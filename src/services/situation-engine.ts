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
  DetectedSituation,
  FuelTensionLevel,
  OilVigilanceStatus,
  SituationAction,
  SituationActionType,
  SituationSeverity,
  SituationType,
} from '../types/index.ts';
import { FRENCH_PORTS } from '../config/french-ports.ts';
import type { FranceRawData } from './france-country-intel.ts';
import { computeCyberPressureAssessment } from './cyber-threat-scoring.ts';
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

// ─── Règle 5 : CYBER_PRESSURE ────────────────────────────────────────────────

function detectCyberPressure(raw: FranceRawData): DetectedSituation | null {
  const cyber = raw.cyberData;
  const threatEvents = raw.threatEvents ?? [];
  if (!cyber && threatEvents.length === 0) return null;

  const pressure = computeCyberPressureAssessment(cyber, threatEvents, {
    powerOutageCount: raw.powerOutages.length,
    telecomOutageCount: raw.telecomOutages.length,
  });
  const score = pressure.score;
  const criticalCVEs = pressure.criticalCVEs;
  const ransomware30d = Math.max(cyber?.ransomware.total30d ?? 0, pressure.summary.ransomware30d);
  const certCritical = pressure.certCritical;
  const leaks30d = pressure.summary.leaks30d;
  const exposure30d = pressure.summary.exposure30d;
  const trend = cyber?.meta.trend ?? 'stable';
  const dominantBreakdown = pressure.breakdown.filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  if (score < 55 && criticalCVEs === 0 && ransomware30d === 0 && leaks30d < 5) return null;

  const outageCorrelation = raw.powerOutages.length > 0 || raw.telecomOutages.length > 0;

  const severity: SituationSeverity = (score >= 85 || certCritical >= 2) ? 'critical'
    : (score >= 65 || criticalCVEs >= 3 || ransomware30d >= 10) ? 'high'
    : 'medium';

  const confidence = Math.min(0.88, 0.50 + (score / 100) * 0.30 + (outageCorrelation ? 0.10 : 0) + (certCritical * 0.04));

  const drivers: string[] = [];
  drivers.push(`Score cyber consolidé : ${score}/100 (tendance ${trend === 'rising' ? 'haussière' : trend === 'falling' ? 'baissière' : 'stable'})`);
  if (dominantBreakdown.length > 0) {
    drivers.push(...dominantBreakdown.slice(0, 3).map((item) => `${item.label} : ${item.score}/${item.cap}`));
  }
  if (certCritical > 0) drivers.push(`${certCritical} alerte(s) critique(s) CERT-FR`);
  if (criticalCVEs > 0) drivers.push(`${criticalCVEs} CVE critique(s) actif(s) (CVSS ≥ 9)`);
  if (ransomware30d > 10) drivers.push(`${ransomware30d} victimes ransomware FR sur 30 jours`);
  if (leaks30d > 0) drivers.push(`${leaks30d} fuite(s) de données FR sur 30 jours`);
  if (exposure30d > 0) drivers.push(`${exposure30d} signal(aux) d’exposition passive Shodan/Censys`);
  if (outageCorrelation) drivers.push('Pannes réseau/telecom concomitantes (corrélation à surveiller)');

  return situation(
    'cyber-pressure',
    'CYBER_PRESSURE',
    severity,
    confidence,
    'Pression cyber multi-source',
    `Baromètre cyber consolidé à ${score}/100${pressure.dominantFamily ? `, dominé par ${dominantBreakdown[0]?.label.toLowerCase()}` : ''}${certCritical > 0 ? ` · ${certCritical} alerte(s) critique(s) CERT-FR` : ''}.`,
    ['France'],
    drivers,
    [
      action('Consulter les bulletins CERT-FR pour les alertes actives', 'Analyste cyber', 'investigate', true),
      action('Vérifier les secteurs OIV/ESS ciblés (santé, énergie, finance)', 'Analyste cyber', 'investigate'),
      ...(outageCorrelation ? [action('Croiser avec les pannes réseau pour écarter une attaque coordonnée', 'IA + analyste infra', 'cross-check', true)] : []),
    ],
    ['CERT-FR', 'RansomwareLive', 'FrenchBreaches', 'Shodan/Censys', 'NVD CVE'],
  );
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
  const defenseAlerts = raw.defenseAlerts.filter((a) => a.severity === 'high');

  const severity: SituationSeverity = highSeverity.length >= 2 || (radioSilence.length >= 2 && defenseAlerts.length >= 1) ? 'critical'
    : highSeverity.length >= 1 || rendezvous.length >= 2 || defenseAlerts.length >= 1 ? 'high'
    : 'medium';

  const confidence = Math.min(
    0.9,
    0.52 +
      highSeverity.length * 0.12 +
      rendezvous.length * 0.06 +
      Math.min(defenseAlerts.length, 2) * 0.08,
  );

  const affectedZones = [...new Set(anomalies.map((a) => nearestPortLabel(a.position)))].slice(0, 4);
  const sampleDescriptions = anomalies.slice(0, 2).map((a) => a.description);

  return situation(
    'maritime-anomaly',
    'MARITIME_ANOMALY',
    severity,
    confidence,
    'Anomalie maritime AIS',
    `${anomalies.length} anomalie(s) AIS détectée(s)${defenseAlerts.length > 0 ? ` avec ${defenseAlerts.length} alerte(s) câbles corrélée(s)` : ''}.`,
    affectedZones.length > 0 ? affectedZones : ['Zone maritime française'],
    [
      ...(radioSilence.length > 0 ? [`${radioSilence.length} silence(s) radio détecté(s)`] : []),
      ...(rendezvous.length > 0 ? [`${rendezvous.length} rendez-vous(x) suspect(s)`] : []),
      ...(sampleDescriptions.length > 0 ? [`Exemples : ${sampleDescriptions.join(' ; ')}`] : []),
      ...(defenseAlerts.length > 0 ? [`${defenseAlerts.length} alerte(s) câbles haute sévérité en appui`] : []),
    ],
    [
      action('Vérifier l\'historique AIS et les pavillons des navires impliqués', 'Analyste maritime', 'investigate', true),
      action('Signaler à la préfecture maritime compétente si nécessaire', 'Analyste maritime', 'escalate'),
    ],
    ['AIS relay', 'Ais anomaly detector', ...(defenseAlerts.length > 0 ? ['Subsea cable alerts'] : [])],
  );
}

// ─── Règle 9 : DEFENSE_SIGNAL_ELEVATED ───────────────────────────────────────

function detectDefenseSignalElevated(raw: FranceRawData): DetectedSituation | null {
  const jamming  = raw.jammingSignals;
  const flights  = raw.militaryFlightsCount;

  const highJamming = jamming.filter(j => j.severity === 'high' || j.severity === 'critical');

  if (highJamming.length === 0 && flights < 8) return null;

  const severity: SituationSeverity = highJamming.length >= 3 ? 'critical'
    : highJamming.length >= 1 && flights >= 10 ? 'high'
    : highJamming.length >= 1 ? 'medium'
    : 'watch';

  const confidence = Math.min(0.82, 0.45 + highJamming.length * 0.12 + Math.min(flights, 20) / 20 * 0.20);

  const jammingZones = jamming.slice(0, 3).map(j => {
    const lat = j.position[1];
    const lon = j.position[0];
    const latStr = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
    return `${latStr} ${lonStr}`;
  });

  return situation(
    'defense-signal-elevated',
    'DEFENSE_SIGNAL_ELEVATED',
    severity,
    confidence,
    'Signal défense / renseignement élevé',
    `${highJamming.length} signal(aux) GPS jamming haute sévérité. ${flights} vols militaires actifs.`,
    jammingZones.length > 0 ? jammingZones : ['France'],
    [
      ...(highJamming.length > 0 ? [`${highJamming.length} brouillage(s) GPS haute sévérité détecté(s)`] : []),
      `${flights} vols militaires français trackés`,
    ],
    [
      action('Corréler avec les NOTAM actifs', 'Analyste défense', 'cross-check', true),
      action('Surveiller les communiqués EMA', 'Analyste défense', 'monitor'),
    ],
    ['OpenSky Network', 'GPS Pattern Detection'],
  );
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
  detectDefenseSignalElevated,
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
