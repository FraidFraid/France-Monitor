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
const BRIEF_PROMPT_VERSION = 'v13';

const _devCache = new Map<string, { value: string; expiresAt: number }>();

function describeStability(score: number, lang: 'fr' | 'en'): string {
  if (score >= 85) return 'stable';
  if (score >= 70) return lang === 'fr' ? 'en vigilance' : 'under watch';
  if (score >= 55) return lang === 'fr' ? 'sous tension' : 'under pressure';
  if (score >= 40) return lang === 'fr' ? 'dégradée' : 'degraded';
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
  situations: CompactSituationPayload[],
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
    situations,
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

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'watch'] as const;
type SituationSeverity = typeof VALID_SEVERITIES[number];

function isSituationSeverity(value: unknown): value is SituationSeverity {
  return typeof value === 'string' && (VALID_SEVERITIES as readonly string[]).includes(value);
}

/** Forme compacte d'une situation corrélée (miroir de CompactSituation cote client). */
interface CompactSituationPayload {
  type: string;
  severity: SituationSeverity;
  confidence: number;
  title: string;
  summary: string;
  drivers: string[];
  sourceRefs: string[];
  affectedZones: string[];
}

function sanitizeSituations(raw: unknown): CompactSituationPayload[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .slice(0, 5)
    .map((item): CompactSituationPayload => {
      const s = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      return {
        type: String(s.type ?? '').slice(0, 40),
        severity: isSituationSeverity(s.severity) ? s.severity : 'watch',
        confidence: typeof s.confidence === 'number' ? Math.max(0, Math.min(1, s.confidence)) : 0,
        title: String(s.title ?? '').replace(/[\r\n]+/g, ' ').slice(0, 120),
        summary: String(s.summary ?? '').replace(/[\r\n]+/g, ' ').slice(0, 240),
        drivers: Array.isArray(s.drivers)
          ? (s.drivers as unknown[]).slice(0, 5).map((d) => String(d).replace(/[\r\n]+/g, ' ').slice(0, 160))
          : [],
        sourceRefs: Array.isArray(s.sourceRefs)
          ? (s.sourceRefs as unknown[]).slice(0, 5).map((r) => String(r).slice(0, 60))
          : [],
        affectedZones: Array.isArray(s.affectedZones)
          ? (s.affectedZones as unknown[]).slice(0, 4).map((z) => String(z).slice(0, 60))
          : [],
      };
    })
    .filter((s) => s.title.length > 0);
}

interface BriefJudgmentPayload {
  priority: 1 | 2 | 3 | 4;
  text: string;
  confidence: 'high' | 'moderate' | 'low';
  sources: string[];
}

interface BriefWatchPayload {
  text: string;
  horizon: '6h' | '24h' | '48h';
}

// Validation structurelle de la sortie LLM — miroir dev de parseStructuredBrief (client / edge function).
function validateBriefShape(value: unknown): { bluf: string; judgments: unknown[]; watch: unknown[] } | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.bluf !== 'string' || v.bluf.trim().length < 20) return null;
  if (!Array.isArray(v.judgments) || v.judgments.length === 0) return null;

  const judgments: BriefJudgmentPayload[] = [];
  for (const item of (v.judgments as unknown[]).slice(0, 4)) {
    if (typeof item !== 'object' || item === null) return null;
    const j = item as Record<string, unknown>;
    const priority = j.priority === 1 || j.priority === 2 || j.priority === 3 || j.priority === 4 ? j.priority : null;
    const confidence = j.confidence === 'high' || j.confidence === 'moderate' || j.confidence === 'low' ? j.confidence : null;
    if (priority === null || confidence === null || typeof j.text !== 'string' || j.text.trim().length === 0) {
      return null;
    }
    const sources = Array.isArray(j.sources)
      ? (j.sources as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 5)
      : [];
    judgments.push({ priority, text: j.text.trim().slice(0, 280), confidence, sources });
  }
  judgments.sort((a, b) => a.priority - b.priority);

  const watch: BriefWatchPayload[] = [];
  if (Array.isArray(v.watch)) {
    for (const item of (v.watch as unknown[]).slice(0, 4)) {
      if (typeof item !== 'object' || item === null) continue;
      const w = item as Record<string, unknown>;
      if (typeof w.text !== 'string' || w.text.trim().length === 0) continue;
      const horizon = w.horizon === '6h' || w.horizon === '24h' || w.horizon === '48h' ? w.horizon : '24h';
      watch.push({ text: w.text.trim().slice(0, 280), horizon });
    }
  }

  return { bluf: v.bluf.trim().slice(0, 400), judgments, watch };
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

function formatSituationsBlock(situations: CompactSituationPayload[], lang: 'fr' | 'en'): string {
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
  situations: CompactSituationPayload[],
  lang: 'fr' | 'en',
): string {
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
              situations?: unknown;
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
            const situations = sanitizeSituations(parsed.situations);
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
            const cached = _devCache.get(cacheKey);
            if (cached && Date.now() < cached.expiresAt) {
              res.end(JSON.stringify({ ...JSON.parse(cached.value), fromCache: true }));
              return;
            }

            const GROQ_API_KEY = options.groqApiKey || process.env['GROQ_API_KEY'];
            if (!GROQ_API_KEY) {
              res.end(JSON.stringify({ brief: null, fromCache: false }));
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
                messages: [{ role: 'user', content: buildPrompt(countryScore, axes, isnrComponents, cyberScore, meteoAlertCount, headlines, signalCounts, energy, situations, lang) }],
                temperature: 0.3,
                max_tokens: 420,
                response_format: { type: 'json_object' },
              }),
              signal: AbortSignal.timeout(30_000),
            });

            if (!groqRes.ok) {
              const errText = await groqRes.text().catch(() => '');
              console.error(`[france-intel-proxy] Groq error ${groqRes.status}:`, errText.slice(0, 300));
              res.end(JSON.stringify({ brief: null, fromCache: false }));
              return;
            }

            const groqText = await groqRes.text();
            const groqClean = groqText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/gu, ' ');
            const groqData = JSON.parse(groqClean) as { choices: Array<{ message: { content: string } }> };
            const rawGroqContent = groqData.choices?.[0]?.message?.content ?? '';

            let brief: { bluf: string; judgments: unknown[]; watch: unknown[] } | null = null;
            try {
              const rawContent = String(rawGroqContent ?? '').replace(/```(?:json)?/gi, '').trim();
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
              _devCache.set(cacheKey, {
                value: JSON.stringify({ brief }),
                expiresAt: Date.now() + CACHE_TTL,
              });
            }
            res.end(JSON.stringify({ brief, fromCache: false }));
          } catch (err) {
            console.error('[france-intel-proxy] Error:', err instanceof Error ? err.message : err);
            console.error('[france-intel-proxy] Body (first 200):', body.slice(0, 200));
            res.end(JSON.stringify({ brief: null, fromCache: false }));
          }
        });
      });
    },
  };
}
