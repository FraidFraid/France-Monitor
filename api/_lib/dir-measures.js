// api/_lib/dir-measures.js : mesures du réseau routier national et bouchons des autoroutes concédées
// (spec 2026-10-03 panneaux trafic § 2.1).
// - QTV (`qtvDir.xml`, période de 6 min) : vitesse et débit par station ; référentiel `refDir.csv` en
//   Lambert-93 (EPSG:2154) reprojeté en WGS84 ; sentinelles 0 et 9999999 écartées ; station lente =
//   moins de 50 km/h avec plus de 1 000 véhicules par heure ; médiane nationale.
// - Traficolor (`TRAFICOLOR-DIR/<réseau>/`, un fichier par minute ou par 6 min) : niveaux fluide, dense,
//   saturé, inconnu par section, dernier fichier de chaque réseau ; part saturée sur les sections connues.
// - CNIR (`RecapBouchonsFranceEntiere.html`, page publique sans protection) : bouchons des autoroutes
//   concédées (origine « SCA … ») ; les lignes d'origine DIR sont déjà dans le flux DATEX II.
import { parisLocalToIso, parisWallTime } from './paris-time.js';
import { cleanText, fetchStrictHtml, fetchStrictText, fetchStrictXml } from './source-http.js';

const BASE = 'https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR';
export const QTV_URL = `${BASE}/QTV-DIR/qtvDir.xml`;
export const REFDIR_URL = `${BASE}/QTV-DIR/refDir.csv`;
export const TRAFICOLOR_BASE = `${BASE}/TRAFICOLOR-DIR`;
export const CNIR_URL = `${BASE}/Evenementiel-DIR/cnir/RecapBouchonsFranceEntiere.html`;

export const SLOW_SPEED_KMH = 50;
export const SLOW_MIN_FLOW_VPH = 1000;
export const SLOWEST_MAX = 10;
const SENTINEL_SPEEDS = new Set([0, 9_999_999]);

/** Codes DIR du référentiel → libellés du flux DATEX II. */
export const DIR_CODES = {
  DIRA: 'DIR Atlantique', DIRCE: 'DIR Centre-Est', DIRCO: 'DIR Centre-Ouest', DIRE: 'DIR Est', DIRIF: 'DIR Île-de-France',
  DIRMC: 'DIR Massif-Central', DIRMED: 'DIR Méditerranée', DIRN: 'DIR Nord', DIRNO: 'DIR Nord-Ouest', DIRO: 'DIR Ouest', DIRSO: 'DIR Sud-Ouest',
};

/**
 * Réseaux Traficolor (dossier → agglomération). Les huit villes communes avec la collecte TomTom portent le
 * même libellé (Lyon, Marseille, Lille, Bordeaux, Toulouse, Nantes, Rennes, Grenoble) ; les autres sont
 * déduits des sections géolocalisées du référentiel (relevé du 03/10/2026).
 */
export const TRAFICOLOR_NETWORKS = {
  ALIENOR: 'Bordeaux',
  TRAFIC_TraficStBrieuc: 'Saint-Brieuc',
  TRAFIC_TraficTriskell56: 'Bretagne sud (Triskell)',
  TraficBreizhNantes: 'Nantes',
  TraficBreizhRennes: 'Rennes',
  TraficCaen: 'Caen',
  TraficDirmc: 'A75 (DIR Massif-Central)',
  TraficErato: 'Toulouse',
  TraficGentiane: 'Grenoble',
  TraficHyrondelle: 'Saint-Étienne',
  TraficLille: 'Lille',
  TraficLimoges: 'Limoges et A20',
  TraficLyon: 'Lyon',
  TraficMarius: 'Marseille',
  TraficMyrabel: 'Lorraine (Myrabel)',
  TraficRouen: 'Rouen',
};

// Lambert-93 (IGN, ellipsoïde GRS80) : constantes de la projection conique conforme sécante.
const L93 = { n: 0.725607765053267, c: 11754255.426096, xs: 700000, ys: 12655612.049876, e: 0.0818191910428158, lon0: (3 * Math.PI) / 180 };

/** Lambert-93 (m) → [longitude, latitude] en degrés WGS84 ; null si les coordonnées sont illisibles. */
export function lambert93ToWgs84(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) return null;
  const dx = x - L93.xs;
  const dy = y - L93.ys;
  const r = Math.hypot(dx, dy);
  const lon = L93.lon0 + Math.atan(dx / -dy) / L93.n;
  const iso = -Math.log(r / L93.c) / L93.n;
  let lat = 2 * Math.atan(Math.exp(iso)) - Math.PI / 2;
  for (let i = 0; i < 20; i += 1) {
    const s = L93.e * Math.sin(lat);
    const next = 2 * Math.atan(((1 + s) / (1 - s)) ** (L93.e / 2) * Math.exp(iso)) - Math.PI / 2;
    if (Math.abs(next - lat) < 1e-12) { lat = next; break; }
    lat = next;
  }
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

function roundCoord(v) {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Lignes du référentiel `refDir.csv` sous forme d'objets colonne → valeur. Les lignes de données ont 19
 * colonnes pour un en-tête de 20 (`code_insee_commune` absent des données, constaté le 03/10/2026) :
 * l'en-tête est alors lu sans cette colonne. Une page HTML à la place du CSV : erreur.
 */
function readRefDirRows(csv) {
  const lines = String(csv ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines[0]?.startsWith('code_pme;')) throw new SyntaxError('refDir.csv : en-tête inattendu');
  const header = lines[0].split(';');
  const shortHeader = header.filter((h) => h !== 'code_insee_commune');
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(';');
    const names = cells.length === header.length ? header : shortHeader;
    const row = Object.fromEntries(names.map((h, i) => [h, (cells[i] ?? '').trim()]));
    if (row.code_pme) rows.push(row);
  }
  return rows;
}

/**
 * Référentiel : identifiant → DIR, route, coordonnées du début de section.
 * @returns {Map<string, { dir: string, road: string | null, lat: number | null, lon: number | null }>}
 */
export function parseRefDir(csv) {
  const out = new Map();
  for (const row of readRefDirRows(csv)) {
    const point = lambert93ToWgs84(Number(row.x_deb), Number(row.y_deb));
    const road = /^([A-Z]+)0*(\d.*)$/.exec(row.axe ?? '');
    out.set(row.code_pme, {
      dir: DIR_CODES[row.source] ?? row.source,
      road: road ? `${road[1]}${road[2]}` : (row.axe || null),
      lat: point ? roundCoord(point[1]) : null,
      lon: point ? roundCoord(point[0]) : null,
    });
  }
  return out;
}

/**
 * Géométrie des sections du référentiel (amendement 3) : identifiant → [[lon, lat] début, [lon, lat] fin],
 * seulement quand les deux extrémités sont lisibles et distinctes (début = fin : tracé de longueur nulle,
 * écarté). Les sections sans géométrie sont absentes.
 * @returns {Map<string, Array<[number, number]>>}
 */
export function parseRefDirPaths(csv) {
  const out = new Map();
  for (const row of readRefDirRows(csv)) {
    const start = lambert93ToWgs84(Number(row.x_deb), Number(row.y_deb));
    const end = lambert93ToWgs84(Number(row.x_fin), Number(row.y_fin));
    if (!start || !end) continue;
    const path = [[roundCoord(start[0]), roundCoord(start[1])], [roundCoord(end[0]), roundCoord(end[1])]];
    if (path[0][0] === path[1][0] && path[0][1] === path[1][1]) continue;
    out.set(row.code_pme, path);
  }
  return out;
}

const NS = '(?:[A-Za-z0-9_]+:)?';
function first(xml, tag) {
  const m = new RegExp(`<${NS}${tag}(?=[\\s>])[^>]*>([^<]*)</${NS}${tag}>`).exec(xml);
  return m ? m[1].trim() : null;
}
function siteBlocks(xml) {
  return [...String(xml).matchAll(new RegExp(`<${NS}siteMeasurements>([\\s\\S]*?)</${NS}siteMeasurements>`, 'g'))].map((m) => m[1]);
}
function siteId(block) {
  return /measurementSiteReference[^>]*\sid="([^"]+)"/.exec(block)?.[1] ?? null;
}

/** QTV : date de mesure (fin de période) et valeurs brutes par station. */
export function parseQtv(xml) {
  if (!/d2LogicalModel/.test(String(xml))) throw new SyntaxError('qtvDir.xml : document DATEX II attendu');
  let at = null;
  const stations = [];
  for (const block of siteBlocks(xml)) {
    const id = siteId(block);
    if (!id) continue;
    const time = first(block, 'measurementTimeDefault');
    if (time && (!at || Date.parse(time) > Date.parse(at))) at = time;
    const speed = Number(first(block, 'speed'));
    const flow = Number(first(block, 'vehicleFlowRate'));
    stations.push({ id, speed: first(block, 'speed') === null ? null : speed, flow: first(block, 'vehicleFlowRate') === null ? null : flow });
  }
  if (stations.length === 0) throw new SyntaxError('qtvDir.xml : aucune station');
  return { at, stations };
}

/**
 * Partie « vitesses » de la réponse : stations valides (sentinelles écartées), stations lentes (moins de
 * 50 km/h avec plus de 1 000 véhicules par heure), médiane nationale, les dix plus lentes.
 */
export function summarizeSpeeds(qtv, ref) {
  const valid = qtv.stations.filter((s) => s.speed !== null && Number.isFinite(s.speed) && !SENTINEL_SPEEDS.has(s.speed));
  // Débit sentinelle (9999999) : jamais pris pour un vrai débit
  const flowOf = (s) => (s.flow === null || !Number.isFinite(s.flow) || s.flow === 9_999_999 ? 0 : s.flow);
  const speeds = valid.map((s) => s.speed).sort((a, b) => a - b);
  const mid = Math.floor(speeds.length / 2);
  const median = speeds.length === 0 ? null : speeds.length % 2 ? speeds[mid] : (speeds[mid - 1] + speeds[mid]) / 2;
  const slow = valid
    .filter((s) => s.speed < SLOW_SPEED_KMH && flowOf(s) > SLOW_MIN_FLOW_VPH)
    .sort((a, b) => a.speed - b.speed);
  return {
    at: qtv.at,
    stations: valid.length,
    under50: slow.length,
    median: median === null ? null : Math.round(median * 10) / 10,
    slowest: slow.slice(0, SLOWEST_MAX).map((s) => {
      const r = ref.get(s.id);
      return {
        id: s.id, dir: r?.dir ?? 'DIR non précisée', road: r?.road ?? null, speed: Math.round(s.speed * 10) / 10,
        flow: s.flow, lat: r?.lat ?? null, lon: r?.lon ?? null,
      };
    }),
  };
}

/** Fichiers listés dans une page d'index Apache (noms, sans les liens de tri ni le dossier parent). */
export function parseListing(html) {
  return [...String(html).matchAll(/<a href="([^"?/][^"?]*)">/g)].map((m) => m[1]);
}

/** Dernier fichier de données d'un réseau : horodatage le plus récent dans le nom (…_AAAAMMJJ_HHMMSS.xml). */
export function latestDataFile(names) {
  let best = null;
  for (const name of names) {
    const m = /_DataTRT_(\d{8})_(\d{6})\.xml$/.exec(name);
    if (m && (!best || `${m[1]}${m[2]}` > best.key)) best = { key: `${m[1]}${m[2]}`, name };
  }
  return best?.name ?? null;
}

/** Fichier Traficolor : date de publication (ISO UTC) et niveau par section. */
export function parseTraficolor(xml) {
  if (!/d2LogicalModel/.test(String(xml))) throw new SyntaxError('Traficolor : document DATEX II attendu');
  const statuses = siteBlocks(xml).map((b) => ({ id: siteId(b), status: first(b, 'trafficStatusValue') ?? 'unknown' }));
  return { at: parisLocalToIso(first(xml, 'publicationTime')), statuses };
}

/** Agrégat officiel d'un réseau (contrat RoadAggloOfficial) ; part saturée sur les sections de niveau connu. */
export function summarizeTraficolor(network, parsed) {
  const count = (v) => parsed.statuses.filter((s) => s.status === v).length;
  const freeFlow = count('freeFlow');
  const heavy = count('heavy');
  const congested = count('congested');
  const sections = parsed.statuses.length;
  const unknown = sections - freeFlow - heavy - congested;
  const known = sections - unknown;
  return {
    network,
    label: TRAFICOLOR_NETWORKS[network] ?? network,
    sections, freeFlow, heavy, congested, unknown,
    congestedPct: known > 0 ? Math.round((congested / known) * 1000) / 10 : null,
    at: parsed.at ?? '',
  };
}

const FR_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function qname(block, name) {
  const m = new RegExp(`qname="${name}"[^>]*>([^<]*)`).exec(block);
  return m ? cleanText(m[1]) : null;
}

/**
 * Récapitulatif CNIR des bouchons : date de la page (« du 3 octobre 2026 à 15h42 », heure de Paris) et
 * bouchons des autoroutes concédées (origine « SCA … »), lus sur les attributs `qname` de la page.
 * Une page sans « Récapitulatif » n'est pas la bonne page : erreur.
 */
export function parseCnir(html) {
  const text = String(html ?? '');
  if (!/Récapitulatif/.test(text)) throw new SyntaxError('CNIR : récapitulatif introuvable dans la page');
  const date = /du (\d{1,2}) (\p{L}+) (\d{4}) à (\d{1,2})h(\d{2})/u.exec(text);
  const month = date ? FR_MONTHS.indexOf(date[2].toLowerCase()) + 1 : 0;
  const at = date && month > 0 ? new Date(parisWallTime(Number(date[3]), month, Number(date[1]), Number(date[4]), Number(date[5]))).toISOString() : null;
  const jams = [];
  for (const block of text.split('<div class="interligne">').slice(1)) {
    const origin = qname(block, 'origine_vr');
    if (!origin || !/^Origine : SCA\b/.test(origin)) continue;
    const stars = (qname(block, 'importance_vr_reduit') ?? '').length;
    const motorway = qname(block, 'axe');
    if (!motorway) continue;
    const nature = qname(block, 'nature_bouchon') ?? 'Bouchon';
    const lengthText = qname(block, 'lg_bouchon');
    const km = lengthText ? Number(/([\d,]+)\s*km/.exec(lengthText)?.[1]?.replace(',', '.')) : Number.NaN;
    const poles = /de (.+?) vers (.+)$/.exec(qname(block, 'sens_par_pole') ?? '');
    const commune = qname(block, 'commune');
    const pieces = [`${nature}${lengthText ? ` ${lengthText}` : ''}`, motorway, poles ? `de ${poles[1]} vers ${poles[2]}` : null, commune];
    jams.push({
      motorway,
      lengthKm: Number.isFinite(km) ? km : null,
      from: poles ? poles[1].trim() : null,
      to: poles ? poles[2].trim() : null,
      operator: origin.replace(/^Origine : SCA\s*/, '').replace(/\s*\(DatexII\)\s*$/i, '').trim() || null,
      importance: /** @type {1 | 2 | 3} */ (Math.min(3, Math.max(1, stars))),
      text: pieces.filter(Boolean).join(', '),
    });
  }
  return { at, jams };
}

/** Lecture de QTV et du référentiel ; le référentiel ({ stations, paths }) est passé par l'appelant (mis en cache 24 h). */
export async function loadSpeeds(readRef) {
  const [xml, ref] = await Promise.all([fetchStrictXml(QTV_URL, { timeoutMs: 20_000 }), readRef()]);
  return summarizeSpeeds(parseQtv(xml), ref.stations);
}

/** Référentiel des stations (coordonnées du début) et des sections (tracé début-fin), lu une seule fois. */
export async function loadRefDir() {
  const csv = await fetchStrictText(REFDIR_URL, { timeoutMs: 20_000 });
  return { stations: parseRefDir(csv), paths: parseRefDirPaths(csv) };
}

/** Réseaux Traficolor listés à la racine du dossier. */
export async function loadTraficolorNetworks() {
  const names = parseListing(await fetchStrictHtml(`${TRAFICOLOR_BASE}/`, { timeoutMs: 15_000 }))
    .filter((n) => n.endsWith('/'))
    .map((n) => n.slice(0, -1));
  if (names.length === 0) throw new SyntaxError('Traficolor : aucun réseau listé');
  return names;
}

/**
 * Sections Traficolor géolocalisées (amendement 3) : celles du dernier fichier dont l'identifiant a un tracé
 * dans le référentiel. Les autres comptent dans l'agrégat de l'agglomération mais restent hors de la carte.
 */
export function buildSections(network, parsed, paths) {
  const out = [];
  for (const s of parsed.statuses) {
    const path = s.id ? paths.get(s.id) : undefined;
    if (!s.id || !path) continue;
    const status = s.status === 'freeFlow' || s.status === 'heavy' || s.status === 'congested' ? s.status : 'unknown';
    out.push({ id: s.id, network, status, path });
  }
  return out;
}

/** Dernier fichier d'un réseau Traficolor : agrégat et niveaux par section. */
export async function loadTraficolorFile(network) {
  const listing = await fetchStrictHtml(`${TRAFICOLOR_BASE}/${network}/?C=M;O=D`, { timeoutMs: 15_000 });
  const file = latestDataFile(parseListing(listing));
  if (!file) throw new SyntaxError('aucun fichier de données');
  const parsed = parseTraficolor(await fetchStrictXml(`${TRAFICOLOR_BASE}/${network}/${file}`, { timeoutMs: 20_000 }));
  return { summary: summarizeTraficolor(network, parsed), parsed };
}

/** Dernier fichier d'un réseau Traficolor, agrégé. */
export async function loadTraficolorNetwork(network) {
  return (await loadTraficolorFile(network)).summary;
}

/** Bouchons des autoroutes concédées (CNIR). */
export async function loadConceded() {
  return parseCnir(await fetchStrictHtml(CNIR_URL, { timeoutMs: 15_000 }));
}
