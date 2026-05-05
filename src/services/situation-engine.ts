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
  SituationAction,
  SituationActionType,
  SituationSeverity,
  SituationType,
} from '../types/index.ts';
import { FRENCH_PORTS } from '../config/french-ports.ts';
import type { FranceRawData } from './france-country-intel.ts';
import { computeCyberPressureAssessment } from './cyber-threat-scoring.ts';

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

function detectEnergyStress(raw: FranceRawData): DetectedSituation | null {
  const ecowatt = raw.ecowattResponse;
  const nuclear = raw.nuclearState?.stress;
  if (!ecowatt) return null;

  const signals = Object.values(ecowatt.signals);
  const redRegions  = signals.filter(s => s === 'red').length;
  const orangeRegions = signals.filter(s => s === 'orange').length;
  const ecowattPressure = redRegions > 0 ? 'red' : orangeRegions >= 2 ? 'orange' : null;
  if (!ecowattPressure) return null;

  const nuclearTense = nuclear && (nuclear.level === 'TENSION' || nuclear.level === 'CRITIQUE');
  const nuclearCritique = nuclear?.level === 'CRITIQUE';

  // Besoin : ecowatt orange/red ET au moins un autre signal confirmant
  const confirmedByNuclear = nuclearTense ?? false;
  const confirmedByOutages = raw.powerOutages.length >= 3;
  const confirmedByEolien  = (raw.eolienLive?.production ?? 9999) < 500; // faible vent

  const confirmedBy = [confirmedByNuclear, confirmedByOutages, confirmedByEolien].filter(Boolean).length;
  if (confirmedBy === 0) return null;

  const severity: SituationSeverity = (ecowattPressure === 'red' || nuclearCritique) ? 'critical'
    : confirmedBy >= 2 ? 'high'
    : 'medium';

  const confidence = Math.min(0.95, 0.50 + confirmedBy * 0.15 + (ecowattPressure === 'red' ? 0.15 : 0));

  const drivers: string[] = [];
  if (ecowattPressure === 'red') drivers.push(`Ecowatt rouge — ${redRegions} région(s) en tension critique`);
  else drivers.push(`Ecowatt orange — ${orangeRegions} région(s) sous pression`);
  if (confirmedByNuclear) drivers.push(`Parc nucléaire dégradé (stress ${nuclear?.level}${nuclear ? ` — ratio ${Math.round(nuclear.stressRatio * 100)}%` : ''})`);
  if (confirmedByOutages) drivers.push(`${raw.powerOutages.length} pannes électriques signalées`);
  if (confirmedByEolien)  drivers.push(`Production éolienne très faible (< 500 MW)`);

  const ECOWATT_REGION_NAMES: Record<string, string> = {
    '11': 'Île-de-France', '24': 'Centre-Val de Loire', '27': 'Bourgogne-Franche-Comté',
    '28': 'Normandie', '32': 'Hauts-de-France', '44': 'Grand Est',
    '52': 'Pays de la Loire', '53': 'Bretagne', '75': 'Nouvelle-Aquitaine',
    '76': 'Occitanie', '84': 'Auvergne-Rhône-Alpes', '93': 'PACA', '94': 'Corse',
  };

  const affectedZones = Object.entries(ecowatt.signals)
    .filter(([, s]) => s === 'red' || s === 'orange')
    .map(([code]) => ECOWATT_REGION_NAMES[code] ?? `Région ${code}`)
    .slice(0, 4);

  return situation(
    'energy-stress',
    'ENERGY_STRESS',
    severity,
    confidence,
    'Tension énergétique nationale',
    `Signal Ecowatt ${ecowattPressure} confirmé par ${confirmedBy} source(s) additionnelle(s). Risque de déséquilibre offre/demande électrique.`,
    affectedZones.length > 0 ? affectedZones : ['France'],
    drivers,
    [
      action('Surveiller Ecowatt RTE et les prévisions J+1', 'Analyste énergie', 'monitor'),
      action('Contrôler les REMIT nucléaires en cours', 'Analyste énergie', 'investigate'),
      action('Vérifier les pannes Enedis sur zones denses', 'Analyste infra', 'cross-check', true),
    ],
    ['Ecowatt RTE', 'REMIT RTE', 'Enedis outages'],
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

function detectWildfireEscalation(raw: FranceRawData): DetectedSituation | null {
  const fireCount = raw.activeFires.length;
  if (fireCount < 5) return null;

  const heatMeteo = raw.meteoAlerts.filter(a =>
    (a.level === 'orange' || a.level === 'red') &&
    (a.risks.includes('heat') || a.risks.includes('wind')),
  );
  const confirmedByMeteo = heatMeteo.length > 0;
  if (fireCount < 10 && !confirmedByMeteo) return null;

  const severity: SituationSeverity = fireCount >= 20 && confirmedByMeteo ? 'critical'
    : fireCount >= 15 || (fireCount >= 5 && confirmedByMeteo) ? 'high'
    : 'medium';

  const confidence = Math.min(0.90, 0.55 + (fireCount / 40) * 0.25 + (confirmedByMeteo ? 0.15 : 0));

  const meteoRisks = [...new Set(heatMeteo.flatMap(a => a.risks))].join(', ');

  return situation(
    'wildfire-escalation',
    'WILDFIRE_ESCALATION',
    severity,
    confidence,
    'Escalade du risque incendie',
    `${fireCount} foyers actifs détectés${confirmedByMeteo ? ', conditions météo aggravantes confirmées' : ''}.`,
    ['France'],
    [
      `${fireCount} détections FIRMS/MODIS actives`,
      ...(confirmedByMeteo ? [
        `Vigilance météo ${heatMeteo[0].level} — ${meteoRisks}`,
      ] : []),
    ],
    [
      action('Surveiller les bulletins DFCI', 'Analyste risques naturels', 'monitor'),
      action('Contrôler l\'indice de risque incendie Météo-France', 'Analyste météo', 'cross-check', true),
    ],
    ['NASA FIRMS', 'Vigilance Météo-France'],
  );
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
  drivers.push(`Score cyber consolidé : ${score}/100 (tendance ${trend === 'rising' ? '↗ haussière' : trend === 'falling' ? '↘ baissière' : '→ stable'})`);
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
    `Baromètre cyber consolidé à ${score}/100${pressure.dominantFamily ? `, dominé par ${dominantBreakdown[0]?.label.toLowerCase()}` : ''}${certCritical > 0 ? ` — ${certCritical} alerte(s) critique(s) CERT-FR` : ''}.`,
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

function detectTelecomDisruption(raw: FranceRawData): DetectedSituation | null {
  const telecomCount = raw.telecomOutages.length;
  const powerCount   = raw.powerOutages.length;

  if (telecomCount < 2) return null;

  const combined = telecomCount + (powerCount >= 3 ? 1 : 0);
  const severity: SituationSeverity = telecomCount >= 5 ? 'critical'
    : combined >= 4 ? 'high'
    : 'medium';

  const confidence = Math.min(0.88, 0.55 + (telecomCount / 10) * 0.25 + (powerCount >= 3 ? 0.10 : 0));

  const zones = [...new Set(raw.telecomOutages.map(o => o.department ?? o.operator ?? 'France'))].slice(0, 3);

  return situation(
    'telecom-disruption',
    'TELECOM_DISRUPTION',
    severity,
    confidence,
    'Perturbation télécom significative',
    `${telecomCount} incident(s) télécom actif(s)${powerCount >= 3 ? ` avec ${powerCount} pannes électriques associées` : ''}.`,
    zones.length > 0 ? zones : ['France'],
    [
      `${telecomCount} panne(s) télécom actives`,
      ...(powerCount >= 3 ? [`${powerCount} pannes électriques corrélées (risque cascade)`] : []),
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

  return situation(
    'fuel-supply-risk',
    'FUEL_SUPPLY_RISK',
    severity,
    confidence,
    'Risque d\'approvisionnement carburant',
    `Tension carburant ${fuelLevel}${oilStatus ? ` — stocks pétroliers ${oilStatus}` : ''}. ${Math.round(anomalyShare)}% des stations en anomalie de prix.`,
    topDepts.length > 0 ? topDepts : ['France'],
    [
      `Tension carburant nationale : ${fuelLevel}`,
      ...(oilTense ? [`Vigilance stocks pétroliers : ${oilStatus} (score ${oilVigilance}/100)`] : []),
      ...(anomalyShare > 5 ? [`${Math.round(anomalyShare)}% des stations en anomalie tarifaire`] : []),
    ],
    [
      action('Surveiller les niveaux de stocks SPE', 'Analyste énergie', 'monitor'),
      action('Identifier les départements à tension CRITICAL pour anticiper les blocages', 'IA + analyste territorial', 'cross-check', true),
    ],
    ['SDES CPDP', 'Prix carburants data.gouv.fr'],
  );
}

// ─── Orchestrateur principal ──────────────────────────────────────────────────

const RULES: Array<(raw: FranceRawData) => DetectedSituation | null> = [
  detectEnergyStress,
  detectImportDependency,
  detectFloodCrisis,
  detectWildfireEscalation,
  detectCyberPressure,
  detectSocialEscalation,
  detectTelecomDisruption,
  detectMaritimeAnomaly,
  detectDefenseSignalElevated,
  detectFuelSupplyRisk,
];

/**
 * Détecte les situations opérationnelles à partir des données brutes.
 * Retourne au maximum 10 situations triées par sévérité > confiance.
 */
export function detectSituations(raw: FranceRawData): DetectedSituation[] {
  const results: DetectedSituation[] = [];

  for (const rule of RULES) {
    try {
      const s = rule(raw);
      if (s) results.push(s);
    } catch (err) {
      // Une règle ne doit jamais faire crasher l'engine
      console.warn('[SituationEngine] Rule error:', err);
    }
  }

  return results
    .sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.confidence - a.confidence;
    })
    .slice(0, 10);
}
