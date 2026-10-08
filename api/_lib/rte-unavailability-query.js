/**
 * Requête RTE « generation_unavailabilities » (nucléaire), partagée par la fonction de
 * production et le proxy de dev. Sans paramètre RTE ne renvoie que les publications du jour :
 * on demande les indisponibilités qui chevauchent [J-3, J+15], dernière version seulement.
 * Format de date du guide : YYYY-MM-DDThh:mm:ssZ. Pagination : 206 + en-tête continuation_token.
 */

export const MAX_PAGES = 10;

const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function buildUnavailabilityParams(now = Date.now()) {
  return new URLSearchParams({
    date_type: 'EVENT_DATE',
    start_date: iso(now - 3 * 86_400_000),
    end_date: iso(now + 15 * 86_400_000),
    fuel_type: 'NUCLEAR',
    last_version: 'true',
  });
}

/** Renvoie { ok: true, items } ou { ok: false, error }. Une pagination non terminée est une erreur. */
export async function fetchAllUnavailabilities(url, accessToken) {
  const params = buildUnavailabilityParams();
  const items = [];
  let token = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    if (token) headers.continuation_token = token;
    const resp = await fetch(`${url}?${params}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (resp.status !== 200 && resp.status !== 206) return { ok: false, error: `RTE API error: ${resp.status}` };
    const raw = await resp.json();
    items.push(...(Array.isArray(raw) ? raw : (raw.generation_unavailabilities ?? raw.unavailabilities ?? [])));
    token = resp.status === 206 ? resp.headers.get('continuation_token') : null;
    if (!token) return { ok: true, items };
  }
  return { ok: false, error: 'RTE API : pagination incomplète' };
}
