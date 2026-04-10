// api/intelligence/v1/france-intel-brief.js
// Vercel Edge Function — generates a national intelligence brief via Groq.
// Input payload (unchanged after client-side migration):
//   { countryScore, axes, isnrComponents, cyberScore, meteoAlertCount, topHeadlines,
//     signalCounts, energy, lang }
// Payload is now built from FranceBriefContext by france-intel-brief.ts (client).
// No changes required to parsing or prompt logic.
export const config = { runtime: 'edge' };

import { redisGet, redisSet } from '../../utils/redis.js';

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const CACHE_TTL  = 6 * 60 * 60; // 6 hours
const BRIEF_PROMPT_VERSION = 'v12';

function describeStability(score, lang) {
  if (score >= 80) return lang === 'fr' ? 'stable' : 'stable';
  if (score >= 65) return lang === 'fr' ? 'sous tension' : 'under pressure';
  if (score >= 50) return lang === 'fr' ? 'dégradée' : 'degraded';
  return lang === 'fr' ? 'critique' : 'critical';
}

function describeAxis(value, lang) {
  if (value >= 75) return lang === 'fr' ? 'très élevée' : 'very high';
  if (value >= 55) return lang === 'fr' ? 'élevée' : 'high';
  if (value >= 35) return lang === 'fr' ? 'modérée' : 'moderate';
  return lang === 'fr' ? 'faible' : 'low';
}

function describeCyber(score, lang) {
  if (score >= 75) return lang === 'fr' ? 'forte' : 'high';
  if (score >= 50) return lang === 'fr' ? 'soutenue' : 'elevated';
  if (score >= 25) return lang === 'fr' ? 'modérée' : 'moderate';
  return lang === 'fr' ? 'faible' : 'low';
}

function hashCacheSeed(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildCacheKey(lang, countryScore, axes, isnrComponents, cyberScore, meteoAlertCount, headlines, signalCounts, energy) {
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
  return `france-intel:brief:${lang}:${BRIEF_PROMPT_VERSION}:${hashCacheSeed(seed)}`;
}

function hasLowImmediateSignals(signalCounts) {
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

function sanitizeHeadlines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 6)
    .map(h => String(h).replace(/[\r\n]+/g, ' ').slice(0, 120));
}

function extractBriefText(raw, lang) {
  const cleaned = String(raw)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/gu, ' ')
    .replace(/```(?:json|text)?/gi, '')
    .trim();

  try {
    const jsonMatch = cleaned.match(/\{[\s\S]*"brief"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed?.brief === 'string' && parsed.brief.trim()) {
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

function hasEnergyTension(energy) {
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

function hasOperationalEnergyStress(energy) {
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

function hasBackgroundEnergyPressure(energy) {
  return hasEnergyTension(energy) && !hasOperationalEnergyStress(energy);
}

function hasOperationalTransportStress(signalCounts) {
  return signalCounts.railDisruptions >= 8 || signalCounts.roadIncidents >= 25;
}

function hasBackgroundTransportPressure(signalCounts) {
  return !hasOperationalTransportStress(signalCounts)
    && (signalCounts.railDisruptions > 0 || signalCounts.roadIncidents > 0);
}

function dominantRiskLabel(axes, signalCounts, energy, lang) {
  const candidates = [
    { score: hasOperationalEnergyStress(energy) ? 85 : hasBackgroundEnergyPressure(energy) ? 35 : 0, fr: 'énergie et carburants', en: 'energy and fuel' },
    { score: hasOperationalTransportStress(signalCounts) ? Math.min(100, signalCounts.railDisruptions * 5 + signalCounts.roadIncidents) : hasBackgroundTransportPressure(signalCounts) ? 18 : 0, fr: 'transport', en: 'transport' },
    { score: axes.security + (signalCounts.cyberAlerts > 0 ? 10 : 0), fr: 'sécurité', en: 'security' },
    { score: signalCounts.defenseAlerts * 8 + signalCounts.jammingSignals * 10, fr: 'défense', en: 'defense' },
    { score: signalCounts.weatherAlerts * 8 + signalCounts.floodAlerts * 8, fr: 'météo et crues', en: 'weather and floods' },
    { score: axes.signal + signalCounts.highNews * 2 + signalCounts.criticalNews * 4, fr: 'pression informationnelle', en: 'information pressure' },
  ].sort((a, b) => b.score - a.score);
  return lang === 'fr' ? candidates[0].fr : candidates[0].en;
}

function buildSituationSummary(signalCounts, energy, lang) {
  const lines = [];
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
      const parts = [];
      if (energy.ecowattSignal === 'red') parts.push('Ecowatt rouge');
      if (energy.fuelTensionLevel && energy.fuelTensionLevel !== 'LOW') parts.push(`carburants ${energy.fuelTensionLevel}`);
      if (energy.oilVigilanceStatus && energy.oilVigilanceStatus !== 'normal') parts.push(`pétrole ${energy.oilVigilanceStatus}`);
      if ((energy.fuelPriceDelta7dCents ?? 0) >= 8) parts.push(`prix +${energy.fuelPriceDelta7dCents?.toFixed(1)} c/L sur 7j`);
      if (parts.length > 0) lines.push(`Tension énergie : ${parts.join(', ')}`);
    } else if (energy && hasBackgroundEnergyPressure(energy)) {
      lines.push('Énergie sous tension de fond sans rupture opérationnelle immédiate');
    }
    if (signalCounts.fireDetections > 0) lines.push(`${signalCounts.fireDetections} détections de feux actifs`);
    if (signalCounts.cyberAlerts > 0) lines.push(`${signalCounts.cyberAlerts} alertes cyber CERT-FR (30j)`);
    if (signalCounts.militaryFlights > 0) lines.push(`${signalCounts.militaryFlights} vols militaires actifs`);
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
      const parts = [];
      if (energy.ecowattSignal === 'red') parts.push('Ecowatt red');
      if (energy.fuelTensionLevel && energy.fuelTensionLevel !== 'LOW') parts.push(`fuel tension ${energy.fuelTensionLevel}`);
      if (energy.oilVigilanceStatus && energy.oilVigilanceStatus !== 'normal') parts.push(`oil ${energy.oilVigilanceStatus}`);
      if ((energy.fuelPriceDelta7dCents ?? 0) >= 8) parts.push(`fuel prices +${energy.fuelPriceDelta7dCents?.toFixed(1)} c/L in 7d`);
      if (parts.length > 0) lines.push(`Energy tension: ${parts.join(', ')}`);
    } else if (energy && hasBackgroundEnergyPressure(energy)) {
      lines.push('Energy remains under background strain without immediate operational rupture.');
    }
    if (signalCounts.fireDetections > 0) lines.push(`${signalCounts.fireDetections} active fire detections`);
    if (signalCounts.cyberAlerts > 0) lines.push(`${signalCounts.cyberAlerts} CERT-FR cyber alerts (30d)`);
    if (signalCounts.militaryFlights > 0) lines.push(`${signalCounts.militaryFlights} active military flights`);
  }
  return lines.length > 0 ? lines.join('\n') : (lang === 'fr' ? 'Aucune pression opérationnelle significative détectée.' : 'No significant operational pressure detected.');
}

function buildDeterministicBrief(lang, countryScore, axes, signalCounts, energy) {
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

  const pressureLines = [];
  if (lang === 'fr') {
    if (energyOperational) {
      const energyDetails = [];
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
      const details = [];
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

  // English
  if (energyOperational) {
    const energyDetails = [];
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
    const details = [];
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

function isBriefCoherent(brief, lang, countryScore, axes, signalCounts, energy) {
  if (!brief || brief.trim().length < 40) return false;
  const text = brief.toLowerCase();

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

  const calmWords = lang === 'fr'
    ? /(période de stabilité|période de calme|situation stable|situation normalisée|sous contrôle|pas menacée|fonctionnent normalement)/i
    : /(stable period|calm period|situation is stable|normalized situation|under control|not threatened|operating normally)/i;
  if ((countryScore < 80 || Math.max(axes.continuity, axes.defense, axes.security, axes.signal) >= 35) && calmWords.test(brief)) {
    return false;
  }

  if (countryScore < 50 && /(faible|low)/i.test(brief) && !/(critique|critical|dégrad|degraded|sous tension|under pressure|pression)/i.test(brief)) {
    return false;
  }

  if (hasEnergyTension(energy) && !/(énergie|carburant|pétrol|fuel|energy|ecowatt|électri)/i.test(brief)) {
    return false;
  }

  if ((signalCounts.railDisruptions > 0 || signalCounts.roadIncidents > 0)
    && !/(rail|ferrovia|rout|transport|sncf|train|mobilité|mobility|traffic)/i.test(brief)) {
    return false;
  }

  return true;
}

function buildPrompt(countryScore, axes, isnrComponents, cyberScore, meteoAlertCount, headlines, signalCounts, energy, lang) {
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



const FALLBACK = { brief: null, fromCache: false };

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate & sanitize inputs
  const lang = body.lang === 'en' ? 'en' : 'fr';
  const countryScore = typeof body.countryScore === 'number'
    ? Math.round(body.countryScore)
    : typeof body.isnrScore === 'number'
      ? Math.round(body.isnrScore)
      : 0;
  const axes = {
    continuity: typeof body.axes?.continuity === 'number' ? Math.round(body.axes.continuity) : 0,
    defense: typeof body.axes?.defense === 'number' ? Math.round(body.axes.defense) : 0,
    security: typeof body.axes?.security === 'number' ? Math.round(body.axes.security) : 0,
    signal: typeof body.axes?.signal === 'number' ? Math.round(body.axes.signal) : 0,
  };
  const cyberScore = typeof body.cyberScore === 'number' ? Math.round(body.cyberScore) : 0;
  const meteoAlertCount = typeof body.meteoAlertCount === 'number' ? body.meteoAlertCount : 0;
  const isnrComponents = {
    social:   typeof body.isnrComponents?.social   === 'number' ? Math.round(body.isnrComponents.social)   : 0,
    security: typeof body.isnrComponents?.security === 'number' ? Math.round(body.isnrComponents.security) : 0,
    infra:    typeof body.isnrComponents?.infra    === 'number' ? Math.round(body.isnrComponents.infra)    : 0,
  };
  const headlines = sanitizeHeadlines(body.topHeadlines);
  const signalCounts = {
    criticalNews: typeof body.signalCounts?.criticalNews === 'number' ? Math.round(body.signalCounts.criticalNews) : 0,
    highNews: typeof body.signalCounts?.highNews === 'number' ? Math.round(body.signalCounts.highNews) : 0,
    weatherAlerts: typeof body.signalCounts?.weatherAlerts === 'number' ? Math.round(body.signalCounts.weatherAlerts) : 0,
    floodAlerts: typeof body.signalCounts?.floodAlerts === 'number' ? Math.round(body.signalCounts.floodAlerts) : 0,
    fireDetections: typeof body.signalCounts?.fireDetections === 'number' ? Math.round(body.signalCounts.fireDetections) : 0,
    railDisruptions: typeof body.signalCounts?.railDisruptions === 'number' ? Math.round(body.signalCounts.railDisruptions) : 0,
    roadIncidents: typeof body.signalCounts?.roadIncidents === 'number' ? Math.round(body.signalCounts.roadIncidents) : 0,
    powerOutages: typeof body.signalCounts?.powerOutages === 'number' ? Math.round(body.signalCounts.powerOutages) : 0,
    telecomOutages: typeof body.signalCounts?.telecomOutages === 'number' ? Math.round(body.signalCounts.telecomOutages) : 0,
    cyberAlerts: typeof body.signalCounts?.cyberAlerts === 'number' ? Math.round(body.signalCounts.cyberAlerts) : 0,
    militaryFlights: typeof body.signalCounts?.militaryFlights === 'number' ? Math.round(body.signalCounts.militaryFlights) : 0,
    maritimeTrafficFrance: typeof body.signalCounts?.maritimeTrafficFrance === 'number' ? Math.round(body.signalCounts.maritimeTrafficFrance) : 0,
    defenseAlerts: typeof body.signalCounts?.defenseAlerts === 'number' ? Math.round(body.signalCounts.defenseAlerts) : 0,
    jammingSignals: typeof body.signalCounts?.jammingSignals === 'number' ? Math.round(body.signalCounts.jammingSignals) : 0,
    marketStress: typeof body.signalCounts?.marketStress === 'number' ? Math.round(body.signalCounts.marketStress) : 0,
  };
  const energy = body.energy ? {
    ecowattSignal: typeof body.energy.ecowattSignal === 'string' ? body.energy.ecowattSignal : null,
    nuclearShare: typeof body.energy.nuclearShare === 'number' ? Math.round(body.energy.nuclearShare) : 0,
    gasShare: typeof body.energy.gasShare === 'number' ? Math.round(body.energy.gasShare) : 0,
    hydroShare: typeof body.energy.hydroShare === 'number' ? Math.round(body.energy.hydroShare) : 0,
    windShare: typeof body.energy.windShare === 'number' ? Math.round(body.energy.windShare) : 0,
    solarShare: typeof body.energy.solarShare === 'number' ? Math.round(body.energy.solarShare) : 0,
    totalMw: typeof body.energy.totalMw === 'number' ? Math.round(body.energy.totalMw) : null,
    oilStocksDays: typeof body.energy.oilStocksDays === 'number' ? Math.round(body.energy.oilStocksDays) : null,
    oilVigilanceStatus: typeof body.energy.oilVigilanceStatus === 'string' ? body.energy.oilVigilanceStatus : null,
    fuelTensionLevel: typeof body.energy.fuelTensionLevel === 'string' ? body.energy.fuelTensionLevel : null,
    fuelTensionAnomalyShare: typeof body.energy.fuelTensionAnomalyShare === 'number' ? body.energy.fuelTensionAnomalyShare : null,
    fuelPriceDelta7dCents: typeof body.energy.fuelPriceDelta7dCents === 'number' ? body.energy.fuelPriceDelta7dCents : null,
    fuelPriceDelta30dCents: typeof body.energy.fuelPriceDelta30dCents === 'number' ? body.energy.fuelPriceDelta30dCents : null,
  } : null;

  // Try Redis cache using the request context, so one bad or outdated response
  // does not mask newer national states for the whole TTL window.
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
  const cached = await redisGet(cacheKey);
  if (cached) {
    try {
      return new Response(JSON.stringify({ ...JSON.parse(cached), fromCache: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch { /* corrupted — fall through */ }
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return new Response(JSON.stringify({
      brief: buildDeterministicBrief(lang, countryScore, axes, signalCounts, energy),
      fromCache: false,
      computedAt: new Date().toISOString(),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'User-Agent': 'FranceMonitor/1.0',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: buildPrompt(countryScore, axes, isnrComponents, cyberScore, meteoAlertCount, headlines, signalCounts, energy, lang) }],
        temperature: 0.3,
        max_tokens: 420,
      }),
    });

    if (!groqRes.ok) {
      return new Response(JSON.stringify({
        brief: buildDeterministicBrief(lang, countryScore, axes, signalCounts, energy),
        fromCache: false,
        computedAt: new Date().toISOString(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const groqText = await groqRes.text();
    const groqClean = groqText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/gu, ' ');
    const groqData = JSON.parse(groqClean);
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
      await redisSet(cacheKey, JSON.stringify(result), CACHE_TTL);
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[france-intel-brief]', err);
    return new Response(JSON.stringify({
      brief: buildDeterministicBrief(lang, countryScore, axes, signalCounts, energy),
      fromCache: false,
      computedAt: new Date().toISOString(),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
