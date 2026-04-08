// api/intelligence/v1/france-intel-brief.js
export const config = { runtime: 'edge' };

import { redisGet, redisSet } from '../../utils/redis.js';

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const CACHE_TTL  = 900; // 15 minutes — global cache (not per-snapshot), acceptable at this TTL

function sanitizeHeadlines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 6)
    .map(h => String(h).replace(/[\r\n]+/g, ' ').slice(0, 120));
}

function buildPrompt(isnrScore, isnrComponents, cyberScore, meteoAlertCount, headlines, signalCounts, energy, lang) {
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : lang === 'fr' ? '(aucune actualité significative)' : '(no significant news)';
  const energyLine = energy
    ? lang === 'fr'
      ? `- Energie: signal Ecowatt ${energy.ecowattSignal ?? 'n/a'}, mix nucléaire ${energy.nuclearShare}%, gaz ${energy.gasShare}%, hydro ${energy.hydroShare}%, éolien ${energy.windShare}%, solaire ${energy.solarShare}%`
      : `- Energy: Ecowatt ${energy.ecowattSignal ?? 'n/a'}, mix nuclear ${energy.nuclearShare}%, gas ${energy.gasShare}%, hydro ${energy.hydroShare}%, wind ${energy.windShare}%, solar ${energy.solarShare}%`
    : '';

  if (lang === 'en') {
    return `You are a senior intelligence analyst specializing in France's national security and stability.

Current situation data:
- National Instability Index (CII): ${isnrScore}/100
- Social dimension (protests, strikes): ${isnrComponents.social}/100
- Security dimension (incidents, interventions): ${isnrComponents.security}/100
- Infrastructure dimension (weather, floods, outages): ${isnrComponents.infra}/100
- Cyber dimension (CERT-FR, ransomware, CVE): ${cyberScore}/100
- Active weather alerts: ${meteoAlertCount}
- Operational signals: ${signalCounts.criticalNews} critical headlines, ${signalCounts.cyberAlerts} cyber alerts, ${signalCounts.railDisruptions} rail disruptions, ${signalCounts.roadIncidents} road incidents, ${signalCounts.powerOutages} power outages, ${signalCounts.telecomOutages} telecom outages, ${signalCounts.defenseAlerts} defense alerts
${energyLine}

Recent significant headlines:
${headlineList}

Write a concise national brief in two short sections and under 140 words total:
1. SITUATION NOW
2. WHAT THIS MEANS FOR FRANCE

Use only the provided inputs. If signals are low, say the posture is calm. Do not invent actors, motives, or foreign topics not present in the inputs. Be factual and restrained.

Respond with valid JSON only: {"brief": "..."}`;
  }

  return `Tu es un analyste senior en renseignement spécialisé dans la sécurité nationale et la stabilité française.

Données situationnelles actuelles :
- Indice d'Instabilité Composite (CII) : ${isnrScore}/100
- Dimension sociale (protestations, grèves) : ${isnrComponents.social}/100
- Dimension sécurité (incidents, interventions) : ${isnrComponents.security}/100
- Dimension infrastructure (météo, crues, pannes) : ${isnrComponents.infra}/100
- Dimension cyber (CERT-FR, ransomware, CVE) : ${cyberScore}/100
- Alertes météo actives : ${meteoAlertCount}
- Signaux opérationnels : ${signalCounts.criticalNews} titres critiques, ${signalCounts.cyberAlerts} alertes cyber, ${signalCounts.railDisruptions} perturbations ferroviaires, ${signalCounts.roadIncidents} incidents routiers, ${signalCounts.powerOutages} coupures électriques, ${signalCounts.telecomOutages} incidents télécom, ${signalCounts.defenseAlerts} alertes défense
${energyLine}

Actualités récentes significatives :
${headlineList}

Rédige un brief national concis en deux sections courtes et moins de 140 mots au total :
1. SITUATION ACTUELLE
2. CE QUE CELA IMPLIQUE POUR LA FRANCE

Utilise uniquement les données fournies. Si les signaux sont faibles, dis-le explicitement. N'invente ni acteurs, ni causes, ni sujets absents des entrées. Style factuel et sobre.

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
  const isnrScore  = typeof body.isnrScore === 'number'  ? Math.round(body.isnrScore)  : 0;
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
    railDisruptions: typeof body.signalCounts?.railDisruptions === 'number' ? Math.round(body.signalCounts.railDisruptions) : 0,
    roadIncidents: typeof body.signalCounts?.roadIncidents === 'number' ? Math.round(body.signalCounts.roadIncidents) : 0,
    powerOutages: typeof body.signalCounts?.powerOutages === 'number' ? Math.round(body.signalCounts.powerOutages) : 0,
    telecomOutages: typeof body.signalCounts?.telecomOutages === 'number' ? Math.round(body.signalCounts.telecomOutages) : 0,
    cyberAlerts: typeof body.signalCounts?.cyberAlerts === 'number' ? Math.round(body.signalCounts.cyberAlerts) : 0,
    defenseAlerts: typeof body.signalCounts?.defenseAlerts === 'number' ? Math.round(body.signalCounts.defenseAlerts) : 0,
  };
  const energy = body.energy ? {
    ecowattSignal: typeof body.energy.ecowattSignal === 'string' ? body.energy.ecowattSignal : null,
    nuclearShare: typeof body.energy.nuclearShare === 'number' ? Math.round(body.energy.nuclearShare) : 0,
    gasShare: typeof body.energy.gasShare === 'number' ? Math.round(body.energy.gasShare) : 0,
    hydroShare: typeof body.energy.hydroShare === 'number' ? Math.round(body.energy.hydroShare) : 0,
    windShare: typeof body.energy.windShare === 'number' ? Math.round(body.energy.windShare) : 0,
    solarShare: typeof body.energy.solarShare === 'number' ? Math.round(body.energy.solarShare) : 0,
    totalMw: typeof body.energy.totalMw === 'number' ? Math.round(body.energy.totalMw) : null,
  } : null;

  // Try Redis cache (global key — acceptable at 15-min TTL)
  const cacheKey = `france-intel:brief:${lang}:v1`;
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
    return new Response(JSON.stringify({ ...FALLBACK, computedAt: new Date().toISOString() }), {
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
        messages: [{ role: 'user', content: buildPrompt(isnrScore, isnrComponents, cyberScore, meteoAlertCount, headlines, signalCounts, energy, lang) }],
        temperature: 0.2,
        max_tokens: 220,
      }),
    });

    if (!groqRes.ok) {
      return new Response(JSON.stringify({ ...FALLBACK, computedAt: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const groqText = await groqRes.text();
    const groqClean = groqText.replace(/[\u0000-\u001F\u007F\u0080-\u009F]/gu, ' ');
    const groqData = JSON.parse(groqClean);
    const raw = groqData.choices?.[0]?.message?.content ?? '';
    const rawClean = String(raw).replace(/[\u0000-\u001F\u007F\u0080-\u009F]/gu, ' ');
    const jsonMatch = rawClean.match(/\{[\s\S]*"brief"[\s\S]*\}/);
    const clean = jsonMatch ? jsonMatch[0] : rawClean.replace(/```json|```/g, '').trim();
    const { brief } = JSON.parse(clean);

    const result = {
      brief: typeof brief === 'string' ? brief : null,
      fromCache: false,
      computedAt: new Date().toISOString(),
    };

    await redisSet(cacheKey, JSON.stringify(result), CACHE_TTL);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[france-intel-brief]', err);
    return new Response(JSON.stringify({ ...FALLBACK, computedAt: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
