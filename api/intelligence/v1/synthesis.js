// api/intelligence/v1/synthesis.js — Vercel Edge Function
// POST { scores: NetworkBarometerResult, headlines: string[] }
// → { briefing: string|null, stabilityImpact: number|null, fromCache: bool, computedAt: string }

export const config = { runtime: 'edge' };

import { redisGet, redisSet } from '../../utils/redis.js';

const CACHE_KEY = 'isnr:synthesis:fr';
const CACHE_TTL = 900; // 15 minutes
const GROQ_URL  = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function buildPrompt(scores, headlines, isnrNationalScore) {
  const { details, score, status } = scores;
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : '(aucune actualité significative détectée)';

  const isnrLine = isnrNationalScore != null
    ? `Score ISNR (stabilité sociale & sécuritaire nationale) : ${isnrNationalScore}/100`
    : `Score ISNR (stabilité sociale & sécuritaire nationale) : indisponible`;

  return `Tu es un analyste OSINT spécialisé dans la résilience des infrastructures françaises.

Voici les scores techniques actuels du Baromètre Réseau France :
- Électricité (Ecowatt) : ${details.elec ?? 'N/A'}/100
- Internet/BGP (IODA) : ${details.bgp ?? 'N/A'}/100
- Télécom (ARCEP) : ${details.telecom ?? 'N/A'}/100
- Météo Spatiale : ${details.space ?? 'N/A'}/100
- Cyber (CERT-FR) : ${details.cyber ?? 'N/A'}/100
Score composite : ${score}/100 (${status})

${isnrLine}

Actualités récentes à impact (filtrées medium/high) :
${headlineList}

Instructions :
1. Détecte les CONVERGENCES entre les scores techniques, le score ISNR et les actualités (ex: chute BGP + ISNR bas + news câble sous-marin).
2. Rédige un "Situation Briefing" en exactement 2 phrases, en français, concis et factuel.
3. Fournis un score d'impact sur la stabilité de 0 à 100.

IMPORTANT : Un score stabilityImpact élevé (proche de 100) signifie une INSTABILITÉ ou un DANGER élevé pour la résilience nationale. Un score bas (proche de 0) signifie une situation stable et nominale.

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après : {"briefing": "...", "stabilityImpact": 42}`;
}

const FALLBACK = { briefing: null, stabilityImpact: null, fromCache: false };

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let scores, headlines, isnrNationalScore;
  try {
    ({ scores, headlines, isnrNationalScore } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. Try Redis cache
  const cached = await redisGet(CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return new Response(JSON.stringify({ ...parsed, fromCache: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // corrupted cache entry — fall through to AI call
    }
  }

  // 2. Call Groq
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
        messages: [{ role: 'user', content: buildPrompt(scores, headlines, isnrNationalScore) }],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    if (!groqRes.ok) {
      console.error('[synthesis] Groq error', groqRes.status);
      return new Response(
        JSON.stringify({ ...FALLBACK, computedAt: new Date().toISOString() }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content ?? '';

    // Parse the JSON response from Groq (strip any accidental markdown fences)
    const clean = raw.replace(/```json|```/g, '').trim();
    const { briefing, stabilityImpact } = JSON.parse(clean);

    const result = {
      briefing: typeof briefing === 'string' ? briefing : null,
      stabilityImpact: typeof stabilityImpact === 'number' ? stabilityImpact : null,
      fromCache: false,
      computedAt: new Date().toISOString(),
    };

    // 3. Store in Redis (fire-and-forget)
    await redisSet(CACHE_KEY, JSON.stringify(result), CACHE_TTL);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[synthesis] error', err);
    return new Response(
      JSON.stringify({ ...FALLBACK, computedAt: new Date().toISOString() }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }
}
