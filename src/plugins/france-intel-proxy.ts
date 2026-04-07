// src/plugins/france-intel-proxy.ts
import type { Plugin } from 'vite';

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const CACHE_TTL  = 900_000; // 15 min in ms

let _devCache: { value: string; expiresAt: number } | null = null;

function sanitizeHeadlines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .slice(0, 6)
    .map(h => String(h).replace(/[\r\n]+/g, ' ').slice(0, 120));
}

function buildPrompt(
  isnrScore: number,
  isnrComponents: { social: number; security: number; infra: number },
  cyberScore: number,
  meteoAlertCount: number,
  headlines: string[],
  lang: 'fr' | 'en',
): string {
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
1. Current Situation
2. Security & Stability Posture
3. Infrastructure & Risk Factors
4. Outlook

Be analytical, specific, factual. No speculation.
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

Rédige un brief en 3-4 paragraphes (250-350 mots) : Situation actuelle / Posture sécuritaire / Facteurs de risque / Perspectives.
Factuel, précis, pas de spéculation.
Réponds en JSON valide uniquement : {"brief": "..."}`;
}

export function franceIntelProxyPlugin(): Plugin {
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

          if (_devCache && Date.now() < _devCache.expiresAt) {
            res.end(JSON.stringify({ ...JSON.parse(_devCache.value), fromCache: true }));
            return;
          }

          const GROQ_API_KEY = process.env['GROQ_API_KEY'];
          if (!GROQ_API_KEY) {
            res.end(JSON.stringify({ brief: null, fromCache: false, computedAt: new Date().toISOString() }));
            return;
          }

          try {
            const parsed = JSON.parse(body) as {
              lang?: unknown;
              isnrScore?: unknown;
              cyberScore?: unknown;
              meteoAlertCount?: unknown;
              isnrComponents?: { social?: unknown; security?: unknown; infra?: unknown };
              topHeadlines?: unknown;
            };

            const lang: 'fr' | 'en'   = parsed.lang === 'en' ? 'en' : 'fr';
            const isnrScore            = typeof parsed.isnrScore === 'number'  ? Math.round(parsed.isnrScore)  : 0;
            const cyberScore           = typeof parsed.cyberScore === 'number' ? Math.round(parsed.cyberScore) : 0;
            const meteoAlertCount      = typeof parsed.meteoAlertCount === 'number' ? parsed.meteoAlertCount : 0;
            const isnrComponents = {
              social:   typeof parsed.isnrComponents?.social   === 'number' ? Math.round(parsed.isnrComponents.social)   : 0,
              security: typeof parsed.isnrComponents?.security === 'number' ? Math.round(parsed.isnrComponents.security) : 0,
              infra:    typeof parsed.isnrComponents?.infra    === 'number' ? Math.round(parsed.isnrComponents.infra)    : 0,
            };
            const headlines = sanitizeHeadlines(parsed.topHeadlines);

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
              signal: AbortSignal.timeout(30_000),
            });

            if (!groqRes.ok) {
              const errText = await groqRes.text().catch(() => '');
              console.error(`[france-intel-proxy] Groq error ${groqRes.status}:`, errText.slice(0, 300));
              res.end(JSON.stringify({ brief: null, fromCache: false, computedAt: new Date().toISOString() }));
              return;
            }

            const groqData = await groqRes.json() as { choices: Array<{ message: { content: string } }> };
            const raw = groqData.choices?.[0]?.message?.content ?? '';
            // Extract JSON robustly — handle markdown fences and surrounding text
            const jsonMatch = raw.match(/\{[\s\S]*"brief"[\s\S]*\}/);
            const clean = jsonMatch ? jsonMatch[0] : raw.replace(/```json|```/g, '').trim();
            const { brief } = JSON.parse(clean) as { brief: string };

            const result = {
              brief: typeof brief === 'string' ? brief : null,
              fromCache: false,
              computedAt: new Date().toISOString(),
            };

            _devCache = { value: JSON.stringify(result), expiresAt: Date.now() + CACHE_TTL };
            res.end(JSON.stringify(result));
          } catch (err) {
            console.error('[france-intel-proxy]', err);
            res.end(JSON.stringify({ brief: null, fromCache: false, computedAt: new Date().toISOString() }));
          }
        });
      });
    },
  };
}
