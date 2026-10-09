// api/_lib/outages-cloud.js : collecteur du panneau Cloud (spec 2026-10-08 panneaux pannes § 3.2 ; faits § 8, 9). Pages d'état filtrées France
// (P2 : un statut mondial n'est pas un statut France) : composants et incidents rattachés à une zone, un centre de données ou un point de
// présence français ; un incident se compte une fois (P3) ; « en cours » = investigating ou identified, « surveillé » = monitoring
// (arbitrage 6). Référentiel (centres de données, points d'échange) servi comme inventaire (P5), jamais comme un état.
// Chaque page d'état (OVHcloud en compte quatre) est une partie : lue toutes les 30 min d'après l'heure de sa dernière lecture RÉUSSIE
// (horloge du serveur, comme `edfReadAt`) ; une page en échec garde ses dernières données, nomme son erreur et est retentée après 5 min
// (outages-parts.js). Le référentiel est une partie à part (6 h, la durée de ses caches). Dernier relevé gardé en KV, servi daté.
import { fetchOfficialIdfDatacenters, fetchUmapProjectDatacenters, mergeDatacenters } from '../_shared/infra-network-datacenters.js';
import { kvGetJson, kvSetJson } from './kv-history.js';
import { failed, partDue, succeeded } from './outages-parts.js';
import { loadExchanges } from './peeringdb.js';
import { fetchStrictJson, fetchStrictText, fetchStrictXml, sourceError } from './source-http.js';

export const OVH_STATUS_PAGES = ['public-cloud', 'web-cloud', 'network', 'bare-metal-servers'].map((s) => `https://${s}.status-ovhcloud.com/api/v2/summary.json`);
export const SCALEWAY_SUMMARY_URL = 'https://status.scaleway.com/api/v2/summary.json';
export const CLOUDFLARE_COMPONENTS_URL = 'https://www.cloudflarestatus.com/api/v2/components.json';
export const GCP_INCIDENTS_URL = 'https://status.cloud.google.com/incidents.json';
export const AWS_RSS_URL = 'https://status.aws.amazon.com/rss/all.rss';
export const OUTSCALE_SUMMARY_URL = 'https://status.outscale.com/api/v2/summary.json';
export const CLOUD_LAST_KEY = 'out:cloud:last';
export const CLOUD_PENDING_NOTE = 'Cloud : collecte en cours';
const CLOUD_INTERVAL_MS = 30 * 60_000;
const REFERENCE_INTERVAL_MS = 6 * 60 * 60_000;
const TIMEOUT_MS = 20_000;
const DAY_MS = 86_400_000;
const LAST_TTL_SEC = 3 * 86_400;

/** Villes des centres OVHcloud français et des points de présence Cloudflare (lieu réel, à l'échelle de la ville). */
const CITY = {
  RBX: { label: 'Roubaix', lat: 50.69, lon: 3.18 }, SBG: { label: 'Strasbourg', lat: 48.58, lon: 7.79 }, GRA: { label: 'Gravelines', lat: 50.99, lon: 2.13 },
  PAR: { label: 'Paris', lat: 48.86, lon: 2.35 }, CDG: { label: 'Paris', lat: 48.86, lon: 2.35 }, MRS: { label: 'Marseille', lat: 43.3, lon: 5.37 },
  LYS: { label: 'Lyon', lat: 45.76, lon: 4.84 }, BOD: { label: 'Bordeaux', lat: 44.84, lon: -0.58 },
};

let queue = Promise.resolve();

/** Réservé aux tests : file libre. */
export function __resetCloudForTests() {
  queue = Promise.resolve();
}

const OVH_FR = /^(RBX\d*|SBG\d*|GRA\d*|EU-WEST-PAR(-[ABC])?|EU-WEST-(GRA|RBX|SBG)|PAR\d*|3AZ|France|Access (RBX|SBG|GRA))$/;
const OVH_TAG_FR = /^(RBX\d*|SBG\d*|GRA\d*|EU-WEST-PAR|PAR\d*|FR|FRANCE)$/;
export function isOvhFrance(name) { return OVH_FR.test(String(name).trim()); }
export function ovhTitleFrance(title) {
  return [...String(title).matchAll(/\[([^\]]+)\]/g)].some((m) => OVH_TAG_FR.test(m[1].trim().toUpperCase()));
}
export const scalewayFrance = { component: (n) => /^(fr-par-\d|DC\d)$/.test(String(n).trim()), title: (t) => /\bfr-par\b/i.test(String(t)) };
/** Outscale : zones par leurs groupes de composants, maintenances et incidents par l'étiquette du titre (« [EU-WEST-2] », « [US-WEST-1 ] »), P6. */
export const outscaleFrance = {
  component: (n) => /^(eu-west-2|cloudgouv-eu-west-1)$/.test(String(n).trim()),
  title: (t) => /\[\s*(EU-WEST-2|CLOUDGOUV-EU-WEST-1)\s*\]/i.test(String(t)),
};
const OVH_FILTER = { component: isOvhFrance, title: ovhTitleFrance };

const STATUS = { operational: 'operational', under_maintenance: 'maintenance', degraded_performance: 'degraded', partial_outage: 'partial', major_outage: 'major' };
export function statuspageStatus(s) { return STATUS[s] ?? 'unknown'; }
export function statuspageState(s) { return s === 'investigating' || s === 'identified' ? 'en-cours' : s === 'monitoring' ? 'surveille' : null; }
const iso = (v) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const IMPACT = new Set(['none', 'minor', 'major', 'critical']);

/** Gravité d'un statut de zone (P7) : le plus grave l'emporte entre composants homonymes. */
const STATUS_RANK = { unknown: 0, operational: 1, maintenance: 2, degraded: 3, partial: 4, major: 5 };

/**
 * Zones dédoublonnées par identifiant (P7) : un même nom de composant figure dans plusieurs groupes de service (« GRA » dans le cloud public,
 * l'hébergement web et le bare-metal). Le statut le plus grave est gardé, la date la plus récente, et les coordonnées de la première qui en a.
 */
function mergeZones(zones) {
  const byId = new Map();
  for (const z of zones) {
    const kept = byId.get(z.id);
    if (!kept) { byId.set(z.id, z); continue; }
    const worse = STATUS_RANK[z.status] > STATUS_RANK[kept.status] ? z : kept;
    const newest = [kept.updatedAt, z.updatedAt].filter((d) => d !== null).sort().at(-1) ?? null;
    byId.set(z.id, { ...worse, updatedAt: newest, lat: worse.lat ?? kept.lat ?? z.lat, lon: worse.lon ?? kept.lon ?? z.lon });
  }
  return [...byId.values()];
}

function cityOf(id) {
  const m = /^(RBX|SBG|GRA|PAR|EU-WEST-PAR)/.exec(id);
  return m ? CITY[m[1] === 'EU-WEST-PAR' ? 'PAR' : m[1]] : null;
}

/**
 * Page Statuspage → zones françaises (composants feuilles), incidents et maintenances France, incidents hors France.
 * `isFrance` : { component(name), title(title) }. Aucune date de lecture ici : elle est celle du serveur, posée par la partie (P8).
 */
export function fromStatuspage(provider, label, json, isFrance, nowMs) {
  const comps = Array.isArray(json?.components) ? json.components : [];
  // Groupes compris : les zones d'Outscale (« eu-west-2 », « cloudgouv-eu-west-1 ») sont des groupes ; les groupes d'OVHcloud et de
  // Scaleway (« Infrastructure || RBX », « Elements - AZ ») ne correspondent jamais aux motifs ancrés.
  const zones = comps.filter((c) => c && isFrance.component(c.name)).map((c) => {
    const city = provider === 'ovhcloud' ? cityOf(String(c.name)) : null;
    return { id: String(c.name), label: city ? `${city.label} (${c.name})` : String(c.name), status: statuspageStatus(c.status), updatedAt: iso(c.updated_at), lat: city?.lat ?? null, lon: city?.lon ?? null };
  });
  const incidents = []; const elsewhere = [];
  for (const i of Array.isArray(json?.incidents) ? json.incidents : []) {
    const state = statuspageState(i.status);
    if (state === null) continue;
    const frZones = (i.components ?? []).map((c) => String(c.name)).filter((n) => isFrance.component(n));
    const item = {
      id: `${provider}:${i.id}`, provider, title: String(i.name), zones: [...new Set(frZones)], state, impact: IMPACT.has(i.impact) ? i.impact : 'minor',
      start: iso(i.created_at) ?? new Date(nowMs).toISOString(), updatedAt: iso(i.updated_at), url: typeof i.shortlink === 'string' ? i.shortlink : null,
    };
    (frZones.length > 0 || isFrance.title(i.name) ? incidents : elsewhere).push(item);
  }
  const maintenances = [];
  for (const m of Array.isArray(json?.scheduled_maintenances) ? json.scheduled_maintenances : []) {
    const frZones = (m.components ?? []).map((c) => String(c.name)).filter((n) => isFrance.component(n));
    if (frZones.length === 0 && !isFrance.title(m.name)) continue;
    const start = iso(m.scheduled_for);
    const inProgress = m.status === 'in_progress' || m.status === 'verifying';
    if (!start || (!inProgress && (m.status !== 'scheduled' || Date.parse(start) > nowMs + 7 * DAY_MS))) continue;
    maintenances.push({ id: `${provider}:${m.id}`, provider, title: String(m.name), zones: [...new Set(frZones)], inProgress, start, end: iso(m.scheduled_until) });
  }
  return { provider, label, zones: mergeZones(zones), incidents, maintenances, elsewhere };
}

/** Points de présence français de Cloudflare (« Paris, France - (CDG) »), date de chaque composant ; statut mondial ignoré (P2). */
export function fromCloudflare(json) {
  return (Array.isArray(json?.components) ? json.components : [])
    .map((c) => ({ c, m: /^([^,]+), France - \((\w{3})\)$/.exec(String(c.name)) }))
    .filter((x) => x.m)
    .map(({ c, m }) => ({ id: m[2], label: m[1], status: statuspageStatus(c.status), updatedAt: iso(c.updated_at), lat: CITY[m[2]]?.lat ?? null, lon: CITY[m[2]]?.lon ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const GCP_IMPACT = { low: 'minor', medium: 'major', high: 'critical' };
/** Incidents Google Cloud en cours à Paris (europe-west9), sans fin publiée. La zone n'a pas de date : elle est déduite de l'absence d'incident. */
export function fromGcp(json, nowMs) {
  const list = Array.isArray(json) ? json : [];
  const incidents = list.filter((i) => !i.end && (i.currently_affected_locations ?? []).some((l) => l.id === 'europe-west9')).map((i) => ({
    id: `gcp:${i.id}`, provider: 'gcp', title: String(i.external_desc ?? 'Incident Google Cloud'), zones: ['europe-west9'], state: 'en-cours',
    impact: GCP_IMPACT[i.severity] ?? 'minor', start: iso(i.begin) ?? new Date(nowMs).toISOString(), updatedAt: iso(i.modified), url: i.uri ? `https://status.cloud.google.com/${i.uri}` : null,
  }));
  return { incidents, zone: { id: 'europe-west9', label: 'Paris (europe-west9)', status: incidents.length > 0 ? 'degraded' : 'operational', updatedAt: null, lat: 48.86, lon: 2.35 } };
}

/** Un élément AWS qui dit que l'événement est terminé : « [RESOLVED] … » ou « Service is operating normally ». */
const AWS_RESOLVED = /\[\s*RESOLVED\s*\]|operating normally|^\s*resolved\b/i;

/**
 * Événements AWS de la région Paris (`-eu-west-3_` dans le guid). Le flux publie une mise à jour par élément : les éléments d'un même
 * événement (guid sans son horodatage final : service et région) sont regroupés et comptés UNE fois (P3). Un événement est en cours tant
 * que son élément le plus récent ne dit pas qu'il est résolu, quel que soit son âge (un événement ouvert depuis des mois reste en cours :
 * la zone n'est jamais dite sans incident à tort, S3, P4). `start` = élément le plus ancien du groupe, `updatedAt` = le plus récent.
 * Zone non datée : déduite de l'absence d'incident, comme Google Cloud.
 */
export function fromAws(xml, nowMs) {
  const items = [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const pick = (block, tag) => { const m = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(block); return m ? m[1].trim() : null; };
  const events = new Map();
  for (const block of items) {
    const guid = pick(block, 'guid') ?? '';
    if (!/-eu-west-3_/.test(guid)) continue;
    const at = Date.parse(pick(block, 'pubDate') ?? '');
    if (!Number.isFinite(at)) continue;
    const key = guid.replace(/^.*#/, '').replace(/_\d+$/, '');
    const group = events.get(key) ?? { first: at, last: null };
    group.first = Math.min(group.first, at);
    if (group.last === null || at > group.last.at) group.last = { at, title: pick(block, 'title') ?? 'Incident AWS' };
    events.set(key, group);
  }
  const incidents = [...events.entries()].filter(([, g]) => !AWS_RESOLVED.test(g.last.title)).map(([key, g]) => ({
    id: `aws:${key}`, provider: 'aws', title: g.last.title, zones: ['eu-west-3'], state: 'en-cours', impact: 'minor',
    start: new Date(g.first).toISOString(), updatedAt: new Date(g.last.at).toISOString(), url: 'https://health.aws.amazon.com/health/status',
  })).sort((a, b) => b.start.localeCompare(a.start));
  return { incidents, zone: { id: 'eu-west-3', label: 'Paris (eu-west-3)', status: incidents.length > 0 ? 'degraded' : 'operational', updatedAt: null, lat: 48.86, lon: 2.35 } };
}

export const CLOUD_PROVIDER_ORDER = ['ovhcloud', 'scaleway', 'cloudflare', 'gcp', 'aws', 'outscale', 'azure'];
const LABEL = { ovhcloud: 'OVHcloud', scaleway: 'Scaleway', cloudflare: 'Cloudflare', gcp: 'Google Cloud', aws: 'AWS', outscale: 'Outscale', azure: 'Azure' };

/**
 * Réponse complète. `parts.statuspages` : sorties de fromStatuspage (les pages d'OVHcloud sont fusionnées en un fournisseur) ; `cloudflare`,
 * `gcp`, `aws` : sorties de leurs lecteurs, absentes si le fournisseur n'a jamais été lu ; `readAts` : dernière lecture réussie de chaque
 * fournisseur (horloge du serveur, P8), à défaut `readAt` pour un fournisseur qui a des données ; `errors` : pannes nommées par fournisseur.
 */
export function buildCloud(parts, nowMs) {
  const byProvider = new Map();
  for (const p of parts.statuspages ?? []) {
    const prev = byProvider.get(p.provider) ?? { zones: [], incidents: [], maintenances: [], elsewhere: [] };
    prev.zones.push(...p.zones); prev.incidents.push(...p.incidents); prev.maintenances.push(...p.maintenances); prev.elsewhere.push(...p.elsewhere);
    byProvider.set(p.provider, prev);
  }
  const readAtOf = (provider, hasData) => parts.readAts?.[provider] ?? (hasData ? parts.readAt ?? null : null);
  const errorOf = (provider) => {
    const own = (parts.errors ?? []).filter((e) => e.startsWith(`${LABEL[provider]} `));
    return own.length > 0 ? own.join(' ; ') : null;
  };
  const providers = CLOUD_PROVIDER_ORDER.map((provider) => {
    const base = { provider, label: LABEL[provider], readAt: null, zones: [], note: null, error: errorOf(provider) };
    if (provider === 'azure') return { ...base, note: 'Azure ne publie pas d’état par région France.' };
    if (provider === 'cloudflare') return { ...base, readAt: readAtOf(provider, Boolean(parts.cloudflare)), zones: parts.cloudflare ?? [] };
    if (provider === 'gcp') return { ...base, readAt: readAtOf(provider, Boolean(parts.gcp)), zones: parts.gcp ? [parts.gcp.zone] : [] };
    if (provider === 'aws') return { ...base, readAt: readAtOf(provider, Boolean(parts.aws)), zones: parts.aws ? [parts.aws.zone] : [] };
    const p = byProvider.get(provider);
    return p ? { ...base, readAt: readAtOf(provider, true), zones: mergeZones(p.zones) } : base;
  });
  const all = [...byProvider.values()];
  const dedupe = (list) => [...new Map(list.map((i) => [i.id, i])).values()];
  const incidents = dedupe([...all.flatMap((p) => p.incidents), ...(parts.gcp?.incidents ?? []), ...(parts.aws?.incidents ?? [])])
    .sort((a, b) => (a.state === 'en-cours' ? 0 : 1) - (b.state === 'en-cours' ? 0 : 1) || b.start.localeCompare(a.start));
  return {
    readAt: parts.readAt, providers, incidents,
    maintenances: dedupe(all.flatMap((p) => p.maintenances)).sort((a, b) => (a.inProgress ? 0 : 1) - (b.inProgress ? 0 : 1) || a.start.localeCompare(b.start)),
    elsewhere: dedupe(all.flatMap((p) => p.elsewhere)), reference: parts.reference, errors: parts.errors ?? [],
  };
}

export function emptyCloud(errors = []) {
  return { readAt: null, providers: [], incidents: [], maintenances: [], elsewhere: [], reference: { generatedAt: null, datacenters: [], exchanges: [] }, errors };
}

// ─── Parties : une par page d'état, une pour le référentiel ───

const emptyStatuspage = (provider) => ({ provider, label: LABEL[provider], readAt: null, zones: [], incidents: [], maintenances: [], elsewhere: [] });
const ovhPageName = (url) => new URL(url).hostname.split('.')[0];
const getJson = (url) => fetchStrictJson(url, { timeoutMs: TIMEOUT_MS });

/** Sources lues : clé de la partie, fournisseur, nom de l'erreur (P31 : la page OVH est nommée), lecteur et forme vide. */
const SOURCES = [
  ...OVH_STATUS_PAGES.map((url) => ({
    key: `ovhcloud:${ovhPageName(url)}`, provider: 'ovhcloud', errorLabel: `OVHcloud (${ovhPageName(url)})`, kind: 'statuspage',
    read: async (now) => fromStatuspage('ovhcloud', LABEL.ovhcloud, await getJson(url), OVH_FILTER, now),
  })),
  { key: 'scaleway', provider: 'scaleway', errorLabel: 'Scaleway', kind: 'statuspage', read: async (now) => fromStatuspage('scaleway', LABEL.scaleway, await getJson(SCALEWAY_SUMMARY_URL), scalewayFrance, now) },
  { key: 'outscale', provider: 'outscale', errorLabel: 'Outscale', kind: 'statuspage', read: async (now) => fromStatuspage('outscale', LABEL.outscale, await getJson(OUTSCALE_SUMMARY_URL), outscaleFrance, now) },
  { key: 'cloudflare', provider: 'cloudflare', errorLabel: 'Cloudflare', kind: 'zones', read: async () => ({ zones: fromCloudflare(await getJson(CLOUDFLARE_COMPONENTS_URL)) }) },
  { key: 'gcp', provider: 'gcp', errorLabel: 'Google Cloud', kind: 'incidents', read: async (now) => fromGcp(await getJson(GCP_INCIDENTS_URL), now) },
  { key: 'aws', provider: 'aws', errorLabel: 'AWS', kind: 'incidents', read: async (now) => fromAws(await fetchStrictXml(AWS_RSS_URL, { timeoutMs: TIMEOUT_MS }), now) },
];
const EMPTY_PART = { statuspage: (s) => emptyStatuspage(s.provider), zones: () => ({ zones: [] }), incidents: () => ({ incidents: [], zone: null }) };

/**
 * Lecture stricte pour les fonctions du référentiel (P9), qui prennent un `fetch` : User-Agent FranceMonitor, délai borné, TLS strict,
 * page HTML ou vide refusée, comme toute source. Les deux fonctions ne lisent que `ok`, `status`, `text()` et `json()`.
 */
async function strictFetch(url, init) {
  const accept = String(init?.headers?.Accept ?? '');
  const text = await fetchStrictText(url, { expect: accept.includes('json') ? 'json' : accept.includes('xml') ? 'xml' : 'text', timeoutMs: TIMEOUT_MS, headers: init?.headers });
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
}

/** Sites du référentiel : coordonnées valides seulement ; `stage` = état d'avancement publié (jamais « inconnu » ni un libellé de supervision). */
function referenceSites(idf, umap) {
  const NOT_A_STAGE = new Set(['', 'inconnu', 'surveillance opérateur']);
  return mergeDatacenters({ officialIdfDatacenters: idf, umapProjectDatacenters: umap, providerStatus: {}, now: new Date(0).toISOString() })
    .filter((d) => Array.isArray(d.coordinates) && Number.isFinite(d.coordinates[0]) && Number.isFinite(d.coordinates[1]))
    .map((d) => {
      const stage = String(d.operationalState ?? '').trim();
      const power = String(d.powerBand ?? '').trim();
      return {
        id: String(d.id), name: String(d.name), operator: d.provider ? String(d.provider) : null, city: d.city ? String(d.city) : null,
        lat: d.coordinates[1], lon: d.coordinates[0],
        stage: NOT_A_STAGE.has(stage) ? null : stage, power: power === '' ? null : power, source: String(d.source ?? ''),
      };
    });
}

/**
 * Lit le référentiel. Chaque lecture qui échoue est nommée et le dernier résultat connu est gardé à sa place ; sans résultat connu, le
 * référentiel est servi sans cette lecture. Ne lève jamais.
 */
async function readReference(now, previous) {
  const errors = [];
  const read = async (label, fn) => { try { return await fn(); } catch (err) { errors.push(sourceError(label, err)); return null; } };
  // `force` : la cadence de la partie (6 h) remplace les caches en mémoire des deux fonctions.
  const idf = await read('Référentiel (DRIEAT)', () => fetchOfficialIdfDatacenters(strictFetch, { force: true }));
  const umap = await read('Référentiel (uMap)', () => fetchUmapProjectDatacenters(strictFetch, { force: true }));
  const ix = await loadExchanges(now);
  errors.push(...ix.errors);
  const complete = idf !== null && umap !== null;
  return {
    data: {
      datacenters: complete || !previous ? referenceSites(idf ?? [], umap) : previous.datacenters,
      exchanges: ix.exchanges ? ix.exchanges.items.map((x) => ({ id: x.id, name: x.name, city: x.city, url: x.url })) : previous?.exchanges ?? [],
    },
    errors,
  };
}

/** Réponse à partir des parties : lecture du serveur par fournisseur (la plus ancienne de ses pages), erreurs nommées, référentiel. */
function bodyFromParts(parts) {
  const statuspages = []; const readAts = {}; const errors = [];
  let cloudflare; let gcp; let aws;
  for (const s of SOURCES) {
    const p = parts[s.key];
    if (!p) continue;
    if (typeof p.readAt === 'string') readAts[s.provider] = [readAts[s.provider], p.readAt].filter(Boolean).sort()[0];
    if (typeof p.error === 'string' && p.error !== '') errors.push(p.error);
    if (typeof p.readAt !== 'string') continue;
    if (s.kind === 'statuspage') statuspages.push(p);
    else if (s.provider === 'cloudflare') cloudflare = p.zones;
    else if (s.provider === 'gcp') gcp = p;
    else if (s.provider === 'aws') aws = p;
  }
  const ref = parts.reference;
  errors.push(...(ref?.errors ?? []));
  const reads = Object.values(readAts);
  return buildCloud({
    statuspages, cloudflare, gcp, aws, readAts, readAt: reads.length > 0 ? reads.sort().at(-1) : null,
    reference: { generatedAt: ref?.readAt ?? null, datacenters: ref?.datacenters ?? [], exchanges: ref?.exchanges ?? [] }, errors: [...new Set(errors)],
  });
}

/** Une collecte : chaque partie relue si elle est due ; une partie en panne garde ses dernières données et nomme son erreur. */
export async function collectCloud(now = Date.now()) {
  const attemptedAt = new Date(now).toISOString();
  const stored = await kvGetJson(CLOUD_LAST_KEY, now);
  const parts = { ...(stored && typeof stored === 'object' ? stored.parts : null) };

  await Promise.all(SOURCES.filter((s) => partDue(parts[s.key], CLOUD_INTERVAL_MS, now)).map(async (s) => {
    try {
      parts[s.key] = succeeded(await s.read(now), attemptedAt);
    } catch (err) {
      parts[s.key] = failed(parts[s.key], { ...EMPTY_PART[s.kind](s), readAt: null }, sourceError(s.errorLabel, err), attemptedAt);
    }
  }));
  if (partDue(parts.reference, REFERENCE_INTERVAL_MS, now)) {
    const { data, errors } = await readReference(now, parts.reference);
    parts.reference = errors.length === 0
      ? { ...succeeded(data, attemptedAt), errors: [] }
      : { ...failed(parts.reference, { readAt: null, datacenters: [], exchanges: [] }, errors.join(' ; '), attemptedAt), ...data, errors };
  }

  const body = bodyFromParts(parts);
  await kvSetJson(CLOUD_LAST_KEY, { attemptedAt, parts, body }, LAST_TTL_SEC, now);
  return body;
}

const anyDue = (parts, now) => SOURCES.some((s) => partDue(parts[s.key], CLOUD_INTERVAL_MS, now)) || partDue(parts.reference, REFERENCE_INTERVAL_MS, now);

/** Dernier relevé, après une collecte si une partie est due ; jamais deux à la fois. */
export function ensureCloudFresh(now = Date.now()) {
  const turn = queue.then(async () => {
    const last = await kvGetJson(CLOUD_LAST_KEY, now);
    if (last?.body && last.parts && !anyDue(last.parts, now)) return last.body;
    return collectCloud(now);
  });
  queue = turn.then(() => undefined, () => undefined);
  return turn;
}

/** Relevé gardé, sans attendre la collecte en cours, avec `note`. */
export async function storedCloud(now, note) {
  const last = await kvGetJson(CLOUD_LAST_KEY, now);
  const body = last?.body ?? emptyCloud();
  return { ...body, errors: [...body.errors, note] };
}
