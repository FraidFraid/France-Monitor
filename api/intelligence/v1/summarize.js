// api/intelligence/v1/summarize.js — Vercel Edge Function
// POST { text: string }
// → { summary: string } | { error: string }
// La clé Groq reste côté serveur (jamais dans le bundle client).

export const config = { runtime: 'edge' };

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_INPUT_CHARS = 4000;
const MAX_FALLBACK_CHARS = 220;

function sanitizeInput(value) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFallbackSummary(text) {
  const clean = sanitizeInput(text);
  if (!clean) {
    return '';
  }

  const firstSentence = clean.match(/(.+?[.!?])(\s|$)/u)?.[1]?.trim() ?? clean;
  if (firstSentence.length <= MAX_FALLBACK_CHARS) {
    return firstSentence;
  }

  return `${firstSentence.slice(0, MAX_FALLBACK_CHARS - 1).trimEnd()}...`;
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const GROQ_API_KEY = (typeof process !== 'undefined' ? process.env.GROQ_API_KEY : undefined)
    ?? globalThis?.env?.GROQ_API_KEY;

  if (!GROQ_API_KEY) {
    return new Response(JSON.stringify({ error: 'Groq not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  let text;
  try {
    const body = await request.json();
    text = typeof body?.text === 'string' ? sanitizeInput(body.text) : '';
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  if (!text) {
    return new Response(JSON.stringify({ error: 'Missing text field' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Truncate input to avoid excessive token usage
  const truncated = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
  const fallbackSummary = buildFallbackSummary(truncated);

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'User-Agent': 'FranceMonitor/1.0',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: 'Tu es un analyste français. Résume en 1 seule courte phrase factuelle.' },
          { role: 'user', content: truncated },
        ],
        temperature: 0.2,
        max_tokens: 120,
      }),
      signal: AbortSignal.timeout(8000),
    });

    const groqBody = await groqRes.text();
    const parsedBody = parseJsonMaybe(groqBody);

    if (groqRes.status === 429) {
      console.error('[summarize] Groq rate limited', {
        status: groqRes.status,
        model: GROQ_MODEL,
        upstream: typeof parsedBody === 'string' ? parsedBody.slice(0, 500) : parsedBody,
      });

      return new Response(JSON.stringify({
        error: 'groq_rate_limited',
        message: 'Groq rate limit exceeded',
        retryAfterSeconds: 2,
        summary: fallbackSummary,
        degraded: true,
        upstream: parsedBody,
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (!groqRes.ok) {
      console.error('[summarize] Groq upstream error', {
        status: groqRes.status,
        model: GROQ_MODEL,
        upstream: typeof parsedBody === 'string' ? parsedBody.slice(0, 500) : parsedBody,
      });

      return new Response(JSON.stringify({
        error: 'groq_upstream_error',
        status: groqRes.status,
        summary: fallbackSummary,
        degraded: true,
        upstream: parsedBody,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const data = parseJsonMaybe(groqBody);
    const summary = sanitizeInput(data.choices?.[0]?.message?.content ?? '') || fallbackSummary;

    return new Response(JSON.stringify({ summary }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[summarize] Unhandled error', err);
    return new Response(JSON.stringify({
      error: 'internal_error',
      message: err instanceof Error ? err.message : String(err),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
