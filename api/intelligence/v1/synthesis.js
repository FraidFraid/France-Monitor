// api/intelligence/v1/synthesis.js — Vercel Edge Function
// POST { scores: NetworkBarometerResult, headlines: string[] }
// → { briefing: string|null, stabilityImpact: number|null, fromCache: bool, computedAt: string }

export const config = { runtime: 'edge' };

import { redisGet, redisSet } from '../../utils/redis.js';

const CACHE_KEY = 'isnr:synthesis:fr';
const CACHE_TTL = 900; // 15 minutes
const GROQ_URL  = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function formatCapacityGW(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value / 1000).toFixed(1).replace('.', ',')} GW`
    : 'indisponible';
}

function buildNuclearBlock(nuclear) {
  if (!nuclear) {
    return '';
  }

  if (!nuclear.rteAvailable) {
    return '\nContexte nucléaire : données RTE indisponibles, ne pas extrapoler.';
  }

  const outageCount = (nuclear.unplannedOutageCount ?? 0) + (nuclear.plannedOutageCount ?? 0);
  const notableSignal = outageCount > 0 || (nuclear.reducedCount ?? 0) > 0 || (nuclear.remitUnconfirmedCount ?? 0) > 0 || nuclear.gridTensionRisk;
  const affectedSites = Array.isArray(nuclear.affectedSites) && nuclear.affectedSites.length > 0
    ? nuclear.affectedSites.join(', ')
    : 'aucun site signalé';

  return `\nContexte nucléaire France :
- Parc : ${formatCapacityGW(nuclear.availableCapacityMW)} disponibles sur ${formatCapacityGW(nuclear.installedCapacityMW)} installés
- Tranches : ${nuclear.unplannedOutageCount ?? 0} arrêts fortuits, ${nuclear.plannedOutageCount ?? 0} arrêts programmés, ${nuclear.reducedCount ?? 0} réductions de puissance
- Sites concernés : ${affectedSites}
- Risque réseau nucléaire : ${nuclear.gridTensionRisk ? 'oui' : 'non'}
- Écarts REMIT non confirmés par RTE : ${nuclear.remitUnconfirmedCount ?? 0}
- Lecture analyste : ${notableSignal ? 'signal nucléaire notable' : 'parc nucléaire nominal'}`;
}

function buildEolienBlock(eolien) {
  if (!eolien) return '';
  const alertLabels = { normal: 'nominal', watch: 'vent modéré', 'low-production': 'production faible — alerte' };
  return `
Éolien France (temps réel éCO2mix) :
- Production : ${typeof eolien.production_gw === 'number' ? eolien.production_gw.toFixed(1) + ' GW' : 'N/A'} sur ${typeof eolien.puissance_installee === 'number' ? eolien.puissance_installee.toFixed(1) + ' GW installés' : 'N/A installés'}
- Facteur de charge : ${typeof eolien.facteur_charge === 'number' ? Math.round(eolien.facteur_charge * 100) + '%' : 'N/A'}
- Parcs actifs : ${typeof eolien.parcs_actifs === 'number' ? eolien.parcs_actifs : 'N/A'}
- Signal : ${alertLabels[eolien.alertLevel] ?? eolien.alertLevel}`;
}

function buildPrompt(scores, headlines, isnrNationalScore, isnrDepts, nuclear, eolien) {
  const { details, score, status } = scores;
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : '(aucune actualité significative détectée)';

  const isnrLine = isnrNationalScore != null
    ? `Score ISNR national (stabilité sociale & sécuritaire) : ${isnrNationalScore}/100`
    : `Score ISNR national (stabilité sociale & sécuritaire) : indisponible`;

  const deptsBlock = isnrDepts && isnrDepts.length > 0
    ? `\nDépartements les plus instables (score bas = instable) :\n${isnrDepts.map((d, i) => `${i + 1}. ${d.name} : ${d.score}/100 (social: ${d.social}, sécurité: ${d.security})`).join('\n')}`
    : '';
  const nuclearBlock = buildNuclearBlock(nuclear);
  const eolienBlock = buildEolienBlock(eolien);

  return `Tu es un analyste OSINT spécialisé dans la résilience des infrastructures françaises.

Voici les scores techniques actuels du Baromètre Réseau France :
- Électricité (Ecowatt) : ${details.elec ?? 'N/A'}/100
- Internet/BGP (IODA) : ${details.bgp ?? 'N/A'}/100
- Télécom (ARCEP) : ${details.telecom ?? 'N/A'}/100
- Météo Spatiale : ${details.space ?? 'N/A'}/100
- Cyber (CERT-FR) : ${details.cyber ?? 'N/A'}/100
- Éolien : ${details.wind ?? 'N/A'}/100
Score composite : ${score}/100 (${status})

${isnrLine}${deptsBlock}${nuclearBlock}${eolienBlock}

Actualités récentes à impact (format [catégorie/niveau] titre (source)) :
${headlineList}

Instructions :
1. Détecte les CONVERGENCES entre les scores techniques, le score ISNR, les départements instables, le signal nucléaire, le signal éolien et les actualités.
2. Rédige un "Situation Briefing" en exactement 2 phrases, en français, concis et factuel. Mentionne les zones géographiques si pertinent.
3. Intègre le nucléaire dans le briefing seulement s'il apporte un signal utile : arrêt fortuit, réduction, site impacté, écart REMIT/RTE ou risque réseau. Si le parc est nominal, tu peux l'omettre ou le résumer en une très courte clause.
4. Intègre l'éolien seulement si l'alerte est 'low-production' ou 'watch', sinon omets-le.
5. Fournis un score d'impact sur la stabilité de 0 à 100.

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

  let scores, headlines, isnrNationalScore, isnrDepts, nuclear, eolien;
  try {
    ({ scores, headlines, isnrNationalScore, isnrDepts, nuclear, eolien } = await request.json());
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
        messages: [{ role: 'user', content: buildPrompt(scores, headlines, isnrNationalScore, isnrDepts, nuclear, eolien) }],
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
