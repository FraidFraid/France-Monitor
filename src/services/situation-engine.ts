/**
 * situation-engine.ts — Moteur de détection de situations opérationnelles.
 *
 * Entrée  : FranceRawData (source de vérité commune)
 * Sortie  : DetectedSituation[] triées par sévérité puis confiance
 *
 * Chaque règle est indépendante et explicable.
 * Aucune situation n'est générée sans facteurs causaux lisibles.
 * Seuils calibrés pour France : peu de faux positifs, réactivité sur événements réels.
 */

import type {
  CableAlert,
  CertFrItem,
  DetectedSituation,
  MilitaryEmergency,
  FuelTensionLevel,
  OilVigilanceStatus,
  SituationAction,
  SituationActionType,
  SituationSeverity,
  SituationType,
} from '../types/index.ts';
import { FRENCH_PORTS } from '../config/french-ports.ts';
import type { FranceRawData } from './france-country-intel.ts';
import {
  CERTFR_RECENT_DAYS, CLAIMS_RATIO_JAUNE, GNSS_SITUATION_CELLS, alertsByVessel, certfrDate, certfrExploitationText, certfrKevAdvisories,
  claimsRatio, defenseSituationSeverity, distinctVessels, isCertFrAlertOpen, isCertFrPublishedRecently, isDefenseSituationEmergency,
  isSovereigntyDataLate,
} from './sovereignty-levels.ts';
import { isEmergencyConfirmed } from './traffic-levels.ts';
import { GNSS_MONITOR_ID } from './sovereignty-alerts.ts';
import { SOVEREIGNTY_SOURCE_DETAILS } from '../config/sovereignty-sources.ts';
import { DEPARTMENTS } from './stability-index.ts';
import { ecowattToday } from './ecowatt-official.ts';
import { formatObservationAge, selectMajorIncidents, wildfireSeverity } from './wildfire-dossier.ts';
import { QUAKE_WINDOW_MS, magnitudeText, nextDayOf, parisDayOf, quakeInFrance, quakePlace } from './environment-levels.ts';

// ─── Ordres de sévérité ──────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<SituationSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  watch: 1,
};

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function now(): Date {
  return new Date();
}

function haversineKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function nearestPortLabel(position: [number, number]): string {
  let best: { name: string; distKm: number } | null = null;
  for (const port of FRENCH_PORTS) {
    const distKm = haversineKm(position, [port.lon, port.lat]);
    if (!best || distKm < best.distKm) {
      best = { name: port.name, distKm };
    }
  }

  if (!best) return 'Zone maritime française';
  return best.distKm <= 75 ? `${best.name} (${Math.round(best.distKm)} km)` : 'Zone maritime française';
}

function situation(
  id: string,
  type: SituationType,
  severity: SituationSeverity,
  confidence: number,
  title: string,
  summary: string,
  affectedZones: string[],
  drivers: string[],
  recommendedActions: SituationAction[],
  sourceRefs: string[],
): DetectedSituation {
  return { id, type, severity, confidence: Math.round(confidence * 100) / 100, title, summary, affectedZones, drivers, recommendedActions, sourceRefs, updatedAt: now() };
}

function action(
  label: string,
  ownerHint: string,
  actionType: SituationActionType,
  automatable = false,
): SituationAction {
  return { label, ownerHint, actionType, automatable };
}

// ─── Règle 1 : ENERGY_STRESS ─────────────────────────────────────────────────

function detectEnergyStress(raw: FranceRawData, nowMs: number = Date.now()): DetectedSituation | null {
  const nuclear = raw.nuclearState?.stress;
  // Écowatt est un signal NATIONAL (RTE) : le niveau du jour s'applique à toute la France, il
  // n'existe pas de déclinaison régionale.
  const level = ecowattToday(raw.ecowattResponse?.official, nowMs);
  if (!level || level === 'green') return null;

  const nuclearTense = nuclear && (nuclear.level === 'TENSION' || nuclear.level === 'CRITIQUE');
  const nuclearCritique = nuclear?.level === 'CRITIQUE';

  // Besoin : Écowatt orange/rouge ET au moins un autre signal confirmant
  const confirmedByNuclear = nuclearTense ?? false;
  const confirmedByOutages = raw.powerOutages.length >= 3;
  const confirmedByEolien  = (raw.eolienLive?.production ?? 9999) < 500; // faible vent

  const confirmedBy = [confirmedByNuclear, confirmedByOutages, confirmedByEolien].filter(Boolean).length;
  if (confirmedBy === 0) return null;

  const severity: SituationSeverity = (level === 'red' || nuclearCritique) ? 'critical'
    : confirmedBy >= 2 ? 'high'
    : 'medium';

  const confidence = Math.min(0.95, 0.50 + confirmedBy * 0.15 + (level === 'red' ? 0.15 : 0));

  const drivers: string[] = [];
  if (level === 'red') drivers.push('Écowatt rouge : signal national RTE');
  else drivers.push('Écowatt orange : signal national RTE');
  if (confirmedByNuclear) drivers.push(`Parc nucléaire dégradé (stress ${nuclear?.level}${nuclear ? ` · ratio ${Math.round(nuclear.stressRatio * 100)}%` : ''})`);
  if (confirmedByOutages) drivers.push(`${raw.powerOutages.length} pannes électriques signalées`);
  if (confirmedByEolien)  drivers.push(`Production éolienne très faible (< 500 MW)`);

  return situation(
    'energy-stress',
    'ENERGY_STRESS',
    severity,
    confidence,
    'Tension énergétique nationale',
    `Signal Écowatt ${level} (national RTE) confirmé par ${confirmedBy} source(s) additionnelle(s). Risque de déséquilibre offre/demande électrique.`,
    ['France'],
    drivers,
    [
      action('Surveiller Écowatt RTE et les prévisions J+1', 'Analyste énergie', 'monitor'),
      action('Contrôler les REMIT nucléaires en cours', 'Analyste énergie', 'investigate'),
      action('Vérifier les pannes Enedis sur zones denses', 'Analyste infra', 'cross-check', true),
    ],
    ['Écowatt RTE', 'REMIT RTE', 'Enedis outages'],
  );
}

// ─── Règle 2 : IMPORT_DEPENDENCY_RISK ────────────────────────────────────────

function detectImportDependency(raw: FranceRawData): DetectedSituation | null {
  const interconnections = raw.ecowattResponse?.interconnections ?? [];
  if (interconnections.length === 0) return null;

  // Convention : flowMW positif = import INTO France
  const totalImportMW = interconnections
    .filter(i => i.flowMW > 0)
    .reduce((sum, i) => sum + i.flowMW, 0);

  const totalExportMW = Math.abs(interconnections
    .filter(i => i.flowMW < 0)
    .reduce((sum, i) => sum + i.flowMW, 0));

  // France exporte normalement. Si elle importe > 2000 MW net, c'est un signal.
  const netImport = totalImportMW - totalExportMW;
  if (netImport < 2000) return null;

  const severity: SituationSeverity = netImport > 5000 ? 'high' : 'medium';
  const confidence = Math.min(0.90, 0.60 + (netImport / 15000) * 0.30);

  const topImporters = interconnections
    .filter(i => i.flowMW > 0)
    .sort((a, b) => b.flowMW - a.flowMW)
    .slice(0, 3)
    .map(i => `${i.country} (+${Math.round(i.flowMW)} MW)`);

  return situation(
    'import-dependency-risk',
    'IMPORT_DEPENDENCY_RISK',
    severity,
    confidence,
    'Dépendance aux importations électriques',
    `La France importe actuellement ${Math.round(netImport)} MW nets. Elle est normalement exportatrice nette.`,
    ['France'],
    [
      `Import net actuel : +${Math.round(netImport)} MW`,
      `Principales sources : ${topImporters.join(', ')}`,
      ...(raw.nuclearState?.stress ? [`Stress nucléaire : ${raw.nuclearState.stress.level}`] : []),
    ],
    [
      action('Vérifier la disponibilité du parc nucléaire (REMIT RTE)', 'Analyste énergie', 'investigate'),
      action('Surveiller l\'évolution du solde commercial sur Eco2mix', 'Analyste énergie', 'monitor', true),
    ],
    ['RTE Eco2mix', 'REMIT'],
  );
}

// ─── Règle 3 : FLOOD_CRISIS ──────────────────────────────────────────────────

function detectFloodCrisis(raw: FranceRawData): DetectedSituation | null {
  const redSegs    = raw.floodSegments.filter(s => s.level === 'red');
  const orangeSegs = raw.floodSegments.filter(s => s.level === 'orange');

  if (redSegs.length === 0 && orangeSegs.length < 3) return null;

  const severity: SituationSeverity = redSegs.length >= 2 ? 'critical'
    : redSegs.length === 1 ? 'high'
    : 'medium';

  const confidence = Math.min(0.92, 0.65 + redSegs.length * 0.10 + orangeSegs.length * 0.03);

  const zones = [...new Set([
    ...redSegs.map(s => s.name),
    ...orangeSegs.slice(0, 2).map(s => s.name),
  ])].slice(0, 4);

  return situation(
    'flood-crisis',
    'FLOOD_CRISIS',
    severity,
    confidence,
    'Crise hydrologique active',
    `${redSegs.length} tronçon(s) rouge et ${orangeSegs.length} orange. Risque d'inondations significatives.`,
    zones.length > 0 ? zones : ['France'],
    [
      ...(redSegs.length > 0 ? [`${redSegs.length} tronçon(s) en vigilance rouge : ${redSegs.slice(0, 2).map(s => s.name).join(', ')}`] : []),
      ...(orangeSegs.length > 0 ? [`${orangeSegs.length} tronçon(s) en vigilance orange`] : []),
      ...(raw.meteoAlerts.some(a => a.level === 'red' && a.risks.includes('rain-flood')) ? ['Vigilance météo rouge pluie-inondation active'] : []),
    ],
    [
      action('Consulter Vigicrues pour l\'évolution horaire des niveaux', 'Analyste météo-hydrologie', 'monitor', true),
      action('Surveiller les arrêtés préfectoraux de zones inondables', 'Analyste territorial', 'monitor'),
    ],
    ['Vigicrues', 'HubEau hydrométrie'],
  );
}

// ─── Règle 4 : WILDFIRE_ESCALATION ───────────────────────────────────────────

// L'ancienne version comptait raw.activeFires.length au national avec un seuil
// critical de 20. Mesuré le 2026-07-26 : 886 détections en France métropole,
// donc le capteur restait épinglé sur critical tout l'été en indiquant
// seulement « France ». Voir §1.3 du design.

export function detectWildfireIncidents(raw: FranceRawData): DetectedSituation[] {
  const incidents = raw.fireIncidents ?? [];
  if (incidents.length === 0) return [];

  // selectMajorIncidents est générique : elle préserve LocatedFireIncident
  // (aucun cast nécessaire, elle ne fait que filtrer).
  const majorIncidents = selectMajorIncidents(incidents);

  return majorIncidents.map(incident => {
    const severity = wildfireSeverity(incident);
    // deptCodes vient de LocatedFireIncident (Task 10). Si la résolution
    // géographique n'a pas encore abouti, on affiche les coordonnées plutôt
    // que « France » : une position vaut mieux qu'une zone qui ne dit rien.
    const zone = incident.deptCodes.length > 0
      ? incident.deptCodes.map(code => `Dépt ${code}`)
      : [`${incident.centroidLat.toFixed(2)} N, ${incident.centroidLon.toFixed(2)} E`];
    const extentKm = Math.round((incident.bboxMaxLat - incident.bboxMinLat) * 111);

    return situation(
      `wildfire-${incident.id}`,
      'WILDFIRE_ESCALATION',
      severity,
      Math.min(0.9, 0.6 + Math.min(incident.detectionsCount, 600) / 600 * 0.3),
      'Incendie majeur en cours',
      // Uniquement de l'OBSERVÉ : les hectares et les évacuations sont des
      // faits déclarés, ils vivent dans le dossier, pas dans l'alerte (§12.5).
      // « agrégées sur 24 h » et l'âge du dernier passage sont indispensables :
      // un cumul de FRP est dominé par le passage le plus intense de la fenêtre,
      // pas par l'instant présent. Sans cette mention, « 6881 MW cumulés »
      // laisse croire à une intensité actuelle qu'on n'a pas mesurée.
      `${incident.detectionsCount} détections VIIRS agrégées sur 24 h, `
        + `${Math.round(incident.frpTotal)} MW cumulés, emprise ~${extentKm} km. `
        + `Dernière détection ${formatObservationAge(incident.endDatetime)}.`,
      zone,
      [
        `${incident.detectionsCount} détections sur ${incident.satellites.join(', ')}`,
        `Puissance radiative cumulée ${Math.round(incident.frpTotal)} MW`,
        ...(incident.nearUrban ? ['Foyer à moins de 15 km d\'une zone urbanisée'] : []),
        ...(incident.hasNightDetection ? ['Activité nocturne confirmée'] : []),
      ],
      [
        action('Ouvrir le dossier d\'incident', 'Analyste OSINT', 'investigate', true),
        action('Croiser avec les communiqués préfectoraux', 'Analyste OSINT', 'cross-check'),
      ],
      ['NASA FIRMS'],
    );
  });
}

// ─── Règle 5 : CYBER_PRESSURE « Vigilance cyber » (spec 2026-10-04 souveraineté § 2.4 ; amendement 7, O1, O3, O4, O6, S14, S15) ───

/** « 30/09 » d'une date « AAAA-MM-JJ ». */
function dayMonthOf(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** « 3 alertes » : nombre et nom collés par une espace insécable (R1). */
function countText(n: number, one: string, many: string): string {
  return `${n}${NBSP}${n > 1 ? many : one}`;
}

/** Publication la plus récente d'abord, puis référence décroissante (même ordre que la pastille, l'ordre de la réponse ne compte pas). */
function byPublication(a: CertFrItem, b: CertFrItem): number {
  return b.firstVersion.localeCompare(a.firstVersion) || b.ref.localeCompare(a.ref, 'fr', { numeric: true });
}

/** « CERTFR-2026-ALE-011 : Citrix NetScaler ADC et Gateway, publiée le 28/09, dernière version le 30/09, exploitation signalée par le CERT-FR ». */
function certfrAlertDriver(a: CertFrItem): string {
  const last = certfrDate(a);
  const dates = last !== a.firstVersion
    ? `publiée le ${dayMonthOf(a.firstVersion)}, dernière version le ${dayMonthOf(last)}`
    : `publiée le ${dayMonthOf(a.firstVersion)}`;
  const exploitation = certfrExploitationText(a);
  return `${a.ref} : ${a.product ?? a.title}, ${dates}${exploitation === null ? '' : `, ${exploitation}`}`;
}

/**
 * « Vigilance cyber » sur des événements, plus aucun seuil sur un stock : alertes CERT-FR au statut « en cours » repris du CERT-FR (O1),
 * avis qui citent une vulnérabilité ajoutée au catalogue KEV depuis moins de 7 jours (O6), revendications au-delà de 1,5 fois la moyenne
 * (fichier de ransomware.live à l'heure). Moyenne ; une alerte seule reste moyenne (S14) ; élevée pour deux alertes en cours publiées
 * depuis moins de 7 jours. Jamais critique : des alertes restent ouvertes des semaines et figeraient l'indice national à 55 (arbitrage
 * du contrôleur, revue d'A16). Les revendications ne dépassent jamais la gravité moyenne (O4). Situation ouverte par les seules
 * revendications : ni action ni source du CERT-FR, la source est Ransomware.live.
 */
function detectCyberPressure(raw: FranceRawData, nowMs: number): DetectedSituation | null {
  const c = raw.cyber;
  if (!c) return null;
  const open = c.certfr.alerts.filter(isCertFrAlertOpen).sort(byPublication);
  const recentOpen = open.filter((a) => isCertFrPublishedRecently(a, nowMs));
  const kevFresh = !isSovereigntyDataLate('kev', c.kev.readAt, nowMs);
  const kevAdvisories = kevFresh ? certfrKevAdvisories(c, nowMs) : [];
  const claimsLate = c.ransomware !== null && isSovereigntyDataLate('ransomware', c.ransomware.lastModified, nowMs);
  const ratio = claimsLate ? null : claimsRatio(c.ransomware);
  const claimsHigh = ratio !== null && ratio > CLAIMS_RATIO_JAUNE;
  const certfrBacked = open.length > 0 || kevAdvisories.length > 0;
  if (!certfrBacked && !claimsHigh) return null;
  // Vulnérabilités citées sur 30 jours : un facteur des seules situations ouvertes par le CERT-FR (un stock, jamais un déclencheur).
  const kevCited = kevFresh && certfrBacked ? c.kev.recent.filter((k) => k.certfrRefs.length > 0).length : 0;

  const severity: SituationSeverity = recentOpen.length >= 2 ? 'high' : 'medium';
  const exploitationSaid = open.some((a) => a.exploited === true || a.kevCves.length > 0);
  const ratioText = ratio === null ? '' : `${ratio.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${NBSP}fois la moyenne`;
  const advisoriesText = `${kevAdvisories.length}${NBSP}avis citant une vulnérabilité ajoutée au catalogue KEV depuis moins de ${CERTFR_RECENT_DAYS}${NBSP}jours`;

  const drivers = [
    ...open.slice(0, 3).map(certfrAlertDriver),
    ...(kevAdvisories.length > 0 ? [`${advisoriesText} : ${kevAdvisories.slice(0, 3).map((a) => a.ref).join(', ')}`] : []),
    ...(kevCited > 0 ? [`${countText(kevCited, 'vulnérabilité exploitée citée', 'vulnérabilités exploitées citées')} par le CERT-FR (catalogue KEV de la CISA, 30${NBSP}jours)`] : []),
    ...(claimsHigh ? [`revendications de la semaine (revendiquées par les groupes, non confirmées) : ${ratioText} · Source : Ransomware.live`] : []),
  ];
  const summary = [
    ...(open.length > 0 ? [countText(open.length, 'alerte CERT-FR en cours', 'alertes CERT-FR en cours')] : []),
    ...(kevAdvisories.length > 0 ? [advisoriesText] : []),
    ...(claimsHigh ? [`revendications à ${ratioText}, non confirmées`] : []),
  ].join(' ; ');
  const outageCorrelation = raw.powerOutages.length > 0 || raw.telecomOutages.length > 0;
  // Lien : la page CERT-FR d'abord (alerte en cours la plus récente, sinon premier avis compté) ; la source des revendications
  // (« Source : Ransomware.live », conditions d'usage) seulement quand elles ouvrent seules la situation.
  const certfrItem = open[0] ?? kevAdvisories[0];
  const link = certfrItem !== undefined
    ? { linkUrl: certfrItem.url, linkLabel: `${certfrItem.kind === 'alerte' ? 'Alerte' : 'Avis'} ${certfrItem.ref}` }
    : { linkUrl: SOVEREIGNTY_SOURCE_DETAILS['Ransomware.live'].link, linkLabel: 'Source : Ransomware.live' };

  const base = situation(
    'cyber-pressure',
    'CYBER_PRESSURE',
    severity,
    exploitationSaid ? 0.85 : 0.7,
    'Vigilance cyber',
    `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`,
    ['France'],
    drivers,
    [
      ...(open.length > 0 ? [
        action('Lire les alertes du CERT-FR et appliquer les correctifs publiés', 'Analyste cyber', 'investigate', true),
        action('Relayer l’alerte aux services et opérateurs concernés', 'Analyste cyber', 'escalate'),
      ] : kevAdvisories.length > 0 ? [
        action('Lire les avis du CERT-FR et appliquer les correctifs publiés', 'Analyste cyber', 'investigate', true),
      ] : []),
      ...(claimsHigh ? [
        action('Vérifier les revendications auprès du CSIRT régional', 'Analyste cyber', 'cross-check'),
        action('Vérifier les secteurs critiques visés (santé, énergie, administration)', 'Analyste cyber', 'investigate'),
      ] : []),
      ...(outageCorrelation ? [action('Croiser avec les pannes réseau pour écarter une attaque coordonnée', 'IA + analyste infra', 'cross-check', true)] : []),
    ],
    [
      ...(certfrBacked ? ['CERT-FR'] : []),
      ...(kevAdvisories.length > 0 || kevCited > 0 ? ['CISA KEV'] : []),
      ...(claimsHigh ? ['Ransomware.live'] : []),
    ],
  );
  return { ...base, ...link, activateLayers: ['cyber'] };
}

// ─── Règle 6 : SOCIAL_ESCALATION ─────────────────────────────────────────────

function detectSocialEscalation(raw: FranceRawData): DetectedSituation | null {
  const isnr = raw.isnrData;
  if (!isnr) return null;

  const highSocialDepts = isnr.scores.filter(s =>
    s.dimensions.social >= 40 || s.dimensions.security >= 50,
  );
  const criticalDepts = isnr.scores.filter(s => s.score >= 65);

  if (highSocialDepts.length < 3 && isnr.nationalScore < 35) return null;

  const severity: SituationSeverity = criticalDepts.length >= 3 ? 'critical'
    : criticalDepts.length >= 1 || highSocialDepts.length >= 5 ? 'high'
    : 'medium';

  const confidence = Math.min(0.85, 0.45 + highSocialDepts.length * 0.05 + (isnr.nationalScore / 100) * 0.20);

  const topDepts = [...isnr.scores]
    .sort((a, b) => (b.dimensions.social + b.dimensions.security) - (a.dimensions.social + a.dimensions.security))
    .slice(0, 3)
    .map(s => `${s.name} (${s.score}/100)`);

  return situation(
    'social-escalation',
    'SOCIAL_ESCALATION',
    severity,
    confidence,
    'Escalade sociale localisée',
    `${highSocialDepts.length} département(s) avec tensions sociales ou sécuritaires élevées. Score national ISNR : ${isnr.nationalScore}/100.`,
    topDepts,
    [
      `${highSocialDepts.length} dept(s) avec dimension sociale/sécurité ≥ 40`,
      `Score national ISNR : ${isnr.nationalScore}/100`,
      ...(criticalDepts.length > 0 ? [`${criticalDepts.length} dept(s) en situation critique (score ≥ 65)`] : []),
    ],
    [
      action('Surveiller les flux RSS des PQR locales sur les départements actifs', 'Analyste OSINT', 'monitor', true),
      action('Croiser avec les alertes préfectorales et les perturbations transport', 'IA + analyste territorial', 'cross-check', true),
    ],
    ['ISNR (PQR + alertes)', 'Vigicrues', 'Vigilance météo'],
  );
}

// ─── Règle 7 : TELECOM_DISRUPTION ────────────────────────────────────────────

const NBSP = '\u00a0';
const TELECOM_RECENT_MS = 24 * 3_600_000;
const PARIS_CLOCK = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function fmtInt(n: number): string {
  return n.toLocaleString('fr-FR').replace(/[\u202f\u00a0 ]/g, NBSP);
}

/** Panne ARCEP sans département (« Inconnu » côté adaptateur, ou vide) : regroupée sous cette clé, jamais affichée telle quelle. */
const UNKNOWN_DEPT = '';
const UNKNOWN_DEPT_LABEL = 'département non précisé';

function telecomDeptKey(department: string | undefined): string {
  const d = department?.trim() ?? '';
  return d === '' || d.toLowerCase() === 'inconnu' ? UNKNOWN_DEPT : d;
}

function telecomDeptLabel(code: string): string {
  if (code === UNKNOWN_DEPT) return UNKNOWN_DEPT_LABEL;
  const name = DEPARTMENTS[code]?.name;
  return name ? `${name} (${code})` : code;
}

/** « dans le département Nord (59) », ou « sans département précisé ». */
function telecomDeptPhrase(code: string): string {
  return code === UNKNOWN_DEPT ? 'sans département précisé' : `dans le département ${telecomDeptLabel(code)}`;
}

/**
 * Le fichier ARCEP est un STOCK de sites hors service (pannes de plusieurs mois comprises), pas un
 * flux d'événements : seules les pannes débutées dans les dernières 24 h (`since`) comptent.
 * Sans date ou plus anciennes, elles ne déclenchent rien.
 */
function detectTelecomDisruption(raw: FranceRawData, nowMs: number = Date.now()): DetectedSituation | null {
  const stock = raw.telecomOutages.length;
  const powerCount = raw.powerOutages.length;

  const byDept = new Map<string, number>();
  let recent = 0;
  for (const o of raw.telecomOutages) {
    const t = o.since ? Date.parse(o.since) : NaN;
    if (Number.isNaN(t) || t > nowMs || nowMs - t > TELECOM_RECENT_MS) continue;
    recent += 1;
    const dept = telecomDeptKey(o.department);
    byDept.set(dept, (byDept.get(dept) ?? 0) + 1);
  }

  const ranked = [...byDept.entries()].sort((a, b) => b[1] - a[1]);
  const [topDept, topCount] = ranked[0] ?? ['', 0];

  const severity: SituationSeverity | null =
    topCount >= 100 || recent >= 600 ? 'critical'
    : topCount >= 50 || recent >= 300 ? 'high'
    : topCount >= 20 ? 'medium'
    : null;
  if (!severity) return null;

  // Les pannes électriques ne font que confirmer : elles ne changent pas la sévérité.
  const powerConfirms = powerCount >= 3;
  const confidence = Math.min(0.88, 0.55 + Math.min(0.25, topCount / 400) + (powerConfirms ? 0.05 : 0));

  const zones = ranked.slice(0, 3).map(([d]) => telecomDeptLabel(d));
  const plural = recent > 1;
  const recentText = `${fmtInt(recent)}${NBSP}site${plural ? 's' : ''} mobile${plural ? 's' : ''} tombé${plural ? 's' : ''} en 24${NBSP}h, dont ${fmtInt(topCount)} ${telecomDeptPhrase(topDept)}`;
  const stockText = `${fmtInt(stock)}${NBSP}site${stock > 1 ? 's' : ''} hors service au total dans le fichier ARCEP du jour, pannes anciennes comprises`;

  return situation(
    'telecom-disruption',
    'TELECOM_DISRUPTION',
    severity,
    confidence,
    'Perturbation télécom significative',
    `${recentText}. ${stockText}.`,
    zones.length > 0 ? zones : ['France'],
    [
      recentText,
      stockText,
      ...(powerConfirms ? [`${powerCount} pannes électriques en parallèle (confirmation, risque cascade)`] : []),
    ],
    [
      action('Vérifier le tableau de bord ARCEP pour les incidents opérateurs', 'Analyste télécom', 'investigate', true),
      action('Identifier les zones de concentration d\'incidents', 'IA + analyste télécom', 'cross-check', true),
    ],
    ['ARCEP', 'Enedis outages', 'IODA'],
  );
}

// ─── Règle 8 : MARITIME_ANOMALY ──────────────────────────────────────────────

function detectMaritimeAnomaly(raw: FranceRawData): DetectedSituation | null {
  const anomalies = raw.aisAnomalies;
  if (anomalies.length === 0) return null;

  const radioSilence = anomalies.filter((a) => a.type === 'radio_silence');
  const rendezvous = anomalies.filter((a) => a.type === 'rendezvous');
  const highSeverity = anomalies.filter((a) => a.severity === 'high' || a.severity === 'critical');
  // Navires lents confirmés sur un câble, AIS frais et veille évaluée (contrats § 6) : un AIS muet n'en donne aucun. Comptés par navire
  // (FX2 : la veille fait une alerte par navire et par câble).
  const slowVessels = distinctVessels(raw.cableAlerts);

  const severity: SituationSeverity = highSeverity.length >= 2 || (radioSilence.length >= 2 && slowVessels >= 1) ? 'critical'
    : highSeverity.length >= 1 || rendezvous.length >= 2 || slowVessels >= 1 ? 'high'
    : 'medium';

  const confidence = Math.min(
    0.9,
    0.52 +
      highSeverity.length * 0.12 +
      rendezvous.length * 0.06 +
      Math.min(slowVessels, 2) * 0.08,
  );

  const affectedZones = [...new Set(anomalies.map((a) => nearestPortLabel(a.position)))].slice(0, 4);
  const sampleDescriptions = anomalies.slice(0, 2).map((a) => a.description);

  return situation(
    'maritime-anomaly',
    'MARITIME_ANOMALY',
    severity,
    confidence,
    'Anomalie maritime AIS',
    `${anomalies.length} anomalie(s) AIS détectée(s)${slowVessels > 0 ? ` avec ${countText(slowVessels, 'navire lent', 'navires lents')} sur un câble` : ''}.`,
    affectedZones.length > 0 ? affectedZones : ['Zone maritime française'],
    [
      ...(radioSilence.length > 0 ? [`${radioSilence.length} silence(s) radio détecté(s)`] : []),
      ...(rendezvous.length > 0 ? [`${rendezvous.length} rendez-vous(x) suspect(s)`] : []),
      ...(sampleDescriptions.length > 0 ? [`Exemples : ${sampleDescriptions.join(' ; ')}`] : []),
      ...(slowVessels > 0 ? [`${countText(slowVessels, 'navire lent confirmé', 'navires lents confirmés')} sur un câble en appui, à vérifier`] : []),
    ],
    [
      action('Vérifier l\'historique AIS et les pavillons des navires impliqués', 'Analyste maritime', 'investigate', true),
      action('Signaler à la préfecture maritime compétente si nécessaire', 'Analyste maritime', 'escalate'),
    ],
    ['AIS relay', 'Ais anomaly detector', ...(slowVessels > 0 ? [CABLES_SOURCE] : [])],
  );
}

// ─── Règle 9 : DEFENSE_SIGNAL_ELEVATED « Signal défense » (spec 2026-10-04 souveraineté § 2.4 ; amendement 7, O7, O10, O15, S3, S5) ───

/** Code du transpondeur (S3 : « 7500 (intervention illicite) »), mêmes mots que la pastille Défense. */
const SQUAWK_TEXT: Readonly<Record<MilitaryEmergency['squawk'], string>> = { '7500': 'intervention illicite', '7600': 'panne radio', '7700': 'urgence' };

/** Source des alertes câbles : câbles du Shom (référence) et d'OpenStreetMap (compléments), relevés AIS (O18). */
const CABLES_SOURCE = 'Câbles (Shom, OpenStreetMap) et AIS';

/** Appareil montré : indicatif (sinon adresse) et type ; appareil masqué (O10) : jamais une adresse, un indicatif ni un type. */
function emergencyWho(e: MilitaryEmergency): string {
  if (e.masked) return e.family === 'francais' ? 'appareil d’État français' : 'appareil à identité protégée ou de nationalité inconnue';
  return `${e.callsign ?? `adresse ${e.icao24}`}${e.type ? ` (${e.type})` : ''}`;
}

/** Lieu court (zone, ligne d'urgence) : département, mer territoriale ou approches ; jamais une position. */
function emergencyZone(e: MilitaryEmergency): string {
  if (e.dept !== null) return `Dépt${NBSP}${e.dept}`;
  return e.inFrance ? 'Mer territoriale' : 'Approches de la France';
}

/** Lieu dans une phrase (S5 pour la mer territoriale). */
function emergencyPlace(e: MilitaryEmergency): string {
  if (e.dept !== null) return `au-dessus de la métropole (Dépt${NBSP}${e.dept})`;
  return e.inFrance
    ? `au-dessus de la mer territoriale (moins de 12${NBSP}milles de la côte)`
    : `dans les approches de la France (moins de 40${NBSP}km)`;
}

/** « RCH161 (C17) · Dépt 29 », « appareil d’État français · Dépt 69 » (même forme que la pastille Défense). */
function emergencyAircraftLine(e: MilitaryEmergency): string {
  const zone = emergencyZone(e);
  return `${emergencyWho(e)} · ${e.dept !== null ? zone : zone.charAt(0).toLowerCase() + zone.slice(1)}`;
}

/**
 * « Signal défense » (O7) : un 7500 affiché sur deux relevés au-dessus du territoire ou à moins de 40 km, moyenne, « à confirmer par les
 * autorités » ; trois mailles à précision GNSS dégradée sur 24 h (phase B, comptes sans lieu), moyenne, élevée seulement sur deux jours
 * UTC complets de suite (defenseSituationSeverity). Les 7700 et 7600 restent des urgences aériennes du panneau et du moniteur d'alertes.
 * Jamais un nombre d'aéronefs : un aéronef observé n'est pas un événement. Sur le seul GNSS, la situation s'intitule « Précision GNSS
 * dégradée » (O15, jamais « brouillage ») et dit de signaler à la DGAC et à l'ANFR, seules à qualifier un brouillage (S15, tâche B28).
 */
function detectDefenseSignal(raw: FranceRawData): DetectedSituation | null {
  const hijacks = (raw.militaryEmergencies ?? []).filter(isDefenseSituationEmergency);
  const gnss = raw.gnssDegraded;
  const severity = defenseSituationSeverity(hijacks, gnss);
  if (severity === null) return null;
  const gnssCells = gnss !== null && gnss.rolling24h >= GNSS_SITUATION_CELLS ? gnss.rolling24h : 0;
  const lines = [
    ...hijacks.map((e) => `code 7500 affiché par le transpondeur, à confirmer par les autorités : ${emergencyAircraftLine(e)}`),
    ...(gnssCells > 0 ? [`${countText(gnssCells, 'maille', 'mailles')} à précision GNSS dégradée sur 24${NBSP}h, à vérifier`] : []),
  ];
  const summary = lines.join(' ; ');
  const base = situation(
    'defense-signal-elevated',
    'DEFENSE_SIGNAL_ELEVATED',
    severity,
    hijacks.length > 0 ? 0.9 : 0.7,
    hijacks.length > 0 ? 'Signal défense' : 'Précision GNSS dégradée',
    `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`,
    hijacks.length > 0 ? [...new Set(hijacks.map(emergencyZone))].slice(0, 4) : ['France'],
    lines,
    [
      ...(hijacks.length > 0 ? [
        action('Croiser avec les communiqués officiels (préfecture, DGAC)', 'Analyste défense', 'cross-check', true),
        action('Suivre l’aéronef sur le panneau Défense', 'Analyste défense', 'monitor'),
      ] : []),
      ...(gnssCells > 0 ? [action('Signaler à la DGAC et à l’ANFR, seules à qualifier un brouillage', 'Analyste défense', 'cross-check')] : []),
    ],
    [...(hijacks.length > 0 ? ['adsb.lol'] : []), ...(gnssCells > 0 ? ['Grille GNSS (adsb.lol)', 'NOAA SWPC'] : [])],
  );
  // Position : seulement une urgence montrée (une urgence masquée n'en a pas, O10).
  const shown = hijacks.find((e) => !e.masked);
  // Entrées du moniteur déjà dites ici (liste « À traiter » : pas de doublon) : l'urgence de chaque 7500, le compte GNSS.
  const coveredAlertIds = [...hijacks.map(militaryEmergencyAlertId), ...(gnssCells > 0 ? [GNSS_MONITOR_ID] : [])];
  return { ...base, ...(shown && !shown.masked ? { lat: shown.lat, lon: shown.lon } : {}), activateLayers: ['military'], coveredAlertIds };
}

/** Identifiant de l'entrée du moniteur d'une urgence, sans gravité : l'urgence qui se confirme reste la même alerte. */
function militaryEmergencyAlertId(e: MilitaryEmergency): string {
  return e.masked ? `military-emergency-masked-${e.squawk}-${e.firstSeen}-${e.dept ?? 'mer'}` : `military-emergency-${e.icao24}-${e.squawk}`;
}

// ─── Moniteur d'alertes : urgences militaires et navires lents sur un câble (souveraineté § 2.4 ; contrats § 6) ───

/**
 * Une alerte par urgence au-dessus du territoire ou à moins de 40 km, les trois codes (O7 : les 7700 et 7600 restent ici comme urgences
 * aériennes) : critique pour un 7500 affiché sur deux relevés, élevée pour un 7700 ou un 7600, moyenne vue une seule fois (à confirmer),
 * comme la pastille Défense. Identifiant sans gravité : l'urgence qui se confirme reste la même alerte. Urgence masquée (O10) : ni adresse,
 * ni indicatif, ni position, son département seul ; la carte ne se recentre que sur une urgence montrée.
 */
export function militaryEmergencyAlerts(emergencies: readonly MilitaryEmergency[]): DetectedSituation[] {
  return emergencies.map((e) => {
    const confirmed = isEmergencyConfirmed(e);
    const severity: SituationSeverity = !confirmed ? 'medium' : e.squawk === '7500' ? 'critical' : 'high';
    const state = !confirmed ? 'vu une fois, à confirmer'
      : e.squawk === '7500' ? 'affiché par le transpondeur sur deux relevés, non confirmé par les autorités'
      : 'affiché sur deux relevés';
    const code = `${e.squawk} (${SQUAWK_TEXT[e.squawk]})`;
    const country = !e.masked && e.country ? ` ; pays du bloc OACI : ${e.country}` : '';
    const base = situation(
      militaryEmergencyAlertId(e),
      'MILITARY_SURGE_ALERT',
      severity,
      confirmed ? 0.9 : 0.6,
      e.masked ? `${code} : ${emergencyAircraftLine(e)}` : `${code} : ${emergencyWho(e)}`,
      `Code ${e.squawk} ${state}, ${emergencyPlace(e)}${country}.`,
      [emergencyZone(e)],
      [`Code ${code} ${state}`, `Aéronef : ${emergencyWho(e)}`, `Dernière lecture à ${PARIS_CLOCK.format(new Date(e.lastSeen))}`],
      [
        action('Suivre l’aéronef sur le panneau Défense', 'Veille défense', 'monitor', true),
        action('Croiser avec les communiqués officiels', 'Veille défense', 'cross-check'),
      ],
      ['adsb.lol'],
    );
    const updatedAt = new Date(e.lastSeen);
    return e.masked
      ? { ...base, activateLayers: ['military'], updatedAt }
      : { ...base, entityId: `${e.icao24}:${e.squawk}`, lat: e.lat, lon: e.lon, activateLayers: ['military'], updatedAt };
  });
}

/** Câble d'une alerte : son nom ; un câble du Shom n'en a pas (le Shom n'en publie pas). */
function cableWord(a: CableAlert): string {
  if (a.cableName !== null) return a.cableName;
  return a.cableId.startsWith('shom/') ? 'câble télécom du Shom' : 'câble sans nom';
}

/** Câbles d'un navire, noms répétés comptés : « BARMAR, 2 câbles télécom du Shom » (jamais deux fois le même mot). */
function cableWords(alerts: readonly CableAlert[]): string[] {
  const counts = new Map<string, number>();
  for (const a of alerts) counts.set(cableWord(a), (counts.get(cableWord(a)) ?? 0) + 1);
  return [...counts].map(([word, n]) => (n > 1 && word.startsWith('câble ') ? `${countText(n, 'câble', 'câbles')} ${word.slice('câble '.length)}` : word));
}

/**
 * Une entrée par navire lent confirmé sur un ou plusieurs câbles, AIS frais (arbitrage FX2 : la veille fait une alerte par navire et par
 * câble ; le moniteur compte des navires, câbles listés) : élevée (pastille orange), « à vérifier » ; seule la préfecture maritime
 * qualifie une infraction (O18). Position, distance et vitesse : celles du câble le plus proche.
 */
export function cableAlertSituations(alerts: readonly CableAlert[]): DetectedSituation[] {
  return alertsByVessel(alerts).map(({ mmsi, alerts: own }) => {
    const nearest = own[0];
    const ship = nearest.name ?? `MMSI ${mmsi}`;
    const words = cableWords(own);
    const cables = words.join(', ');
    const several = own.length > 1;
    const speed = `${nearest.speedKn.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NBSP}${nearest.speedKn >= 2 ? 'nœuds' : 'nœud'}`;
    const base = situation(
      `defense-alert-${mmsi}`,
      'DEFENSE_ALERT',
      'high',
      0.85,
      several ? `Navire lent près de ${countText(own.length, 'câble', 'câbles')} : ${ship} (${cables})` : `Navire lent sur un câble : ${ship} (${cables})`,
      `À ${nearest.distanceM}${NBSP}m du ${several ? 'tracé le plus proche' : 'tracé'}, ${speed}, confirmé sur deux relevés AIS : à vérifier ; `
        + 'seule la préfecture maritime qualifie une infraction.',
      words,
      [
        `Navire : ${ship}${nearest.vesselType ? ` (${nearest.vesselType})` : ''}`,
        ...(several ? [`Câbles : ${cables}`] : []),
        `Distance au ${several ? 'tracé le plus proche' : 'tracé'} : ${nearest.distanceM}${NBSP}m`,
        `Vitesse : ${speed}`,
      ],
      [
        action('Vérifier l’identité et l’historique AIS du navire', 'Veille maritime', 'investigate'),
        action('Surveiller la zone du câble', 'Sûreté des infrastructures', 'monitor', true),
      ],
      [CABLES_SOURCE],
    );
    const lastSeen = Math.max(...own.map((a) => Date.parse(a.lastSeen)).filter(Number.isFinite));
    return {
      ...base, lat: nearest.lat, lon: nearest.lon, activateLayers: ['subseaCables', 'trafficMaritime'],
      updatedAt: new Date(Number.isFinite(lastSeen) ? lastSeen : Date.parse(nearest.lastSeen)),
    };
  });
}

// ─── Règle 10 : FUEL_SUPPLY_RISK ─────────────────────────────────────────────

// Valeurs du tableau de bord carburant et pétrole en français : aucune valeur anglaise du moteur
// à l'écran (spec §4.3). Les règles et les seuils ne changent pas.
const FUEL_TENSION_FR: Record<FuelTensionLevel, string> = {
  LOW: 'faible',
  MEDIUM: 'modérée',
  HIGH: 'forte',
  CRITICAL: 'critique',
};

const OIL_STATUS_FR: Record<OilVigilanceStatus, string> = {
  normal: 'normaux',
  tense: 'sous tension',
  critical: 'critiques',
  unknown: 'non renseignés',
};

function detectFuelSupplyRisk(raw: FranceRawData): DetectedSituation | null {
  const fuelLevel = raw.fuelTensionDashboard?.national.tensionLevel ?? null;
  const oilStatus = raw.oilDashboard?.meta.status ?? null;
  const oilVigilance = raw.oilDashboard?.meta.vigilanceScore ?? 0;

  const fuelCritical = fuelLevel === 'CRITICAL';
  const fuelHigh     = fuelLevel === 'HIGH';
  const oilTense     = oilStatus === 'tense' || oilStatus === 'critical';

  if (!fuelCritical && !(fuelHigh && oilTense)) return null;

  const severity: SituationSeverity = fuelCritical && oilTense ? 'critical'
    : fuelCritical ? 'high'
    : 'medium';

  const anomalyShare = raw.fuelTensionDashboard?.national.anomalyShare ?? 0;
  const confidence = Math.min(0.90, 0.60 + (fuelCritical ? 0.20 : 0.10) + (oilTense ? 0.10 : 0));

  const topDepts = (raw.fuelTensionDashboard?.national.topDepartments ?? [])
    .slice(0, 3)
    .map(d => d.departmentName);
  const fuelWord = fuelLevel ? FUEL_TENSION_FR[fuelLevel] : 'inconnue';
  const oilWord = oilStatus ? OIL_STATUS_FR[oilStatus] : null;

  return situation(
    'fuel-supply-risk',
    'FUEL_SUPPLY_RISK',
    severity,
    confidence,
    'Risque d\'approvisionnement carburant',
    `Tension carburant ${fuelWord}${oilWord ? ` · stocks pétroliers ${oilWord}` : ''}. ${Math.round(anomalyShare)}% des stations en rupture temporaire.`,
    topDepts.length > 0 ? topDepts : ['France'],
    [
      `Tension carburant nationale : ${fuelWord}`,
      ...(oilTense && oilWord ? [`Vigilance stocks pétroliers : ${oilWord} (score ${oilVigilance}/100)`] : []),
      ...(anomalyShare > 5 ? [`${Math.round(anomalyShare)}% des stations en rupture temporaire`] : []),
    ],
    [
      action('Surveiller les niveaux de stocks SPE', 'Analyste énergie', 'monitor'),
      action('Identifier les départements en tension critique pour anticiper les blocages', 'IA + analyste territorial', 'cross-check', true),
    ],
    ['SDES CPDP', 'Prix carburants data.gouv.fr'],
  );
}

// ─── Règle : SEISMIC_EVENT (spec 2026-10-04 environnement § 3.3, amendements 2 et 6) ─────────

const PARIS_PARTS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** « le 04/10 à 05:10 » (heure de Paris). */
function parisWhen(iso: string): string {
  const p = Object.fromEntries(PARIS_PARTS.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `le ${p['day']}/${p['month']} à ${p['hour']}:${p['minute']}`;
}

/**
 * Une situation par séisme de magnitude 4 ou plus en France (territoire ou eaux françaises) dans les 72 dernières heures :
 * sévérité moyenne, élevée dès 5 (qui plafonne le score à 78 par CAP_ONE_HIGH). Un séisme hors de France n'en crée jamais.
 */
export function detectSeismicEvents(raw: FranceRawData, nowMs: number): DetectedSituation[] {
  return (raw.quakes ?? []).flatMap((q): DetectedSituation[] => {
    const t = Date.parse(q.at);
    if (!quakeInFrance(q) || q.magnitude < 4 || !Number.isFinite(t) || t > nowMs || nowMs - t > QUAKE_WINDOW_MS) return [];
    const mag = magnitudeText(q.magnitude);
    const place = quakePlace(q);
    const zone = q.dept !== null ? `Dépt ${q.dept}` : `en mer, à ${Math.round(q.distanceKm)}${NBSP}km des côtes`;
    const depth = q.depthKm !== null ? `profondeur ${Math.round(q.depthKm)}${NBSP}km` : 'profondeur non publiée';
    const status = q.status === 'revu' ? 'revu par un sismologue' : 'automatique, à confirmer';
    const base = situation(
      `seismic-${q.id}`, 'SEISMIC_EVENT', q.magnitude >= 5 ? 'high' : 'medium', q.status === 'revu' ? 0.9 : 0.75,
      `Séisme de magnitude ${mag} ${place}`,
      `Magnitude ${mag}${q.magType ? ` (${q.magType})` : ''}, ${depth}, ${parisWhen(q.at)} (heure de Paris), ${status}.`,
      [zone],
      [`Magnitude ${mag} ${place}`, `${depth.charAt(0).toUpperCase()}${depth.slice(1)}`, `Relevé ${status}`],
      [
        action('Consulter la fiche du séisme (intensité ressentie, témoignages)', 'Analyste risques naturels', 'monitor', true),
        action('Croiser avec les communiqués de la préfecture et des secours', 'Analyste territorial', 'cross-check'),
      ],
      [q.source],
    );
    return [{ ...base, lat: q.lat, lon: q.lon, activateLayers: ['earthquakes'], ...(q.url ? { linkUrl: q.url, linkLabel: 'Fiche du séisme' } : {}) }];
  });
}

// ─── Règle : AIR_POLLUTION_EPISODE (spec 2026-10-04 environnement § 3.2, amendement 6) ───────

/** Une situation quand un épisode atteint le seuil d'alerte en J ou J+1 (jours de Paris) : sévérité moyenne, sans plafond du score. */
export function detectAirPollution(raw: FranceRawData, nowMs: number): DetectedSituation | null {
  const today = parisDayOf(nowMs);
  const wanted = new Set([today, nextDayOf(today)]);
  const alerts = (raw.airEpisodes ?? []).filter((e) => e.state === 'alerte' && wanted.has(e.date));
  if (alerts.length === 0) return null;
  const zones = [...new Set(alerts.map((e) => e.zone))];
  const pollutants = [...new Set(alerts.map((e) => e.pollutant))].join(', ');
  const when = alerts.some((e) => e.date === today) ? 'aujourd’hui' : 'demain';
  const base = situation(
    'air-pollution', 'AIR_POLLUTION_EPISODE', 'medium', 0.8,
    `Épisode de pollution au seuil d’alerte : ${pollutants}`,
    `${alerts.length} procédure${alerts.length > 1 ? 's' : ''} d’alerte (${pollutants}) ${when} ; niveaux publiés par les AASQA (Atmo France).`,
    zones.slice(0, 4),
    alerts.slice(0, 4).map((e) => `${e.pollutant} : alerte, ${e.zone}, le ${e.date.slice(8, 10)}/${e.date.slice(5, 7)}`),
    [
      action('Consulter l’arrêté préfectoral de la zone (absent du flux Atmo France)', 'Analyste territorial', 'monitor'),
      action(`Suivre la prévision du lendemain (publiée vers 14${NBSP}h)`, 'Analyste environnement', 'monitor', true),
    ],
    ['Atmo France'],
  );
  return { ...base, activateLayers: ['airQuality'] };
}

// ─── Orchestrateur principal ──────────────────────────────────────────────────

const RULES: Array<(raw: FranceRawData, nowMs: number) => DetectedSituation | null> = [
  detectEnergyStress,
  detectImportDependency,
  detectFloodCrisis,
  detectCyberPressure,
  detectSocialEscalation,
  detectTelecomDisruption,
  detectMaritimeAnomaly,
  detectDefenseSignal,
  detectFuelSupplyRisk,
  detectAirPollution,
];

/**
 * Détecte les situations opérationnelles à partir des données brutes.
 * Retourne au maximum 10 situations triées par sévérité > confiance.
 */
export function detectSituations(raw: FranceRawData, nowMs: number = Date.now()): DetectedSituation[] {
  const results: DetectedSituation[] = [];

  for (const rule of RULES) {
    try {
      const s = rule(raw, nowMs);
      if (s) results.push(s);
    } catch (err) {
      // Une règle ne doit jamais faire crasher l'engine
      console.warn('[SituationEngine] Rule error:', err);
    }
  }

  // Règle multi-situations : une alerte par incident majeur (§5.3).
  // Même isolation que les autres règles — un incident mal formé ne doit pas
  // emporter tout le moteur.
  try {
    results.push(...detectWildfireIncidents(raw));
  } catch (err) {
    console.warn('[SituationEngine] Wildfire rule error:', err);
  }

  // Une situation par séisme fort (§ 3.3) ; même isolation que les autres règles.
  try {
    results.push(...detectSeismicEvents(raw, nowMs));
  } catch (err) {
    console.warn('[SituationEngine] Seismic rule error:', err);
  }

  const ranked = results.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.confidence - a.confidence;
  });
  if (ranked.length > 10) {
    console.warn(
      `[SituationEngine] ${ranked.length - 10} situation(s) tronquée(s) par le plafond de 10`,
    );
  }
  return ranked.slice(0, 10);
}
