// api/_lib/outages-cloud.js : collecteur du panneau Cloud (spec 2026-10-08 panneaux pannes § 3.2 ; faits § 8, 9). Pages d'état filtrées France
// (P2 : un statut mondial n'est pas un statut France) : composants et incidents rattachés à une zone, un centre de données ou un point de
// présence français ; un incident se compte une fois (P3) ; « en cours » = investigating ou identified, « surveillé » = monitoring
// (arbitrage 6). Référentiel (centres de données, points d'échange) servi comme inventaire (P5), jamais comme un état.
// Chaque page d'état (OVHcloud en compte quatre) est une partie : lue toutes les 30 min d'après l'heure de sa dernière lecture RÉUSSIE
// (horloge du serveur, comme `edfReadAt`) ; une page en échec garde ses dernières données, nomme son erreur et est retentée après 5 min
// (outages-parts.js). Le référentiel a trois sous-sources (DRIEAT, uMap, PeeringDB), chacune avec son état : relue toutes les 6 h (la durée
// de ses caches) après une lecture réussie, retentée au plus toutes les 6 h après un échec (le WFS DRIEAT est en panne côté serveur depuis
// le 09/10/2026 : jamais relu toutes les 5 min, et uMap n'est pas relu parce que DRIEAT a échoué). Le KV garde les parties une seule fois ;
// la réponse en est recalculée à chaque lecture.
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

/**
 * Scaleway : zones de la région fr-par (« région parisienne », même point que les autres zones parisiennes) et centres Dedibox DC1 à DC5.
 * Source des emplacements : Scaleway publie ses centres sous « Paris » (tableau « Paris : DC1, DC2, DC3, DC5 » de
 * https://www.scaleway.com/en/docs/account/reference-content/products-availability/, et « DC2 PAR1 Paris, DC3 PAR1 Paris, DC4 Paris, DC5 PAR2 Paris »
 * de https://www.scaleway.com/en/environmental-leadership/, lus le 09/10/2026). La commune « Paris » (code INSEE 75056) a pour centre
 * [2.347, 48.8589] selon https://geo.api.gouv.fr/communes/75056?fields=nom,code,centre, arrondi comme CITY.PAR. Scaleway ne publie pas de commune
 * plus précise : aucune adresse n'est devinée.
 */
function scalewayPlace(id) {
  const region = /^fr-par-\d$/.test(id);
  return /^(fr-par-\d|DC\d)$/.test(id) ? { label: region ? 'Région parisienne' : CITY.PAR.label, lat: CITY.PAR.lat, lon: CITY.PAR.lon } : null;
}

let queue = Promise.resolve();

/** Réservé aux tests : file libre. */
export function __resetCloudForTests() {
  queue = Promise.resolve();
}

/** Marqueurs France d'OVHcloud (centres, zones, régions) : une seule source pour les composants et les étiquettes de titre (m1). */
const OVH_FR = /^(RBX\d*|SBG\d*|GRA\d*|EU-WEST-PAR(-[ABC])?|EU-WEST-(GRA|RBX|SBG)|PAR\d*|3AZ|France|Access (RBX|SBG|GRA))$/i;
export function isOvhFrance(name) { return OVH_FR.test(String(name).trim()); }
/** Titre étiqueté « [GRA7] », « [EU-WEST-PAR-A] »… : mêmes marqueurs que les composants, plus l'étiquette de pays « [FR] ». */
export function ovhTitleFrance(title) {
  return [...String(title).matchAll(/\[([^\]]+)\]/g)].some((m) => isOvhFrance(m[1]) || m[1].trim().toUpperCase() === 'FR');
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
    const city = provider === 'ovhcloud' ? cityOf(String(c.name)) : provider === 'scaleway' ? scalewayPlace(String(c.name)) : null;
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

/** Erreur déjà nommée par sa source (« PeeringDB : HTTP 503 »). */
class NamedError extends Error {}

/** Points d'échange PeeringDB (cache partagé de 24 h) : `dataAt` = heure de la lecture PeeringDB servie ; lève l'erreur déjà nommée. */
async function readExchanges(now) {
  const ix = await loadExchanges(now);
  if (!ix.exchanges) throw new NamedError(ix.errors.join(' ; '));
  return { dataAt: ix.exchanges.readAt, items: ix.exchanges.items.map((x) => ({ id: x.id, name: x.name, city: x.city, url: x.url })) };
}

/**
 * Sous-sources du référentiel : chacune est une partie (outages-parts.js) relue toutes les 6 h, et retentée au plus toutes les 6 h après
 * un échec. `force` : la cadence de la partie remplace les caches en mémoire des deux fonctions. `dataAt` : date de la donnée servie.
 */
const REFERENCE_PARTS = [
  {
    key: 'drieat', label: 'Référentiel (DRIEAT)', empty: { rows: [] },
    read: async (now) => ({ dataAt: new Date(now).toISOString(), rows: await fetchOfficialIdfDatacenters(strictFetch, { force: true }) }),
  },
  {
    key: 'umap', label: 'Référentiel (uMap)', empty: { rows: null },
    read: async (now) => ({ dataAt: new Date(now).toISOString(), rows: await fetchUmapProjectDatacenters(strictFetch, { force: true }) }),
  },
  { key: 'peeringdb', label: 'PeeringDB', empty: { items: [] }, read: readExchanges },
];

/** Sous-partie du référentiel gardée en KV (objet), sinon undefined (jamais lue, ou relevé d'une forme antérieure). */
function referencePart(parts, key) {
  const ref = parts.reference;
  const part = ref && typeof ref === 'object' ? ref[key] : undefined;
  return part && typeof part === 'object' ? part : undefined;
}
const referenceDue = (parts, s, now) => partDue(referencePart(parts, s.key), REFERENCE_INTERVAL_MS, now, REFERENCE_INTERVAL_MS);

/** Lit les sous-sources dues ; chacune en échec garde ses dernières données et nomme son erreur. Ne lève jamais. */
async function collectReference(parts, now, attemptedAt) {
  const reference = Object.fromEntries(REFERENCE_PARTS.map((s) => [s.key, referencePart(parts, s.key)]).filter(([, v]) => v !== undefined));
  await Promise.all(REFERENCE_PARTS.filter((s) => referenceDue(parts, s, now)).map(async (s) => {
    try {
      reference[s.key] = succeeded(await s.read(now), attemptedAt);
    } catch (err) {
      const message = err instanceof NamedError ? err.message : sourceError(s.label, err);
      reference[s.key] = failed(reference[s.key], { ...s.empty, dataAt: null, readAt: null }, message, attemptedAt);
    }
  }));
  return reference;
}

/**
 * Référentiel servi : sites et points d'échange des dernières lectures réussies de chaque sous-source ; daté par la plus récente d'entre
 * elles (`generatedAt`, null si aucune n'a jamais réussi) ; pannes nommées par sous-source.
 */
function referenceFromParts(parts) {
  const read = REFERENCE_PARTS.map((s) => referencePart(parts, s.key)).filter((p) => p !== undefined && typeof p.readAt === 'string');
  const drieat = referencePart(parts, 'drieat');
  const umap = referencePart(parts, 'umap');
  const peeringdb = referencePart(parts, 'peeringdb');
  return {
    reference: {
      generatedAt: read.map((p) => (typeof p.dataAt === 'string' ? p.dataAt : p.readAt)).sort().at(-1) ?? null,
      datacenters: referenceSites(Array.isArray(drieat?.rows) ? drieat.rows : [], umap?.rows ?? null),
      exchanges: Array.isArray(peeringdb?.items) ? peeringdb.items : [],
    },
    errors: REFERENCE_PARTS.map((s) => referencePart(parts, s.key)?.error).filter((e) => typeof e === 'string' && e !== ''),
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
  const ref = referenceFromParts(parts);
  errors.push(...ref.errors);
  const reads = Object.values(readAts);
  return buildCloud({
    statuspages, cloudflare, gcp, aws, readAts, readAt: reads.length > 0 ? reads.sort().at(-1) : null, reference: ref.reference, errors: [...new Set(errors)],
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
  if (REFERENCE_PARTS.some((s) => referenceDue(parts, s, now))) parts.reference = await collectReference(parts, now, attemptedAt);

  // Les parties seules sont gardées (le référentiel une seule fois) ; la réponse en est recalculée.
  await kvSetJson(CLOUD_LAST_KEY, { attemptedAt, parts }, LAST_TTL_SEC, now);
  return bodyFromParts(parts);
}

const anyDue = (parts, now) => SOURCES.some((s) => partDue(parts[s.key], CLOUD_INTERVAL_MS, now)) || REFERENCE_PARTS.some((s) => referenceDue(parts, s, now));
const storedParts = (last) => (last && typeof last === 'object' && last.parts && typeof last.parts === 'object' ? last.parts : null);

/** Dernier relevé, après une collecte si une partie est due ; jamais deux à la fois. */
export function ensureCloudFresh(now = Date.now()) {
  const turn = queue.then(async () => {
    const parts = storedParts(await kvGetJson(CLOUD_LAST_KEY, now));
    if (parts && !anyDue(parts, now)) return bodyFromParts(parts);
    return collectCloud(now);
  });
  queue = turn.then(() => undefined, () => undefined);
  return turn;
}

/** Relevé gardé, sans attendre la collecte en cours, avec `note`. */
export async function storedCloud(now, note) {
  const parts = storedParts(await kvGetJson(CLOUD_LAST_KEY, now));
  const body = parts ? bodyFromParts(parts) : emptyCloud();
  return { ...body, errors: [...body.errors, note] };
}
