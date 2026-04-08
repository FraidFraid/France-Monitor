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
  signalCounts: {
    criticalNews: number;
    railDisruptions: number;
    roadIncidents: number;
    powerOutages: number;
    telecomOutages: number;
    cyberAlerts: number;
    defenseAlerts: number;
  },
  energy: {
    ecowattSignal: string | null;
    nuclearShare: number;
    gasShare: number;
    hydroShare: number;
    windShare: number;
    solarShare: number;
    totalMw: number | null;
  } | null,
  lang: 'fr' | 'en',
): string {
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
            // Strip ASCII + C1 Unicode control characters — RSS titles can
            // contain literal control chars (U+0000–U+001F, U+007F, U+0080–U+009F)
            // that make JSON.parse throw
            const cleanBody = body.replace(/[\u0000-\u001F\u007F\u0080-\u009F]/gu, ' ');
            const parsed = JSON.parse(cleanBody) as {
              lang?: unknown;
              isnrScore?: unknown;
              cyberScore?: unknown;
              meteoAlertCount?: unknown;
              isnrComponents?: { social?: unknown; security?: unknown; infra?: unknown };
              topHeadlines?: unknown;
              signalCounts?: {
                criticalNews?: unknown;
                railDisruptions?: unknown;
                roadIncidents?: unknown;
                powerOutages?: unknown;
                telecomOutages?: unknown;
                cyberAlerts?: unknown;
                defenseAlerts?: unknown;
              };
              energy?: {
                ecowattSignal?: unknown;
                nuclearShare?: unknown;
                gasShare?: unknown;
                hydroShare?: unknown;
                windShare?: unknown;
                solarShare?: unknown;
                totalMw?: unknown;
              } | null;
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
            const signalCounts = {
              criticalNews: typeof parsed.signalCounts?.criticalNews === 'number' ? Math.round(parsed.signalCounts.criticalNews) : 0,
              railDisruptions: typeof parsed.signalCounts?.railDisruptions === 'number' ? Math.round(parsed.signalCounts.railDisruptions) : 0,
              roadIncidents: typeof parsed.signalCounts?.roadIncidents === 'number' ? Math.round(parsed.signalCounts.roadIncidents) : 0,
              powerOutages: typeof parsed.signalCounts?.powerOutages === 'number' ? Math.round(parsed.signalCounts.powerOutages) : 0,
              telecomOutages: typeof parsed.signalCounts?.telecomOutages === 'number' ? Math.round(parsed.signalCounts.telecomOutages) : 0,
              cyberAlerts: typeof parsed.signalCounts?.cyberAlerts === 'number' ? Math.round(parsed.signalCounts.cyberAlerts) : 0,
              defenseAlerts: typeof parsed.signalCounts?.defenseAlerts === 'number' ? Math.round(parsed.signalCounts.defenseAlerts) : 0,
            };
            const energy = parsed.energy ? {
              ecowattSignal: typeof parsed.energy.ecowattSignal === 'string' ? parsed.energy.ecowattSignal : null,
              nuclearShare: typeof parsed.energy.nuclearShare === 'number' ? Math.round(parsed.energy.nuclearShare) : 0,
              gasShare: typeof parsed.energy.gasShare === 'number' ? Math.round(parsed.energy.gasShare) : 0,
              hydroShare: typeof parsed.energy.hydroShare === 'number' ? Math.round(parsed.energy.hydroShare) : 0,
              windShare: typeof parsed.energy.windShare === 'number' ? Math.round(parsed.energy.windShare) : 0,
              solarShare: typeof parsed.energy.solarShare === 'number' ? Math.round(parsed.energy.solarShare) : 0,
              totalMw: typeof parsed.energy.totalMw === 'number' ? Math.round(parsed.energy.totalMw) : null,
            } : null;

            const groqRes = await fetch(GROQ_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${GROQ_API_KEY}`,
              },
              body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: buildPrompt(isnrScore, isnrComponents, cyberScore, meteoAlertCount, headlines, signalCounts, energy, lang) }],
                temperature: 0.2,
                max_tokens: 220,
              }),
              signal: AbortSignal.timeout(30_000),
            });

            if (!groqRes.ok) {
              const errText = await groqRes.text().catch(() => '');
              console.error(`[france-intel-proxy] Groq error ${groqRes.status}:`, errText.slice(0, 300));
              res.end(JSON.stringify({ brief: null, fromCache: false, computedAt: new Date().toISOString() }));
              return;
            }

            // Read as text + strip control chars before parsing — Groq can return
            // brief text with literal control characters that break JSON.parse
            const groqText = await groqRes.text();
            const groqClean = groqText.replace(/[\u0000-\u001F\u007F\u0080-\u009F]/gu, ' ');
            const groqData = JSON.parse(groqClean) as { choices: Array<{ message: { content: string } }> };
            const raw = groqData.choices?.[0]?.message?.content ?? '';
            // The model may embed literal \n inside the JSON string value (invalid JSON).
            // Strip control chars from raw content BEFORE the second JSON.parse.
            const rawClean = raw.replace(/[\u0000-\u001F\u007F\u0080-\u009F]/gu, ' ');
            // Extract JSON robustly — handle markdown fences and surrounding text
            const jsonMatch = rawClean.match(/\{[\s\S]*"brief"[\s\S]*\}/);
            const clean = jsonMatch ? jsonMatch[0] : rawClean.replace(/```json|```/g, '').trim();
            const { brief } = JSON.parse(clean) as { brief: string };

            const result = {
              brief: typeof brief === 'string' ? brief : null,
              fromCache: false,
              computedAt: new Date().toISOString(),
            };

            _devCache = { value: JSON.stringify(result), expiresAt: Date.now() + CACHE_TTL };
            res.end(JSON.stringify(result));
          } catch (err) {
            console.error('[france-intel-proxy] Error:', err instanceof Error ? err.message : err);
            console.error('[france-intel-proxy] Body (first 200):', body.slice(0, 200));
            res.end(JSON.stringify({ brief: null, fromCache: false, computedAt: new Date().toISOString() }));
          }
        });
      });
    },
  };
}
