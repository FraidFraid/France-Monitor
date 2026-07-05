// api/intelligence/v1/france-intel-brief.js
// Vercel Edge Function — generates the national intelligence brief via Groq (contract v13).
// Input payload: { countryScore, axes, isnrComponents, cyberScore, meteoAlertCount,
//   topHeadlines, signalCounts, energy, situations, lang }, built from
// FranceBriefContext by france-intel-brief.ts (client).
// Response: { brief: StructuredBrief | null, fromCache: boolean } — brief is
// { bluf, judgments, watch } once validateBriefShape() has passed the LLM output
// through JSON parsing + structural validation, or null if the LLM call failed,
// returned malformed JSON, or GROQ_API_KEY is unset. There is no server-side
// fallback brief: a null brief here is handled client-side (deterministic synthesis).
export const config = { runtime: 'edge' };

import { redisGet, redisSet } from '../../utils/redis.js';

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const CACHE_TTL  = 6 * 60 * 60; // 6 hours
const BRIEF_PROMPT_VERSION = 'v13';

function describeStability(score, lang) {
  if (score >= 85) return 'stable';
  if (score >= 70) return lang === 'fr' ? 'en vigilance' : 'under watch';
  if (score >= 55) return lang === 'fr' ? 'sous tension' : 'under pressure';
  if (score >= 40) return lang === 'fr' ? 'dégradée' : 'degraded';
  return lang === 'fr' ? 'critique' : 'critical';
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

function buildCacheKey(lang, countryScore, axes, isnrComponents, cyberScore, meteoAlertCount, headlines, signalCounts, energy, situations) {
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
    situations,
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

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'watch'];

function sanitizeSituations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 5).map((s) => ({
    type: String(s?.type ?? '').slice(0, 40),
    severity: VALID_SEVERITIES.includes(s?.severity) ? s.severity : 'watch',
    confidence: typeof s?.confidence === 'number' ? Math.max(0, Math.min(1, s.confidence)) : 0,
    title: String(s?.title ?? '').replace(/[\r\n]+/g, ' ').slice(0, 120),
    summary: String(s?.summary ?? '').replace(/[\r\n]+/g, ' ').slice(0, 240),
    drivers: Array.isArray(s?.drivers)
      ? s.drivers.slice(0, 5).map((d) => String(d).replace(/[\r\n]+/g, ' ').slice(0, 160))
      : [],
    sourceRefs: Array.isArray(s?.sourceRefs)
      ? s.sourceRefs.slice(0, 5).map((r) => String(r).slice(0, 60))
      : [],
    affectedZones: Array.isArray(s?.affectedZones)
      ? s.affectedZones.slice(0, 4).map((z) => String(z).slice(0, 60))
      : [],
  })).filter((s) => s.title.length > 0);
}

// Validation structurelle de la sortie LLM — miroir serveur de parseStructuredBrief (client).
function validateBriefShape(value) {
  if (typeof value !== 'object' || value === null) return null;
  if (typeof value.bluf !== 'string' || value.bluf.trim().length < 20) return null;
  if (!Array.isArray(value.judgments) || value.judgments.length === 0) return null;
  const judgments = [];
  for (const j of value.judgments.slice(0, 4)) {
    if (typeof j !== 'object' || j === null) return null;
    if (![1, 2, 3, 4].includes(j.priority)) return null;
    if (!['high', 'moderate', 'low'].includes(j.confidence)) return null;
    if (typeof j.text !== 'string' || j.text.trim().length === 0) return null;
    judgments.push({
      priority: j.priority,
      text: j.text.trim().slice(0, 280),
      confidence: j.confidence,
      sources: Array.isArray(j.sources)
        ? j.sources.filter((s) => typeof s === 'string').slice(0, 5)
        : [],
    });
  }
  judgments.sort((a, b) => a.priority - b.priority);
  const watch = [];
  if (Array.isArray(value.watch)) {
    for (const w of value.watch.slice(0, 4)) {
      if (typeof w !== 'object' || w === null || typeof w.text !== 'string' || w.text.trim().length === 0) continue;
      watch.push({
        text: w.text.trim().slice(0, 280),
        horizon: ['6h', '24h', '48h'].includes(w.horizon) ? w.horizon : '24h',
      });
    }
  }
  return { bluf: value.bluf.trim().slice(0, 400), judgments, watch };
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

function formatSituationsBlock(situations, lang) {
  if (situations.length === 0) {
    return lang === 'fr'
      ? '(aucune situation corrélée détectée par le moteur)'
      : '(no correlated situation detected by the engine)';
  }
  return situations.map((s, i) => {
    const zones = s.affectedZones.length > 0 ? ` | zones: ${s.affectedZones.join(', ')}` : '';
    const drivers = s.drivers.length > 0 ? `\n   preuves: ${s.drivers.join(' ; ')}` : '';
    const sources = s.sourceRefs.length > 0 ? `\n   sources: ${s.sourceRefs.join(', ')}` : '';
    return `${i + 1}. [${s.severity.toUpperCase()} conf=${s.confidence}] ${s.title} — ${s.summary}${zones}${drivers}${sources}`;
  }).join('\n');
}

function buildPrompt(countryScore, axes, isnrComponents, cyberScore, meteoAlertCount, headlines, signalCounts, energy, situations, lang) {
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : lang === 'fr' ? '(aucune actualité significative)' : '(no significant news)';
  const stabilityLabel = describeStability(countryScore, lang);
  const cyberLabel = describeCyber(cyberScore, lang);
  const maxAxis = Math.max(axes.continuity, axes.defense, axes.security, axes.signal);
  const immediateSignalsLow = hasLowImmediateSignals(signalCounts);
  const calmAllowed = countryScore >= 88 && maxAxis < 20 && immediateSignalsLow && situations.length === 0;
  const situationSummary = buildSituationSummary(signalCounts, energy, lang);
  const situationsBlock = formatSituationsBlock(situations, lang);

  const schema = `{"bluf": "...", "judgments": [{"priority": 1, "text": "...", "confidence": "high|moderate|low", "sources": ["..."]}], "watch": [{"text": "...", "horizon": "6h|24h|48h"}]}`;

  if (lang === 'en') {
    return `[SYSTEM]
You are a senior OSINT analyst writing France's national intelligence brief. Output MUST be a single valid JSON object matching this exact schema, nothing else:
${schema}

[CORRELATED SITUATIONS — primary facts, established by a deterministic engine]
${situationsBlock}

[CONTEXT DATA]
Posture: ${stabilityLabel} | Pillars: continuity=${axes.continuity} defense=${axes.defense} security=${axes.security} signal=${axes.signal} (0–100, higher = more pressure)
Cyber pressure: ${cyberLabel} | Severe weather alerts: ${meteoAlertCount}
Signals: ${signalCounts.criticalNews} critical / ${signalCounts.highNews} high headlines, ${signalCounts.railDisruptions} rail, ${signalCounts.roadIncidents} road, ${signalCounts.powerOutages} power outages, ${signalCounts.telecomOutages} telecom, ${signalCounts.defenseAlerts} cable alerts, ${signalCounts.jammingSignals} GPS jamming, ${signalCounts.militaryFlights} military flights, ${signalCounts.fireDetections} fires, ${signalCounts.marketStress} stressed market lines
Situation summary:
${situationSummary}
Recent headlines:
${headlineList}

[RULES]
1. "bluf": 2-3 sentences, ≤ 400 chars. Overall assessment: posture, dominant pressure, whether pressures converge.
2. "judgments": 2-4 items. Base them PRIMARILY on the correlated situations above. priority 1 = most important. Each text ≤ 280 chars, must state something actionable or falsifiable — no filler.
3. "confidence": derive from the situation confidence values (≥0.75 high, ≥0.55 moderate, else low). Never exceed the engine's confidence.
4. "sources": only names present in the data above (e.g. "Ecowatt RTE", "CERT-FR"). Never invent sources.
5. "watch": 1-4 concrete indicators with a realistic horizon. Be specific ("Ecowatt D+1 signal at 17:00", not "energy situation").
6. Calm wording (stable/calm/normal/under control) is ${calmAllowed ? 'allowed' : 'FORBIDDEN'}.
7. Never quote numeric scores or /100 values. Never invent facts, actors or locations.
8. If no correlated situation exists, say so honestly in the bluf and focus judgments on the strongest background signals.`;
  }

  return `[SYSTEM]
Tu es un analyste OSINT senior rédigeant le brief national France. Ta sortie DOIT être un unique objet JSON valide conforme à ce schéma, rien d'autre :
${schema}

[SITUATIONS CORRÉLÉES — faits primaires, établis par un moteur déterministe]
${situationsBlock}

[DONNÉES DE CONTEXTE]
Posture : ${stabilityLabel} | Piliers : continuité=${axes.continuity} défense=${axes.defense} sécurité=${axes.security} signal=${axes.signal} (0–100, plus haut = plus de pression)
Pression cyber : ${cyberLabel} | Alertes météo sévères : ${meteoAlertCount}
Signaux : ${signalCounts.criticalNews} titres critiques / ${signalCounts.highNews} élevés, ${signalCounts.railDisruptions} rail, ${signalCounts.roadIncidents} route, ${signalCounts.powerOutages} coupures élec, ${signalCounts.telecomOutages} télécom, ${signalCounts.defenseAlerts} alertes câbles, ${signalCounts.jammingSignals} brouillages GPS, ${signalCounts.militaryFlights} vols militaires, ${signalCounts.fireDetections} feux, ${signalCounts.marketStress} lignes marché sous tension
Résumé situationnel :
${situationSummary}
Actualités récentes :
${headlineList}

[CONSIGNES]
1. "bluf" : 2-3 phrases, ≤ 400 caractères. Évaluation d'ensemble : posture, pression dominante, convergence ou non des pressions.
2. "judgments" : 2-4 éléments. Fonde-les EN PRIORITÉ sur les situations corrélées ci-dessus. priority 1 = le plus important. Chaque texte ≤ 280 caractères, doit affirmer quelque chose d'actionnable ou de falsifiable — aucun remplissage.
3. "confidence" : dérive-la des confiances du moteur (≥0.75 high, ≥0.55 moderate, sinon low). Ne dépasse jamais la confiance du moteur.
4. "sources" : uniquement des noms présents dans les données ci-dessus (ex. "Ecowatt RTE", "CERT-FR"). N'invente jamais de source.
5. "watch" : 1-4 indicateurs concrets avec un horizon réaliste. Sois spécifique (« signal Ecowatt J+1 à 17h », pas « situation énergétique »).
6. Vocabulaire calme (stable/calme/normal/sous contrôle) : ${calmAllowed ? 'autorisé' : 'INTERDIT'}.
7. Ne cite jamais de score numérique ni de valeur /100. N'invente aucun fait, acteur ou lieu.
8. S'il n'existe aucune situation corrélée, dis-le honnêtement dans le bluf et fonde les jugements sur les signaux de fond les plus forts.`;
}

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
  const situations = sanitizeSituations(body.situations);

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
    situations,
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
    return new Response(JSON.stringify({ brief: null, fromCache: false }), {
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
        messages: [{ role: 'user', content: buildPrompt(countryScore, axes, isnrComponents, cyberScore, meteoAlertCount, headlines, signalCounts, energy, situations, lang) }],
        temperature: 0.3,
        // 900 tokens : le schéma JSON v13 (bluf 400c + 4 jugements + 4 watch) peut
        // atteindre ~3000 caractères — 420 tronquait le JSON en plein objet.
        max_tokens: 900,
        response_format: { type: 'json_object' },
      }),
    });

    if (!groqRes.ok) {
      return new Response(JSON.stringify({ brief: null, fromCache: false }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const groqText = await groqRes.text();
    const groqClean = groqText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/gu, ' ');
    const groqData = JSON.parse(groqClean);
    const content = groqData.choices?.[0]?.message?.content ?? '';

    let brief = null;
    try {
      const rawContent = String(content ?? '').replace(/```(?:json)?/gi, '').trim();
      const start = rawContent.indexOf('{');
      const end = rawContent.lastIndexOf('}');
      if (start >= 0 && end > start) {
        brief = validateBriefShape(JSON.parse(rawContent.slice(start, end + 1)));
      }
    } catch {
      brief = null;
    }

    // Garde anti-« tout va bien » : si des situations existent, un bluf lénifiant est rejeté.
    if (brief && situations.length > 0) {
      const calmWords = lang === 'fr'
        ? /(situation stable|situation normalisée|sous contrôle|période de calme)/i
        : /(situation is stable|normalized situation|under control|calm period)/i;
      if (calmWords.test(brief.bluf)) brief = null;
    }

    if (brief) {
      await redisSet(cacheKey, JSON.stringify({ brief }), CACHE_TTL);
    }
    return new Response(JSON.stringify({ brief, fromCache: false }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[france-intel-brief]', err);
    return new Response(JSON.stringify({ brief: null, fromCache: false }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
