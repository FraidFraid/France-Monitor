// api/_handlers/outages/now.js : pannes de téléphone et d'internet en cours, toutes sources et tous opérateurs confondus (21/10/2026).
// Fusion (api/_lib/outages-now.js) des relevés déjà tenus par /api/outages/telecom (ARCEP, presse) et /api/outages/internet (IODA,
// Cloudflare Radar) : aucune lecture de source de plus. Réponse légère, relue toutes les 2 min par chaque page ; toujours 200.
import { ARCEP_MAX_AGE_MS, LIVE_MAX_AGE_MS, outagesNow } from '../../_lib/outages-now.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';
import { loadInternet } from './internet.js';
import { loadTelecom } from './telecom.js';

export const CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';

const fresh = (iso, now, maxAge) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) && now - t <= maxAge;
};

/** Réponse complète (OutagesNowResponse) ; ne lève jamais. */
export async function loadOutagesNow(now = Date.now(), { readTelecom = loadTelecom, readInternet = loadInternet } = {}) {
  const [telecom, internet] = await Promise.all([readTelecom(now), readInternet(now)]);
  return {
    generatedAt: new Date(now).toISOString(),
    outages: outagesNow({ telecom, internet, power: null, cloud: null, now }),
    sources: [
      { source: 'presse', readAt: telecom.press ? new Date(now).toISOString() : null, ok: telecom.press !== undefined },
      { source: 'arcep', readAt: telecom.file?.publishedAt ?? null, ok: fresh(telecom.file?.publishedAt, now, ARCEP_MAX_AGE_MS) },
      { source: 'ioda', readAt: internet.iodaReadAt ?? null, ok: fresh(internet.iodaReadAt, now, LIVE_MAX_AGE_MS) },
      { source: 'radar', readAt: internet.radar?.readAt ?? null, ok: Boolean(internet.radar?.configured) && fresh(internet.radar?.readAt, now, LIVE_MAX_AGE_MS) },
    ],
    errors: [...telecom.errors, ...internet.errors],
  };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  sendSourceJson(res, await loadOutagesNow(Date.now()), { ok: true, cacheControl: CACHE_CONTROL });
}
