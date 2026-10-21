// api/_lib/outages-now.js : pannes de téléphone et d'internet en cours, toutes sources et tous opérateurs confondus (21/10/2026). Pur.
// Une panne = un opérateur, un département ou le pays entier ; chaque source qui la voit y ajoute une preuve (presse, ARCEP, IODA,
// Cloudflare Radar). Niveau = la preuve la plus grave ; « mesurée » si une source autre que la presse la voit. Une source en retard
// ne compte pas (ses pannes ne disent plus rien du moment).

const HOUR_MS = 60 * 60 * 1000;
/** Fichier ARCEP pris en compte s'il a moins de 30 h (un fichier par jour, vers 11 h). */
export const ARCEP_MAX_AGE_MS = 30 * HOUR_MS;
/** Lecture IODA ou Radar prise en compte si elle a moins d'une heure (relève toutes les 10 min). */
export const LIVE_MAX_AGE_MS = HOUR_MS;
/** Seuils départementaux de la pastille Télécoms (src/services/outages-levels.ts, TELECOM_DISRUPTION_THRESHOLDS). */
const DEPT = { jaune: 20, orange: 50, rouge: 100 };
const NATIONAL_ORANGE = 300;
const NATIONAL_ROUGE = 600;

/** Réseaux des opérateurs grand public (AS) : une panne de réseau rejoint celle que la presse attribue au même opérateur. */
export const OPERATOR_ASN = new Map([
  [3215, 'Orange'], [15557, 'SFR'], [21502, 'SFR'], [5410, 'Bouygues Telecom'], [12322, 'Free'], [51207, 'Free'],
]);

const RANK = { jaune: 1, orange: 2, rouge: 3 };
const PRESS_LEVEL = { medium: 'jaune', high: 'orange', critical: 'rouge' };
const fresh = (iso, now, maxAge) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) && now - t <= maxAge;
};

/**
 * @param {{ telecom: any, internet: any, now: number }} input réponses de /api/outages/telecom et /api/outages/internet
 * @returns {import('../../src/types/index.ts').OutageNow[]}
 */
export function outagesNow({ telecom, internet, now }) {
  /** @type {Map<string, any>} */
  const byKey = new Map();
  const add = (key, base, evidence) => {
    const o = byKey.get(key) ?? { id: key, ...base, level: evidence.level, since: evidence.since, national: base.scope === 'national', measured: false, evidence: [] };
    if (RANK[evidence.level] > RANK[o.level]) o.level = evidence.level;
    if (evidence.since !== null && (o.since === null || Date.parse(evidence.since) < Date.parse(o.since))) o.since = evidence.since;
    if (evidence.source !== 'presse') o.measured = true;
    if (base.scope === 'national') o.national = true;
    o.label ??= base.label;
    o.evidence.push({ source: evidence.source, text: evidence.text, at: evidence.since, link: evidence.link ?? null });
    byKey.set(key, o);
  };
  const operatorBase = (name) => ({ scope: 'operateur', operator: name, dept: null, label: name });

  // Presse : un signalement par opérateur cité (ou sans opérateur).
  for (const p of telecom?.press ?? []) {
    const base = p.operator !== null ? operatorBase(p.operator) : { scope: p.national ? 'national' : 'inconnu', operator: null, dept: null, label: 'Opérateur non précisé' };
    const key = p.operator !== null ? `op:${p.operator}` : 'presse:sans-operateur';
    add(key, base, {
      source: 'presse', level: PRESS_LEVEL[p.severity], since: p.firstAt, link: p.link,
      text: `${p.articles}\u00a0article${p.articles > 1 ? 's' : ''}, ${p.sources}\u00a0source${p.sources > 1 ? 's' : ''}${p.national ? ', panne dite nationale' : ''}\u00a0: ${p.title}`,
    });
    if (p.national) byKey.get(key).national = true;
  }

  // ARCEP : départements au-dessus du seuil, pays entier au-delà de 300 antennes récentes.
  if (telecom?.summary && fresh(telecom.file?.publishedAt, now, ARCEP_MAX_AGE_MS)) {
    for (const d of telecom.byDept ?? []) {
      if (d.dept === null || d.recent < DEPT.jaune) continue;
      const level = d.recent >= DEPT.rouge ? 'rouge' : d.recent >= DEPT.orange ? 'orange' : 'jaune';
      add(`dept:${d.dept}`, { scope: 'departement', operator: null, dept: d.dept, label: null },
        { source: 'arcep', level, since: telecom.file.publishedAt, text: `${d.recent}\u00a0antennes en panne imprévue depuis moins de 24\u00a0h (fichier ARCEP)` });
    }
    const recent = telecom.summary.recent;
    if (recent >= NATIONAL_ORANGE) {
      add('national', { scope: 'national', operator: null, dept: null, label: 'France entière' },
        { source: 'arcep', level: recent >= NATIONAL_ROUGE ? 'rouge' : 'orange', since: telecom.file.publishedAt, text: `${recent}\u00a0antennes en panne imprévue depuis moins de 24\u00a0h en France` });
    }
  }

  // IODA : coupures en cours (hors « ouvertes depuis plus de 7 jours », probables recalages).
  if (internet && fresh(internet.iodaReadAt, now, LIVE_MAX_AGE_MS)) {
    for (const e of internet.events ?? []) {
      if (!e.ongoing || e.staleOpen) continue;
      const text = `coupure internet en cours mesurée (${e.signal})`;
      if (e.scope === 'national') add('national', { scope: 'national', operator: null, dept: null, label: 'France entière' }, { source: 'ioda', level: 'rouge', since: e.start, text });
      else if (e.scope === 'departement' && e.dept !== null) add(`dept:${e.dept}`, { scope: 'departement', operator: null, dept: e.dept, label: e.label }, { source: 'ioda', level: 'jaune', since: e.start, text });
      else if (e.scope === 'operateur' && e.asn !== null) {
        const name = OPERATOR_ASN.get(e.asn) ?? e.label;
        add(`op:${name}`, operatorBase(name), { source: 'ioda', level: 'orange', since: e.start, text: `${text}, réseau AS${e.asn}` });
      }
    }
  }

  // Cloudflare Radar : anomalies de trafic et pannes annotées en cours.
  if (internet?.radar?.configured && fresh(internet.radar.readAt, now, LIVE_MAX_AGE_MS)) {
    for (const r of internet.radar.items ?? []) {
      if (r.end !== null) continue;
      const what = r.kind === 'panne' ? `panne annotée${r.cause ? ` (${r.cause})` : ''}` : 'anomalie de trafic';
      if (r.national) add('national', { scope: 'national', operator: null, dept: null, label: 'France entière' },
        { source: 'radar', level: r.kind === 'anomalie' ? 'orange' : 'rouge', since: r.start, text: `${what} sur la France` });
      else if (r.asn !== null) {
        const name = OPERATOR_ASN.get(r.asn) ?? r.label;
        add(`op:${name}`, operatorBase(name), { source: 'radar', level: 'orange', since: r.start, text: `${what}, réseau AS${r.asn}` });
      }
    }
  }

  return [...byKey.values()].sort((a, b) => RANK[b.level] - RANK[a.level] || Number(b.national) - Number(a.national)
    || Date.parse(b.since ?? '') - Date.parse(a.since ?? ''));
}
