// api/intelligence/v1/synthesis.js : Vercel Edge Function
// POST { scores: NetworkBarometerResult, headlines: string[] }
// → { briefing: string|null, stabilityImpact: number|null, fromCache: bool, computedAt: string }

export const config = { runtime: 'edge' };

import { redisGet, redisSet } from '../../../_utils/redis.js';
import { GROQ_MODEL, groqModelParams, withReasoningHeadroom } from '../../../_lib/groq-models.js';
import { mayGenerate } from '../../../_lib/brief-store.js';

const CACHE_KEY = 'isnr:synthesis:fr:v2';
// Synthèse partagée (audit du 13/11/2026) : comme le brief, elle est rédigée par l'enregistreur de la VM (jeton, toutes les
// 15 min) et lue par tous. 2 h de garde : elle survit à quelques passages manqués.
const CACHE_TTL = 2 * 60 * 60;

/** Texte court venu du client, mis sur une ligne et borné : il entre dans l'invite. */
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const num = (value, min, max) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null);
const oneOf = (value, list) => (list.includes(value) ? value : null);
const textList = (value, maxItems, maxLen) => (Array.isArray(value) ? value.slice(0, maxItems).map((v) => cleanText(v, maxLen)).filter(Boolean) : []);

/**
 * Corps de la requête ramené à ce que l'invite attend : nombres bornés, listes courtes, textes sur une ligne. Tout le reste
 * est ignoré. Exportée pour les tests.
 */
export function sanitizeSynthesisInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const d = b.scores && typeof b.scores.details === 'object' && b.scores.details ? b.scores.details : {};
  const details = {};
  for (const key of ['elec', 'bgp', 'telecom', 'space', 'cyber', 'wind']) details[key] = num(d[key], 0, 100);
  const scores = { details, score: num(b.scores?.score, 0, 100) ?? 'N/A', status: cleanText(b.scores?.status, 24) || 'indéterminé' };

  const isnrDepts = (Array.isArray(b.isnrDepts) ? b.isnrDepts : []).slice(0, 5)
    .map((dep) => ({ name: cleanText(dep?.name, 60), score: num(dep?.score, 0, 100), social: num(dep?.social, 0, 100), security: num(dep?.security, 0, 100) }))
    .filter((dep) => dep.name);

  const n = b.nuclear && typeof b.nuclear === 'object' ? b.nuclear : null;
  const nuclear = n && {
    rteAvailable: n.rteAvailable === true,
    unplannedOutageCount: num(n.unplannedOutageCount, 0, 100) ?? 0,
    plannedOutageCount: num(n.plannedOutageCount, 0, 100) ?? 0,
    reducedCount: num(n.reducedCount, 0, 100) ?? 0,
    remitUnconfirmedCount: num(n.remitUnconfirmedCount, 0, 100) ?? 0,
    gridTensionRisk: n.gridTensionRisk === true,
    affectedSites: textList(n.affectedSites, 12, 40),
    availableCapacityMW: num(n.availableCapacityMW, 0, 100_000),
    installedCapacityMW: num(n.installedCapacityMW, 0, 100_000),
  };

  const e = b.eolien && typeof b.eolien === 'object' ? b.eolien : null;
  const eolien = e && {
    production_gw: num(e.production_gw, 0, 100) ?? undefined,
    puissance_installee: num(e.puissance_installee, 0, 100) ?? undefined,
    facteur_charge: num(e.facteur_charge, 0, 1) ?? undefined,
    parcs_actifs: num(e.parcs_actifs, 0, 100_000) ?? undefined,
    alertLevel: oneOf(e.alertLevel, ['normal', 'watch', 'low-production']) ?? 'normal',
  };

  const o = b.oil && typeof b.oil === 'object' ? b.oil : null;
  const oil = o && {
    structuralStatus: oneOf(o.structuralStatus, ['normal', 'tense', 'critical', 'unknown']) ?? 'unknown',
    structuralScore: num(o.structuralScore, 0, 100) ?? undefined,
    nationalStocksDays: num(o.nationalStocksDays, 0, 1000) ?? undefined,
    monthlyRoadFuelYoYPct: num(o.monthlyRoadFuelYoYPct, -100, 1000) ?? undefined,
    fuelTensionCoverage: cleanText(o.fuelTensionCoverage, 40) || undefined,
    fuelTensionStationCount: num(o.fuelTensionStationCount, 0, 100_000) ?? undefined,
    fuelTensionLevel: cleanText(o.fuelTensionLevel, 20) || undefined,
    fuelTensionAnomalyShare: num(o.fuelTensionAnomalyShare, 0, 100) ?? undefined,
    fuelTensionAvgUpdateAgeMinutes: num(o.fuelTensionAvgUpdateAgeMinutes, 0, 1_000_000) ?? undefined,
    fuelTensionTopDepartments: textList(o.fuelTensionTopDepartments, 8, 40),
  };

  return {
    scores,
    headlines: textList(b.headlines, 10, 220),
    isnrNationalScore: num(b.isnrNationalScore, 0, 100),
    isnrDepts,
    nuclear,
    eolien,
    oil,
  };
}
const GROQ_URL  = 'https://api.groq.com/openai/v1/chat/completions';
// Modèle centralisé (Groq a retiré llama-3.3-70b-versatile) : voir api/_lib/groq-models.js

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
  const alertLabels = { normal: 'nominal', watch: 'vent modéré', 'low-production': 'production faible (alerte)' };
  return `
Éolien France (temps réel éCO2mix) :
- Production : ${typeof eolien.production_gw === 'number' ? eolien.production_gw.toFixed(1) + ' GW' : 'N/A'} sur ${typeof eolien.puissance_installee === 'number' ? eolien.puissance_installee.toFixed(1) + ' GW installés' : 'N/A installés'}
- Facteur de charge : ${typeof eolien.facteur_charge === 'number' ? Math.round(eolien.facteur_charge * 100) + '%' : 'N/A'}
- Parcs actifs : ${typeof eolien.parcs_actifs === 'number' ? eolien.parcs_actifs : 'N/A'}
- Signal : ${alertLabels[eolien.alertLevel] ?? eolien.alertLevel}`;
}

function buildOilBlock(oil) {
  if (!oil) return '';

  const structuralLabels = {
    normal: 'nominal',
    tense: 'tendu',
    critical: 'critique',
    unknown: 'indéterminé',
  };

  const topDepartments = Array.isArray(oil.fuelTensionTopDepartments) && oil.fuelTensionTopDepartments.length > 0
    ? oil.fuelTensionTopDepartments.join(', ')
    : 'aucun département notable';

  return `
Pétrole / carburants France :
- OilNetwork structurel : ${structuralLabels[oil.structuralStatus] ?? oil.structuralStatus} (${typeof oil.structuralScore === 'number' ? `${oil.structuralScore}/100` : 'score indisponible'})
- Stocks nationaux : ${typeof oil.nationalStocksDays === 'number' ? `${oil.nationalStocksDays} jours` : 'indisponibles'}
- Dernière tendance livraisons carburants routiers : ${typeof oil.monthlyRoadFuelYoYPct === 'number' ? `${oil.monthlyRoadFuelYoYPct > 0 ? '+' : ''}${oil.monthlyRoadFuelYoYPct.toFixed(1)}% vs N-1` : 'indisponible'}
- Tension carburants : ${oil.fuelTensionCoverage ?? 'couverture inconnue'}, ${typeof oil.fuelTensionStationCount === 'number' ? `${oil.fuelTensionStationCount} stations exploitées` : 'stations indisponibles'}
- Signal carburants national : ${oil.fuelTensionLevel ?? 'indisponible'}, anomalies ${typeof oil.fuelTensionAnomalyShare === 'number' ? `${oil.fuelTensionAnomalyShare.toFixed(1)}%` : 'n.d.'}, fraîcheur ${typeof oil.fuelTensionAvgUpdateAgeMinutes === 'number' ? `${Math.round(oil.fuelTensionAvgUpdateAgeMinutes)} min` : 'n.d.'}
- Départements carburants les plus tendus : ${topDepartments}`;
}

/** Invite de la synthèse ; exportée pour les tests. La composante « bgp » vient de RIPEstat (network-barometer.ts normalizeBgp). */
export function buildPrompt(scores, headlines, isnrNationalScore, isnrDepts, nuclear, eolien, oil) {
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
  const oilBlock = buildOilBlock(oil);

  return `Tu es un analyste OSINT spécialisé dans la résilience des infrastructures françaises.

Voici les scores techniques actuels du Baromètre Réseau France :
- Électricité (Ecowatt) : ${details.elec ?? 'N/A'}/100
- Internet, visibilité BGP des grands réseaux (RIPEstat) : ${details.bgp ?? 'N/A'}/100
- Télécom (ARCEP) : ${details.telecom ?? 'N/A'}/100
- Météo Spatiale : ${details.space ?? 'N/A'}/100
- Cyber (CERT-FR) : ${details.cyber ?? 'N/A'}/100
- Éolien : ${details.wind ?? 'N/A'}/100
Score composite : ${score}/100 (${status})

${isnrLine}${deptsBlock}${nuclearBlock}${eolienBlock}${oilBlock}

Actualités récentes à impact (format [catégorie/niveau] titre (source)) :
${headlineList}

Instructions :
1. Détecte les CONVERGENCES entre les scores techniques, le score ISNR, les départements instables, le signal nucléaire, le signal éolien, le contexte pétrole/carburants et les actualités.
2. Rédige un "Situation Briefing" en exactement 2 phrases, en français, concis et factuel. Mentionne les zones géographiques si pertinent.
3. Intègre le nucléaire dans le briefing seulement s'il apporte un signal utile : arrêt fortuit, réduction, site impacté, écart REMIT/RTE ou risque réseau. Si le parc est nominal, tu peux l'omettre ou le résumer en une très courte clause.
4. Intègre l'éolien seulement si l'alerte est 'low-production' ou 'watch', sinon omets-le.
5. Intègre le pétrole/carburants seulement s'il existe un signal utile : tension carburants HIGH/CRITICAL, anomalies carburants significatives, départements sous tension, baisse de stocks ou signal structurel pétrole tendu/critique. Si le pétrole est nominal, tu peux l'omettre.
6. Fournis un score d'impact sur la stabilité de 0 à 100.

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

  let scores, headlines, isnrNationalScore, isnrDepts, nuclear, eolien, oil;
  try {
    ({ scores, headlines, isnrNationalScore, isnrDepts, nuclear, eolien, oil } = sanitizeSynthesisInput(await request.json()));
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
      // corrupted cache entry : fall through to AI call
    }
  }

  // 2. Call Groq : seulement pour le porteur du jeton de rédaction (l'enregistreur). Un visiteur lit la synthèse gardée ;
  // il ne peut ni la faire rédiger avec ses propres chiffres et titres, ni dépenser le quota Groq.
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY || !mayGenerate(request.headers?.get?.('x-fm-brief-token'), process.env.FM_BRIEF_TOKEN)) {
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
        ...groqModelParams(GROQ_MODEL),
        messages: [{ role: 'user', content: buildPrompt(scores, headlines, isnrNationalScore, isnrDepts, nuclear, eolien, oil) }],
        temperature: 0.3,
        max_tokens: withReasoningHeadroom(GROQ_MODEL, 300),
      }),
      signal: AbortSignal.timeout(10_000),
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
      briefing: cleanText(briefing, 600) || null,
      stabilityImpact: num(stabilityImpact, 0, 100),
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
