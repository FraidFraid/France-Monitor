// api/_lib/anticipation/signals.js : normalisation des relevés du site en signaux datés et attribués (spec anticipation § 6, 04/11/2026).
// Fonction pure : aucune lecture, aucune horloge (l'heure est passée en argument). Un relevé absent ou trop ancien ne produit aucun
// signal et son nom entre dans `unknown` : la règle tourne sans lui, elle ne lève jamais.
import { departementAt } from '../geo-fr.js';
import { normalizeDepartmentCode } from '../../_shared/departments.js';
import { deptsOfRailScope } from './rail-hubs.js';

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

const SOCIAL_RE = /grève|mouvement social|préavis/i;
const OPERATOR_RE = /\b(SNCF|RATP|TCL|RTM|Tisséo|TBM|Ilévia|Star|Tan)\b/i;
/** Phénomènes de vigilance (id Météo-France → nom court porté par `ref`). */
const PHENOMENA = Object.freeze({ 1: 'vent', 2: 'pluie_inondation', 3: 'orages', 4: 'crues', 5: 'neige_verglas', 6: 'canicule', 7: 'grand_froid', 9: 'vagues_submersion' });
const LEVEL_OF_COLOR = Object.freeze({ 2: 'jaune', 3: 'orange', 4: 'rouge' });
const OFFICIAL_OUTAGE_SOURCES = new Set(['rte', 'edf', 'statut', 'arcep']);

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
    official: p.official ?? false, dept, communes: p.communes ?? [],
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

function fromProtests(/** @type {any} */ protests, /** @type {number} */ now) {
  /** @type {Signal[]} */
  const out = [];
  const readAt = protests.readAt;
  for (const it of Array.isArray(protests.items) ? protests.items : []) {
    const start = ms(it.startsAt);
    if (!Number.isFinite(start)) continue;
    const signale = it.status === 'signale' || it.source === 'presse' || it.source === 'gdelt';
    const end = signale ? start : start + (it.allDay ? 24 * H : 3 * H);
    if (end + MAX_AGE_MS.rassemblement < now) continue;
    const code = normalizeDepartmentCode(it.dept);
    const dept = code ? [code] : deptOfPoint(it.lat, it.lon);
    const base = { domain: /** @type {const} */ ('social'), readAt, dept, window: { from: iso(start), to: iso(end) }, ref: it.url || String(it.id), key: String(it.id) };
    if (it.arrete) {
      out.push(mk({ ...base, kind: 'arrete_prefectoral', source: 'prefecture', origin: `prefecture:${dept[0] ?? 'n.d.'}`, official: true }));
    } else if (it.source === 'prefecture') {
      out.push(mk({ ...base, kind: 'rassemblement_annonce', source: 'prefecture', origin: `prefecture:${dept[0] ?? 'n.d.'}`, official: true }));
    } else if (signale) {
      const origin = it.source === 'gdelt' ? `gdelt:${it.id}` : `presse:item:${it.id}`;
      out.push(mk({ ...base, kind: 'rassemblement_signale', source: it.source, origin, value: typeof it.participants === 'number' ? it.participants : null, publishedAt: iso(start) }));
    } else {
      const origin = it.source === 'giletsjaunes' ? 'gilets-jaunes' : it.source;
      out.push(mk({ ...base, kind: 'rassemblement_annonce', source: it.source, origin }));
    }
  }
  return out;
}

// ─── Vigilance Météo-France ───

function fromVigilance(/** @type {any} */ v) {
  /** @type {Signal[]} */
  const out = [];
  for (const period of Array.isArray(v.periods) ? v.periods : []) {
    for (const d of Array.isArray(period.departments) ? period.departments : []) {
      const code = normalizeDepartmentCode(d.code);
      if (!code) continue;
      for (const ph of Array.isArray(d.phenomena) ? d.phenomena : []) {
        const level = /** @type {Record<number, string>} */ (LEVEL_OF_COLOR)[ph.color];
        const name = /** @type {Record<string, string>} */ (PHENOMENA)[ph.id];
        if (!level || !name) continue;
        const slot = (Array.isArray(ph.slots) ? ph.slots : []).find((/** @type {any} */ s) => s.color === ph.color && Number.isFinite(ms(s.from)) && Number.isFinite(ms(s.to)));
        const window = slot ? { from: iso(ms(slot.from)), to: iso(ms(slot.to)) } : { from: iso(ms(period.begin)), to: iso(ms(period.end)) };
        out.push(mk({ kind: 'vigilance', domain: 'weather', source: 'meteo-france', origin: 'meteo-france', official: true, dept: [code], level, window,
          publishedAt: v.updateTime ?? null, readAt: v.readAt, key: `${name}:${period.echeance}`, ref: name }));
      }
    }
  }
  return out;
}

// ─── Situations ferroviaires ───

function fromRail(/** @type {any} */ rail, /** @type {number} */ now) {
  /** @type {Signal[]} */
  const out = [];
  for (const s of Array.isArray(rail.situations) ? rail.situations : []) {
    const social = SOCIAL_RE.test(`${s.cause ?? ''} ${s.title ?? ''}`);
    if (!social && s.causeKind === 'travaux') continue; // travaux annoncés : pas une perturbation
    const from = ms(s.start);
    if (!Number.isFinite(from)) continue;
    const to = Number.isFinite(ms(s.end)) ? ms(s.end) : Math.max(from, now);
    out.push(mk({ kind: social ? 'mouvement_social_transport' : 'perturbation_sncf', domain: 'transport', source: 'sncf', origin: 'sncf', official: true,
      dept: deptsOfRailScope(String(s.scope ?? s.title ?? '')), window: { from: iso(from), to: iso(to) }, publishedAt: iso(from), readAt: rail.at, key: String(s.id), ref: String(s.title ?? s.id) }));
  }
  return out;
}

// ─── Pannes en cours ───

function fromRoom(/** @type {any} */ room, /** @type {number} */ now) {
  /** @type {Signal[]} */
  const out = [];
  for (const o of Array.isArray(room.outages) ? room.outages : []) {
    const evidence = Array.isArray(o.evidence) ? o.evidence : [];
    const best = evidence.find((/** @type {any} */ e) => OFFICIAL_OUTAGE_SOURCES.has(e.source)) ?? evidence[0];
    const src = best?.source ?? 'presse';
    const code = normalizeDepartmentCode(o.dept);
    const from = ms(o.since);
    const to = Number.isFinite(ms(o.until)) ? ms(o.until) : now;
    out.push(mk({ kind: 'panne', domain: o.network === 'electricite' ? 'energy' : 'telecom', source: src, origin: `${src}:${o.id}`,
      official: OFFICIAL_OUTAGE_SOURCES.has(src), dept: code ? [code] : [], level: o.level ?? null,
      window: Number.isFinite(from) ? { from: iso(from), to: iso(Math.max(from, to)) } : null, publishedAt: Number.isFinite(from) ? iso(from) : null,
      readAt: room.generatedAt, key: String(o.id), ref: String(o.id) }));
  }
  return out;
}

// ─── Veille cyber ───

function fromCyber(/** @type {any} */ cyber, /** @type {number} */ now) {
  /** @type {Signal[]} */
  const out = [];
  for (const h of Array.isArray(cyber.ddosia?.hosts) ? cyber.ddosia.hosts : []) {
    if (!/\.fr$/i.test(String(h.host)) || !(ms(h.last) >= now - 24 * H)) continue;
    const code = normalizeDepartmentCode(h.place?.dept);
    out.push(mk({ kind: 'cyber_revendication', domain: 'cyber', source: 'ddosia', origin: 'ddosia', dept: code ? [code] : [], publishedAt: h.last, readAt: cyber.readAt, key: String(h.host), ref: String(h.host) }));
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
    out.push(mk({ kind: 'tension_carburant', domain: 'fuel', source: 'prix-carburants', origin: 'prix-carburants', official: true, dept: [code],
      level: share >= 40 ? 'rouge' : share >= 25 ? 'orange' : 'jaune', value: share, readAt: fuel.generatedAt, key: code, ref: code }));
  }
  return out;
}

// ─── Presse ───

function fromNews(/** @type {any[]} */ news, /** @type {number} */ now) {
  /** @type {Signal[]} */
  const out = [];
  const seen = new Set();
  const seenSocial = new Set();
  const level = { medium: 'jaune', high: 'orange', critical: 'rouge' };
  for (const n of news) {
    const t = ms(n?.publishedAt);
    if (!Number.isFinite(t) || now - t > MAX_AGE_MS.presse || t - now > 5 * 60_000) continue;
    const origin = n.eventId != null ? `presse:event:${n.eventId}` : n.id != null ? `presse:item:${n.id}` : null;
    if (!origin) continue;
    const common = { domain: /** @type {const} */ ('press'), source: String(n.feedName ?? 'presse'), origin, dept: deptOfPoint(n.lat, n.lon), publishedAt: iso(t), readAt: iso(now), ref: String(n.link ?? origin), key: origin };
    if (!seen.has(origin)) {
      seen.add(origin);
      out.push(mk({ ...common, kind: 'presse', level: /** @type {Record<string, string>} */ (level)[n.severity] ?? null }));
    }
    const title = String(n.title ?? '');
    if (n.category === 'social' && SOCIAL_RE.test(title) && OPERATOR_RE.test(title) && !seenSocial.has(origin)) {
      seenSocial.add(origin);
      out.push(mk({ ...common, domain: 'transport', kind: 'mouvement_social_transport' }));
    }
  }
  return out;
}

/**
 * Normalise les relevés en signaux. `unknown` nomme (en français) les relevés absents ou périmés.
 * @param {{protests: any, vigilance: any, rail: any, room: any, cyber: any, ecowatt: any, fuel: any, news: any[]|null, football?: any}} inputs
 * @param {number} now Heure de référence en ms (aucune lecture d'horloge ici).
 * @returns {{signals: Signal[], unknown: string[]}}
 */
export function toSignals(inputs, now) {
  /** @type {Signal[]} */
  const signals = [];
  /** @type {string[]} */
  const unknown = [];
  /** @type {Array<[any, unknown, number, string, () => Signal[]]>} */
  const sources = [
    [inputs.protests, inputs.protests?.readAt, MAX_AGE_MS.rassemblement, 'Manifestations non lues', () => fromProtests(inputs.protests, now)],
    [inputs.vigilance, inputs.vigilance?.readAt, MAX_AGE_MS.vigilance, 'Météo-France non lue', () => fromVigilance(inputs.vigilance)],
    [inputs.rail, inputs.rail?.at, MAX_AGE_MS.perturbation_sncf, 'SNCF non lue', () => fromRail(inputs.rail, now)],
    [inputs.room, inputs.room?.generatedAt, MAX_AGE_MS.panne, 'Pannes non lues', () => fromRoom(inputs.room, now)],
    [inputs.cyber, inputs.cyber?.readAt, MAX_AGE_MS.cyber, 'Veille cyber non lue', () => fromCyber(inputs.cyber, now)],
    [inputs.ecowatt, inputs.ecowatt?.generatedAt, MAX_AGE_MS.ecowatt, 'Écowatt non lu', () => fromEcowatt(inputs.ecowatt, now)],
    [inputs.fuel, inputs.fuel?.generatedAt, MAX_AGE_MS.tension_carburant, 'Carburants non lus', () => fromFuel(inputs.fuel)],
  ];
  for (const [input, readAt, max, label, map] of sources) {
    if (!input || !fresh(readAt, max, now)) { unknown.push(label); continue; }
    try { signals.push(...map()); } catch { unknown.push(label); }
  }
  // Presse : un tableau sans date de lecture, chaque article est daté et filtré à 24 h.
  if (Array.isArray(inputs.news)) {
    try { signals.push(...fromNews(inputs.news, now)); } catch { unknown.push('Presse non lue'); }
  } else unknown.push('Presse non lue');
  return { signals, unknown };
}
