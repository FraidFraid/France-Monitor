// api/_handlers/energy/drom-live.js : production d'électricité par filière en temps réel des territoires
// non interconnectés (EDF SEI, open data gratuite, pas de 5 min, 15 min en Corse, statut « Estimé »).
// Spec 2026-10-02 lot 2 § 2.2. Un appel par territoire ; un territoire en erreur n'empêche pas les autres.

const EDF_BASE = 'https://opendata.edf.fr/data-fair/api/v1/datasets';

/** Territoires publiés en temps réel (Mayotte ne l'est pas). */
export const DROM_LIVE_TERRITORIES = Object.freeze([
  { code: 'RE', name: 'La Réunion', dataset: 'njq-knwu0diqrdup6tya8qxi', timeZone: 'Indian/Reunion', utcOffsetLabel: 'UTC+4' },
  { code: 'GP', name: 'Guadeloupe', dataset: '0ba5scbyc293-o3ysyn0b2e6', timeZone: 'America/Guadeloupe', utcOffsetLabel: 'UTC−4' },
  { code: 'MQ', name: 'Martinique', dataset: 'eua6h7wc9lm8upptrutp76kc', timeZone: 'America/Martinique', utcOffsetLabel: 'UTC−4' },
  { code: 'GF', name: 'Guyane', dataset: '90wor4x46g95v4zrsfusmtqa', timeZone: 'America/Cayenne', utcOffsetLabel: 'UTC−3' },
  { code: 'COR', name: 'Corse', dataset: 'k18y10din3b036hq9tt7puwn', timeZone: 'Europe/Paris', utcOffsetLabel: 'heure de Paris' },
]);

/** Filières communes, dans l'ordre d'affichage. */
export const SECTORS = Object.freeze(['coal', 'oil', 'turbine', 'bio', 'geothermal', 'hydro', 'solar', 'wind', 'storage', 'links', 'other']);

/** Noms de champs EDF (variables selon le territoire) → filière commune. */
const FIELD_SECTOR = Object.freeze({
  charbon: 'coal',
  diesel: 'oil', moteurs_diesels: 'oil', moteur_diesel: 'oil',
  turbines_combustion: 'turbine', tac: 'turbine',
  bioenergies: 'bio',
  geothermie: 'geothermal',
  hydraulique: 'hydro', micro_hydro: 'hydro',
  photovoltaique: 'solar',
  eolien: 'wind',
  stockage: 'storage', solde_stockage: 'storage',
  liaisons: 'links',
});
const RENEWABLE = Object.freeze(['bio', 'geothermal', 'hydro', 'solar', 'wind']);
/** Champs qui ne sont pas des productions : horodatage, statut, total publié. */
const META_FIELDS = new Set(['date', 'jour', 'date_jour', 'statut', 'total']);
/** Champs techniques data-fair (_i, _id…), agrégats (filiere_*) et parts en % (part_*) publiés en Corse :
 *  les additionner compterait deux fois la même production. */
const DERIVED_FIELD = /^(?:_|part_|filiere_)/;

const warned = new Set();
/** Champ de production inconnu : journalisé une fois par territoire et champ ; compté dans « autres ». */
function warnUnknown(code, field) {
  const key = `${code}:${field}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[api/energy/drom-live] champ inconnu ${key} : compté dans « autres »`);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function emptyMix() {
  return Object.fromEntries(SECTORS.map((s) => [s, null]));
}

function positiveSum(mix) {
  const values = SECTORS.map((s) => mix[s]).filter(isNum);
  return values.length === 0 ? null : values.reduce((sum, v) => sum + Math.max(0, v), 0);
}

/**
 * Une ligne EDF → { at, status, totalMw, mix }. Filières en MW signés (négatif : stockage en
 * charge, export par les liaisons, auxiliaires) ; null = filière non publiée, jamais 0.
 */
export function normalizeLine(code, line, warn = warnUnknown) {
  const mix = emptyMix();
  for (const [field, value] of Object.entries(line ?? {})) {
    if (META_FIELDS.has(field) || DERIVED_FIELD.test(field) || !isNum(value)) continue;
    const sector = Object.hasOwn(FIELD_SECTOR, field) ? FIELD_SECTOR[field] : 'other';
    if (sector === 'other') warn(code, field);
    mix[sector] = (mix[sector] ?? 0) + value;
  }
  const date = typeof line?.date === 'string' ? line.date : null;
  const at = date ? Date.parse(date) : Number.NaN;
  return {
    at: Number.isFinite(at) ? at : null,
    status: typeof line?.statut === 'string' ? line.statut : null,
    totalMw: isNum(line?.total) ? line.total : positiveSum(mix),
    mix,
  };
}

function renewableShare(row) {
  if (!isNum(row.totalMw) || row.totalMw <= 0) return null;
  const renewable = RENEWABLE.reduce((sum, s) => sum + Math.max(0, row.mix[s] ?? 0), 0);
  return Math.round((renewable / row.totalMw) * 100);
}

export function errorTerritory(cfg, message) {
  return {
    code: cfg.code, name: cfg.name, utcOffsetLabel: cfg.utcOffsetLabel, timeZone: cfg.timeZone,
    state: 'error', error: message, dataTime: null, status: null, totalMw: null, mix: emptyMix(), renewableSharePct: null, day: [],
  };
}

/** Jour local (AAAA-MM-JJ) d'un instant dans le fuseau du territoire : indépendant de la façon dont EDF écrit la date (décalage local ou « Z »). */
function localDay(ms, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date(ms));
}

/** Dernière ligne du territoire et courbe de sa journée locale (ordre croissant). */
export function buildTerritory(cfg, lines, warn = warnUnknown) {
  const rows = (Array.isArray(lines) ? lines : [])
    .map((line) => normalizeLine(cfg.code, line, warn))
    .filter((row) => row.at !== null)
    .sort((a, b) => b.at - a.at);
  const latest = rows[0];
  if (!latest) return errorTerritory(cfg, 'aucune ligne exploitable');
  const day = rows
    .filter((row) => localDay(row.at, cfg.timeZone) === localDay(latest.at, cfg.timeZone))
    .map((row) => ({ at: row.at, totalMw: row.totalMw }))
    .sort((a, b) => a.at - b.at);
  return {
    code: cfg.code, name: cfg.name, utcOffsetLabel: cfg.utcOffsetLabel, timeZone: cfg.timeZone,
    state: 'ok', error: null, dataTime: latest.at, status: latest.status, totalMw: latest.totalMw,
    mix: latest.mix, renewableSharePct: renewableShare(latest), day,
  };
}

async function fetchTerritory(cfg) {
  try {
    const resp = await fetch(`${EDF_BASE}/${cfg.dataset}/lines?size=300&sort=-date`, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return errorTerritory(cfg, `HTTP ${resp.status}`);
    const json = await resp.json();
    return buildTerritory(cfg, Array.isArray(json?.results) ? json.results : []);
  } catch (err) {
    return errorTerritory(cfg, err instanceof Error ? err.message : String(err));
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  const territories = await Promise.all(DROM_LIVE_TERRITORIES.map(fetchTerritory));
  if (territories.every((t) => t.state === 'error')) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'EDF open data injoignable', territories });
    return;
  }
  // Pas EDF de 5 min : cache CDN aligné (spec lot 2 § 2.2).
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  res.status(200).json({ fetchedAt: Date.now(), territories });
}
