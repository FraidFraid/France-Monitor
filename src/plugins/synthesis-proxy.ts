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

function buildPrompt(scores: Record<string, unknown>, headlines: string[], isnrNationalScore?: number, isnrDepts?: ISNRDeptContext[]): string {
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

  return `Tu es un analyste OSINT spécialisé dans la résilience des infrastructures françaises.

Voici les scores techniques actuels du Baromètre Réseau France :
- Électricité (Ecowatt) : ${details['elec'] ?? 'N/A'}/100
- Internet/BGP (IODA) : ${details['bgp'] ?? 'N/A'}/100
- Télécom (ARCEP) : ${details['telecom'] ?? 'N/A'}/100
- Météo Spatiale : ${details['space'] ?? 'N/A'}/100
- Cyber (CERT-FR) : ${details['cyber'] ?? 'N/A'}/100
Score composite : ${score}/100 (${status})

${isnrLine}${deptsBlock}

Actualités récentes à impact (format [catégorie/niveau] titre (source)) :
${headlineList}

Instructions :
1. Détecte les CONVERGENCES entre les scores techniques, le score ISNR, les départements instables et les actualités.
2. Rédige un "Situation Briefing" en exactement 2 phrases, en français, concis et factuel. Mentionne les zones géographiques si pertinent.
3. Fournis un score d'impact sur la stabilité de 0 à 100.

IMPORTANT : Un score stabilityImpact élevé (proche de 100) signifie une INSTABILITÉ ou un DANGER élevé pour la résilience nationale. Un score bas (proche de 0) signifie une situation stable et nominale.

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après : {"briefing": "...", "stabilityImpact": 42}`;
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
            res.end(JSON.stringify({
              briefing: null, stabilityImpact: null, fromCache: false,
              computedAt: new Date().toISOString(),
            }));
            return;
          }

          try {
            const { scores, headlines, isnrNationalScore, isnrDepts } = JSON.parse(body) as {
              scores: Record<string, unknown>;
              headlines: string[];
              isnrNationalScore?: number;
              isnrDepts?: ISNRDeptContext[];
            };

            const groqRes = await fetch(GROQ_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${GROQ_API_KEY}`,
              },
              body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: buildPrompt(scores, headlines, isnrNationalScore, isnrDepts) }],
                temperature: 0.3,
                max_tokens: 300,
              }),
            });

            if (!groqRes.ok) {
              res.end(JSON.stringify({
                briefing: null, stabilityImpact: null, fromCache: false,
                computedAt: new Date().toISOString(),
              }));
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
            res.end(JSON.stringify({
              briefing: null, stabilityImpact: null, fromCache: false,
              computedAt: new Date().toISOString(),
            }));
          }
        });
      });
    },
  };
}
