// api/_lib/anticipation/signals.js : normalisation des relevés du site en signaux datés et attribués (spec anticipation § 6, 04/11/2026).
// Fonction pure : aucune lecture, aucune horloge (l'heure est passée en argument). Un relevé absent ou trop ancien ne produit aucun
// signal et son nom entre dans `unknown` : la règle tourne sans lui, elle ne lève jamais.
import { departementAt } from '../geo-fr.js';
import { normalizeDepartmentCode } from '../../_shared/departments.js';
import { deptsOfRailScope } from './rail-hubs.js';
import { parisInstant } from './rules/paris-time.js';

/** @typedef {import('./probability.js').Signal} Signal */

const H = 3_600_000;

/** Âge maximal d'un relevé (ou d'un signal) avant d'être jugé périmé, par nature de signal, en millisecondes. */
export const MAX_AGE_MS = Object.freeze({
  rassemblement: 26 * H, // après la fin annoncée
  vigilance: 6 * H,
  panne: 30 * 60_000,
  perturbation_sncf: 2 * H,
  cyber: 3 * H,
  ecowatt: 26 * H,
  tension_carburant: 1 * H,
  presse: 24 * H,
});

/** Âge maximal du relevé lui-même (distinct de la péremption d'un signal : un rassemblement reste 26 h après sa fin). */
export const RELEVE_MAX_AGE_MS = Object.freeze({ protests: 2 * H });

const SOCIAL_RE = /grève|mouvement social|préavis/i;
const OPERATOR_RE = /\b(SNCF|RATP|TCL|RTM|Tisséo|TBM|Ilévia|Star|Tan)\b/i;
/** Phénomènes de vigilance (id Météo-France → nom court porté par `ref`). */
const PHENOMENA = Object.freeze({ 1: 'vent', 2: 'pluie_inondation', 3: 'orages', 4: 'crues', 5: 'neige_verglas', 6: 'canicule', 7: 'grand_froid', 9: 'vagues_submersion' });
const LEVEL_OF_COLOR = Object.freeze({ 2: 'jaune', 3: 'orange', 4: 'rouge' });
const OFFICIAL_OUTAGE_SOURCES = new Set(['rte', 'edf', 'statut', 'arcep']);

/** Jour de publication « AAAA-MM-JJ » (jour de Paris) en ISO (minuit de Paris), ou null s'il manque ou est illisible. */
function parisDayToIso(/** @type {unknown} */ day) {
  const m = typeof day === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  return m ? new Date(parisInstant(Number(m[1]), Number(m[2]), Number(m[3]), 0)).toISOString() : null;
}

const errMsg = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();
const ms = (/** @type {unknown} */ v) => (typeof v === 'string' ? Date.parse(v) : NaN);
/** Relevé lu il y a moins de `max` ms (date illisible ou future au-delà de 5 min : périmé). */
const fresh = (/** @type {unknown} */ readAt, /** @type {number} */ max, /** @type {number} */ now) => {
  const t = ms(readAt);
  return Number.isFinite(t) && now - t <= max && t - now <= 5 * 60_000;
};

/**
 * Construit un signal ; l'id est stable d'un tick à l'autre : `<kind>:<origin>:<dept>:<clé>`.
 * @param {Partial<Signal> & {kind: string, domain: Signal['domain'], source: string, origin: string, key: string, readAt: string}} p
 * @returns {Signal}
 */
function mk(p) {
  const dept = p.dept ?? [];
  return {
    id: `${p.kind}:${p.origin}:${dept.join('+') || '-'}:${p.key}`,
    domain: p.domain, kind: p.kind, source: p.source, origin: p.origin,
    official: p.official ?? false, dept, communes: p.communes ?? [], ...(p.meta ? { meta: p.meta } : {}),
    level: p.level ?? null, value: p.value ?? null, window: p.window ?? null,
    publishedAt: p.publishedAt ?? null, observedAt: p.observedAt ?? p.readAt, checkedAt: p.readAt, ref: p.ref ?? '',
  };
}

/** Département d'un point, ou []. */
function deptOfPoint(/** @type {unknown} */ lat, /** @type {unknown} */ lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return [];
  const d = departementAt(lat, lon);
  return d ? [d] : [];
}

// ─── Manifestations ───

function fromProtests(/** @type {any} */ protests, /** @type {number} */ now, /** @type {string[]} */ errors) {
  /** @type {Signal[]} */
  const out = [];
  const readAt = protests.readAt;
  for (const it of Array.isArray(protests.items) ? protests.items : []) {
    try {
    const start = ms(it.startsAt);
    if (!Number.isFinite(start)) continue;
    const signale = it.status === 'signale' || it.source === 'presse' || it.source === 'gdelt';
    const end = signale ? start : start + (it.allDay ? 24 * H : 3 * H);
    if (end + MAX_AGE_MS.rassemblement < now) continue;
    const code = normalizeDepartmentCode(it.dept);
    const dept = code ? [code] : deptOfPoint(it.lat, it.lon);
    const base = { domain: /** @type {const} */ ('social'), readAt, dept, window: { from: iso(start), to: iso(end) }, ref: it.url || String(it.id), key: String(it.id) };
    if (it.arrete) {
      // Document officiel : PDF du recueil ouvert à la page de l'arrêté, et de quoi l'apercevoir dans la fiche (bascule « arrêté publié »).
      const a = it.arrete;
      const page = Number.isInteger(a.page) && a.page > 0 ? a.page : null;
      const url = typeof it.url === 'string' && it.url ? `${it.url.split('#')[0]}${page ? `#page=${page}` : ''}` : '';
      const doc = {
        act: typeof a.act === 'string' ? a.act : null, title: typeof a.title === 'string' ? a.title : null,
        excerpt: typeof a.excerpt === 'string' ? a.excerpt : null, hours: Array.isArray(a.hours) ? a.hours : null,
        publishedOn: typeof a.publishedOn === 'string' ? a.publishedOn : null, issuer: typeof it.edition === 'string' ? it.edition : null, page,
      };
      out.push(mk({ ...base, ref: url || base.ref, kind: 'arrete_prefectoral', source: 'prefecture', origin: `prefecture:${dept[0] ?? 'n.d.'}`, official: true, publishedAt: parisDayToIso(a.publishedOn), meta: { doc } }));
    } else if (it.source === 'prefecture') {
      out.push(mk({ ...base, kind: 'rassemblement_annonce', source: 'prefecture', origin: `prefecture:${dept[0] ?? 'n.d.'}`, official: true }));
    } else if (signale) {
      const origin = it.source === 'gdelt' ? `gdelt:${it.id}` : `presse:item:${it.id}`;
      out.push(mk({ ...base, kind: 'rassemblement_signale', source: it.source, origin, value: typeof it.participants === 'number' ? it.participants : null, publishedAt: iso(start), meta: { participants: typeof it.participants === 'number' ? it.participants : null } }));
    } else {
      const origin = it.source === 'giletsjaunes' ? 'gilets-jaunes' : it.source;
      out.push(mk({ ...base, kind: 'rassemblement_annonce', source: it.source, origin }));
    }
    } catch (e) { errors.push(`Manifestations: ${it?.id}: ${errMsg(e)}`); }
  }
  return out;
}

// ─── Vigilance Météo-France ───

function fromVigilance(/** @type {any} */ v, /** @type {number} */ now, /** @type {string[]} */ errors) {
  /** @type {Signal[]} */
  const out = [];
  for (const period of Array.isArray(v.periods) ? v.periods : []) {
    if (ms(period.end) + MAX_AGE_MS.vigilance < now) continue;
    for (const d of Array.isArray(period.departments) ? period.departments : []) {
      try {
        const code = normalizeDepartmentCode(d.code);
        if (!code) continue;
        for (const ph of Array.isArray(d.phenomena) ? d.phenomena : []) {
          const level = /** @type {Record<number, string>} */ (LEVEL_OF_COLOR)[ph.color];
          const name = /** @type {Record<string, string>} */ (PHENOMENA)[ph.id];
          if (!level || !name) continue;
          // Créneaux de la couleur du phénomène (ou plus forte) fusionnés : du premier début à la dernière fin.
          const all = Array.isArray(ph.slots) ? ph.slots : [];
          if (all.some((/** @type {any} */ s) => !Number.isFinite(ms(s.from)) || !Number.isFinite(ms(s.to)))) throw new Error('créneau à date illisible');
          const slots = all.filter((/** @type {any} */ s) => s.color >= ph.color);
          const window = slots.length
            ? { from: iso(Math.min(...slots.map((/** @type {any} */ s) => ms(s.from)))), to: iso(Math.max(...slots.map((/** @type {any} */ s) => ms(s.to)))) }
            : { from: iso(ms(period.begin)), to: iso(ms(period.end)) };
          out.push(mk({ kind: 'vigilance', domain: 'weather', source: 'meteo-france', origin: 'meteo-france', official: true, dept: [code], level, window,
            publishedAt: v.updateTime ?? null, readAt: v.readAt, key: `${name}:${period.echeance}`, ref: 'meteo-france:vigilance', meta: { phenomenon: name, echeance: period.echeance } }));
        }
      } catch (e) { errors.push(`Météo-France: département ${d?.code}: ${errMsg(e)}`); }
    }
  }
  return out;
}

// ─── Situations ferroviaires ───

function fromRail(/** @type {any} */ rail, /** @type {number} */ now, /** @type {string[]} */ errors) {
  /** @type {Signal[]} */
  const out = [];
  for (const s of Array.isArray(rail.situations) ? rail.situations : []) {
    try {
    if (ms(s.end) + MAX_AGE_MS.perturbation_sncf < now) continue;
    const social = SOCIAL_RE.test(`${s.cause ?? ''} ${s.title ?? ''}`);
    if (!social && s.causeKind === 'travaux') continue; // travaux annoncés : pas une perturbation
    const from = ms(s.start);
    if (!Number.isFinite(from)) continue;
    const to = Number.isFinite(ms(s.end)) ? ms(s.end) : Math.max(from, now);
    out.push(mk({ kind: social ? 'mouvement_social_transport' : 'perturbation_sncf', domain: 'transport', source: 'sncf', origin: 'sncf', official: true,
      dept: deptsOfRailScope(String(s.scope ?? s.title ?? '')), window: { from: iso(from), to: iso(to) }, publishedAt: iso(from), readAt: rail.at, key: String(s.id), ref: String(s.id) }));
    } catch (e) { errors.push(`SNCF: ${s?.id}: ${errMsg(e)}`); }
  }
  return out;
}

// ─── Pannes en cours ───

function fromRoom(/** @type {any} */ room, /** @type {number} */ now, /** @type {string[]} */ errors) {
  /** @type {Signal[]} */
  const out = [];
  for (const o of Array.isArray(room.outages) ? room.outages : []) {
    try {
    const evidence = Array.isArray(o.evidence) ? o.evidence : [];
    const best = evidence.find((/** @type {any} */ e) => OFFICIAL_OUTAGE_SOURCES.has(e.source)) ?? evidence[0];
    const src = best?.source ?? 'presse';
    const code = normalizeDepartmentCode(o.dept);
    const from = ms(o.since);
    const to = Number.isFinite(ms(o.until)) ? ms(o.until) : now;
    out.push(mk({ kind: 'panne', domain: o.network === 'electricite' ? 'energy' : 'telecom', source: src, origin: src,
      official: OFFICIAL_OUTAGE_SOURCES.has(src), dept: code ? [code] : [], level: o.level ?? null,
      window: Number.isFinite(from) ? { from: iso(from), to: iso(Math.max(from, to)) } : null, publishedAt: Number.isFinite(from) ? iso(from) : null,
      readAt: room.generatedAt, key: String(o.id), ref: String(o.id), meta: { network: o.network, exposed: Number(o.exposed?.total) > 0 } }));
    } catch (e) { errors.push(`Pannes: ${o?.id}: ${errMsg(e)}`); }
  }
  return out;
}

// ─── Veille cyber ───

function fromCyber(/** @type {any} */ cyber, /** @type {number} */ now, /** @type {string[]} */ errors) {
  /** @type {Signal[]} */
  const out = [];
  for (const h of Array.isArray(cyber.ddosia?.hosts) ? cyber.ddosia.hosts : []) {
    try {
    if (!/\.fr$/i.test(String(h.host)) || !(ms(h.last) >= now - 24 * H)) continue;
    const code = normalizeDepartmentCode(h.place?.dept);
    out.push(mk({ kind: 'cyber_revendication', domain: 'cyber', source: 'ddosia', origin: 'ddosia', dept: code ? [code] : [], publishedAt: h.last, readAt: cyber.readAt, key: String(h.host), ref: String(h.host) }));
    } catch (e) { errors.push(`Veille cyber: ${h?.host}: ${errMsg(e)}`); }
  }
  const ratio = Math.max(cyber.radar?.l7Ratio ?? 0, cyber.radar?.l3Ratio ?? 0);
  if (ratio > 1) {
    out.push(mk({ kind: 'cyber_pic', domain: 'cyber', source: 'cloudflare-radar', origin: 'cloudflare-radar', official: true, value: ratio, publishedAt: cyber.radar.dataUntil ?? null, readAt: cyber.readAt, key: 'ddos-fr', ref: 'ddos-fr' }));
  }
  return out;
}

// ─── Écowatt ───

/** Jour de Paris « AAAA-MM-JJ » d'un instant. */
const parisDay = (/** @type {number} */ t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(t);
/** Instant (ms) du minuit de Paris d'un jour « AAAA-MM-JJ » (heure d'hiver ou d'été). */
function parisMidnight(/** @type {string} */ day) {
  const utc = Date.parse(`${day}T00:00:00Z`);
  for (const h of [1, 2]) if (parisDay(utc - h * H) === day && parisDay(utc - h * H - 1) !== day) return utc - h * H;
  return utc - H;
}

function fromEcowatt(/** @type {any} */ eco, /** @type {number} */ now) {
  /** @type {Signal[]} */
  const out = [];
  if (eco.source !== 'rte') return out; // le repli ODRÉ ne porte que des jours passés
  const today = parisDay(now);
  const last = parisDay(parisMidnight(today) + 3 * 24 * H + 2 * H);
  const level = { orange: 'orange', red: 'rouge' };
  for (const d of Array.isArray(eco.days) ? eco.days : []) {
    if (typeof d.date !== 'string' || d.date < today || d.date > last) continue;
    const from = parisMidnight(d.date);
    out.push(mk({ kind: 'ecowatt', domain: 'energy', source: 'rte', origin: 'rte', official: true, level: /** @type {Record<string, string>} */ (level)[d.level] ?? null,
      window: { from: iso(from), to: iso(parisMidnight(parisDay(from + 26 * H))) }, publishedAt: eco.generatedAt, readAt: eco.generatedAt, key: d.date, ref: d.date }));
  }
  return out;
}

// ─── Tension carburants ───

function fromFuel(/** @type {any} */ fuel) {
  /** @type {Signal[]} */
  const out = [];
  for (const s of Array.isArray(fuel.summaries) ? fuel.summaries : []) {
    const share = s.anomalyShare;
    const code = normalizeDepartmentCode(s.departmentCode);
    if (!code || typeof share !== 'number' || share < 15) continue; // seuils du 08/10/2026 : 15, 25, 40 %
    // Tendance : seulement si le relevé porte une valeur précédente ; sinon inconnue (aucun historique n'est inventé).
    const previous = typeof s.previousAnomalyShare === 'number' ? s.previousAnomalyShare : null;
    out.push(mk({ kind: 'tension_carburant', domain: 'fuel', source: 'prix-carburants', origin: 'prix-carburants', official: true, dept: [code],
      level: share >= 40 ? 'rouge' : share >= 25 ? 'orange' : 'jaune', value: share, readAt: fuel.generatedAt, key: code, ref: code, ...(previous !== null ? { meta: { previousValue: previous } } : {}) }));
  }
  // Part nationale des stations en rupture (sans département), lue par l'arrivée de la règle grève × carburant.
  const national = fuel.national?.anomalyShare;
  if (typeof national === 'number') {
    out.push(mk({ kind: 'tension_carburant', domain: 'fuel', source: 'prix-carburants', origin: 'prix-carburants', official: true, dept: [], value: national, readAt: fuel.generatedAt, key: 'national', ref: 'national',
      meta: { national: true, ...(typeof fuel.national?.previousAnomalyShare === 'number' ? { previousValue: fuel.national.previousAnomalyShare } : {}) } }));
  }
  return out;
}

// ─── Calendrier sportif ───

/** Signal de match : de 2 h avant le coup d'envoi à 3 h après. Un stade non reconnu n'a pas de département. */
function fromFootball(/** @type {any} */ football, /** @type {number} */ now, /** @type {string[]} */ errors) {
  /** @type {Signal[]} */
  const out = [];
  if (!football?.configured) return out;
  for (const m of Array.isArray(football.matches) ? football.matches : []) {
    try {
      const kick = ms(m.kickoff);
      if (!Number.isFinite(kick) || kick + 3 * H < now) continue;
      const code = normalizeDepartmentCode(m.dept);
      out.push(mk({ kind: 'evenement_sportif', domain: 'event', source: 'football-data', origin: 'football-data', official: false, dept: code ? [code] : [], communes: typeof m.commune === 'string' ? [m.commune] : [],
        window: { from: iso(kick - 2 * H), to: iso(kick + 3 * H) }, publishedAt: iso(kick), readAt: football.readAt, key: String(m.id), ref: String(m.id),
        meta: { competition: m.competition ?? null, home: m.home ?? null, away: m.away ?? null, venue: m.venue ?? null } }));
    } catch (e) { errors.push(`Calendrier sportif: ${m?.id}: ${errMsg(e)}`); }
  }
  return out;
}

// ─── Presse ───

const SEVERITY_RANK = Object.freeze({ info: 0, low: 1, medium: 2, high: 3, critical: 4 });

function fromNews(/** @type {any[]} */ news, /** @type {number} */ now, /** @type {string[]} */ errors) {
  /** @type {Signal[]} */
  const out = [];
  /** @type {Map<string, any>} */
  const events = new Map();
  for (const n of news) {
    try {
      const t = ms(n?.publishedAt);
      if (!Number.isFinite(t) || now - t > MAX_AGE_MS.presse || t - now > 5 * 60_000) continue;
      const origin = n.eventId != null ? `presse:event:${n.eventId}` : n.id != null ? `presse:item:${n.id}` : null;
      if (!origin) continue;
      const rank = /** @type {Record<string, number>} */ (SEVERITY_RANK)[n.severity] ?? -1;
      const cur = events.get(origin);
      if (!cur) events.set(origin, { origin, first: n, best: n, bestRank: rank, social: false });
      else if (rank > cur.bestRank) { cur.best = n; cur.bestRank = rank; }
      const e = events.get(origin);
      if (n.category === 'social' && SOCIAL_RE.test(String(n.title ?? '')) && OPERATOR_RE.test(String(n.title ?? ''))) e.social = e.social || n;
    } catch (err) { errors.push(`Presse: ${n?.id}: ${errMsg(err)}`); }
  }
  const level = { medium: 'jaune', high: 'orange', critical: 'rouge' };
  for (const e of events.values()) {
    try {
      const n = e.first;
      const t = ms(n.publishedAt);
      const meta = { eventId: n.eventId ?? null, category: e.best.category ?? null, severity: e.best.severity ?? null, title: String(n.title ?? '') };
      // Point : le premier article localisé de l'événement.
      const located = [e.first, e.best, e.social].find((x) => x && typeof x.lat === 'number' && typeof x.lon === 'number') ?? n;
      const common = { domain: /** @type {const} */ ('press'), source: String(n.feedName ?? 'presse'), origin: e.origin, dept: deptOfPoint(located.lat, located.lon), publishedAt: iso(t), readAt: iso(now), ref: String(n.link ?? e.origin), key: e.origin, meta };
      out.push(mk({ ...common, kind: 'presse', level: /** @type {Record<string, string>} */ (level)[e.best.severity] ?? null }));
      if (e.social) out.push(mk({ ...common, domain: 'transport', kind: 'mouvement_social_transport', meta: { ...meta, category: e.social.category ?? null } }));
    } catch (err) { errors.push(`Presse: ${e.origin}: ${errMsg(err)}`); }
  }
  return out;
}

/**
 * Normalise les relevés en signaux. `unknown` nomme (en français) les relevés absents ou périmés ; `errors` rapporte les éléments illisibles écartés.
 * @param {{protests: any, vigilance: any, rail: any, room: any, cyber: any, ecowatt: any, fuel: any, news: any[]|null, football?: any}} inputs
 * @param {number} now Heure de référence en ms (aucune lecture d'horloge ici).
 * @returns {{signals: Signal[], unknown: string[], errors: string[]}}
 */
export function toSignals(inputs, now) {
  /** @type {Signal[]} */
  const signals = [];
  /** @type {string[]} */
  const unknown = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {Array<[any, unknown, number, string, () => Signal[]]>} */
  const sources = [
    [inputs.protests, inputs.protests?.readAt, RELEVE_MAX_AGE_MS.protests, 'Manifestations non lues', () => fromProtests(inputs.protests, now, errors)],
    [inputs.vigilance, inputs.vigilance?.readAt, MAX_AGE_MS.vigilance, 'Météo-France non lue', () => fromVigilance(inputs.vigilance, now, errors)],
    [inputs.rail, inputs.rail?.at, MAX_AGE_MS.perturbation_sncf, 'SNCF non lue', () => fromRail(inputs.rail, now, errors)],
    [inputs.room, inputs.room?.generatedAt, MAX_AGE_MS.panne, 'Pannes non lues', () => fromRoom(inputs.room, now, errors)],
    [inputs.cyber, inputs.cyber?.readAt, MAX_AGE_MS.cyber, 'Veille cyber non lue', () => fromCyber(inputs.cyber, now, errors)],
    [inputs.ecowatt, inputs.ecowatt?.generatedAt, MAX_AGE_MS.ecowatt, 'Écowatt non lu', () => fromEcowatt(inputs.ecowatt, now)],
    [inputs.fuel, inputs.fuel?.generatedAt, MAX_AGE_MS.tension_carburant, 'Carburants non lus', () => fromFuel(inputs.fuel)],
  ];
  for (const [input, readAt, max, label, map] of sources) {
    if (!input || !fresh(readAt, max, now)) { unknown.push(label); continue; }
    try { signals.push(...map()); } catch (e) { unknown.push(label); errors.push(`${label}: ${errMsg(e)}`); }
  }
  // Calendrier sportif : facultatif, jamais compté dans `unknown` (la room nomme « non configuré » dans l'instantané seulement).
  try { signals.push(...fromFootball(inputs.football, now, errors)); } catch (e) { errors.push(`Calendrier sportif: ${errMsg(e)}`); }
  // Presse : un tableau sans date de lecture, chaque article est daté et filtré à 24 h.
  if (Array.isArray(inputs.news)) {
    try { signals.push(...fromNews(inputs.news, now, errors)); } catch (e) { unknown.push('Presse non lue'); errors.push(`Presse: ${errMsg(e)}`); }
  } else unknown.push('Presse non lue');
  return { signals, unknown, errors };
}
