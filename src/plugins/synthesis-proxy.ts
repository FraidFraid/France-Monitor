// src/plugins/synthesis-proxy.ts
import type { Plugin } from 'vite';

/** Redis key used by the serverless function — kept here to document the contract */
export const CACHE_KEY = 'isnr:synthesis:fr';
const CACHE_TTL = 900;
const GROQ_URL  = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// Simple in-process memory cache for dev (mirrors Redis TTL behaviour)
let _devCache: { value: string; expiresAt: number } | null = null;

type ISNRDeptContext = { name: string; score: number; social: number; security: number };
type NuclearBriefingContext = {
  rteAvailable: boolean;
  availableCapacityMW: number | null;
  installedCapacityMW: number | null;
  unplannedOutageCount: number;
  plannedOutageCount: number;
  reducedCount: number;
  affectedSites: string[];
  gridTensionRisk: boolean;
  remitUnconfirmedCount: number;
};

type SynthesisRequestBody = {
  scores: Record<string, unknown>;
  headlines: string[];
  isnrNationalScore?: number;
  isnrDepts?: ISNRDeptContext[];
  nuclear?: NuclearBriefingContext;
};

function formatCapacityGW(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value / 1000).toFixed(1).replace('.', ',')} GW`
    : 'indisponible';
}

function buildNuclearBlock(nuclear?: NuclearBriefingContext): string {
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

function buildPrompt(
  scores: Record<string, unknown>,
  headlines: string[],
  isnrNationalScore?: number,
  isnrDepts?: ISNRDeptContext[],
  nuclear?: NuclearBriefingContext,
): string {
  const details = scores.details as Record<string, number | null> ?? {};
  const score = scores.score as number ?? 0;
  const status = scores.status as string ?? 'unknown';
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

  return `Tu es un analyste OSINT spécialisé dans la résilience des infrastructures françaises.

Voici les scores techniques actuels du Baromètre Réseau France :
- Électricité (Ecowatt) : ${details['elec'] ?? 'N/A'}/100
- Internet/BGP (IODA) : ${details['bgp'] ?? 'N/A'}/100
- Télécom (ARCEP) : ${details['telecom'] ?? 'N/A'}/100
- Météo Spatiale : ${details['space'] ?? 'N/A'}/100
- Cyber (CERT-FR) : ${details['cyber'] ?? 'N/A'}/100
Score composite : ${score}/100 (${status})

${isnrLine}${deptsBlock}${nuclearBlock}

Actualités récentes à impact (format [catégorie/niveau] titre (source)) :
${headlineList}

Instructions :
1. Détecte les CONVERGENCES entre les scores techniques, le score ISNR, les départements instables, le signal nucléaire et les actualités.
2. Rédige un "Situation Briefing" en exactement 2 phrases, en français, concis et factuel. Mentionne les zones géographiques si pertinent.
3. Intègre le nucléaire dans le briefing seulement s'il apporte un signal utile : arrêt fortuit, réduction, site impacté, écart REMIT/RTE ou risque réseau. Si le parc est nominal, tu peux l'omettre ou le résumer en une très courte clause.
4. Fournis un score d'impact sur la stabilité de 0 à 100.

IMPORTANT : Un score stabilityImpact élevé (proche de 100) signifie une INSTABILITÉ ou un DANGER élevé pour la résilience nationale. Un score bas (proche de 0) signifie une situation stable et nominale.

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après : {"briefing": "...", "stabilityImpact": 42}`;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildFallbackSynthesis(body: SynthesisRequestBody): {
  briefing: string;
  stabilityImpact: number;
  fromCache: boolean;
  computedAt: string;
} {
  const score = toNumber(body.scores.score) ?? 0;
  const status = typeof body.scores.status === 'string' ? body.scores.status : 'unknown';
  const details = (body.scores.details as Record<string, unknown> | undefined) ?? {};
  const elec = toNumber(details.elec);
  const bgp = toNumber(details.bgp);
  const telecom = toNumber(details.telecom);
  const cyber = toNumber(details.cyber);
  const weakest = [
    { label: 'électricité', value: elec },
    { label: 'internet', value: bgp },
    { label: 'télécoms', value: telecom },
    { label: 'cyber', value: cyber },
  ]
    .filter((item): item is { label: string; value: number } => item.value !== null)
    .sort((a, b) => a.value - b.value)[0];

  const unstableDept = body.isnrDepts?.[0]?.name ?? null;
  const hasNuclearSignal = !!body.nuclear && (
    body.nuclear.unplannedOutageCount > 0
    || body.nuclear.reducedCount > 0
    || body.nuclear.remitUnconfirmedCount > 0
    || body.nuclear.gridTensionRisk
  );

  const sentence1 = weakest
    ? `La résilience des infrastructures françaises reste ${status === 'critical' ? 'critique' : status === 'degraded' ? 'dégradée' : 'sous tension'}, avec un score composite de ${score}/100 et un point de fragilité principal sur ${weakest.label} (${weakest.value}/100).`
    : `La résilience des infrastructures françaises reste ${status === 'critical' ? 'critique' : status === 'degraded' ? 'dégradée' : 'sous tension'}, avec un score composite de ${score}/100.`;

  const sentence2Parts: string[] = [];
  if (unstableDept) sentence2Parts.push(`Le signal territorial le plus fragile remonte autour de ${unstableDept}`);
  if (hasNuclearSignal) sentence2Parts.push('un signal nucléaire notable reste à surveiller');
  if (body.headlines.length > 0) sentence2Parts.push('les actualités récentes confirment une pression opérationnelle mesurable');
  if (sentence2Parts.length === 0) sentence2Parts.push('aucune convergence brutale supplémentaire n’est détectée à cette minute');

  const stabilityImpact = Math.max(0, Math.min(100, Math.round(100 - score + ((cyber != null && cyber < 60) ? 8 : 0))));

  return {
    briefing: `${sentence1} ${sentence2Parts.join(', ')}.`,
    stabilityImpact,
    fromCache: false,
    computedAt: new Date().toISOString(),
  };
}

export function synthesisProxyPlugin(): Plugin {
  return {
    name: 'synthesis-proxy',
    configureServer(server) {
      server.middlewares.use('/api/intelligence/v1/synthesis', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');

          // Dev in-process cache
          if (_devCache && Date.now() < _devCache.expiresAt) {
            const cached = JSON.parse(_devCache.value);
            res.end(JSON.stringify({ ...cached, fromCache: true }));
            return;
          }

          const GROQ_API_KEY = process.env['GROQ_API_KEY'];
          if (!GROQ_API_KEY) {
            const parsed = JSON.parse(body) as SynthesisRequestBody;
            res.end(JSON.stringify(buildFallbackSynthesis(parsed)));
            return;
          }

          try {
            const parsed = JSON.parse(body) as SynthesisRequestBody;
            const { scores, headlines, isnrNationalScore, isnrDepts, nuclear } = parsed;

            const groqRes = await fetch(GROQ_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${GROQ_API_KEY}`,
              },
              body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: buildPrompt(scores, headlines, isnrNationalScore, isnrDepts, nuclear) }],
                temperature: 0.3,
                max_tokens: 300,
              }),
            });

            if (!groqRes.ok) {
              res.end(JSON.stringify(buildFallbackSynthesis(parsed)));
              return;
            }

            const groqData = await groqRes.json() as {
              choices: Array<{ message: { content: string } }>;
            };
            const raw = groqData.choices?.[0]?.message?.content ?? '';
            const clean = raw.replace(/```json|```/g, '').trim();
            const { briefing, stabilityImpact } = JSON.parse(clean) as {
              briefing: string;
              stabilityImpact: number;
            };

            const result = {
              briefing: typeof briefing === 'string' ? briefing : null,
              stabilityImpact: typeof stabilityImpact === 'number' ? stabilityImpact : null,
              fromCache: false,
              computedAt: new Date().toISOString(),
            };

            _devCache = { value: JSON.stringify(result), expiresAt: Date.now() + CACHE_TTL * 1000 };
            res.end(JSON.stringify(result));
          } catch (err) {
            console.error('[synthesis-proxy]', err);
            try {
              const parsed = JSON.parse(body) as SynthesisRequestBody;
              res.end(JSON.stringify(buildFallbackSynthesis(parsed)));
            } catch {
              res.end(JSON.stringify({
                briefing: 'Synthèse indisponible pour ce cycle.',
                stabilityImpact: null,
                fromCache: false,
                computedAt: new Date().toISOString(),
              }));
            }
          }
        });
      });
    },
  };
}
