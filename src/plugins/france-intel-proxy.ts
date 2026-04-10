// src/plugins/france-intel-proxy.ts
// Dev proxy for /api/intelligence/v1/france-intel-brief (Vite dev server only).
// Receives the same JSON payload shape as the Vercel handler (unchanged after migration):
//   { countryScore, axes, isnrComponents, cyberScore, meteoAlertCount, topHeadlines,
//     signalCounts, energy, lang }
// Source of that payload is now FranceBriefContext (built by france-country-intel.ts).
// No structural changes required here.
import type { Plugin } from 'vite';

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const CACHE_TTL  = 6 * 60 * 60 * 1000; // 6 h in ms
const BRIEF_PROMPT_VERSION = 'v12';

const _devCache = new Map<string, { value: string; expiresAt: number }>();

function describeStability(score: number, lang: 'fr' | 'en'): string {
  if (score >= 80) return lang === 'fr' ? 'stable' : 'stable';
  if (score >= 65) return lang === 'fr' ? 'sous tension' : 'under pressure';
  if (score >= 50) return lang === 'fr' ? 'dégradée' : 'degraded';
  return lang === 'fr' ? 'critique' : 'critical';
}

function describeCyber(score: number, lang: 'fr' | 'en'): string {
  if (score >= 75) return lang === 'fr' ? 'forte' : 'high';
  if (score >= 50) return lang === 'fr' ? 'soutenue' : 'elevated';
  if (score >= 25) return lang === 'fr' ? 'modérée' : 'moderate';
  return lang === 'fr' ? 'faible' : 'low';
}

function hashCacheSeed(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildCacheKey(
  lang: 'fr' | 'en',
  countryScore: number,
  axes: { continuity: number; defense: number; security: number; signal: number },
  isnrComponents: { social: number; security: number; infra: number },
  cyberScore: number,
  meteoAlertCount: number,
  headlines: string[],
  signalCounts: {
    criticalNews: number;
    highNews: number;
    weatherAlerts: number;
    floodAlerts: number;
    fireDetections: number;
    railDisruptions: number;
    roadIncidents: number;
    powerOutages: number;
    telecomOutages: number;
    cyberAlerts: number;
    militaryFlights: number;
    maritimeTrafficFrance: number;
    defenseAlerts: number;
    jammingSignals: number;
    marketStress: number;
  },
  energy: {
    ecowattSignal: string | null;
    nuclearShare: number;
    gasShare: number;
    hydroShare: number;
    windShare: number;
    solarShare: number;
    totalMw: number | null;
    oilStocksDays: number | null;
    oilVigilanceStatus: string | null;
    fuelTensionLevel: string | null;
    fuelTensionAnomalyShare: number | null;
    fuelPriceDelta7dCents: number | null;
    fuelPriceDelta30dCents: number | null;
  } | null,
): string {
  const seed = JSON.stringify({
    lang,
    countryScore,
    axes,
    isnrComponents,
    cyberScore,
    meteoAlertCount,
    headlines,
    signalCounts,
    energy,
  });
  return `france-intel:${BRIEF_PROMPT_VERSION}:${lang}:${hashCacheSeed(seed)}`;
}

function hasLowImmediateSignals(signalCounts: {
  criticalNews: number;
  highNews: number;
  weatherAlerts: number;
  floodAlerts: number;
  fireDetections: number;
  railDisruptions: number;
  roadIncidents: number;
  powerOutages: number;
  telecomOutages: number;
  cyberAlerts: number;
  militaryFlights: number;
  maritimeTrafficFrance: number;
  defenseAlerts: number;
  jammingSignals: number;
  marketStress: number;
}): boolean {
  return (
    signalCounts.criticalNews === 0
    && signalCounts.highNews === 0
    && signalCounts.weatherAlerts === 0
    && signalCounts.floodAlerts === 0
    && signalCounts.cyberAlerts === 0
    && signalCounts.railDisruptions === 0
    && signalCounts.roadIncidents === 0
    && signalCounts.powerOutages === 0
    && signalCounts.telecomOutages === 0
    && signalCounts.defenseAlerts === 0
    && signalCounts.jammingSignals === 0
    && signalCounts.marketStress === 0
  );
}

function sanitizeHeadlines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .slice(0, 6)
    .map(h => String(h).replace(/[\r\n]+/g, ' ').slice(0, 120));
}

function extractBriefText(raw: string, lang: 'fr' | 'en'): string | null {
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/gu, ' ')
    .replace(/```(?:json|text)?/gi, '')
    .trim();

  try {
    const jsonMatch = cleaned.match(/\{[\s\S]*"brief"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { brief?: unknown };
      if (typeof parsed.brief === 'string' && parsed.brief.trim()) {
        return parsed.brief.trim();
      }
    }
  } catch {
    // Fall through to plain-text extraction.
  }

  const firstTitle = lang === 'fr' ? 'SITUATION ACTUELLE' : 'CURRENT SITUATION';
  const titleIndex = cleaned.indexOf(firstTitle);
  const candidate = (titleIndex >= 0 ? cleaned.slice(titleIndex) : cleaned)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return candidate.length > 0 ? candidate : null;
}

function hasEnergyTension(energy: {
  ecowattSignal: string | null;
  nuclearShare: number;
  gasShare: number;
  hydroShare: number;
  windShare: number;
  solarShare: number;
  totalMw: number | null;
  oilStocksDays: number | null;
  oilVigilanceStatus: string | null;
  fuelTensionLevel: string | null;
  fuelTensionAnomalyShare: number | null;
  fuelPriceDelta7dCents: number | null;
  fuelPriceDelta30dCents: number | null;
} | null): boolean {
  if (!energy) return false;
  return (
    energy.ecowattSignal === 'orange'
    || energy.ecowattSignal === 'red'
    || energy.oilVigilanceStatus === 'tense'
    || energy.oilVigilanceStatus === 'critical'
    || energy.fuelTensionLevel === 'MEDIUM'
    || energy.fuelTensionLevel === 'HIGH'
    || energy.fuelTensionLevel === 'CRITICAL'
    || (energy.fuelTensionAnomalyShare ?? 0) >= 5
    || (energy.fuelPriceDelta7dCents ?? 0) >= 8
    || (energy.fuelPriceDelta30dCents ?? 0) >= 15
  );
}

function hasOperationalEnergyStress(energy: {
  ecowattSignal: string | null;
  nuclearShare: number;
  gasShare: number;
  hydroShare: number;
  windShare: number;
  solarShare: number;
  totalMw: number | null;
  oilStocksDays: number | null;
  oilVigilanceStatus: string | null;
  fuelTensionLevel: string | null;
  fuelTensionAnomalyShare: number | null;
  fuelPriceDelta7dCents: number | null;
  fuelPriceDelta30dCents: number | null;
} | null): boolean {
  if (!energy) return false;
  return (
    energy.ecowattSignal === 'red'
    || energy.oilVigilanceStatus === 'critical'
    || energy.fuelTensionLevel === 'HIGH'
    || energy.fuelTensionLevel === 'CRITICAL'
    || (energy.fuelTensionAnomalyShare ?? 0) >= 12
    || (energy.fuelPriceDelta7dCents ?? 0) >= 12
    || (energy.fuelPriceDelta30dCents ?? 0) >= 20
  );
}

function hasBackgroundEnergyPressure(energy: {
  ecowattSignal: string | null;
  nuclearShare: number;
  gasShare: number;
  hydroShare: number;
  windShare: number;
  solarShare: number;
  totalMw: number | null;
  oilStocksDays: number | null;
  oilVigilanceStatus: string | null;
  fuelTensionLevel: string | null;
  fuelTensionAnomalyShare: number | null;
  fuelPriceDelta7dCents: number | null;
  fuelPriceDelta30dCents: number | null;
} | null): boolean {
  return hasEnergyTension(energy) && !hasOperationalEnergyStress(energy);
}

function hasOperationalTransportStress(signalCounts: {
  criticalNews: number;
  highNews: number;
  weatherAlerts: number;
  floodAlerts: number;
  fireDetections: number;
  railDisruptions: number;
  roadIncidents: number;
  powerOutages: number;
  telecomOutages: number;
  cyberAlerts: number;
  militaryFlights: number;
  maritimeTrafficFrance: number;
  defenseAlerts: number;
  jammingSignals: number;
  marketStress: number;
}): boolean {
  return signalCounts.railDisruptions >= 8 || signalCounts.roadIncidents >= 25;
}

function hasBackgroundTransportPressure(signalCounts: {
  criticalNews: number;
  highNews: number;
  weatherAlerts: number;
  floodAlerts: number;
  fireDetections: number;
  railDisruptions: number;
  roadIncidents: number;
  powerOutages: number;
  telecomOutages: number;
  cyberAlerts: number;
  militaryFlights: number;
  maritimeTrafficFrance: number;
  defenseAlerts: number;
  jammingSignals: number;
  marketStress: number;
}): boolean {
  return !hasOperationalTransportStress(signalCounts)
    && (signalCounts.railDisruptions > 0 || signalCounts.roadIncidents > 0);
}

function dominantRiskLabel(
  axes: { continuity: number; defense: number; security: number; signal: number },
  signalCounts: {
    criticalNews: number;
    highNews: number;
    weatherAlerts: number;
    floodAlerts: number;
    fireDetections: number;
    railDisruptions: number;
    roadIncidents: number;
    powerOutages: number;
    telecomOutages: number;
    cyberAlerts: number;
    militaryFlights: number;
    maritimeTrafficFrance: number;
    defenseAlerts: number;
    jammingSignals: number;
    marketStress: number;
  },
  energy: {
    ecowattSignal: string | null;
    nuclearShare: number;
    gasShare: number;
    hydroShare: number;
    windShare: number;
    solarShare: number;
    totalMw: number | null;
    oilStocksDays: number | null;
    oilVigilanceStatus: string | null;
    fuelTensionLevel: string | null;
    fuelTensionAnomalyShare: number | null;
    fuelPriceDelta7dCents: number | null;
    fuelPriceDelta30dCents: number | null;
  } | null,
  lang: 'fr' | 'en',
): string {
  const candidates = [
    { key: 'energy', score: hasOperationalEnergyStress(energy) ? 85 : hasBackgroundEnergyPressure(energy) ? 35 : 0, fr: 'énergie et carburants', en: 'energy and fuel' },
    { key: 'transport', score: hasOperationalTransportStress(signalCounts) ? Math.min(100, signalCounts.railDisruptions * 5 + signalCounts.roadIncidents) : hasBackgroundTransportPressure(signalCounts) ? 18 : 0, fr: 'transport', en: 'transport' },
    { key: 'security', score: axes.security + (signalCounts.cyberAlerts > 0 ? 10 : 0), fr: 'sécurité', en: 'security' },
    { key: 'defense', score: signalCounts.defenseAlerts * 8 + signalCounts.jammingSignals * 10, fr: 'défense', en: 'defense' },
    { key: 'weather', score: signalCounts.weatherAlerts * 8 + signalCounts.floodAlerts * 8, fr: 'météo et crues', en: 'weather and floods' },
    { key: 'information', score: axes.signal + signalCounts.highNews * 2 + signalCounts.criticalNews * 4, fr: 'pression informationnelle', en: 'information pressure' },
  ].sort((a, b) => b.score - a.score);

  return lang === 'fr' ? candidates[0].fr : candidates[0].en;
}

function buildSituationSummary(
  signalCounts: {
    criticalNews: number;
    highNews: number;
    weatherAlerts: number;
    floodAlerts: number;
    fireDetections: number;
    railDisruptions: number;
    roadIncidents: number;
    powerOutages: number;
    telecomOutages: number;
    cyberAlerts: number;
    militaryFlights: number;
    maritimeTrafficFrance: number;
    defenseAlerts: number;
    jammingSignals: number;
    marketStress: number;
  },
  energy: {
    ecowattSignal: string | null;
    nuclearShare: number;
    gasShare: number;
    hydroShare: number;
    windShare: number;
    solarShare: number;
    totalMw: number | null;
    oilStocksDays: number | null;
    oilVigilanceStatus: string | null;
    fuelTensionLevel: string | null;
    fuelTensionAnomalyShare: number | null;
    fuelPriceDelta7dCents: number | null;
    fuelPriceDelta30dCents: number | null;
  } | null,
  lang: 'fr' | 'en',
): string {
  const lines: string[] = [];
  if (lang === 'fr') {
    if (signalCounts.weatherAlerts > 0 || signalCounts.floodAlerts > 0) {
      lines.push(`${signalCounts.weatherAlerts} alertes météo sévères + ${signalCounts.floodAlerts} alertes crues actives`);
    }
    if (hasOperationalTransportStress(signalCounts)) {
      lines.push(`${signalCounts.railDisruptions} perturbations ferroviaires SNCF, ${signalCounts.roadIncidents} incidents routiers`);
    } else if (hasBackgroundTransportPressure(signalCounts)) {
      lines.push(`mobilité sous bruit de fond: ${signalCounts.railDisruptions} perturbations ferroviaires, ${signalCounts.roadIncidents} incidents routiers`);
    }
    if (signalCounts.powerOutages > 0 || signalCounts.telecomOutages > 0) {
      lines.push(`${signalCounts.powerOutages} coupures électriques, ${signalCounts.telecomOutages} incidents télécom`);
    }
    if (signalCounts.defenseAlerts > 0 || signalCounts.jammingSignals > 0) {
      lines.push(`${signalCounts.defenseAlerts} alertes défense (câbles sous-marins), ${signalCounts.jammingSignals} signaux brouillage GPS`);
    }
    if (energy && hasOperationalEnergyStress(energy)) {
      const parts: string[] = [];
      if (energy.ecowattSignal === 'red') parts.push('Ecowatt rouge');
      if (energy.fuelTensionLevel && energy.fuelTensionLevel !== 'LOW') parts.push(`carburants ${energy.fuelTensionLevel}`);
      if (energy.oilVigilanceStatus && energy.oilVigilanceStatus !== 'normal') parts.push(`pétrole ${energy.oilVigilanceStatus}`);
      if ((energy.fuelPriceDelta7dCents ?? 0) >= 8) parts.push(`prix +${energy.fuelPriceDelta7dCents?.toFixed(1)} c/L sur 7j`);
      if (parts.length > 0) lines.push(`Tension énergie : ${parts.join(', ')}`);
    } else if (energy && hasBackgroundEnergyPressure(energy)) {
      lines.push('Énergie sous tension de fond sans rupture opérationnelle immédiate');
    }
    if (signalCounts.fireDetections > 0) {
      lines.push(`${signalCounts.fireDetections} détections de feux actifs`);
    }
    if (signalCounts.cyberAlerts > 0) {
      lines.push(`${signalCounts.cyberAlerts} alertes cyber CERT-FR (30j)`);
    }
    if (signalCounts.militaryFlights > 0) {
      lines.push(`${signalCounts.militaryFlights} vols militaires actifs`);
    }
  } else {
    if (signalCounts.weatherAlerts > 0 || signalCounts.floodAlerts > 0) {
      lines.push(`${signalCounts.weatherAlerts} severe weather alerts + ${signalCounts.floodAlerts} active flood alerts`);
    }
    if (hasOperationalTransportStress(signalCounts)) {
      lines.push(`${signalCounts.railDisruptions} SNCF rail disruptions, ${signalCounts.roadIncidents} road incidents`);
    } else if (hasBackgroundTransportPressure(signalCounts)) {
      lines.push(`mobility background friction: ${signalCounts.railDisruptions} rail disruptions, ${signalCounts.roadIncidents} road incidents`);
    }
    if (signalCounts.powerOutages > 0 || signalCounts.telecomOutages > 0) {
      lines.push(`${signalCounts.powerOutages} power outages, ${signalCounts.telecomOutages} telecom incidents`);
    }
    if (signalCounts.defenseAlerts > 0 || signalCounts.jammingSignals > 0) {
      lines.push(`${signalCounts.defenseAlerts} defense alerts (subsea cables), ${signalCounts.jammingSignals} GPS jamming signals`);
    }
    if (energy && hasOperationalEnergyStress(energy)) {
      const parts: string[] = [];
      if (energy.ecowattSignal === 'red') parts.push('Ecowatt red');
      if (energy.fuelTensionLevel && energy.fuelTensionLevel !== 'LOW') parts.push(`fuel tension ${energy.fuelTensionLevel}`);
      if (energy.oilVigilanceStatus && energy.oilVigilanceStatus !== 'normal') parts.push(`oil ${energy.oilVigilanceStatus}`);
      if ((energy.fuelPriceDelta7dCents ?? 0) >= 8) parts.push(`fuel prices +${energy.fuelPriceDelta7dCents?.toFixed(1)} c/L in 7d`);
      if (parts.length > 0) lines.push(`Energy tension: ${parts.join(', ')}`);
    } else if (energy && hasBackgroundEnergyPressure(energy)) {
      lines.push('Energy remains under background strain without immediate operational rupture.');
    }
    if (signalCounts.fireDetections > 0) {
      lines.push(`${signalCounts.fireDetections} active fire detections`);
    }
    if (signalCounts.cyberAlerts > 0) {
      lines.push(`${signalCounts.cyberAlerts} CERT-FR cyber alerts (30d)`);
    }
    if (signalCounts.militaryFlights > 0) {
      lines.push(`${signalCounts.militaryFlights} active military flights`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : (lang === 'fr' ? 'Aucune pression opérationnelle significative détectée.' : 'No significant operational pressure detected.');
}

function buildDeterministicBrief(
  lang: 'fr' | 'en',
  countryScore: number,
  axes: { continuity: number; defense: number; security: number; signal: number },
  signalCounts: {
    criticalNews: number;
    highNews: number;
    weatherAlerts: number;
    floodAlerts: number;
    fireDetections: number;
    railDisruptions: number;
    roadIncidents: number;
    powerOutages: number;
    telecomOutages: number;
    cyberAlerts: number;
    militaryFlights: number;
    maritimeTrafficFrance: number;
    defenseAlerts: number;
    jammingSignals: number;
    marketStress: number;
  },
  energy: {
    ecowattSignal: string | null;
    nuclearShare: number;
    gasShare: number;
    hydroShare: number;
    windShare: number;
    solarShare: number;
    totalMw: number | null;
    oilStocksDays: number | null;
    oilVigilanceStatus: string | null;
    fuelTensionLevel: string | null;
    fuelTensionAnomalyShare: number | null;
    fuelPriceDelta7dCents: number | null;
    fuelPriceDelta30dCents: number | null;
  } | null,
): string {
  const posture = describeStability(countryScore, lang);
  const dominantRisk = dominantRiskLabel(axes, signalCounts, energy, lang);
  const immediateShock = signalCounts.criticalNews > 0
    || signalCounts.weatherAlerts > 0
    || signalCounts.floodAlerts > 0
    || signalCounts.defenseAlerts > 0
    || signalCounts.jammingSignals > 0;
  const energyTension = hasEnergyTension(energy);
  const energyOperational = hasOperationalEnergyStress(energy);
  const transportActive = signalCounts.railDisruptions > 0 || signalCounts.roadIncidents > 0;
  const transportOperational = hasOperationalTransportStress(signalCounts);
  const securityActive = axes.security >= 50 || signalCounts.cyberAlerts > 0 || signalCounts.defenseAlerts > 0 || signalCounts.jammingSignals > 0;
  const weatherActive = signalCounts.weatherAlerts > 0 || signalCounts.floodAlerts > 0;

  const pressureLines: string[] = [];
  if (lang === 'fr') {
    if (energyOperational) {
      const energyDetails: string[] = [];
      if (energy?.ecowattSignal === 'red') energyDetails.push('Ecowatt rouge');
      if (energy?.fuelTensionLevel && energy.fuelTensionLevel !== 'LOW') {
        energyDetails.push(`carburants ${energy.fuelTensionLevel}${energy.fuelTensionAnomalyShare != null ? `, ${energy.fuelTensionAnomalyShare.toFixed(1)}% anomalies` : ''}`);
      }
      if ((energy?.fuelPriceDelta7dCents ?? 0) >= 8) {
        energyDetails.push(`hausse carburants ${energy?.fuelPriceDelta7dCents?.toFixed(1)} c/L sur 7j`);
      }
      pressureLines.push(`L'énergie devient un sujet opérationnel${energyDetails.length > 0 ? ` : ${energyDetails.join(', ')}` : ''}.`);
    } else if (energyTension) {
      pressureLines.push('L\'énergie reste sous tension de fond, sans rupture immédiate de continuité.');
    }
    if (transportOperational) {
      pressureLines.push(`${signalCounts.railDisruptions} perturbations ferroviaires et ${signalCounts.roadIncidents} incidents routiers dépassent le bruit habituel de mobilité.`);
    } else if (transportActive) {
      pressureLines.push('Les perturbations transport relèvent surtout du bruit de fond du réseau et restent à confirmer avant d\'en faire une tension nationale.');
    }
    if (securityActive) {
      const details: string[] = [];
      if (signalCounts.cyberAlerts > 0) details.push(`${signalCounts.cyberAlerts} alertes cyber`);
      if (signalCounts.defenseAlerts > 0) details.push(`${signalCounts.defenseAlerts} alertes défense`);
      if (signalCounts.jammingSignals > 0) details.push(`${signalCounts.jammingSignals} signaux brouillage`);
      pressureLines.push(`Pression sécuritaire active${details.length > 0 ? ` : ${details.join(', ')}` : ''}.`);
    }
    if (weatherActive) {
      pressureLines.push(`${signalCounts.weatherAlerts} alertes météo sévères et ${signalCounts.floodAlerts} alertes crues en cours.`);
    }
    if (pressureLines.length === 0) {
      pressureLines.push('La pression reste diffuse, sans point de convergence dominant.');
    }

    return [
      'SITUATION ACTUELLE',
      `La France se situe dans une posture ${posture} avec une pression dominante centrée sur ${dominantRisk}.`,
      immediateShock
        ? 'Les signaux opérationnels indiquent une tension active et non une situation normalisée.'
        : 'Pas de choc immédiat majeur, mais la pression de fond reste mesurable.',
      'POINTS DE PRESSION',
      ...pressureLines,
      'ANALYSE',
      `La lecture nationale doit être ${posture} : les marges de résilience sont ${countryScore >= 80 ? 'préservées' : countryScore >= 65 ? 'réduites' : 'sensiblement entamées'}.`,
      securityActive
        ? 'La continuité de l\'État est maintenue mais les capacités sécuritaires sont sollicitées.'
        : 'La continuité de l\'État est maintenue, les indicateurs de fond restent à surveiller.',
      'À SURVEILLER (6H)',
      `Surveiller en priorité le domaine ${dominantRisk} pour détecter toute escalade opérationnelle.`,
      energyOperational
        ? 'Suivre la part d\'anomalies carburants et la dérive des prix à 7 jours.'
        : transportOperational
          ? 'Observer si les perturbations transport restent localisées ou se propagent.'
          : 'Observer la convergence éventuelle des signaux faibles vers un schéma d\'instabilité.',
    ].join('\n');
  }

  if (energyOperational) {
    const energyDetails: string[] = [];
    if (energy?.ecowattSignal === 'red') energyDetails.push('Ecowatt red');
    if (energy?.fuelTensionLevel && energy.fuelTensionLevel !== 'LOW') {
      energyDetails.push(`fuel tension ${energy.fuelTensionLevel}${energy.fuelTensionAnomalyShare != null ? `, ${energy.fuelTensionAnomalyShare.toFixed(1)}% anomalies` : ''}`);
    }
    if ((energy?.fuelPriceDelta7dCents ?? 0) >= 8) {
      energyDetails.push(`fuel prices +${energy?.fuelPriceDelta7dCents?.toFixed(1)} c/L over 7d`);
    }
    pressureLines.push(`Energy has become an operational issue${energyDetails.length > 0 ? `: ${energyDetails.join(', ')}` : ''}.`);
  } else if (energyTension) {
    pressureLines.push('Energy remains under background strain without immediate continuity rupture.');
  }
  if (transportOperational) {
    pressureLines.push(`${signalCounts.railDisruptions} rail disruptions and ${signalCounts.roadIncidents} road incidents exceed routine mobility noise.`);
  } else if (transportActive) {
    pressureLines.push('Transport disruptions currently resemble background network friction more than a national pressure point.');
  }
  if (securityActive) {
    const details: string[] = [];
    if (signalCounts.cyberAlerts > 0) details.push(`${signalCounts.cyberAlerts} cyber alerts`);
    if (signalCounts.defenseAlerts > 0) details.push(`${signalCounts.defenseAlerts} defense alerts`);
    if (signalCounts.jammingSignals > 0) details.push(`${signalCounts.jammingSignals} jamming signals`);
    pressureLines.push(`Security pressure active${details.length > 0 ? `: ${details.join(', ')}` : ''}.`);
  }
  if (weatherActive) {
    pressureLines.push(`${signalCounts.weatherAlerts} severe weather alerts and ${signalCounts.floodAlerts} flood alerts active.`);
  }
  if (pressureLines.length === 0) {
    pressureLines.push('Pressure remains diffuse with no dominant convergence point.');
  }

  return [
    'CURRENT SITUATION',
    `France is in a ${posture} posture with the main pressure centered on ${dominantRisk}.`,
    immediateShock
      ? 'Operational signals indicate active stress rather than a normalized situation.'
      : 'No major immediate shock, but background pressure remains measurable.',
    'PRESSURE POINTS',
    ...pressureLines,
    'ANALYSIS',
    `The national reading should be ${posture}: resilience margins are ${countryScore >= 80 ? 'preserved' : countryScore >= 65 ? 'reduced' : 'significantly eroded'}.`,
    securityActive
      ? 'State continuity is maintained but security capabilities are under solicitation.'
      : 'State continuity is maintained, background indicators warrant continued monitoring.',
    'NEXT 6 HOURS TO WATCH',
    `Watch the ${dominantRisk} domain as priority for any operational escalation.`,
    energyOperational
      ? 'Track fuel anomaly share and short-term fuel price acceleration.'
      : transportOperational
        ? 'Track whether transport disruptions stay localized or begin to propagate.'
        : 'Watch for potential convergence of weak signals into a broader instability pattern.',
  ].join('\n');
}

function isBriefCoherent(
  brief: string | null,
  lang: 'fr' | 'en',
  countryScore: number,
  axes: { continuity: number; defense: number; security: number; signal: number },
  signalCounts: {
    criticalNews: number;
    highNews: number;
    weatherAlerts: number;
    floodAlerts: number;
    fireDetections: number;
    railDisruptions: number;
    roadIncidents: number;
    powerOutages: number;
    telecomOutages: number;
    cyberAlerts: number;
    militaryFlights: number;
    maritimeTrafficFrance: number;
    defenseAlerts: number;
    jammingSignals: number;
    marketStress: number;
  },
  energy: {
    ecowattSignal: string | null;
    nuclearShare: number;
    gasShare: number;
    hydroShare: number;
    windShare: number;
    solarShare: number;
    totalMw: number | null;
    oilStocksDays: number | null;
    oilVigilanceStatus: string | null;
    fuelTensionLevel: string | null;
    fuelTensionAnomalyShare: number | null;
    fuelPriceDelta7dCents: number | null;
    fuelPriceDelta30dCents: number | null;
  } | null,
): boolean {
  if (!brief || brief.trim().length < 40) return false;
  const text = brief.toLowerCase();

  // Accept if at least 3 out of 4 expected sections are present (relaxed from 4/4)
  const titlesV11 = lang === 'fr'
    ? ['situation actuelle', 'points de pression', 'analyse', 'surveiller']
    : ['current situation', 'pressure points', 'analysis', 'to watch'];
  const titlesV10 = lang === 'fr'
    ? ['situation actuelle', 'points de vigilance', 'ce que cela implique', 'surveiller']
    : ['current situation', 'pressure points', 'what this means', 'to watch'];
  const matchCount = Math.max(
    titlesV11.filter((t) => text.includes(t)).length,
    titlesV10.filter((t) => text.includes(t)).length,
  );
  if (matchCount < 3) return false;

  // Reject calm/stable wording when score indicates tension
  const calmWords = lang === 'fr'
    ? /(période de stabilité|période de calme|situation stable|situation normalisée|sous contrôle|pas menacée|fonctionnent normalement)/i
    : /(stable period|calm period|situation is stable|normalized situation|under control|not threatened|operating normally)/i;
  if ((countryScore < 80 || Math.max(axes.continuity, axes.defense, axes.security, axes.signal) >= 35) && calmWords.test(brief)) {
    return false;
  }

  // Reject if critical score but brief says "low"
  if (countryScore < 50 && /(faible|low)/i.test(brief) && !/(critique|critical|dégrad|degraded|sous tension|under pressure|pression)/i.test(brief)) {
    return false;
  }

  // Energy tension must be mentioned (with broader synonym matching)
  if (hasEnergyTension(energy) && !/(énergie|carburant|pétrol|fuel|energy|ecowatt|électri)/i.test(brief)) {
    return false;
  }

  // Transport must be mentioned if active (broader synonym matching)
  if ((signalCounts.railDisruptions > 0 || signalCounts.roadIncidents > 0)
    && !/(rail|ferrovia|rout|transport|sncf|train|mobilité|mobility|traffic)/i.test(brief)) {
    return false;
  }

  return true;
}

function buildPrompt(
  countryScore: number,
  axes: { continuity: number; defense: number; security: number; signal: number },
  _isnrComponents: { social: number; security: number; infra: number },
  cyberScore: number,
  meteoAlertCount: number,
  headlines: string[],
  signalCounts: {
    criticalNews: number;
    highNews: number;
    weatherAlerts: number;
    floodAlerts: number;
    fireDetections: number;
    railDisruptions: number;
    roadIncidents: number;
    powerOutages: number;
    telecomOutages: number;
    cyberAlerts: number;
    militaryFlights: number;
    maritimeTrafficFrance: number;
    defenseAlerts: number;
    jammingSignals: number;
    marketStress: number;
  },
  energy: {
    ecowattSignal: string | null;
    nuclearShare: number;
    gasShare: number;
    hydroShare: number;
    windShare: number;
    solarShare: number;
    totalMw: number | null;
    oilStocksDays: number | null;
    oilVigilanceStatus: string | null;
    fuelTensionLevel: string | null;
    fuelTensionAnomalyShare: number | null;
    fuelPriceDelta7dCents: number | null;
    fuelPriceDelta30dCents: number | null;
  } | null,
  lang: 'fr' | 'en',
): string {
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : lang === 'fr' ? '(aucune actualité significative)' : '(no significant news)';
  const stabilityLabel = describeStability(countryScore, lang);
  const cyberLabel = describeCyber(cyberScore, lang);
  const maxAxis = Math.max(axes.continuity, axes.defense, axes.security, axes.signal);
  const immediateSignalsLow = hasLowImmediateSignals(signalCounts);
  const calmAllowedText = countryScore >= 88 && maxAxis < 20 && immediateSignalsLow
    ? (lang === 'fr' ? 'autorisé' : 'allowed')
    : (lang === 'fr' ? 'interdit' : 'forbidden');

  const situationSummary = buildSituationSummary(signalCounts, energy, lang);

  const energyBlock = energy
    ? lang === 'fr'
      ? `Énergie — Ecowatt ${energy.ecowattSignal ?? 'n/a'}, mix nucléaire ${energy.nuclearShare}% / gaz ${energy.gasShare}% / hydro ${energy.hydroShare}% / éolien ${energy.windShare}% / solaire ${energy.solarShare}%, production ${energy.totalMw ?? 'n.d.'} MW, stocks pétroliers ${energy.oilStocksDays != null ? `${energy.oilStocksDays}j` : 'n.d.'} (${energy.oilVigilanceStatus ?? 'n.d.'}), carburants ${energy.fuelTensionLevel ?? 'n.d.'}${energy.fuelTensionAnomalyShare != null ? ` (${energy.fuelTensionAnomalyShare.toFixed(1)}% anomalies)` : ''}${energy.fuelPriceDelta7dCents != null ? `, delta 7j ${energy.fuelPriceDelta7dCents >= 0 ? '+' : ''}${energy.fuelPriceDelta7dCents.toFixed(1)} c/L` : ''}${energy.fuelPriceDelta30dCents != null ? `, delta 30j ${energy.fuelPriceDelta30dCents >= 0 ? '+' : ''}${energy.fuelPriceDelta30dCents.toFixed(1)} c/L` : ''}`
      : `Energy — Ecowatt ${energy.ecowattSignal ?? 'n/a'}, mix nuclear ${energy.nuclearShare}% / gas ${energy.gasShare}% / hydro ${energy.hydroShare}% / wind ${energy.windShare}% / solar ${energy.solarShare}%, production ${energy.totalMw ?? 'n/a'} MW, oil stocks ${energy.oilStocksDays != null ? `${energy.oilStocksDays}d` : 'n/a'} (${energy.oilVigilanceStatus ?? 'n/a'}), fuel ${energy.fuelTensionLevel ?? 'n/a'}${energy.fuelTensionAnomalyShare != null ? ` (${energy.fuelTensionAnomalyShare.toFixed(1)}% anomalies)` : ''}${energy.fuelPriceDelta7dCents != null ? `, 7d delta ${energy.fuelPriceDelta7dCents >= 0 ? '+' : ''}${energy.fuelPriceDelta7dCents.toFixed(1)} c/L` : ''}${energy.fuelPriceDelta30dCents != null ? `, 30d delta ${energy.fuelPriceDelta30dCents >= 0 ? '+' : ''}${energy.fuelPriceDelta30dCents.toFixed(1)} c/L` : ''}`
    : '';

  if (lang === 'en') {
    return `[SYSTEM]
You are a senior OSINT intelligence analyst producing a national situational brief for France. Your output must read like a classified daily brief: factual, precise, no filler. Each sentence must carry operational value.

[DATA]
Posture: ${stabilityLabel} | Axes: continuity=${axes.continuity} defense=${axes.defense} security=${axes.security} signal=${axes.signal} (0–100, higher=more pressure)
Cyber pressure: ${cyberLabel} (score ${cyberScore}/100)
Active severe weather alerts: ${meteoAlertCount}
${energyBlock ? energyBlock : 'Energy: no data'}

Operational signals:
- Headlines: ${signalCounts.criticalNews} critical, ${signalCounts.highNews} high-severity
- Transport: ${signalCounts.railDisruptions} rail disruptions, ${signalCounts.roadIncidents} road incidents
- Infrastructure: ${signalCounts.powerOutages} power outages, ${signalCounts.telecomOutages} telecom outages
- Defense: ${signalCounts.defenseAlerts} cable alerts, ${signalCounts.jammingSignals} GPS jamming, ${signalCounts.militaryFlights} military flights
- Maritime: ${signalCounts.maritimeTrafficFrance} ships in French waters
- Fires: ${signalCounts.fireDetections} active detections
- Markets: ${signalCounts.marketStress} stressed lines

Situation summary:
${situationSummary}

Recent headlines (with severity and category):
${headlineList}

[INSTRUCTIONS]
1. Write exactly 4 sections: CURRENT SITUATION / PRESSURE POINTS / ANALYSIS / NEXT 6 HOURS TO WATCH
2. Each section: 2-4 short factual lines. Total 10-16 lines, under 280 words.
3. CURRENT SITUATION: synthesize the overall posture in 2-3 sentences. Name the dominant pressure domain.
4. PRESSURE POINTS: identify concrete convergences between signals. Cite specific signal types (rail, cyber, fuel, defense) — do not stay generic.
5. ANALYSIS: what national capabilities are under strain. Mention resilience margins honestly.
6. NEXT 6 HOURS TO WATCH: name specific indicators to monitor. Be precise (e.g. "fuel anomaly share" not "energy situation").
7. Calm/stability wording is ${calmAllowedText}. If forbidden, never use "stable", "calm", "normal", "under control".
8. Never quote numeric scores, indices, or /100 values.
9. Never invent facts, actors, locations not present in the data.
10. Treat routine rail disruptions and ordinary Ecowatt variability as background unless counts are unusually high or fuel stress is clearly worsening.
11. Escalate energy only when fuel tension is material: red oil vigilance, high/critical fuel tension, large anomaly share, or sharp short-term fuel price increase.
12. If energy shows tension, explain whether it is background or operational.
13. Prefer the strongest concrete signals. Every sentence must carry information — no generic filler.
14. Do not prefix lines with bullets, dashes, or asterisks.

Respond with valid JSON only: {"brief": "..."}`;
  }

  return `[SYSTEM]
Tu es un analyste OSINT senior produisant un brief situationnel national pour la France. Chaque phrase doit porter une valeur opérationnelle. Ton de note classifiée : factuel, précis, aucun remplissage.

[DONNÉES]
Posture : ${stabilityLabel} | Axes : continuité=${axes.continuity} défense=${axes.defense} sécurité=${axes.security} signal=${axes.signal} (0–100, plus haut = plus de pression)
Pression cyber : ${cyberLabel} (score ${cyberScore}/100)
Alertes météo sévères actives : ${meteoAlertCount}
${energyBlock ? energyBlock : 'Énergie : pas de données'}

Signaux opérationnels :
- Titres : ${signalCounts.criticalNews} critiques, ${signalCounts.highNews} à gravité élevée
- Transport : ${signalCounts.railDisruptions} perturbations SNCF, ${signalCounts.roadIncidents} incidents routiers
- Infrastructure : ${signalCounts.powerOutages} coupures électriques, ${signalCounts.telecomOutages} incidents télécom
- Défense : ${signalCounts.defenseAlerts} alertes câbles, ${signalCounts.jammingSignals} brouillages GPS, ${signalCounts.militaryFlights} vols militaires
- Maritime : ${signalCounts.maritimeTrafficFrance} navires en zone FR
- Feux : ${signalCounts.fireDetections} détections actives
- Marchés : ${signalCounts.marketStress} lignes sous tension

Résumé situationnel :
${situationSummary}

Actualités récentes (avec sévérité et catégorie) :
${headlineList}

[CONSIGNES]
1. Rédige exactement 4 sections : SITUATION ACTUELLE / POINTS DE PRESSION / ANALYSE / À SURVEILLER (6H)
2. Chaque section : 2-4 lignes courtes et factuelles. Total 10-16 lignes, moins de 280 mots.
3. SITUATION ACTUELLE : synthétise la posture globale en 2-3 phrases. Nomme le domaine de pression dominant.
4. POINTS DE PRESSION : identifie les convergences concrètes entre signaux. Cite les types de signaux précis (ferroviaire, cyber, carburants, défense) — ne reste pas générique.
5. ANALYSE : quelles capacités nationales sont sous tension. Mentionne honnêtement les marges de résilience.
6. À SURVEILLER (6H) : nomme des indicateurs précis à suivre. Sois spécifique (ex: "part anomalies carburants" pas "situation énergétique").
7. Vocabulaire stable/calme : ${calmAllowedText}. Si interdit, n'écris jamais "stable", "calme", "normal", "sous contrôle".
8. Ne cite jamais de scores numériques, d'indices ou de valeurs /100.
9. N'invente aucun fait, acteur ou lieu absent des données.
10. Considère les perturbations ferroviaires courantes et la variabilité ordinaire d'Ecowatt comme du bruit de fond, sauf si les volumes deviennent anormalement élevés ou si la tension carburants se dégrade nettement.
11. Fais émerger l'énergie comme problème seulement si la tension carburants/pétrole est matérielle : vigilance pétrole rouge/critique, carburants HIGH/CRITICAL, part d'anomalies élevée, ou hausse courte des prix.
12. Si l'énergie montre une tension, précise s'il s'agit d'un bruit de fond ou d'un problème opérationnel.
13. Privilégie les signaux concrets les plus forts. Chaque phrase doit porter de l'information — aucune phrase générique.
14. N'ajoute jamais de préfixe ":" "-" "•" ou "*" devant les phrases.

Réponds en JSON valide uniquement : {"brief": "..."}`;
}

interface FranceIntelProxyPluginOptions {
  groqApiKey?: string;
}

export function franceIntelProxyPlugin(options: FranceIntelProxyPluginOptions = {}): Plugin {
  return {
    name: 'france-intel-proxy',
    configureServer(server) {
      server.middlewares.use('/api/intelligence/v1/france-intel-brief', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');

          try {
            // Strip ASCII + C1 Unicode control characters — RSS titles can
            // contain literal control chars (U+0000–U+001F, U+007F, U+0080–U+009F)
            // that make JSON.parse throw
            const cleanBody = body.replace(/[\u0000-\u001F\u007F\u0080-\u009F]/gu, ' ');
            const parsed = JSON.parse(cleanBody) as {
              lang?: unknown;
              countryScore?: unknown;
              axes?: { continuity?: unknown; defense?: unknown; security?: unknown; signal?: unknown };
              isnrScore?: unknown;
              cyberScore?: unknown;
              meteoAlertCount?: unknown;
              isnrComponents?: { social?: unknown; security?: unknown; infra?: unknown };
              topHeadlines?: unknown;
              signalCounts?: {
                criticalNews?: unknown;
                highNews?: unknown;
                weatherAlerts?: unknown;
                floodAlerts?: unknown;
                fireDetections?: unknown;
                railDisruptions?: unknown;
                roadIncidents?: unknown;
                powerOutages?: unknown;
                telecomOutages?: unknown;
                cyberAlerts?: unknown;
                militaryFlights?: unknown;
                maritimeTrafficFrance?: unknown;
                defenseAlerts?: unknown;
                jammingSignals?: unknown;
                marketStress?: unknown;
              };
              energy?: {
                ecowattSignal?: unknown;
                nuclearShare?: unknown;
                gasShare?: unknown;
                hydroShare?: unknown;
                windShare?: unknown;
                solarShare?: unknown;
                totalMw?: unknown;
                oilStocksDays?: unknown;
                oilVigilanceStatus?: unknown;
                fuelTensionLevel?: unknown;
                fuelTensionAnomalyShare?: unknown;
                fuelPriceDelta7dCents?: unknown;
                fuelPriceDelta30dCents?: unknown;
              } | null;
            };

            const lang: 'fr' | 'en'   = parsed.lang === 'en' ? 'en' : 'fr';
            const countryScore         = typeof parsed.countryScore === 'number'
              ? Math.round(parsed.countryScore)
              : typeof parsed.isnrScore === 'number'
                ? Math.round(parsed.isnrScore)
                : 0;
            const axes = {
              continuity: typeof parsed.axes?.continuity === 'number' ? Math.round(parsed.axes.continuity) : 0,
              defense: typeof parsed.axes?.defense === 'number' ? Math.round(parsed.axes.defense) : 0,
              security: typeof parsed.axes?.security === 'number' ? Math.round(parsed.axes.security) : 0,
              signal: typeof parsed.axes?.signal === 'number' ? Math.round(parsed.axes.signal) : 0,
            };
            const cyberScore           = typeof parsed.cyberScore === 'number' ? Math.round(parsed.cyberScore) : 0;
            const meteoAlertCount      = typeof parsed.meteoAlertCount === 'number' ? parsed.meteoAlertCount : 0;
            const isnrComponents = {
              social:   typeof parsed.isnrComponents?.social   === 'number' ? Math.round(parsed.isnrComponents.social)   : 0,
              security: typeof parsed.isnrComponents?.security === 'number' ? Math.round(parsed.isnrComponents.security) : 0,
              infra:    typeof parsed.isnrComponents?.infra    === 'number' ? Math.round(parsed.isnrComponents.infra)    : 0,
            };
            const headlines = sanitizeHeadlines(parsed.topHeadlines);
            const signalCounts = {
              criticalNews: typeof parsed.signalCounts?.criticalNews === 'number' ? Math.round(parsed.signalCounts.criticalNews) : 0,
              highNews: typeof parsed.signalCounts?.highNews === 'number' ? Math.round(parsed.signalCounts.highNews) : 0,
              weatherAlerts: typeof parsed.signalCounts?.weatherAlerts === 'number' ? Math.round(parsed.signalCounts.weatherAlerts) : 0,
              floodAlerts: typeof parsed.signalCounts?.floodAlerts === 'number' ? Math.round(parsed.signalCounts.floodAlerts) : 0,
              fireDetections: typeof parsed.signalCounts?.fireDetections === 'number' ? Math.round(parsed.signalCounts.fireDetections) : 0,
              railDisruptions: typeof parsed.signalCounts?.railDisruptions === 'number' ? Math.round(parsed.signalCounts.railDisruptions) : 0,
              roadIncidents: typeof parsed.signalCounts?.roadIncidents === 'number' ? Math.round(parsed.signalCounts.roadIncidents) : 0,
              powerOutages: typeof parsed.signalCounts?.powerOutages === 'number' ? Math.round(parsed.signalCounts.powerOutages) : 0,
              telecomOutages: typeof parsed.signalCounts?.telecomOutages === 'number' ? Math.round(parsed.signalCounts.telecomOutages) : 0,
              cyberAlerts: typeof parsed.signalCounts?.cyberAlerts === 'number' ? Math.round(parsed.signalCounts.cyberAlerts) : 0,
              militaryFlights: typeof parsed.signalCounts?.militaryFlights === 'number' ? Math.round(parsed.signalCounts.militaryFlights) : 0,
              maritimeTrafficFrance: typeof parsed.signalCounts?.maritimeTrafficFrance === 'number' ? Math.round(parsed.signalCounts.maritimeTrafficFrance) : 0,
              defenseAlerts: typeof parsed.signalCounts?.defenseAlerts === 'number' ? Math.round(parsed.signalCounts.defenseAlerts) : 0,
              jammingSignals: typeof parsed.signalCounts?.jammingSignals === 'number' ? Math.round(parsed.signalCounts.jammingSignals) : 0,
              marketStress: typeof parsed.signalCounts?.marketStress === 'number' ? Math.round(parsed.signalCounts.marketStress) : 0,
            };
            const energy = parsed.energy ? {
              ecowattSignal: typeof parsed.energy.ecowattSignal === 'string' ? parsed.energy.ecowattSignal : null,
              nuclearShare: typeof parsed.energy.nuclearShare === 'number' ? Math.round(parsed.energy.nuclearShare) : 0,
              gasShare: typeof parsed.energy.gasShare === 'number' ? Math.round(parsed.energy.gasShare) : 0,
              hydroShare: typeof parsed.energy.hydroShare === 'number' ? Math.round(parsed.energy.hydroShare) : 0,
              windShare: typeof parsed.energy.windShare === 'number' ? Math.round(parsed.energy.windShare) : 0,
              solarShare: typeof parsed.energy.solarShare === 'number' ? Math.round(parsed.energy.solarShare) : 0,
              totalMw: typeof parsed.energy.totalMw === 'number' ? Math.round(parsed.energy.totalMw) : null,
              oilStocksDays: typeof parsed.energy.oilStocksDays === 'number' ? Math.round(parsed.energy.oilStocksDays) : null,
              oilVigilanceStatus: typeof parsed.energy.oilVigilanceStatus === 'string' ? parsed.energy.oilVigilanceStatus : null,
              fuelTensionLevel: typeof parsed.energy.fuelTensionLevel === 'string' ? parsed.energy.fuelTensionLevel : null,
              fuelTensionAnomalyShare: typeof parsed.energy.fuelTensionAnomalyShare === 'number' ? parsed.energy.fuelTensionAnomalyShare : null,
              fuelPriceDelta7dCents: typeof parsed.energy.fuelPriceDelta7dCents === 'number' ? parsed.energy.fuelPriceDelta7dCents : null,
              fuelPriceDelta30dCents: typeof parsed.energy.fuelPriceDelta30dCents === 'number' ? parsed.energy.fuelPriceDelta30dCents : null,
            } : null;
            const cacheKey = buildCacheKey(
              lang,
              countryScore,
              axes,
              isnrComponents,
              cyberScore,
              meteoAlertCount,
              headlines,
              signalCounts,
              energy,
            );
            const cached = _devCache.get(cacheKey);
            if (cached && Date.now() < cached.expiresAt) {
              res.end(JSON.stringify({ ...JSON.parse(cached.value), fromCache: true }));
              return;
            }

            const GROQ_API_KEY = options.groqApiKey || process.env['GROQ_API_KEY'];
            if (!GROQ_API_KEY) {
              const result = {
                brief: buildDeterministicBrief(lang, countryScore, axes, signalCounts, energy),
                fromCache: false,
                computedAt: new Date().toISOString(),
              };
              _devCache.set(cacheKey, {
                value: JSON.stringify(result),
                expiresAt: Date.now() + CACHE_TTL,
              });
              res.end(JSON.stringify(result));
              return;
            }

            const groqRes = await fetch(GROQ_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${GROQ_API_KEY}`,
              },
              body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: buildPrompt(countryScore, axes, isnrComponents, cyberScore, meteoAlertCount, headlines, signalCounts, energy, lang) }],
                temperature: 0.3,
                max_tokens: 420,
              }),
              signal: AbortSignal.timeout(30_000),
            });

            if (!groqRes.ok) {
              const errText = await groqRes.text().catch(() => '');
              console.error(`[france-intel-proxy] Groq error ${groqRes.status}:`, errText.slice(0, 300));
              res.end(JSON.stringify({
                brief: buildDeterministicBrief(lang, countryScore, axes, signalCounts, energy),
                fromCache: false,
                computedAt: new Date().toISOString(),
              }));
              return;
            }

            const groqText = await groqRes.text();
            const groqClean = groqText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/gu, ' ');
            const groqData = JSON.parse(groqClean) as { choices: Array<{ message: { content: string } }> };
            const raw = groqData.choices?.[0]?.message?.content ?? '';
            const llmBrief = extractBriefText(raw, lang);
            const brief = isBriefCoherent(llmBrief, lang, countryScore, axes, signalCounts, energy)
              ? llmBrief
              : buildDeterministicBrief(lang, countryScore, axes, signalCounts, energy);

            const result = {
              brief,
              fromCache: false,
              computedAt: new Date().toISOString(),
            };

            if (result.brief && result.brief.trim().length > 0) {
              _devCache.set(cacheKey, {
                value: JSON.stringify(result),
                expiresAt: Date.now() + CACHE_TTL,
              });
            }
            res.end(JSON.stringify(result));
          } catch (err) {
            console.error('[france-intel-proxy] Error:', err instanceof Error ? err.message : err);
            console.error('[france-intel-proxy] Body (first 200):', body.slice(0, 200));
            res.end(JSON.stringify({
              brief: buildDeterministicBrief(
                'fr',
                0,
                { continuity: 0, defense: 0, security: 0, signal: 0 },
                {
                  criticalNews: 0,
                  highNews: 0,
                  weatherAlerts: 0,
                  floodAlerts: 0,
                  fireDetections: 0,
                  railDisruptions: 0,
                  roadIncidents: 0,
                  powerOutages: 0,
                  telecomOutages: 0,
                  cyberAlerts: 0,
                  militaryFlights: 0,
                  maritimeTrafficFrance: 0,
                  defenseAlerts: 0,
                  jammingSignals: 0,
                  marketStress: 0,
                },
                null,
              ),
              fromCache: false,
              computedAt: new Date().toISOString(),
            }));
          }
        });
      });
    },
  };
}
