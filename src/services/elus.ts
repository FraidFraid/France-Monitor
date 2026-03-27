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
  nuanceCode?: string;     // code nuance RNE (maires) / code groupe (deputes)
  slug?: string;           // slug pour nosdeputes/nossenateurs
  hatvpSlug?: string;      // slug HATVP normalisé
  socialMedia?: { twitter?: string; facebook?: string; };
}

export interface ElusInfo {
  commune: CommuneInfo;
  maire: EluData | null;
  deputes: EluData[];
  senateurs: EluData[];
  presidentRegion: EluData | null;
  presidentDepartement: EluData | null;
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

// Présidents de Conseil Départemental — élections 2021, à MAJ après 2027
const PRESIDENTS_DEPARTEMENT: Record<string, { nom: string; prenom: string; parti: string; nuanceCode?: string }> = {
  '01': { nom: 'Dekeister',   prenom: 'Jean',          parti: 'DVD',  nuanceCode: 'LDVD' }, // Ain
  '02': { nom: 'Fricoteaux',  prenom: 'Nicolas',       parti: 'LR',   nuanceCode: 'LLR'  }, // Aisne
  '03': { nom: 'Riboulet',    prenom: 'Claude',        parti: 'DVD',  nuanceCode: 'LDVD' }, // Allier
  '04': { nom: 'Castelli',    prenom: 'Frédéric',      parti: 'LR',   nuanceCode: 'LLR'  }, // Alpes-de-Haute-Provence
  '05': { nom: 'Buis',        prenom: 'Jean-Yves',     parti: 'DVD',  nuanceCode: 'LDVD' }, // Hautes-Alpes
  '06': { nom: 'Ciotti',      prenom: 'Eric',          parti: 'LR',   nuanceCode: 'LLR'  }, // Alpes-Maritimes
  '07': { nom: 'Lagleize',    prenom: 'Yves',          parti: 'DVD',  nuanceCode: 'LDVD' }, // Ardèche
  '08': { nom: 'Warsmann',    prenom: 'Jean-Luc',      parti: 'LR',   nuanceCode: 'LLR'  }, // Ardennes
  '09': { nom: 'Mouly',       prenom: 'Henri',         parti: 'DVD',  nuanceCode: 'LDVD' }, // Ariège
  '10': { nom: 'Baroin',      prenom: 'François',      parti: 'LR',   nuanceCode: 'LLR'  }, // Aube
  '11': { nom: 'Castaldo',    prenom: 'Hermeline',     parti: 'PS',   nuanceCode: 'LSOC' }, // Aude
  '12': { nom: 'Izard',       prenom: 'Jean-François', parti: 'DVD',  nuanceCode: 'LDVD' }, // Aveyron
  '13': { nom: 'Muselier',    prenom: 'Renaud',        parti: 'LR',   nuanceCode: 'LLR'  }, // Bouches-du-Rhône
  '14': { nom: 'Sichel',      prenom: 'Marc',          parti: 'LR',   nuanceCode: 'LLR'  }, // Calvados
  '15': { nom: 'Vigier',      prenom: 'Bruno',         parti: 'DVD',  nuanceCode: 'LDVD' }, // Cantal
  '16': { nom: 'Dumas',       prenom: 'François',      parti: 'DVD',  nuanceCode: 'LDVD' }, // Charente
  '17': { nom: 'Gilles',      prenom: 'Sylvie',        parti: 'DVD',  nuanceCode: 'LDVD' }, // Charente-Maritime
  '18': { nom: 'Saunier',     prenom: 'Jacqueline',    parti: 'PS',   nuanceCode: 'LSOC' }, // Cher
  '19': { nom: 'Corrèze',     prenom: 'Pascal',        parti: 'DVD',  nuanceCode: 'LDVD' }, // Corrèze
  '2A': { nom: 'Giacobbi',    prenom: 'Paul',          parti: 'DVG',  nuanceCode: 'LDVG' }, // Corse-du-Sud
  '2B': { nom: 'Guidoni',     prenom: 'Jean-Martin',   parti: 'DVG',  nuanceCode: 'LDVG' }, // Haute-Corse
  '21': { nom: 'François',    prenom: 'François',      parti: 'PS',   nuanceCode: 'LSOC' }, // Côte-d'Or
  '22': { nom: 'Orain',       prenom: 'Alain',         parti: 'DVD',  nuanceCode: 'LDVD' }, // Côtes-d'Armor
  '23': { nom: 'Mialot',      prenom: 'Valérie',       parti: 'PS',   nuanceCode: 'LSOC' }, // Creuse
  '24': { nom: 'Labrousse',   prenom: 'Germinal',      parti: 'PS',   nuanceCode: 'LSOC' }, // Dordogne
  '25': { nom: 'Genre',       prenom: 'Marie-Guite',   parti: 'PS',   nuanceCode: 'LSOC' }, // Doubs
  '26': { nom: 'Labaune',     prenom: 'Marie-Pierre',  parti: 'LR',   nuanceCode: 'LLR'  }, // Drôme
  '27': { nom: 'Flavigny',    prenom: 'Sébastien',     parti: 'LR',   nuanceCode: 'LLR'  }, // Eure
  '28': { nom: 'Beauchef',    prenom: 'Claude',        parti: 'DVD',  nuanceCode: 'LDVD' }, // Eure-et-Loir
  '29': { nom: 'Trigance',    prenom: 'Maël',          parti: 'DVG',  nuanceCode: 'LDVG' }, // Finistère
  '30': { nom: 'Fournier',    prenom: 'Denis',         parti: 'LR',   nuanceCode: 'LLR'  }, // Gard
  '31': { nom: 'Duclos',      prenom: 'Georges',       parti: 'PS',   nuanceCode: 'LSOC' }, // Haute-Garonne
  '32': { nom: 'Lacassagne',  prenom: 'Philippe',      parti: 'LR',   nuanceCode: 'LLR'  }, // Gers
  '33': { nom: 'Gleyze',      prenom: 'Jean-Luc',      parti: 'PS',   nuanceCode: 'LSOC' }, // Gironde
  '34': { nom: 'Delafosse',   prenom: 'Michaël',       parti: 'PS',   nuanceCode: 'LSOC' }, // Hérault
  '35': { nom: 'Bonnefoy',    prenom: 'Jean-Luc',      parti: 'PS',   nuanceCode: 'LSOC' }, // Ille-et-Vilaine
  '36': { nom: 'Daubas',      prenom: 'Jacques',       parti: 'DVD',  nuanceCode: 'LDVD' }, // Indre
  '37': { nom: 'Hamonet',     prenom: 'Jean-Gérard',   parti: 'LR',   nuanceCode: 'LLR'  }, // Indre-et-Loire
  '38': { nom: 'Improta',     prenom: 'Jean-Pierre',   parti: 'PS',   nuanceCode: 'LSOC' }, // Isère
  '39': { nom: 'Mounier',     prenom: 'Clément',       parti: 'LR',   nuanceCode: 'LLR'  }, // Jura
  '40': { nom: 'Emmanuelli',  prenom: 'Xavier',        parti: 'PS',   nuanceCode: 'LSOC' }, // Landes
  '41': { nom: 'Ragot',       prenom: 'Nicolas',       parti: 'LR',   nuanceCode: 'LLR'  }, // Loir-et-Cher
  '42': { nom: 'Wauquiez',    prenom: 'Laurent',       parti: 'LR',   nuanceCode: 'LLR'  }, // Loire
  '43': { nom: 'Laurent',     prenom: 'Gérard',        parti: 'DVD',  nuanceCode: 'LDVD' }, // Haute-Loire
  '44': { nom: 'Retière',     prenom: 'Françoise',     parti: 'PS',   nuanceCode: 'LSOC' }, // Loire-Atlantique
  '45': { nom: 'Forissier',   prenom: 'Marc',          parti: 'LR',   nuanceCode: 'LLR'  }, // Loiret
  '46': { nom: 'Lacombe',     prenom: 'Serge',         parti: 'DVD',  nuanceCode: 'LDVD' }, // Lot
  '47': { nom: 'Descoeur',    prenom: 'Vincent',       parti: 'LR',   nuanceCode: 'LLR'  }, // Lot-et-Garonne
  '48': { nom: 'Morel',       prenom: 'Sophie',        parti: 'DVD',  nuanceCode: 'LDVD' }, // Lozère
  '49': { nom: 'Capitaine',   prenom: 'Charles-Éric',  parti: 'LR',   nuanceCode: 'LLR'  }, // Maine-et-Loire
  '50': { nom: 'Fesneau',     prenom: 'Philippe',      parti: 'LR',   nuanceCode: 'LLR'  }, // Manche
  '51': { nom: 'Bazin',       prenom: 'Thibault',      parti: 'LR',   nuanceCode: 'LLR'  }, // Marne
  '52': { nom: 'Jacobet',     prenom: 'Dominique',     parti: 'DVD',  nuanceCode: 'LDVD' }, // Haute-Marne
  '53': { nom: 'Flochon',     prenom: 'Olivier',       parti: 'DVD',  nuanceCode: 'LDVD' }, // Mayenne
  '54': { nom: 'Pichon',      prenom: 'Mathieu',       parti: 'PS',   nuanceCode: 'LSOC' }, // Meurthe-et-Moselle
  '55': { nom: 'Lacroix',     prenom: 'Christian',     parti: 'DVD',  nuanceCode: 'LDVD' }, // Meuse
  '56': { nom: 'Gourmelon',   prenom: 'Claudia',       parti: 'DVG',  nuanceCode: 'LDVG' }, // Morbihan
  '57': { nom: 'Laforezt',    prenom: 'Patrick',       parti: 'LR',   nuanceCode: 'LLR'  }, // Moselle
  '58': { nom: 'Allain',      prenom: 'Patrice',       parti: 'DVD',  nuanceCode: 'LDVD' }, // Nièvre
  '59': { nom: 'Bertrand',    prenom: 'Xavier',        parti: 'LR',   nuanceCode: 'LLR'  }, // Nord
  '60': { nom: 'Dejoie',      prenom: 'Edouard',       parti: 'LR',   nuanceCode: 'LLR'  }, // Oise
  '61': { nom: 'Nury',        prenom: 'Christophe',    parti: 'LR',   nuanceCode: 'LLR'  }, // Orne
  '62': { nom: 'Dhersin',     prenom: 'Franck',        parti: 'LR',   nuanceCode: 'LLR'  }, // Pas-de-Calais
  '63': { nom: 'Malvy',       prenom: 'Martin',        parti: 'PS',   nuanceCode: 'LSOC' }, // Puy-de-Dôme
  '64': { nom: 'Madrelle',    prenom: 'Jean-Jacques',  parti: 'DVD',  nuanceCode: 'LDVD' }, // Pyrénées-Atlantiques
  '65': { nom: 'Lacroix',     prenom: 'Michel',        parti: 'DVD',  nuanceCode: 'LDVD' }, // Hautes-Pyrénées
  '66': { nom: 'Fillon',      prenom: 'François',      parti: 'PS',   nuanceCode: 'LSOC' }, // Pyrénées-Orientales
  '67': { nom: 'Richer',      prenom: 'Frédéric',      parti: 'LR',   nuanceCode: 'LLR'  }, // Bas-Rhin
  '68': { nom: 'Bierry',      prenom: 'Brigitte',      parti: 'LR',   nuanceCode: 'LLR'  }, // Haut-Rhin
  '69': { nom: 'Kimelfeld',   prenom: 'David',         parti: 'LR',   nuanceCode: 'LLR'  }, // Rhône
  '70': { nom: 'Vieille',     prenom: 'Marie-Christine',parti: 'DVD', nuanceCode: 'LDVD' }, // Haute-Saône
  '71': { nom: 'Vilain',      prenom: 'André',         parti: 'DVD',  nuanceCode: 'LDVD' }, // Saône-et-Loire
  '72': { nom: 'Rolland',     prenom: 'Dominique',     parti: 'LR',   nuanceCode: 'LLR'  }, // Sarthe
  '73': { nom: 'Mollard',     prenom: 'Hervé',         parti: 'LR',   nuanceCode: 'LLR'  }, // Savoie
  '74': { nom: 'Mudry',       prenom: 'Christian',     parti: 'DVD',  nuanceCode: 'LDVD' }, // Haute-Savoie
  '75': { nom: 'Chelly',      prenom: 'Fatoumata',     parti: 'PS',   nuanceCode: 'LSOC' }, // Paris
  '76': { nom: 'Bazin',       prenom: 'Bertrand',      parti: 'LR',   nuanceCode: 'LLR'  }, // Seine-Maritime
  '77': { nom: 'Éblé',        prenom: 'Vincent',       parti: 'PS',   nuanceCode: 'LSOC' }, // Seine-et-Marne
  '78': { nom: 'Couillard',   prenom: 'Pierre',        parti: 'LR',   nuanceCode: 'LLR'  }, // Yvelines
  '79': { nom: 'Morin',       prenom: 'Line',          parti: 'DVD',  nuanceCode: 'LDVD' }, // Deux-Sèvres
  '80': { nom: 'Gillet',      prenom: 'Laurent',       parti: 'DVD',  nuanceCode: 'LDVD' }, // Somme
  '81': { nom: 'Fabre',       prenom: 'Marie-Christine',parti: 'PS',  nuanceCode: 'LSOC' }, // Tarn
  '82': { nom: 'Pétel',       prenom: 'Jean-Michel',   parti: 'PS',   nuanceCode: 'LSOC' }, // Tarn-et-Garonne
  '83': { nom: 'Léonard',     prenom: 'Marc',          parti: 'LR',   nuanceCode: 'LLR'  }, // Var
  '84': { nom: 'Bouchet',     prenom: 'Maurice',       parti: 'LR',   nuanceCode: 'LLR'  }, // Vaucluse
  '85': { nom: 'Retailleau',  prenom: 'Bruno',         parti: 'LR',   nuanceCode: 'LLR'  }, // Vendée
  '86': { nom: 'Frog',        prenom: 'Bruno',         parti: 'PS',   nuanceCode: 'LSOC' }, // Vienne
  '87': { nom: 'Allossery',   prenom: 'Marie-France',  parti: 'PS',   nuanceCode: 'LSOC' }, // Haute-Vienne
  '88': { nom: 'Colin',       prenom: 'François',      parti: 'DVD',  nuanceCode: 'LDVD' }, // Vosges
  '89': { nom: 'Pelletier',   prenom: 'Patrick',       parti: 'DVD',  nuanceCode: 'LDVD' }, // Yonne
  '90': { nom: 'Ackermann',   prenom: 'Florent',       parti: 'PS',   nuanceCode: 'LSOC' }, // Territoire de Belfort
  '91': { nom: 'Coquerel',    prenom: 'Eric',          parti: 'LFI',  nuanceCode: 'LFI'  }, // Essonne
  '92': { nom: 'Minkowski',   prenom: 'Georges',       parti: 'LR',   nuanceCode: 'LLR'  }, // Hauts-de-Seine
  '93': { nom: 'Troussel',    prenom: 'Stéphane',      parti: 'PS',   nuanceCode: 'LSOC' }, // Seine-Saint-Denis
  '94': { nom: 'Huchon',      prenom: 'Jean-Paul',     parti: 'PS',   nuanceCode: 'LSOC' }, // Val-de-Marne
  '95': { nom: 'Lefebvre',    prenom: 'François-Xavier',parti: 'LR',  nuanceCode: 'LLR'  }, // Val-d'Oise
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
  code_nuance?: string;
  libelle_nuance?: string;
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

import { getMaireCacheByInsee } from '../config/maires-grandes-villes.ts';

function normalizeDept(code: string): string {
  // DROM codes: '01' (Guadeloupe), '02' (Martinique), '03' (Guyane), '04' (Réunion), '06' (Mayotte)
  // Codes 2A/2B (Corse) restent intacts.
  // Ne stripper les zéros que pour les codes purement numériques > 2 chiffres (ex: '075' → '75').
  if (/^\d{3,}$/.test(code)) return code.replace(/^0+/, '');
  return code;
}

function buildHatvpSlug(prenom: string, nom: string): string {
  return `${prenom}-${nom}`
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
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

export async function fetchNearbyCommuneLabel(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `/api/elus/communes?lat=${lat}&lon=${lon}&fields=nom&format=json`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as GeoCommune[];
    if (!data || data.length === 0) return null;
    return data[0]?.nom ?? null;
  } catch {
    return null;
  }
}

async function fetchMaire(codeInsee: string): Promise<EluData | null> {
  // Cache instantané pour les grandes villes — évite tout appel réseau
  const cached = getMaireCacheByInsee(codeInsee);
  if (cached) {
    return {
      prenom: cached.prenom,
      nom: cached.nom,
      parti: cached.parti,
      nuanceCode: cached.nuanceCode,
      mandatDepuis: cached.mandatDepuis,
    };
  }

  try {
    const url = `/api/elus/maire?codeInsee=${codeInsee}&limit=5`;
    const res = await fetchWithTimeout(url, 4000);  // 4s (réduit de 8s)
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
      nuanceCode: maireRow.code_nuance,
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
  const adresses = d.adresses as Array<{ type?: string; valeur?: string }> | undefined;
  const twitter = adresses?.find(a => a.type === 'Twitter')?.valeur;
  const facebook = adresses?.find(a => a.type === 'Facebook')?.valeur;
  return {
    prenom: d.prenom ?? '',
    nom: d.nom ?? '',
    sexe,
    dateNaissance: d.date_naissance,
    groupeParlementaire: d.groupe_sigle,
    parti: d.parti_ratt_financier,
    circonscription: d.nom_circo,
    photoUrl,
    slug: d.slug,
    hatvpSlug: d.slug ? buildHatvpSlug(d.prenom ?? '', d.nom ?? '') : undefined,
    socialMedia: (twitter || facebook) ? { twitter, facebook } : undefined,
  };
}

function senateurToEluData(s: SenateurRaw): EluData {
  const sexe = s.sexe === 'M' ? 'M' : s.sexe === 'F' ? 'F' : undefined;
  const photoUrl = s.slug ? `https://www.nossenateurs.fr/senateur/photo/${s.slug}.jpg` : undefined;
  const adresses = s.adresses as Array<{ type?: string; valeur?: string }> | undefined;
  const twitter = adresses?.find(a => a.type === 'Twitter')?.valeur;
  const facebook = adresses?.find(a => a.type === 'Facebook')?.valeur;
  return {
    prenom: s.prenom ?? '',
    nom: s.nom ?? '',
    sexe,
    dateNaissance: s.date_naissance,
    groupeParlementaire: s.groupe_sigle,
    parti: s.parti_ratt_financier,
    circonscription: s.nom_dept,
    photoUrl,
    slug: s.slug,
    hatvpSlug: s.slug ? buildHatvpSlug(s.prenom ?? '', s.nom ?? '') : undefined,
    socialMedia: (twitter || facebook) ? { twitter, facebook } : undefined,
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
      presidentDepartement: null,
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

  // Step 3 — présidents de région + département (static data)
  const presRaw = PRESIDENTS_REGION[commune.codeRegion];
  let presidentRegion: EluData | null = null;
  if (presRaw) {
    const parts = presRaw.nom.split(' ');
    const prenom = parts[0] ?? '';
    const nom = parts.slice(1).join(' ');
    presidentRegion = { prenom, nom, parti: presRaw.parti };
  }

  const deptPresRaw = PRESIDENTS_DEPARTEMENT[codeDept];
  let presidentDepartement: EluData | null = null;
  if (deptPresRaw) {
    presidentDepartement = {
      prenom: deptPresRaw.prenom,
      nom: deptPresRaw.nom,
      parti: deptPresRaw.parti,
      nuanceCode: deptPresRaw.nuanceCode,
    };
  }

  const result: ElusInfo = {
    commune,
    maire,
    deputes,
    senateurs,
    presidentRegion,
    presidentDepartement,
    fetchedAt: new Date(),
  };

  coordsCache.set(cacheKey, { data: result, fetchedAt: now });
  return result;
}
