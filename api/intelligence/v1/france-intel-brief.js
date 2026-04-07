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

function buildPrompt(isnrScore, isnrComponents, cyberScore, meteoAlertCount, headlines, lang) {
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : lang === 'fr' ? '(aucune actualité significative)' : '(no significant news)';

  if (lang === 'en') {
    return `You are a senior intelligence analyst specializing in France's national security and stability.

Current situation data:
- National Instability Index (CII): ${isnrScore}/100
- Social dimension (protests, strikes): ${isnrComponents.social}/100
- Security dimension (incidents, interventions): ${isnrComponents.security}/100
- Infrastructure dimension (weather, floods, outages): ${isnrComponents.infra}/100
- Cyber dimension (CERT-FR, ransomware, CVE): ${cyberScore}/100
- Active weather alerts: ${meteoAlertCount}

Recent significant headlines:
${headlineList}

Write a 3-4 paragraph intelligence brief (250-350 words) covering:
1. Current Situation — key active signals and their convergence
2. Security & Stability Posture — dominant threats
3. Infrastructure & Risk Factors — energy, transport, cyber, weather
4. Outlook — short-term trajectory

Be analytical, specific, and factual. No speculation.

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

Actualités récentes significatives :
${headlineList}

Rédige un brief de renseignement en 3-4 paragraphes (250-350 mots) couvrant :
1. Situation actuelle — signaux actifs et convergences
2. Posture sécuritaire et stabilité — menaces dominantes
3. Facteurs de risque — énergie, transport, cyber, météo
4. Perspectives — trajectoire à court terme

Sois analytique, précis et factuel. Pas de spéculation.

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
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: buildPrompt(isnrScore, isnrComponents, cyberScore, meteoAlertCount, headlines, lang) }],
        temperature: 0.4,
        max_tokens: 700,
      }),
    });

    if (!groqRes.ok) {
      return new Response(JSON.stringify({ ...FALLBACK, computedAt: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content ?? '';
    const clean = raw.replace(/```json|```/g, '').trim();
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
