// api/_lib/groq-classifier.js
// Optional Groq LLM classification for ambiguous news articles.
// Called by the ingestion cron when GROQ_API_KEY is set.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_TIMEOUT_MS = 5000;

const VALID_CATEGORIES = new Set([
  'social', 'security', 'energy', 'weather', 'transport',
  'infrastructure', 'health', 'finance', 'floods', 'fires', 'cyber', 'general',
]);

const VALID_SEVERITIES = new Set([
  'critical', 'high', 'medium', 'low', 'info',
]);

const SYSTEM_PROMPT = `Tu es un analyste de veille stratégique pour la France. Classifie cet article de presse.

Réponds UNIQUEMENT en JSON valide :
{"category":"<valeur>","severity":"<valeur>"}

Catégories possibles : social, security, energy, weather, transport, infrastructure, health, finance, floods, fires, cyber, general
Sévérités possibles : critical, high, medium, low, info`;

/**
 * Classify a news article using Groq LLM.
 *
 * @param {string} apiKey - Groq API key
 * @param {string} title - Article title
 * @param {string | null} description - Article description (nullable)
 * @returns {Promise<{ category: string; severity: string } | null>}
 *   Validated result or null (timeout, parse error, invalid values).
 *   Throws on HTTP errors (429, 500, etc.) so caller can stop the pass.
 */
export async function classifyWithGroq(apiKey, title, description) {
  const desc = (description ?? '').slice(0, 500);
  const userPrompt = `Titre : ${title}\nDescription : ${desc}`;

  /** @type {Response} */
  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'FranceMonitor/1.0',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 80,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });
  } catch {
    // Timeout or network error — return null (caller continues to next candidate)
    console.warn('[groq-classifier] timeout or network error');
    return null;
  }

  if (!res.ok) {
    // HTTP error (429, 500, etc.) — throw so caller stops the pass
    const body = await res.text().catch(() => '');
    const err = new Error(`Groq HTTP ${res.status}`);
    /** @type {any} */ (err).status = res.status;
    /** @type {any} */ (err).body = body.slice(0, 200);
    throw err;
  }

  // Parse response
  let parsed;
  try {
    const body = await res.json();
    const content = body?.choices?.[0]?.message?.content ?? '';
    parsed = JSON.parse(content);
  } catch {
    console.warn('[groq-classifier] invalid JSON in response');
    return null;
  }

  // Validate
  const category = String(parsed?.category ?? '').toLowerCase();
  const severity = String(parsed?.severity ?? '').toLowerCase();

  if (!VALID_CATEGORIES.has(category) || !VALID_SEVERITIES.has(severity)) {
    console.warn('[groq-classifier] invalid category/severity:', { category, severity });
    return null;
  }

  return { category, severity };
}
