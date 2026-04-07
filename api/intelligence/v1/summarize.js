// api/intelligence/v1/summarize.js — Vercel Edge Function
// POST { text: string }
// → { summary: string } | { error: string }
// La clé Groq reste côté serveur (jamais dans le bundle client).

export const config = { runtime: 'edge' };

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama3-8b-8192';
const MAX_INPUT_CHARS = 4000;

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
    text = typeof body?.text === 'string' ? body.text.trim() : '';
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

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: 'Tu es un analyste français. Résume en 1 seule courte phrase factuelle.' },
          { role: 'user', content: truncated },
        ],
        max_tokens: 120,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!groqRes.ok) {
      return new Response(JSON.stringify({ error: `Groq upstream ${groqRes.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const data = await groqRes.json();
    const summary = data.choices?.[0]?.message?.content?.trim() ?? '';

    return new Response(JSON.stringify({ summary }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Groq fetch failed', message: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
