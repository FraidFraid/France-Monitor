// api/_lib/alerts.js : alertes de France Monitor (26/10/2026), tirées des relevés de la note que la VM prend toutes les 15 min
// (api/_lib/score-history.js), et publiées en CAP 1.2 (Common Alerting Protocol, OASIS) et en Atom. Fonctions pures.
//
// Deux déclencheurs, rien d'autre (jamais noyer le destinataire) :
//   1. le niveau national change de couleur (seuils 85/70/55, src/services/vigilance.ts) ;
//   2. une situation devient élevée ou critique, ou passe d'élevée à critique.
// Un changement ne compte que s'il tient sur deux relevés de suite (environ 15 min) ; les relevés incomplets (plus d'une source sur
// 14 non lue) sont écartés : une source muette ne déclenche jamais d'alerte. Les alertes se recalculent à chaque lecture depuis le
// fichier des relevés (35 jours) : aucun état à garder, identifiants stables.
//
// CAP appliqué sans surpromettre : urgence toujours « Unknown » (France Monitor ne prévoit rien), certitude « Observed » pour le
// niveau (calculé sur des données lues) et « Likely » pour une situation (convergence de signaux), statut « Actual », et chaque alerte
// rappelle qu'il s'agit d'une agrégation de sources ouvertes en version bêta, ni prévision ni évaluation officielle.

export const SITE_URL = 'https://www.francemonitor.com';
export const APP_URL = `${SITE_URL}/?view=app`;
export const CAP_SENDER = 'www.francemonitor.com';
/** Au plus une source non lue sur les 14 de l'indice. */
export const MIN_SOURCES_READ_MARGIN = 1;
export const ALERT_KEEP_DAYS = 30;
export const ATOM_MAX_ENTRIES = 50;

const LEVEL_LABEL = { vert: 'vert', jaune: 'jaune', orange: 'orange', rouge: 'rouge' };
const LEVEL_RANK = { vert: 0, jaune: 1, orange: 2, rouge: 3 };
const ALERT_SEVERITIES = new Set(['high', 'critical']);
const SEVERITY_RANK = { watch: 0, medium: 1, high: 2, critical: 3 };
const SEVERITY_WORD = { high: 'élevée', critical: 'critique' };

const NOTE = 'France Monitor, version bêta : agrégation de sources publiques ouvertes. Ni prévision, ni évaluation officielle. '
  + 'Méthode : https://www.francemonitor.com/methodology.html';

/** Couleur du niveau national (mêmes seuils que src/services/vigilance.ts#scoreLevel). */
export function levelOf(score) {
  if (!Number.isFinite(score)) return 'jaune';
  if (score >= 85) return 'vert';
  if (score >= 70) return 'jaune';
  if (score >= 55) return 'orange';
  return 'rouge';
}

/** Relevé utilisable : note lue et au plus une source manquante. */
export function usableRecord(r) {
  const c = r?.coverage;
  return Number.isFinite(r?.score) && typeof r?.capturedAt === 'string' && c && Number.isFinite(c.read) && Number.isFinite(c.total)
    && c.total - c.read <= MIN_SOURCES_READ_MARGIN;
}

/**
 * Types sans alerte : SOCIAL_ESCALATION est sans effet sur la note depuis le 26/10/2026 (SCORE_NEUTRAL_SITUATIONS,
 * src/services/france-country-intel.ts) ; affichée à titre d'information, elle ne déclenche pas d'alerte.
 */
const NO_ALERT_TYPES = new Set(['SOCIAL_ESCALATION']);

/** Situations élevées ou critiques d'un relevé, par id. */
function graveSituations(r) {
  const map = new Map();
  for (const s of Array.isArray(r.situations) ? r.situations : []) {
    if (s && typeof s.id === 'string' && ALERT_SEVERITIES.has(s.severity) && !NO_ALERT_TYPES.has(s.type)) map.set(s.id, s);
  }
  return map;
}

function stamp(iso) {
  return iso.replace(/[-:.]/g, '').replace('T', 't').toLowerCase();
}

/**
 * Alertes tirées des relevés (ordre chronologique), les plus récentes en dernier.
 * @param {Array<Record<string, any>>} records relevés triés par capturedAt
 * @param {number} nowMs
 */
export function alertsFromRecords(records, nowMs = Date.now()) {
  const usable = records.filter(usableRecord);
  const alerts = [];
  let level = null;
  /** Gravité confirmée de chaque situation suivie (deux relevés de suite). */
  let confirmed = new Map();
  for (let i = 1; i < usable.length; i += 1) {
    const prev = usable[i - 1];
    const cur = usable[i];
    // 1. Niveau national : nouvelle couleur tenue sur deux relevés.
    const l0 = levelOf(prev.score);
    const l1 = levelOf(cur.score);
    if (level === null) {
      level = l0;
    }
    if (l0 === l1 && l1 !== level) {
      alerts.push(levelAlert(level, l1, cur));
      level = l1;
    }
    // 2. Situations élevées ou critiques présentes sur les deux relevés.
    const a = graveSituations(prev);
    const b = graveSituations(cur);
    const next = new Map();
    for (const [id, s] of b) {
      const before = a.get(id);
      if (!before) continue;
      const severity = SEVERITY_RANK[s.severity] <= SEVERITY_RANK[before.severity] ? s.severity : before.severity;
      next.set(id, severity);
      const known = confirmed.get(id);
      // Première paire de relevés : état de départ, sans alerte (une situation déjà en cours n'« apparaît » pas).
      if (i > 1 && (known === undefined || SEVERITY_RANK[severity] > SEVERITY_RANK[known])) alerts.push(situationAlert(s, severity, cur, known));
    }
    // Une situation retombée sous « élevée » sur les deux derniers relevés n'est plus suivie : sa réapparition alertera de nouveau.
    for (const [id, sev] of confirmed) {
      if (!next.has(id) && (a.has(id) || b.has(id))) next.set(id, sev);
    }
    confirmed = next;
  }
  const since = nowMs - ALERT_KEEP_DAYS * 86_400_000;
  return alerts.filter((x) => Date.parse(x.sent) >= since);
}

function levelAlert(from, to, record) {
  const up = LEVEL_RANK[to] > LEVEL_RANK[from];
  const headline = `Niveau national : ${LEVEL_LABEL[from]} → ${LEVEL_LABEL[to]}`;
  const drivers = (Array.isArray(record.situations) ? record.situations : [])
    .filter((s) => s && (s.severity === 'critical' || s.severity === 'high'))
    .map((s) => `${s.title} (${SEVERITY_WORD[s.severity]})`);
  const description = [
    `Le niveau national de France Monitor passe de ${LEVEL_LABEL[from]} à ${LEVEL_LABEL[to]} (indice ${record.score}/100), `
      + `${up ? 'à la hausse' : 'à la baisse'}, sur deux relevés successifs.`,
    drivers.length > 0 ? `Situations élevées ou critiques : ${drivers.join(' ; ')}.` : 'Aucune situation élevée ou critique en cours.',
    `Sources lues : ${record.coverage.read} sur ${record.coverage.total}.`,
  ].join(' ');
  return {
    id: `fm-niveau-${to}-${stamp(record.capturedAt)}`,
    kind: 'level',
    sent: record.capturedAt,
    headline,
    event: 'Niveau national de situation',
    category: 'Other',
    severity: { vert: 'Minor', jaune: 'Minor', orange: 'Moderate', rouge: 'Severe' }[to],
    certainty: 'Observed',
    areaDesc: 'France',
    description,
  };
}

const TYPE_CATEGORY = {
  SOCIAL_MOBILISATION: 'Security', SECURITY_UNREST: 'Security', SOCIAL_ESCALATION: 'Security', CYBER_PRESSURE: 'Security',
  DEFENSE_SIGNAL_ELEVATED: 'Security', DEFENSE_ALERT: 'Security', MILITARY_SURGE_ALERT: 'Security', GPS_JAMMING_ALERT: 'Security',
  MARITIME_ANOMALY: 'Security', AIS_ANOMALY_ALERT: 'Security', NEWS_ALERT: 'Safety',
  FLOOD_CRISIS: 'Met', WEATHER_ALERT: 'Met', WILDFIRE_ESCALATION: 'Fire', SEISMIC_EVENT: 'Geo', NATURAL_HAZARD_ALERT: 'Geo',
  EMS_ACTIVATION: 'Rescue', AIR_POLLUTION_EPISODE: 'Env', ASNR_CRISIS: 'CBRNE', NUCLEAR_INCIDENT: 'CBRNE',
  ENERGY_STRESS: 'Infra', IMPORT_DEPENDENCY_RISK: 'Infra', FUEL_SUPPLY_RISK: 'Infra', TELECOM_DISRUPTION: 'Infra',
};

function situationAlert(s, severity, record, previous) {
  const word = SEVERITY_WORD[severity];
  const zones = Array.isArray(s.affectedZones) && s.affectedZones.length > 0 ? s.affectedZones.slice(0, 6) : ['France'];
  return {
    id: `fm-situation-${String(s.id).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-${severity}-${stamp(record.capturedAt)}`,
    kind: 'situation',
    sent: record.capturedAt,
    headline: `${s.title} : ${previous ? `${SEVERITY_WORD[previous] ?? previous} → ` : ''}${word}`,
    event: String(s.title),
    category: TYPE_CATEGORY[s.type] ?? 'Other',
    severity: severity === 'critical' ? 'Severe' : 'Moderate',
    certainty: 'Likely',
    areaDesc: zones.join(', '),
    description: [
      `Situation ${word}, confirmée sur deux relevés successifs.`,
      typeof s.topDriver === 'string' && s.topDriver ? `Signal principal : ${s.topDriver}.` : '',
      `Indice national au même moment : ${record.score}/100 (${LEVEL_LABEL[levelOf(record.score)]}).`,
    ].filter(Boolean).join(' '),
  };
}

function xml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** CAP 1.2 d'une alerte. */
export function capXml(alert) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${xml(alert.id)}</identifier>
  <sender>${xml(CAP_SENDER)}</sender>
  <sent>${xml(alert.sent.replace(/\.\d{3}Z$/, '+00:00').replace(/Z$/, '+00:00'))}</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <note>${xml(NOTE)}</note>
  <info>
    <language>fr-FR</language>
    <category>${xml(alert.category)}</category>
    <event>${xml(alert.event)}</event>
    <urgency>Unknown</urgency>
    <severity>${xml(alert.severity)}</severity>
    <certainty>${xml(alert.certainty)}</certainty>
    <senderName>France Monitor (bêta, sources ouvertes)</senderName>
    <headline>${xml(alert.headline)}</headline>
    <description>${xml(alert.description)}</description>
    <web>${xml(APP_URL)}</web>
    <area>
      <areaDesc>${xml(alert.areaDesc)}</areaDesc>
    </area>
  </info>
</alert>
`;
}

/** Flux Atom des alertes, les plus récentes d'abord ; chaque entrée renvoie à son CAP. */
export function atomXml(alerts, nowMs = Date.now()) {
  const recent = [...alerts].reverse().slice(0, ATOM_MAX_ENTRIES);
  const updated = recent[0]?.sent ?? new Date(nowMs).toISOString();
  const entries = recent.map((a) => `  <entry>
    <id>urn:francemonitor:alerte:${xml(a.id)}</id>
    <title>${xml(a.headline)}</title>
    <updated>${xml(a.sent)}</updated>
    <published>${xml(a.sent)}</published>
    <link rel="alternate" type="text/html" href="${xml(APP_URL)}"/>
    <link rel="related" type="application/cap+xml" href="${xml(`${SITE_URL}/api/alerts/cap?id=${encodeURIComponent(a.id)}`)}"/>
    <category term="${xml(a.category)}"/>
    <summary>${xml(a.description)}</summary>
  </entry>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="fr">
  <id>urn:francemonitor:alertes</id>
  <title>France Monitor : alertes</title>
  <subtitle>${xml(`Changements de niveau national et situations élevées ou critiques. ${NOTE}`)}</subtitle>
  <updated>${xml(updated)}</updated>
  <author><name>France Monitor</name><uri>${xml(SITE_URL)}</uri></author>
  <link rel="self" type="application/atom+xml" href="${xml(`${SITE_URL}/api/alerts/atom`)}"/>
  <link rel="alternate" type="text/html" href="${xml(APP_URL)}"/>
${entries}
</feed>
`;
}
