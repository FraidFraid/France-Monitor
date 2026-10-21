// api/_lib/outages-now.js : pannes en cours, toutes sources et tous opérateurs confondus (21/10/2026). Pur. Une panne = un réseau
// (téléphone mobile, internet, électricité, cloud) et un opérateur, un département, un ouvrage ou le pays entier ; chaque source qui la
// voit y ajoute une preuve. Niveau = la preuve la plus grave. Échelon : « signalee » (presse seule), « mesuree » (ARCEP, IODA,
// Cloudflare Radar, RTE, EDF), « confirmee » (page d'état du fournisseur). Une source en retard ne compte pas.

const HOUR_MS = 60 * 60 * 1000;
/** Fichier ARCEP pris en compte s'il a moins de 30 h (un fichier par jour, vers 11 h). */
export const ARCEP_MAX_AGE_MS = 30 * HOUR_MS;
/** Lecture IODA ou Radar prise en compte si elle a moins d'une heure (relève toutes les 10 min). */
export const LIVE_MAX_AGE_MS = HOUR_MS;
/** Page d'état cloud prise en compte si elle a moins de 2 h (même règle que cloudLive, src/services/outages-levels.ts). */
export const CLOUD_MAX_AGE_MS = 2 * HOUR_MS;
/** Seuils départementaux de la pastille Télécoms (src/services/outages-levels.ts, TELECOM_DISRUPTION_THRESHOLDS). */
const DEPT = { jaune: 20, orange: 50, rouge: 100 };
const NATIONAL_ORANGE = 300;
const NATIONAL_ROUGE = 600;
/** Arrêts imprévus de production : seuils orange et rouge alignés sur fleetLevel (src/services/nuclear-fleet.ts). */
const FLEET_ORANGE_MW = 3000;
const FLEET_ROUGE_MW = 6000;

/** Réseaux des opérateurs grand public (AS) : une coupure IODA ou Radar est rattachée à l'opérateur. */
export const OPERATOR_ASN = new Map([
  [3215, 'Orange'], [15557, 'SFR'], [21502, 'SFR'], [5410, 'Bouygues Telecom'], [12322, 'Free'], [51207, 'Free'],
]);
/** Libellés des fournisseurs cloud (même table que CLOUD_PROVIDER_LABEL, src/services/outages-levels.ts). */
const CLOUD_LABEL = {
  ovhcloud: 'OVHcloud', scaleway: 'Scaleway', cloudflare: 'Cloudflare', gcp: 'Google Cloud', aws: 'AWS', outscale: 'Outscale', azure: 'Azure',
};

const RANK = { jaune: 1, orange: 2, rouge: 3 };
const RUNG_RANK = { signalee: 0, mesuree: 1, confirmee: 2 };
const PRESS_LEVEL = { medium: 'jaune', high: 'orange', critical: 'rouge' };
const CLOUD_LEVEL = { critical: 'rouge', major: 'orange', minor: 'jaune', none: 'jaune' };
const RUNG_OF = { presse: 'signalee', usagers: 'signalee', statut: 'confirmee' };
const fresh = (iso, now, maxAge) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) && now - t <= maxAge;
};
const gw = (mw) => `${(mw / 1000).toFixed(1).replace('.', ',')} GW`;

/**
 * @param {{ telecom: any, internet: any, power: any, cloud: any, now: number, press?: any[] }} input réponses des routes /api/outages/* (null :
 *   non lue) ; `press` : signalements de tous les réseaux (pressOutages, telecom-press.js), à défaut la presse télécoms (réseau mobile) ;
 *   `social` : pics de signalements d'usagers (socialOutages, outages-social.js)
 * @returns {import('../../src/types/index.ts').OutageNow[]}
 */
export function outagesNow({ telecom, internet, power, cloud, now, press, social }) {
  /** @type {Map<string, any>} */
  const byKey = new Map();
  const add = (network, key, base, evidence) => {
    const id = `${network}|${key}`;
    const o = byKey.get(id) ?? { id, network, ...base, level: evidence.level, since: evidence.since, national: base.scope === 'national', rung: 'signalee', measured: false, evidence: [] };
    if (RANK[evidence.level] > RANK[o.level]) o.level = evidence.level;
    if (evidence.since !== null && (o.since === null || Date.parse(evidence.since) < Date.parse(o.since))) o.since = evidence.since;
    const rung = RUNG_OF[evidence.source] ?? 'mesuree';
    if (RUNG_RANK[rung] > RUNG_RANK[o.rung]) o.rung = rung;
    o.measured = o.rung !== 'signalee';
    if (base.scope === 'national') o.national = true;
    o.label ??= base.label;
    o.evidence.push({ source: evidence.source, text: evidence.text, at: evidence.since, link: evidence.link ?? null });
    byKey.set(id, o);
    return o;
  };
  const operatorBase = (name) => ({ scope: 'operateur', operator: name, dept: null, label: name });
  const nationalBase = { scope: 'national', operator: null, dept: null, label: 'France entière' };

  // Presse : un signalement par réseau et opérateur cité (ou sans opérateur).
  const reports = press ?? (telecom?.press ?? []).map((p) => ({ ...p, network: 'mobile', level: PRESS_LEVEL[p.severity] }));
  for (const p of reports) {
    const key = p.operator !== null ? `op:${p.operator}` : p.national ? 'national' : 'presse:sans-operateur';
    const base = p.operator !== null ? operatorBase(p.operator) : p.national ? nationalBase : { scope: 'inconnu', operator: null, dept: null, label: 'signalement presse' };
    const o = add(p.network, key, base, {
      source: 'presse', level: p.level, since: p.firstAt, link: p.link,
      text: `${p.articles} article${p.articles > 1 ? 's' : ''}, ${p.sources} source${p.sources > 1 ? 's' : ''}${p.national ? ', panne dite nationale' : ''} : ${p.title}`,
    });
    if (p.national) o.national = true;
  }

  // Usagers (Bluesky, Mastodon) : un pic de messages sur 15 min, toujours « signalée ».
  for (const s of social ?? []) {
    const key = s.operator !== null ? `op:${s.operator}` : 'usagers:sans-operateur';
    const base = s.operator !== null ? operatorBase(s.operator) : { scope: 'inconnu', operator: null, dept: null, label: 'signalement d’usagers' };
    add(s.network, key, base, {
      source: 'usagers', level: s.level, since: s.since, link: s.link,
      text: `${s.recent}\u00a0messages en 15\u00a0min sur Bluesky et Mastodon (normale\u00a0: ${String(s.baseline).replace('.', ',')})`,
    });
  }

  // ARCEP : départements au-dessus du seuil, pays entier au-delà de 300 antennes récentes.
  if (telecom?.summary && fresh(telecom.file?.publishedAt, now, ARCEP_MAX_AGE_MS)) {
    for (const d of telecom.byDept ?? []) {
      if (d.dept === null || d.recent < DEPT.jaune) continue;
      const level = d.recent >= DEPT.rouge ? 'rouge' : d.recent >= DEPT.orange ? 'orange' : 'jaune';
      add('mobile', `dept:${d.dept}`, { scope: 'departement', operator: null, dept: d.dept, label: null },
        { source: 'arcep', level, since: telecom.file.publishedAt, text: `${d.recent} antennes en panne imprévue depuis moins de 24 h (fichier ARCEP)` });
    }
    const recent = telecom.summary.recent;
    if (recent >= NATIONAL_ORANGE) {
      add('mobile', 'national', nationalBase,
        { source: 'arcep', level: recent >= NATIONAL_ROUGE ? 'rouge' : 'orange', since: telecom.file.publishedAt, text: `${recent} antennes en panne imprévue depuis moins de 24 h en France` });
    }
  }

  // IODA : coupures en cours (hors « ouvertes depuis plus de 7 jours », probables recalages).
  if (internet && fresh(internet.iodaReadAt, now, LIVE_MAX_AGE_MS)) {
    for (const e of internet.events ?? []) {
      if (!e.ongoing || e.staleOpen) continue;
      const text = `coupure internet en cours mesurée (${e.signal})`;
      if (e.scope === 'national') add('internet', 'national', nationalBase, { source: 'ioda', level: 'rouge', since: e.start, text });
      else if (e.scope === 'departement' && e.dept !== null) add('internet', `dept:${e.dept}`, { scope: 'departement', operator: null, dept: e.dept, label: e.label }, { source: 'ioda', level: 'jaune', since: e.start, text });
      else if (e.scope === 'operateur' && e.asn !== null) {
        const name = OPERATOR_ASN.get(e.asn) ?? e.label;
        add('internet', `op:${name}`, operatorBase(name), { source: 'ioda', level: 'orange', since: e.start, text: `${text}, réseau AS${e.asn}` });
      }
    }
  }

  // Cloudflare Radar : anomalies de trafic et pannes annotées en cours.
  if (internet?.radar?.configured && fresh(internet.radar.readAt, now, LIVE_MAX_AGE_MS)) {
    for (const r of internet.radar.items ?? []) {
      if (r.end !== null) continue;
      const what = r.kind === 'panne' ? `panne annotée${r.cause ? ` (${r.cause})` : ''}` : 'anomalie de trafic';
      if (r.national) add('internet', 'national', nationalBase, { source: 'radar', level: r.kind === 'anomalie' ? 'orange' : 'rouge', since: r.start, text: `${what} sur la France` });
      else if (r.asn !== null) {
        const name = OPERATOR_ASN.get(r.asn) ?? r.label;
        add('internet', `op:${name}`, operatorBase(name), { source: 'radar', level: 'orange', since: r.start, text: `${what}, réseau AS${r.asn}` });
      }
    }
  }

  // Électricité : ouvrages de transport RTE en coupure imprévue ; arrêts imprévus de production de 3 GW ou plus.
  if (power && fresh(power.iipReadAt, now, LIVE_MAX_AGE_MS)) {
    for (const t of power.transmission?.unplanned ?? []) {
      if (t.end !== null && Date.parse(t.end) <= now) continue;
      add('electricite', `ouvrage:${t.asset}`, { scope: 'inconnu', operator: 'RTE', dept: null, label: t.asset },
        { source: 'rte', level: 'orange', since: t.start, text: `coupure imprévue de l’ouvrage de transport ${t.asset}${t.reason ? ` (${t.reason})` : ''}` });
    }
  }
  if (power && fresh(power.edfReadAt, now, LIVE_MAX_AGE_MS)) {
    const lost = (power.unplanned ?? []).reduce((sum, u) => sum + (u.lostMw ?? 0), 0);
    if (lost >= FLEET_ORANGE_MW) {
      const since = (power.unplanned ?? []).map((u) => u.start).sort()[0] ?? null;
      add('electricite', 'national', nationalBase,
        { source: 'edf', level: lost >= FLEET_ROUGE_MW ? 'rouge' : 'orange', since, text: `${gw(lost)} d’arrêts imprévus de production (${power.unplanned.length} unités)` });
    }
  }

  // Cloud : incidents « en cours » d'un fournisseur lu depuis moins de 2 h.
  if (cloud) {
    const freshProviders = new Set((cloud.providers ?? []).filter((p) => fresh(p.readAt, now, CLOUD_MAX_AGE_MS)).map((p) => p.provider));
    for (const i of cloud.incidents ?? []) {
      if (i.state !== 'en-cours' || !freshProviders.has(i.provider)) continue;
      const name = CLOUD_LABEL[i.provider] ?? i.provider;
      add('cloud', `op:${name}`, operatorBase(name), { source: 'statut', level: CLOUD_LEVEL[i.impact] ?? 'jaune', since: i.start, link: i.url, text: i.title });
    }
  }

  return [...byKey.values()].sort((a, b) => RANK[b.level] - RANK[a.level] || Number(b.national) - Number(a.national)
    || Date.parse(b.since ?? '') - Date.parse(a.since ?? ''));
}
