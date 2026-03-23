/**
 * elus.ts — Service de récupération des élus pour une coordonnée géographique.
 * Sources : geo.api.gouv.fr, tabular-api.data.gouv.fr, api.nosdeputes.fr, api.nossenateurs.fr
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CommuneInfo {
  nom: string;
  code: string;
  codePostal: string;
  codeDepartement: string;
  nomDepartement: string;
  codeRegion: string;
  nomRegion: string;
  population: number;
}

export interface EluData {
  prenom: string;
  nom: string;
  sexe?: 'M' | 'F';
  dateNaissance?: string;
  parti?: string;
  groupeParlementaire?: string;
  mandatDepuis?: string;
  profession?: string;
  email?: string;
  siteWeb?: string;
  photoUrl?: string;
  circonscription?: string;
}

export interface ElusInfo {
  commune: CommuneInfo;
  maire: EluData | null;
  deputes: EluData[];
  senateurs: EluData[];
  presidentRegion: EluData | null;
  fetchedAt: Date;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const TTL_COORDS_MS = 30 * 60 * 1000;   // 30 min for coord-based cache
const TTL_PARLEMENT_MS = 6 * 60 * 60 * 1000; // 6h for parliamentary APIs

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const coordsCache = new Map<string, CacheEntry<ElusInfo>>();
let deputesCache: CacheEntry<DeputeRaw[]> | null = null;
let senateursCache: CacheEntry<SenateurRaw[]> | null = null;

// ─── Static data ──────────────────────────────────────────────────────────────

// Présidents de région — à mettre à jour après les élections 2027
// Codes régions INSEE métropolitains
const PRESIDENTS_REGION: Record<string, { nom: string; parti: string }> = {
  '11': { nom: 'Valérie Pécresse',        parti: 'LR' },           // Île-de-France
  '24': { nom: 'François Bonneau',         parti: 'PS' },           // Centre-Val de Loire
  '27': { nom: 'Marie-Guite Dufay',        parti: 'PS' },           // Bourgogne-Franche-Comté
  '28': { nom: 'Hervé Morin',              parti: 'Centristes' },   // Normandie
  '32': { nom: 'Xavier Bertrand',          parti: 'LR' },           // Hauts-de-France
  '44': { nom: 'Franck Leroy',             parti: 'RE' },           // Grand Est
  '52': { nom: 'Christelle Morançais',     parti: 'LR' },           // Pays de la Loire
  '53': { nom: 'Loïg Chesnais-Girard',    parti: 'PS' },           // Bretagne
  '75': { nom: 'Alain Rousset',            parti: 'PS' },           // Nouvelle-Aquitaine
  '76': { nom: 'Carole Delga',             parti: 'PS' },           // Occitanie
  '84': { nom: 'Fabrice Pannekoucke',      parti: 'LR' },           // Auvergne-Rhône-Alpes
  '93': { nom: 'Renaud Muselier',          parti: 'LR' },           // Provence-Alpes-Côte d'Azur
  '94': { nom: 'Marie-Antoinette Maupertuis', parti: 'Pè a Corsica' }, // Corse
  // DROM
  '01': { nom: 'Ary Chalus',              parti: 'LIOT' },          // Guadeloupe
  '02': { nom: 'Serge Letchimy',          parti: 'PPM' },           // Martinique
  '03': { nom: 'Gabriel Serville',        parti: 'GRS' },           // Guyane
  '04': { nom: 'Huguette Bello',          parti: 'PLR' },           // La Réunion
  '06': { nom: 'Ben Issa Ousseni',        parti: 'DVG' },           // Mayotte
};

// ─── Raw API types ────────────────────────────────────────────────────────────

interface GeoCommune {
  nom: string;
  code: string;
  codesPostaux: string[];
  codeDepartement: string;
  codeRegion: string;
  population: number;
}

interface GeoNamed {
  nom: string;
}

interface MaireRaw {
  prenom_de_l_elu: string;
  nom_de_l_elu: string;
  libelle_de_la_profession?: string;
  date_de_debut_du_mandat?: string;
  code_sexe?: string;
  libelle_de_la_fonction?: string;
}

interface DeputeRaw {
  prenom: string;
  nom: string;
  sexe?: string;
  date_naissance?: string;
  groupe_sigle?: string;
  parti_ratt_financier?: string;
  nom_circo?: string;
  num_deptmt?: string;
  slug?: string;
  adresses?: unknown;
}

interface DeputeWrapper {
  depute: DeputeRaw;
}

interface SenateurRaw {
  prenom: string;
  nom: string;
  sexe?: string;
  date_naissance?: string;
  groupe_sigle?: string;
  parti_ratt_financier?: string;
  nom_dept?: string;
  num_dept?: string;
  slug?: string;
  adresses?: unknown;
}

interface SenateurWrapper {
  senateur: SenateurRaw;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(tid);
  }
}

function normalizeDept(code: string): string {
  // Ensure 2-char format without leading zeros for regions in the 1-9 range
  return code;
}

// ─── Individual fetchers ──────────────────────────────────────────────────────

async function fetchCommune(lat: number, lon: number): Promise<{ commune: CommuneInfo } | null> {
  try {
    const url = `/api/elus/communes?lat=${lat}&lon=${lon}&fields=nom,code,codesPostaux,codeDepartement,codeRegion,population&format=json`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as GeoCommune[];
    if (!data || data.length === 0) return null;
    const raw = data[0];

    // Fetch dept and region names in parallel
    const [deptRes, regionRes] = await Promise.allSettled([
      fetchWithTimeout(`/api/elus/departements/${raw.codeDepartement}?fields=nom`),
      fetchWithTimeout(`/api/elus/regions/${raw.codeRegion}?fields=nom`),
    ]);

    let nomDepartement = raw.codeDepartement;
    let nomRegion = raw.codeRegion;

    if (deptRes.status === 'fulfilled' && deptRes.value.ok) {
      const deptData = (await deptRes.value.json()) as GeoNamed;
      nomDepartement = deptData.nom ?? nomDepartement;
    }
    if (regionRes.status === 'fulfilled' && regionRes.value.ok) {
      const regionData = (await regionRes.value.json()) as GeoNamed;
      nomRegion = regionData.nom ?? nomRegion;
    }

    return {
      commune: {
        nom: raw.nom,
        code: raw.code,
        codePostal: raw.codesPostaux?.[0] ?? '',
        codeDepartement: raw.codeDepartement,
        nomDepartement,
        codeRegion: raw.codeRegion,
        nomRegion,
        population: raw.population ?? 0,
      },
    };
  } catch {
    return null;
  }
}

async function fetchMaire(codeInsee: string): Promise<EluData | null> {
  try {
    const url = `/api/elus/maire?codeInsee=${codeInsee}&limit=5`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: MaireRaw[] };
    const rows: MaireRaw[] = json.data ?? [];
    const maireRow = rows.find(
      (r) =>
        typeof r.libelle_de_la_fonction === 'string' &&
        r.libelle_de_la_fonction.toLowerCase().includes('maire') &&
        !r.libelle_de_la_fonction.toLowerCase().includes('adjoint')
    );
    if (!maireRow) return null;
    const sexe = maireRow.code_sexe === 'M' ? 'M' : maireRow.code_sexe === 'F' ? 'F' : undefined;
    return {
      prenom: maireRow.prenom_de_l_elu ?? '',
      nom: maireRow.nom_de_l_elu ?? '',
      sexe,
      profession: maireRow.libelle_de_la_profession,
      mandatDepuis: maireRow.date_de_debut_du_mandat,
    };
  } catch {
    return null;
  }
}

async function fetchAllDeputes(): Promise<DeputeRaw[]> {
  const now = Date.now();
  if (deputesCache && now - deputesCache.fetchedAt < TTL_PARLEMENT_MS) {
    return deputesCache.data;
  }
  try {
    const res = await fetchWithTimeout('/api/elus/deputes', 25000);
    if (!res.ok) return [];
    const json = (await res.json()) as { deputes?: DeputeWrapper[] };
    const list = (json.deputes ?? []).map((w) => w.depute);
    deputesCache = { data: list, fetchedAt: now };
    return list;
  } catch {
    return deputesCache?.data ?? [];
  }
}

async function fetchAllSenateurs(): Promise<SenateurRaw[]> {
  const now = Date.now();
  if (senateursCache && now - senateursCache.fetchedAt < TTL_PARLEMENT_MS) {
    return senateursCache.data;
  }
  try {
    const res = await fetchWithTimeout('/api/elus/senateurs', 25000);
    if (!res.ok) return [];
    const json = (await res.json()) as { senateurs?: SenateurWrapper[] };
    const list = (json.senateurs ?? []).map((w) => w.senateur);
    senateursCache = { data: list, fetchedAt: now };
    return list;
  } catch {
    return senateursCache?.data ?? [];
  }
}

function deputeToEluData(d: DeputeRaw): EluData {
  const sexe = d.sexe === 'M' ? 'M' : d.sexe === 'F' ? 'F' : undefined;
  const photoUrl = d.slug ? `https://www.nosdeputes.fr/depute/photo/${d.slug}.jpg` : undefined;
  return {
    prenom: d.prenom ?? '',
    nom: d.nom ?? '',
    sexe,
    dateNaissance: d.date_naissance,
    groupeParlementaire: d.groupe_sigle,
    parti: d.parti_ratt_financier,
    circonscription: d.nom_circo,
    photoUrl,
  };
}

function senateurToEluData(s: SenateurRaw): EluData {
  const sexe = s.sexe === 'M' ? 'M' : s.sexe === 'F' ? 'F' : undefined;
  const photoUrl = s.slug ? `https://www.nossenateurs.fr/senateur/photo/${s.slug}.jpg` : undefined;
  return {
    prenom: s.prenom ?? '',
    nom: s.nom ?? '',
    sexe,
    dateNaissance: s.date_naissance,
    groupeParlementaire: s.groupe_sigle,
    parti: s.parti_ratt_financier,
    circonscription: s.nom_dept,
    photoUrl,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchElusByCoords(lat: number, lon: number): Promise<ElusInfo> {
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const now = Date.now();
  const cached = coordsCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < TTL_COORDS_MS) {
    return cached.data;
  }

  // Step 1 — resolve commune (required before other lookups)
  const communeResult = await fetchCommune(lat, lon);
  if (!communeResult) {
    // Return minimal fallback
    const fallback: ElusInfo = {
      commune: {
        nom: 'Inconnue',
        code: '',
        codePostal: '',
        codeDepartement: '',
        nomDepartement: '',
        codeRegion: '',
        nomRegion: '',
        population: 0,
      },
      maire: null,
      deputes: [],
      senateurs: [],
      presidentRegion: null,
      fetchedAt: new Date(),
    };
    return fallback;
  }

  const { commune } = communeResult;
  const codeDept = normalizeDept(commune.codeDepartement);

  // Step 2 — parallel fetch of maire + deputes + senateurs
  const [maireResult, allDeputesResult, allSenateursResult] = await Promise.allSettled([
    fetchMaire(commune.code),
    fetchAllDeputes(),
    fetchAllSenateurs(),
  ]);

  const maire = maireResult.status === 'fulfilled' ? maireResult.value : null;

  const allDeputes = allDeputesResult.status === 'fulfilled' ? allDeputesResult.value : [];
  const deputes = allDeputes
    .filter((d) => {
      const deptNorm = String(d.num_deptmt ?? '').replace(/^0+/, '');
      const codeDeptNorm = codeDept.replace(/^0+/, '');
      return deptNorm === codeDeptNorm;
    })
    .map(deputeToEluData);

  const allSenateurs = allSenateursResult.status === 'fulfilled' ? allSenateursResult.value : [];
  const senateurs = allSenateurs
    .filter((s) => {
      const sNum = String(s.num_dept ?? '').replace(/^0+/, '');
      const codeDeptNorm = codeDept.replace(/^0+/, '');
      return sNum === codeDeptNorm;
    })
    .map(senateurToEluData);

  // Step 3 — président de région (static data)
  const presRaw = PRESIDENTS_REGION[commune.codeRegion];
  let presidentRegion: EluData | null = null;
  if (presRaw) {
    const parts = presRaw.nom.split(' ');
    const prenom = parts[0] ?? '';
    const nom = parts.slice(1).join(' ');
    presidentRegion = { prenom, nom, parti: presRaw.parti };
  }

  const result: ElusInfo = {
    commune,
    maire,
    deputes,
    senateurs,
    presidentRegion,
    fetchedAt: new Date(),
  };

  coordsCache.set(cacheKey, { data: result, fetchedAt: now });
  return result;
}
