// api/_lib/cyber-watch.js : veille cyber élargie de la France (18/10/2026), à côté de la Vigilance cyber (cyber-collect.js). Huit
// parties, chacune à sa cadence et avec sa date ; une partie en panne garde sa dernière valeur et nomme l'erreur (préfixe de la source) :
//   radar      Cloudflare Radar : attaques DDoS visant la France (couches 3 et 7, 28 jours), secteurs visés, rang mondial, détournements
//              et fuites de routes BGP impliquant un réseau français (1 h, clé CLOUDFLARE_RADAR_TOKEN).
//   abuse      abuse.ch : URL malveillantes hébergées en France (URLhaus, flux pays) et serveurs de commande Feodo situés en France (6 h).
//   ddosia     witha.name : listes de cibles du groupe pro-russe NoName057(16) (DDoSia), sites français relevés sur 30 jours, lieu
//              déduit du nom de domaine seulement quand il est sûr (préfecture en gouv.fr, commune au nom exact) (1 h).
//   lookalikes domaines enregistrés la veille qui imitent un service public ou une grande marque française (liste quotidienne whoisds,
//              30 jours gardés) (6 h).
//   cnil       violations de données notifiées à la CNIL (open data trimestriel), agrégées par trimestre, secteur et origine (24 h).
//   epss       probabilité d'exploitation à 30 jours (FIRST EPSS) des vulnérabilités suivies par la Vigilance cyber (12 h).
//   euvd       vulnérabilités exploitées de la base européenne de l'ENISA (EUVD), 30 jours (6 h).
//   services   disponibilité des grands services publics en ligne, sondés par le serveur (5 min, 24 h d'historique).
// Aucune donnée personnelle : statistiques, indicateurs techniques publics (domaines, adresses de serveurs malveillants) et sites
// d'organisations visées tels que publiés par les sources. Seules des valeurs de moins de 200 Ko vont au stockage clé-valeur.
import { inflateRawSync } from 'node:zlib';
import { DEPT_NAMES } from '../_shared/departments.js';
import { CYBER_KEY } from './cyber-collect.js';
import { kvGetJson, kvSetJson } from './kv-history.js';
import { mapLimit } from './map-limit.js';
import { SOURCE_USER_AGENT, fetchStrictJson, fetchStrictText, sourceError } from './source-http.js';

export const CYBER_WATCH_KEY = 'sov:cyberwatch:last';
const KEEP_SEC = 35 * 86_400;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NBSP = ' ';

/** Cadence de chaque partie. */
export const CADENCE_MS = {
  radar: HOUR, abuse: 6 * HOUR, ddosia: HOUR, lookalikes: 6 * HOUR, cnil: DAY, epss: 12 * HOUR, euvd: 6 * HOUR, services: 5 * MIN, targets: 10 * MIN,
};
/** Nouvel essai d'une partie en échec : 10 min (5 min pour les sondes). */
const RETRY_MS = 10 * MIN;
const PREFIX = {
  radar: 'Cloudflare Radar', abuse: 'abuse.ch', ddosia: 'DDoSia (witha.name)', lookalikes: 'Domaines imitateurs (whoisds)', cnil: 'CNIL',
  epss: 'EPSS (FIRST)', euvd: 'EUVD (ENISA)', services: 'Services publics', targets: 'Sites visés',
};
export const PARTS = Object.keys(CADENCE_MS);

const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** « Haute-Saône » → « haute-saone » ; « Côtes-d'Armor » → « cotes-darmor ». */
export function slug(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Cloudflare Radar ───────────────────────────────────────────────────────────────────────────────────────────────────────

const RADAR = 'https://api.cloudflare.com/client/v4/radar';

/** Série quotidienne normalisée de Radar → [{ day, value }] ; lève si illisible. */
export function radarSeries(json) {
  const s = json?.result?.serie_0;
  if (!json?.success || !Array.isArray(s?.timestamps) || !Array.isArray(s?.values)) throw new Error('série illisible');
  return s.timestamps.map((t, i) => ({ day: String(t).slice(0, 10), value: round(num(s.values[i]), 3) })).filter((p) => p.value !== null);
}

/** Dernier jour rapporté à la médiane des jours précédents (null si moins de 7 jours). */
export function lastVsMedian(points) {
  if (points.length < 8) return null;
  const prev = points.slice(0, -1).map((p) => p.value).sort((a, b) => a - b);
  const med = prev[Math.floor(prev.length / 2)];
  return med > 0 ? round(points.at(-1).value / med, 2) : null;
}

/** Événements BGP de Radar → liste compacte (au plus 12), noms des réseaux depuis `asn_info`. */
export function radarBgp(json, kind) {
  const r = json?.result;
  if (!json?.success || !Array.isArray(r?.events)) throw new Error('événements BGP illisibles');
  const names = new Map((r.asn_info ?? []).map((a) => [a.asn, { name: a.org_name ?? null, cc: a.country_code ?? null }]));
  const as = (asn) => ({ asn: num(asn), name: names.get(asn)?.name ?? null, cc: names.get(asn)?.cc ?? null });
  if (kind === 'hijack') {
    return r.events.slice(0, 12).map((e) => ({
      id: String(e.id), start: String(e.min_hijack_ts ?? '').slice(0, 19), end: String(e.max_hijack_ts ?? '').slice(0, 19),
      hijacker: as(e.hijacker_asn), victims: (e.victim_asns ?? []).slice(0, 4).map(as), prefixes: (e.prefixes ?? []).length,
      confidence: num(e.confidence_score), ongoing: num(e.on_going_count) > 0,
    }));
  }
  return r.events.slice(0, 12).map((e) => ({
    id: String(e.id), start: String(e.min_ts ?? e.detected_ts ?? '').slice(0, 19), leaker: as(e.leak_asn), countries: (e.countries ?? []).slice(0, 6),
    prefixes: num(e.prefix_count), finished: Boolean(e.finished),
  }));
}

async function readRadar(now) {
  const token = String(process.env.CLOUDFLARE_RADAR_TOKEN ?? '').trim();
  if (!token) throw new Error('clé CLOUDFLARE_RADAR_TOKEN absente');
  const get = (path) => fetchStrictJson(`${RADAR}/${path}`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 30_000 });
  const [l7, l3, industry, rank7, hijacks, leaks] = await Promise.all([
    get('attacks/layer7/timeseries?location=FR&dateRange=28d&aggInterval=1d'),
    get('attacks/layer3/timeseries?location=FR&dateRange=28d&aggInterval=1d'),
    get('attacks/layer7/summary/industry?location=FR&dateRange=7d'),
    get('attacks/layer7/top/locations/target?dateRange=7d&limit=50'),
    get('bgp/hijacks/events?involvedCountry=FR&dateRange=7d&per_page=50&sortBy=TIME&sortOrder=DESC'),
    get('bgp/leaks/events?involvedCountry=FR&dateRange=7d&per_page=50&sortBy=TIME&sortOrder=DESC'),
  ]);
  const l7s = radarSeries(l7);
  const l3s = radarSeries(l3);
  const ind = industry?.result?.summary_0 ?? {};
  const industries = Object.entries(ind).map(([label, v]) => ({ label, pct: round(num(v)) })).filter((x) => x.pct !== null)
    .sort((a, b) => b.pct - a.pct).slice(0, 6);
  const top = rank7?.result?.top_0 ?? [];
  const fr = top.find((x) => x.targetCountryAlpha2 === 'FR');
  return {
    readAt: new Date(now).toISOString(),
    dataUntil: String(l7?.result?.meta?.lastUpdated ?? l7s.at(-1)?.day ?? ''),
    l7: l7s, l3: l3s, l7Ratio: lastVsMedian(l7s), l3Ratio: lastVsMedian(l3s), industries,
    targetRank: fr ? num(fr.rank) ?? top.indexOf(fr) + 1 : null, targetShare: fr ? round(num(fr.value), 2) : null,
    hijacks: radarBgp(hijacks, 'hijack'), hijackCount: hijacks.result.events.length,
    leaks: radarBgp(leaks, 'leak'), leakCount: leaks.result.events.length,
  };
}

// ─── abuse.ch ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const URLHAUS_FR = 'https://urlhaus.abuse.ch/feeds/country/FR/';
const FEODO = 'https://feodotracker.abuse.ch/downloads/ipblocklist.json';

/** Ligne CSV entre guillemets « "a","b" » → champs. */
function csvQuoted(line) {
  const out = [];
  const re = /"((?:[^"]|"")*)"/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1].replace(/""/g, '"'));
  return out;
}

/** Flux pays d'URLhaus → résumé sur 30 jours : compte, en ligne, menaces, réseaux hébergeurs, 8 plus récentes en ligne. */
export function parseUrlhaus(text, now) {
  const since = now - 30 * DAY;
  let total = 0;
  let online = 0;
  const threats = new Map();
  const asns = new Map();
  const weeks = new Map();
  const latest = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('"')) continue;
    const [added, , status, threat, host, , asn, country] = csvQuoted(line);
    const t = Date.parse(`${String(added).replace(' ', 'T')}Z`);
    if (!Number.isFinite(t) || country !== 'FR') continue;
    const wk = Math.floor((now - t) / (7 * DAY));
    if (wk < 12) weeks.set(wk, (weeks.get(wk) ?? 0) + 1);
    if (t < since) continue;
    total += 1;
    if (status === 'online') {
      online += 1;
      if (latest.length < 8) latest.push({ added: new Date(t).toISOString(), host: host ?? '', threat: threat ?? '', asn: num(asn) });
    }
    threats.set(threat ?? 'n.d.', (threats.get(threat ?? 'n.d.') ?? 0) + 1);
    if (num(asn) !== null) asns.set(num(asn), (asns.get(num(asn)) ?? 0) + 1);
  }
  if (total === 0 && weeks.size === 0) throw new Error('flux URLhaus vide');
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    last30: total, online, threats: top(threats, 5).map(([label, count]) => ({ label, count })),
    asns: top(asns, 6).map(([asn, count]) => ({ asn, count, name: null })),
    weeks: Array.from({ length: 12 }, (_, i) => ({ weeksAgo: 11 - i, count: weeks.get(11 - i) ?? 0 })), latest,
  };
}

/** Liste Feodo → serveurs de commande situés en France (en ligne d'abord). */
export function parseFeodo(json) {
  if (!Array.isArray(json)) throw new Error('liste Feodo illisible');
  const fr = json.filter((x) => x?.country === 'FR');
  return {
    total: json.length, fr: fr.length, frOnline: fr.filter((x) => x.status === 'online').length,
    servers: fr.sort((a, b) => String(b.last_online ?? '').localeCompare(String(a.last_online ?? ''))).slice(0, 10)
      .map((x) => ({ ip: String(x.ip_address ?? ''), port: num(x.port), malware: x.malware ?? null, asName: x.as_name ?? null, status: x.status ?? null, lastOnline: x.last_online ?? null })),
  };
}

async function readAbuse(now) {
  const [csv, feodo] = await Promise.all([
    fetchStrictText(URLHAUS_FR, { timeoutMs: 60_000 }), fetchStrictJson(FEODO, { timeoutMs: 30_000 }),
  ]);
  const urlhaus = parseUrlhaus(csv, now);
  // Nom des réseaux hébergeurs : celui de Feodo quand il est connu, sinon le numéro seul (aucune requête de plus).
  const asNames = new Map(Array.isArray(feodo) ? feodo.map((x) => [x.as_number, x.as_name]) : []);
  urlhaus.asns = urlhaus.asns.map((a) => ({ ...a, name: asNames.get(a.asn) ?? KNOWN_AS[a.asn] ?? null }));
  return { readAt: new Date(now).toISOString(), urlhaus, feodo: parseFeodo(feodo) };
}

/** Hébergeurs français les plus fréquents (noms publiés par les registres). */
const KNOWN_AS = {
  16276: 'OVHcloud', 12876: 'Scaleway', 24940: 'Hetzner', 3215: 'Orange', 15557: 'SFR', 12322: 'Free', 5410: 'Bouygues Telecom',
  29169: 'Gandi', 8075: 'Microsoft', 16509: 'Amazon', 15169: 'Google', 13335: 'Cloudflare', 51167: 'Contabo', 39180: 'O2switch',
  50474: 'O2switch', 8560: 'IONOS', 20473: 'Vultr', 14061: 'DigitalOcean', 63949: 'Akamai (Linode)', 214961: 'Bunkerhost', 56971: 'CGI GLOBAL',
};

// ─── DDoSia (NoName057(16)) ─────────────────────────────────────────────────────────────────────────────────────────────────

const WITHA = 'https://witha.name/api';
const PREFECTURES = new Map(Object.entries(DEPT_NAMES).map(([code, name]) => [slug(name), code]));

/** Site français ? Domaine en .fr (gouv.fr compris). */
export const isFrenchHost = (host) => /\.fr$/i.test(String(host ?? ''));

/** Lieu sûr d'un site : préfecture (www.<département>.gouv.fr) ; sinon null (la commune est cherchée à part). */
export function prefectureOf(host) {
  const m = /^(?:www\.)?([a-z0-9-]+)\.gouv\.fr$/i.exec(String(host ?? ''));
  return m && PREFECTURES.has(m[1].toLowerCase()) ? PREFECTURES.get(m[1].toLowerCase()) : null;
}

/** Libellés candidats d'un domaine pour une commune : « metropole.toulouse.fr » → toulouse ; « www.marseille-port.fr » → marseille-port,
 * marseille ; « www.larochelle.port.fr » → larochelle. Libellés de moins de 4 lettres écartés. */
export function communeCandidates(host) {
  const labels = String(host ?? '').toLowerCase().replace(/\.fr$/, '').split('.').filter((l) => l !== 'www' && /^[a-z-]+$/.test(l));
  const out = [];
  for (const l of labels.reverse()) {
    const bare = l.replace(/^(ville|mairie|metropole|agglo)-/, '');
    out.push(bare, ...bare.split('-'));
  }
  return [...new Set(out)].filter((c) => c.replace(/-/g, '').length >= 4);
}

/** Nature du site d'après son nom (jamais devinée au-delà). */
export function hostKind(host) {
  const h = String(host ?? '').toLowerCase();
  if (/\.gouv\.fr$/.test(h)) return prefectureOf(h) ? 'préfecture' : 'administration';
  if (/(^|[.-])port([.-]|$)/.test(h)) return 'port';
  if (/(^|\.)(ville|mairie|metropole|agglo)[.-]/.test(h)) return 'collectivité';
  return 'site';
}

let communesIndex = null;

/** Index des communes (geo.api.gouv.fr, une lecture par processus) : nom sans accents ni tirets → la plus peuplée. */
async function communes() {
  if (communesIndex) return communesIndex;
  const list = await fetchStrictJson('https://geo.api.gouv.fr/communes?fields=nom,code,centre,codeDepartement,population&format=json', { timeoutMs: 60_000 });
  if (!Array.isArray(list) || list.length < 30_000) throw new Error('liste des communes illisible');
  const idx = new Map();
  for (const c of list) {
    if (!c?.centre?.coordinates) continue;
    const k = slug(c.nom).replace(/-/g, '');
    if ((idx.get(k)?.population ?? -1) < (c.population ?? 0)) idx.set(k, c);
  }
  communesIndex = idx;
  return idx;
}

/** Commune au nom exact d'après le domaine (communes de 5 000 habitants et plus seulement, pour éviter les homonymes), sinon null. */
export function communeOf(host, idx) {
  for (const cand of communeCandidates(host)) {
    const c = idx.get(cand.replace(/-/g, ''));
    if (c && (c.population ?? 0) >= 5000) {
      return { name: c.nom, dept: c.codeDepartement, lon: c.centre.coordinates[0], lat: c.centre.coordinates[1] };
    }
  }
  return null;
}

async function readDdosia(now, prev) {
  const configs = await fetchStrictJson(`${WITHA}/configs`, { timeoutMs: 30_000 });
  if (!Array.isArray(configs?.items)) throw new Error('liste des configurations illisible');
  const seen = new Set(prev?.configsSeen ?? []);
  const fresh = configs.items.filter((c) => typeof c.id === 'string' && !seen.has(c.id) && Number(c.ts) * 1000 > now - 30 * DAY)
    .sort((a, b) => Number(a.ts) - Number(b.ts)).slice(-8);
  const hosts = new Map((prev?.hosts ?? []).map((h) => [h.host, h]));
  const places = new Map(Object.entries(prev?.places ?? {}));
  const days = new Map((prev?.days ?? []).map((d) => [d.day, d]));
  let lastConfig = prev?.lastConfig ?? null;
  for (const c of fresh) {
    const cfg = await fetchStrictJson(`${WITHA}/config/${encodeURIComponent(c.id)}`, { timeoutMs: 30_000 });
    const targets = Array.isArray(cfg?.targets) ? cfg.targets : [];
    const at = new Date(Number(c.ts) * 1000).toISOString();
    const names = [...new Set(targets.map((t) => String(t.host ?? '').toLowerCase()).filter(Boolean))];
    const tlds = new Map();
    for (const n of names) { const tld = n.split('.').pop(); tlds.set(tld, (tlds.get(tld) ?? 0) + 1); }
    const frNames = names.filter(isFrenchHost);
    for (const host of frNames) {
      const h = hosts.get(host) ?? { host, first: at, last: at, configs: 0, kind: hostKind(host) };
      h.last = at > h.last ? at : h.last;
      h.first = at < h.first ? at : h.first;
      h.configs += 1;
      hosts.set(host, h);
    }
    const day = at.slice(0, 10);
    const d = days.get(day) ?? { day, configs: 0, targets: 0, fr: 0, frHosts: [] };
    d.configs += 1;
    d.targets = Math.max(d.targets, names.length);
    d.frHosts = [...new Set([...d.frHosts, ...frNames])];
    d.fr = d.frHosts.length;
    days.set(day, d);
    seen.add(c.id);
    if (!lastConfig || at > lastConfig.at) {
      lastConfig = { id: c.id, at, targets: names.length, fr: frNames.length,
        tlds: [...tlds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count })) };
    }
  }
  // Lieux : préfecture d'après le domaine, sinon commune au nom exact ; cherchés une seule fois par site.
  const toPlace = [...hosts.keys()].filter((h) => !places.has(h));
  const idx = toPlace.length ? await communes().catch(() => null) : null;
  for (const host of toPlace) {
    const dept = prefectureOf(host);
    if (dept) { places.set(host, { dept, name: `Préfecture ${DEPT_NAMES[dept]}`, how: 'préfecture', lon: null, lat: null }); continue; }
    if (!idx) continue; // liste des communes indisponible : nouvel essai au cycle suivant
    const c = communeOf(host, idx);
    places.set(host, c ? { ...c, how: 'commune' } : null);
  }
  const cut = new Date(now - 30 * DAY).toISOString();
  const keptHosts = [...hosts.values()].filter((h) => h.last >= cut).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 150);
  return {
    readAt: new Date(now).toISOString(), lastConfig,
    hosts: keptHosts.map((h) => {
      const place = places.get(h.host) ?? null;
      // Site au nom exact d'une commune (« brest.fr », « www.saint-malo.fr ») : site de la collectivité.
      const kind = h.kind === 'site' && place?.how === 'commune' && /^(www\.)?[a-z-]+\.fr$/.test(h.host) ? 'collectivité' : h.kind;
      return { host: h.host, first: h.first, last: h.last, configs: h.configs, kind, place };
    }),
    days: [...days.values()].filter((d) => d.day >= cut.slice(0, 10)).sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ ...d, frHosts: d.frHosts.slice(0, 40) })),
    configsSeen: [...seen].slice(-200),
    places: Object.fromEntries([...places.entries()].filter(([h]) => keptHosts.some((k) => k.host === h))),
  };
}

// ─── Domaines imitateurs ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Services publics et grandes marques visés par l'hameçonnage en France ; mots composés écrits sans tiret. */
export const BRANDS = {
  ameli: 'Assurance maladie (ameli)', cpam: 'Assurance maladie (CPAM)', impots: 'Impôts', dgfip: 'Impôts (DGFiP)', franceconnect: 'FranceConnect',
  antai: 'ANTAI (amendes)', amende: 'ANTAI (amendes)', amendes: 'ANTAI (amendes)', caf: 'CAF', francetravail: 'France Travail', poleemploi: 'France Travail',
  urssaf: 'Urssaf', servicepublic: 'Service-public.fr', critair: "Crit'Air", vignettecritair: "Crit'Air", laposte: 'La Poste', colissimo: 'Colissimo',
  chronopost: 'Chronopost', mondialrelay: 'Mondial Relay', creditagricole: 'Crédit Agricole', labanquepostale: 'La Banque postale',
  societegenerale: 'Société générale', bnpparibas: 'BNP Paribas', creditmutuel: 'Crédit mutuel', caisseepargne: "Caisse d'épargne",
  banquepopulaire: 'Banque populaire', boursorama: 'Boursorama', boursobank: 'BoursoBank', vinted: 'Vinted', leboncoin: 'Leboncoin',
  doctolib: 'Doctolib', sncf: 'SNCF', sncfconnect: 'SNCF', ouigo: 'SNCF', edf: 'EDF', engie: 'Engie', totalenergies: 'TotalEnergies',
  ants: 'ANTS', ameliassure: 'Assurance maladie (ameli)', moncompteformation: 'Mon compte formation', cpf: 'Mon compte formation',
};
/** Mots trop courts ou trop courants seuls : retenus seulement avec un mot d'appui (« ants-gouv », « caf-aide »). */
const WEAK = new Set(['caf', 'edf', 'cpf', 'ants', 'sncf', 'amende', 'amendes', 'cpam']);
const SUPPORT = new Set(['gouv', 'fr', 'france', 'service', 'services', 'aide', 'aides', 'remboursement', 'paiement', 'compte', 'moncompte',
  'espace', 'info', 'infos', 'verif', 'verification', 'secure', 'securite', 'login', 'connexion', 'dossier', 'suivi', 'colis', 'carte',
  'vitale', 'permis', 'titres', 'amende', 'amendes', 'regularisation', 'majoration', 'avis', 'client', 'clients', 'livraison', 'mise', 'jour', 'maj']);
/** Domaines officiels connus : jamais signalés. */
const OFFICIAL = /^(ameli|impots|franceconnect|antai|caf|francetravail|urssaf|service-public|laposte|colissimo|chronopost|mondialrelay|credit-agricole|labanquepostale|societegenerale|bnpparibas|creditmutuel|caisse-epargne|banquepopulaire|boursorama|boursobank|vinted|leboncoin|doctolib|sncf|sncf-connect|ouigo|edf|engie|totalenergies|ants|moncompteformation)\.(fr|com|gouv\.fr)$/;

/** Marque imitée par un domaine, ou null. « vinted-order803.com » → Vinted ; « ameliachicago.com » → null. */
export function brandOf(domain) {
  const d = String(domain ?? '').toLowerCase().trim();
  if (!d || OFFICIAL.test(d)) return null;
  const label = d.split('.').slice(0, -1).join('-');
  const tokens = label.replace(/[0-9]+/g, '-').split(/[-.]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    for (const k of [tokens[i], `${tokens[i]}${tokens[i + 1] ?? ''}`, `${tokens[i]}${tokens[i + 1] ?? ''}${tokens[i + 2] ?? ''}`]) {
      if (!BRANDS[k]) continue;
      if (WEAK.has(k) && !tokens.some((t, j) => j !== i && SUPPORT.has(t))) continue;
      return BRANDS[k];
    }
  }
  return null;
}

/** Premier fichier d'une archive zip (méthode « deflate » ou « store »), sans bibliothèque. */
export function unzipFirst(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('archive zip illisible');
  const method = buf.readUInt16LE(8);
  let size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (size === 0 || buf.readUInt16LE(6) & 0x08) {
    // Taille dans le répertoire central (fichier écrit en flux) : l'inflation lit jusqu'à la fin du flux compressé.
    size = buf.length - start;
  }
  const data = buf.subarray(start, start + size);
  if (method === 0) return data.toString('utf8');
  if (method === 8) return inflateRawSync(data).toString('utf8');
  throw new Error(`méthode de compression ${method} non lue`);
}

async function readLookalikes(now, prev) {
  const day = dayOf(now - DAY);
  if (prev?.days?.includes(day)) return { ...prev, readAt: prev.readAt };
  const name = Buffer.from(`${day}.zip`).toString('base64');
  const res = await fetch(`https://www.whoisds.com//whois-database/newly-registered-domains/${name}/nrd`, {
    headers: { 'User-Agent': SOURCE_USER_AGENT }, signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = unzipFirst(Buffer.from(await res.arrayBuffer()));
  const all = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (all.length < 1000) throw new Error('liste quotidienne trop courte');
  const found = all.map((domain) => ({ domain, brand: brandOf(domain), day })).filter((x) => x.brand);
  const cut = dayOf(now - 30 * DAY);
  const domains = [...found, ...(prev?.domains ?? []).filter((x) => x.day >= cut && !found.some((f) => f.domain === x.domain))].slice(0, 300);
  const perDay = [...(prev?.perDay ?? []).filter((x) => x.day >= cut && x.day !== day), { day, total: all.length, matched: found.length }]
    .sort((a, b) => a.day.localeCompare(b.day));
  return { readAt: new Date(now).toISOString(), days: [...new Set([...(prev?.days ?? []).filter((d) => d >= cut), day])], domains, perDay };
}

// ─── CNIL ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CNIL_DATASET = 'https://www.data.gouv.fr/api/1/datasets/?q=Notifications%20%C3%A0%20la%20CNIL%20de%20violations%20de%20donn%C3%A9es&page_size=3';

/** Ligne CSV séparée par des points-virgules, champs entre guillemets compris (« "Commerce ; réparation" »). */
export function splitSemicolon(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** CSV CNIL (point-virgule, 1re ligne = note d'extraction) → trimestres, secteurs et origines des 4 derniers trimestres. */
export function parseCnil(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const note = splitSemicolon(lines[0] ?? '')[0].trim();
  const head = splitSemicolon(lines[1] ?? '').map((h) => h.trim().toLowerCase());
  const iDate = head.findIndex((h) => h.startsWith('date'));
  const iSector = head.findIndex((h) => h.startsWith('secteur'));
  const iOrigin = head.findIndex((h) => h.startsWith('origines'));
  const iCause = head.findIndex((h) => h.startsWith('causes'));
  if (iDate < 0 || iSector < 0 || iOrigin < 0) throw new Error('colonnes CNIL introuvables');
  const quarters = new Map();
  const rows = [];
  for (const line of lines.slice(2)) {
    const f = splitSemicolon(line);
    const m = /^(\d{4})-(\d{2})$/.exec((f[iDate] ?? '').trim());
    if (!m) continue;
    const q = `${m[1]}-T${Math.ceil(Number(m[2]) / 3)}`;
    quarters.set(q, (quarters.get(q) ?? 0) + 1);
    rows.push({ q, sector: (f[iSector] ?? '').trim().replace(/''/g, "'") || 'non précisé', origin: (f[iOrigin] ?? '').trim(), cause: (f[iCause] ?? '').trim() });
  }
  if (!rows.length) throw new Error('aucune notification lue');
  const qs = [...quarters.keys()].sort();
  const last4 = new Set(qs.slice(-4));
  const recent = rows.filter((r) => last4.has(r.q));
  const count = (key) => {
    const m = new Map();
    for (const r of recent) for (const v of key(r)) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([label, n]) => ({ label, count: n }));
  };
  const hacking = recent.filter((r) => /piratage|malveillant|ran[cç]ongiciel|hame[cç]onnage/i.test(r.origin)).length;
  const external = recent.filter((r) => /externe malveillant/i.test(r.cause)).length;
  return {
    note, quarters: qs.slice(-12).map((q) => ({ q, count: quarters.get(q) })), last4: recent.length,
    hackingPct: recent.length ? Math.round((hacking / recent.length) * 100) : null,
    externalPct: recent.length ? Math.round((external / recent.length) * 100) : null,
    sectors: count((r) => [r.sector]),
    origins: count((r) => r.origin.split(/,(?=[A-ZÉ])/).map((s) => s.trim()).filter(Boolean)),
  };
}

async function readCnil(now) {
  const meta = await fetchStrictJson(CNIL_DATASET, { timeoutMs: 30_000 });
  const ds = (meta?.data ?? []).find((d) => /violations de donn/i.test(d.title ?? ''));
  const res = ds?.resources?.find((r) => /csv/i.test(r.format ?? ''));
  if (!res?.url) throw new Error('fichier CSV introuvable sur data.gouv.fr');
  const text = await fetchStrictText(res.url, { timeoutMs: 120_000 });
  return { readAt: new Date(now).toISOString(), fileDate: String(res.last_modified ?? '').slice(0, 10), file: res.title ?? null, ...parseCnil(text) };
}

// ─── EPSS et EUVD ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** CVE suivis par la Vigilance cyber (KEV récents et alertes ou avis du CERT-FR), au plus 100. */
export function trackedCves(cyber) {
  const out = new Set();
  for (const k of cyber?.kev?.recent ?? []) if (k?.cve) out.add(k.cve);
  for (const i of [...(cyber?.certfr?.alerts ?? []), ...(cyber?.certfr?.avis ?? [])]) for (const c of i?.cves ?? []) out.add(c);
  return [...out].filter((c) => /^CVE-\d{4}-\d{4,}$/.test(c)).slice(0, 100);
}

async function readEpss(now) {
  const cves = trackedCves(await kvGetJson(CYBER_KEY, now));
  if (!cves.length) return { readAt: new Date(now).toISOString(), date: null, scores: [] };
  const json = await fetchStrictJson(`https://api.first.org/data/v1/epss?cve=${cves.join(',')}&limit=100`, { timeoutMs: 30_000 });
  if (!Array.isArray(json?.data)) throw new Error('réponse EPSS illisible');
  const scores = json.data.filter((d) => typeof d?.cve === 'string')
    .map((d) => ({ cve: d.cve, epss: round(num(d.epss), 4), percentile: round(num(d.percentile), 4) }));
  return { readAt: new Date(now).toISOString(), date: json.data[0]?.date ?? null, scores };
}

/** « Oct 15, 2026, 8:30:32 PM » → « 2026-10-15 » ; null si illisible. */
export function euvdDay(text) {
  const t = Date.parse(String(text ?? '').replace(/,(?= \d{1,2}:)/, ''));
  return Number.isFinite(t) ? dayOf(t) : null;
}

export function parseEuvd(json, now) {
  if (!Array.isArray(json?.items)) throw new Error('réponse EUVD illisible');
  const items = json.items.map((i) => {
    const product = i.enisaIdProduct?.[0]?.product;
    return {
      id: String(i.id), cve: (String(i.aliases ?? '').split('\n').find((a) => a.startsWith('CVE-')) ?? null),
      vendor: product?.vendor?.name ?? i.enisaIdVendor?.[0]?.vendor?.name ?? null, product: product?.name ?? null,
      score: num(i.baseScore), exploitedSince: euvdDay(i.exploitedSince), published: euvdDay(i.datePublished),
    };
  }).sort((a, b) => String(b.exploitedSince ?? b.published).localeCompare(String(a.exploitedSince ?? a.published)));
  const cut7 = dayOf(now - 7 * DAY);
  return { total30: num(json.total) ?? items.length, last7: items.filter((i) => (i.exploitedSince ?? i.published ?? '') >= cut7).length, items: items.slice(0, 25) };
}

async function readEuvd(now) {
  const from = dayOf(now - 30 * DAY);
  const json = await fetchStrictJson(`https://euvdservices.enisa.europa.eu/api/search?exploited=true&size=100&fromDate=${from}`, { timeoutMs: 30_000 });
  return { readAt: new Date(now).toISOString(), ...parseEuvd(json, now) };
}

// ─── Services publics en ligne ──────────────────────────────────────────────────────────────────────────────────────────────

export const SERVICES = [
  { id: 'franceconnect', name: 'FranceConnect', url: 'https://app.franceconnect.gouv.fr/' },
  { id: 'impots', name: 'impots.gouv.fr', url: 'https://www.impots.gouv.fr/' },
  { id: 'ameli', name: 'ameli.fr', url: 'https://www.ameli.fr/' },
  { id: 'ants', name: 'ANTS', url: 'https://ants.gouv.fr/' },
  { id: 'servicepublic', name: 'Service-public.fr', url: 'https://www.service-public.fr/' },
  { id: 'caf', name: 'caf.fr', url: 'https://www.caf.fr/' },
  { id: 'francetravail', name: 'France Travail', url: 'https://www.francetravail.fr/' },
  { id: 'monespacesante', name: 'Mon espace santé', url: 'https://www.monespacesante.fr/' },
  { id: 'demarches', name: 'Démarches simplifiées', url: 'https://www.demarches-simplifiees.fr/' },
];
const PROBE_TIMEOUT_MS = 15_000;
const SAMPLES_KEEP = 288;

/** Une sonde : réponse HTTP < 500 dans le délai = en ligne (403 compris : le site répond mais filtre les robots). */
async function probe(service) {
  const t0 = Date.now();
  try {
    const res = await fetch(service.url, { headers: { 'User-Agent': SOURCE_USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => {});
    return { ok: res.status < 500, status: res.status, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: err instanceof Error && err.name === 'TimeoutError' ? 'délai dépassé' : 'connexion impossible' };
  }
}

async function readServices(now, prev) {
  const results = await mapLimit(SERVICES, 4, probe);
  const items = SERVICES.map((s, i) => {
    const old = (prev?.items ?? []).find((x) => x.id === s.id);
    const r = results[i].ok ? results[i].value : { ok: false, status: null, ms: null, error: 'sonde en échec' };
    const samples = [...(old?.samples ?? []), [Math.round(now / MIN), r.ok ? r.ms : -1]].slice(-SAMPLES_KEEP);
    const downSince = r.ok ? null : (old && !old.ok ? old.downSince : new Date(now).toISOString());
    const up = samples.filter((x) => x[1] >= 0);
    return {
      id: s.id, name: s.name, url: s.url, ok: r.ok, status: r.status, ms: r.ms, error: r.error ?? null, downSince,
      uptime24: samples.length ? round((up.length / samples.length) * 100) : null,
      medianMs: up.length ? up.map((x) => x[1]).sort((a, b) => a - b)[Math.floor(up.length / 2)] : null, samples,
    };
  });
  return { readAt: new Date(now).toISOString(), items };
}

// ─── Sites français visés par NoName057(16) : joignables ? ───

/** Sites relevés dans une liste de moins de 24 h : sondés toutes les 10 min (une requête chacun, au plus 30). */
const TARGET_WINDOW_MS = DAY;
const TARGET_SAMPLES = 36;
const TARGET_MAX = 30;
/** Lent : plus de 3 fois sa réponse médiane des 6 dernières heures et plus de 3 s. */
const SLOW_FACTOR = 3;
const SLOW_MIN_MS = 3000;

/** État d'un site visé d'après sa dernière sonde et sa médiane : joignable, lent ou injoignable. */
export function targetState(ok, ms, medianMs) {
  if (!ok) return 'injoignable';
  if (ms !== null && ms > SLOW_MIN_MS && medianMs !== null && ms > SLOW_FACTOR * medianMs) return 'lent';
  return 'joignable';
}

async function readTargets(now, prev, all) {
  const hosts = (all?.ddosia?.hosts ?? []).filter((h) => now - Date.parse(h.last) < TARGET_WINDOW_MS).slice(0, TARGET_MAX).map((h) => h.host);
  // HTTPS d'abord ; connexion refusée (site sans HTTPS, comme www.mn.fr le 18/10) : repli en HTTP, jamais une fausse panne.
  const probes = await mapLimit(hosts, 6, async (host) => {
    const r = await probe({ url: `https://${host}/` });
    return r.ok || r.error !== 'connexion impossible' ? r : probe({ url: `http://${host}/` });
  });
  const items = hosts.map((host, i) => {
    const old = (prev?.items ?? []).find((x) => x.host === host);
    const r = probes[i].ok ? probes[i].value : { ok: false, status: null, ms: null, error: 'sonde en échec' };
    const samples = [...(old?.samples ?? []), [Math.round(now / MIN), r.ok ? r.ms : -1]].slice(-TARGET_SAMPLES);
    const up = samples.slice(0, -1).filter((x) => x[1] >= 0).map((x) => x[1]).sort((a, b) => a - b);
    const medianMs = up.length >= 3 ? up[Math.floor(up.length / 2)] : null;
    const state = targetState(r.ok, r.ms, medianMs);
    const since = state === 'joignable' ? null : (old && old.state !== 'joignable' ? old.since : new Date(now).toISOString());
    return { host, ok: r.ok, status: r.status, ms: r.ms, error: r.error ?? null, medianMs, state, since, samples };
  });
  return { readAt: new Date(now).toISOString(), items };
}

// ─── Collecte ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const READERS = {
  radar: (now) => readRadar(now), abuse: (now) => readAbuse(now), ddosia: readDdosia, lookalikes: readLookalikes, cnil: (now) => readCnil(now),
  epss: (now) => readEpss(now), euvd: (now) => readEuvd(now), services: readServices, targets: readTargets,
};

/** Réservé aux tests : lecteurs remplacés. */
export function __setReadersForTests(next) {
  Object.assign(READERS, next);
}

function due(part, prev, now) {
  const p = prev?.[part];
  const tried = Date.parse(prev?.tried?.[part] ?? '');
  if (Number.isFinite(tried) && now - tried < Math.min(RETRY_MS, CADENCE_MS[part])) return false;
  const read = Date.parse(p?.readAt ?? '');
  return !Number.isFinite(read) || now - read >= CADENCE_MS[part] - 5_000;
}

export function emptyWatch(errors = []) {
  return { readAt: null, ...Object.fromEntries(PARTS.map((p) => [p, null])), errors };
}

async function collect(now) {
  const stored = await kvGetJson(CYBER_WATCH_KEY, now);
  const prev = isRecord(stored) ? stored : null;
  const next = { ...emptyWatch(), ...(prev ?? {}), tried: { ...(prev?.tried ?? {}) }, failures: { ...(prev?.failures ?? {}) } };
  const work = PARTS.filter((p) => due(p, prev, now));
  if (!work.length) return next;
  const run = async (part) => {
    next.tried[part] = new Date(now).toISOString();
    try {
      next[part] = await READERS[part](now, prev?.[part] ?? null, next);
      delete next.failures[part];
    } catch (err) {
      next.failures[part] = sourceError(PREFIX[part], err);
    }
  };
  // Sondes des sites visés après la lecture des listes de cibles : elles portent sur les sites de la liste du moment.
  await Promise.all(work.filter((p) => p !== 'targets').map(run));
  if (work.includes('targets')) await run('targets');
  const dates = PARTS.map((p) => next[p]?.readAt).filter((d) => typeof d === 'string').sort();
  next.readAt = dates.at(-1) ?? null;
  next.errors = Object.values(next.failures);
  await kvSetJson(CYBER_WATCH_KEY, next, KEEP_SEC, now);
  return next;
}

/** Réponse publique : sans l'état interne (essais, configurations lues, cache des lieux, échantillons bruts des sondes). */
export function publicWatch(body) {
  const b = isRecord(body) ? body : emptyWatch();
  const out = { readAt: b.readAt ?? null, errors: Array.isArray(b.errors) ? b.errors : [] };
  for (const p of PARTS) out[p] = b[p] ?? null;
  if (out.ddosia) out.ddosia = { readAt: out.ddosia.readAt, lastConfig: out.ddosia.lastConfig, hosts: out.ddosia.hosts, days: out.ddosia.days };
  if (out.lookalikes) out.lookalikes = { readAt: out.lookalikes.readAt, domains: out.lookalikes.domains, perDay: out.lookalikes.perDay };
  if (out.targets) out.targets = { readAt: out.targets.readAt, items: out.targets.items.map(({ samples, ...t }) => t) };
  if (out.services) {
    out.services = {
      readAt: out.services.readAt,
      items: out.services.items.map(({ samples, ...s }) => ({ ...s, hours: hourly(samples ?? []) })),
    };
  }
  return out;
}

/** Échantillons (minute, ms ou −1) → disponibilité par heure sur 24 h (null sans mesure). */
export function hourly(samples) {
  if (!samples.length) return [];
  const lastHour = Math.floor(samples.at(-1)[0] / 60);
  return Array.from({ length: 24 }, (_, i) => {
    const h = lastHour - 23 + i;
    const s = samples.filter((x) => Math.floor(x[0] / 60) === h);
    return s.length ? Math.round((s.filter((x) => x[1] >= 0).length / s.length) * 100) : null;
  });
}

let inflight = null;

/** Collecte à jour (chaque partie seulement si due) ; une seule à la fois ; ne lève jamais. */
export function ensureCyberWatchFresh(now = Date.now()) {
  inflight ??= collect(now)
    .catch(async (err) => {
      console.error('[veille cyber] collecte interrompue', err instanceof Error ? err.message : String(err));
      const stored = await kvGetJson(CYBER_WATCH_KEY, now).catch(() => null);
      return { ...(isRecord(stored) ? stored : emptyWatch()), errors: [sourceError('Veille cyber', err)] };
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Dernière collecte gardée, sans attendre (échéance de la route). */
export async function storedCyberWatch(now, note) {
  const stored = await kvGetJson(CYBER_WATCH_KEY, now);
  const body = isRecord(stored) ? stored : emptyWatch();
  return { ...body, errors: [...(Array.isArray(body.errors) ? body.errors : []), ...(note ? [note] : [])] };
}

/** Réservé aux tests. */
export function __resetCyberWatchForTests() {
  inflight = null;
}

export const CYBER_WATCH_PENDING_NOTE = 'Veille cyber : collecte en cours';
