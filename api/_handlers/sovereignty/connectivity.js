// api/_handlers/sovereignty/connectivity.js : visibilité des grands réseaux français et points d'échange (spec 2026-10-04 souveraineté
// § 3.3 ; contrats § 2.6). Dernier relevé RIPEstat (lecture lancée si elle est due), série de 30 jours, annuaire PeeringDB, chacun avec
// sa date. 200 si RIPEstat ou PeeringDB est servi ; 502 sinon. Échéance de 15 s : une lecture plus longue continue en arrière-plan,
// le relevé précédent est servi avec la note « RIPEstat : lecture en cours ». Hors score.
import { MAJOR_NETWORKS, RIPE_PENDING_NOTE, RIPE_PREFIXES_KEY, RIPE_SAMPLES_KEY, RIPE_SAMPLES_MAX_AGE_MS, emptyRipe, ensureRipeFresh, storedRipe } from '../../_lib/ripestat.js';
import { loadExchanges } from '../../_lib/peeringdb.js';
import { readSeries } from '../../_lib/kv-history.js';
import { ROUTE_BUDGET_MS, withinBudget } from '../../_lib/route-budget.js';
import { handlePreflight, sendSourceJson, sourceError } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=1800, stale-while-revalidate=3600';
export const PENDING_CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';
const PEERINGDB_LATE_ERROR = 'PeeringDB : délai dépassé (échéance de la route)';

/**
 * Réponse complète (ConnectivityResponse) ; ne lève jamais.
 * @param {number} [now]
 * @param {{ budgetMs?: number }} [options]
 */
export async function loadConnectivity(now = Date.now(), { budgetMs = ROUTE_BUDGET_MS } = {}) {
  const ripeWork = ensureRipeFresh(now).catch((err) => emptyRipe([sourceError('RIPEstat', err)]));
  const [ripe, ix] = await Promise.all([
    withinBudget(ripeWork, budgetMs, () => storedRipe(now, RIPE_PENDING_NOTE)),
    withinBudget(loadExchanges(now), budgetMs, () => ({ exchanges: null, errors: [PEERINGDB_LATE_ERROR] })),
  ]);
  const [samples, prefixSamples] = await Promise.all([
    readSeries(RIPE_SAMPLES_KEY, { maxAgeMs: RIPE_SAMPLES_MAX_AGE_MS, now }),
    readSeries(RIPE_PREFIXES_KEY, { maxAgeMs: RIPE_SAMPLES_MAX_AGE_MS, now }),
  ]);
  // Les six réseaux figurent toujours : un réseau non lu est nommé avec sa panne, jamais omis ni compté à 0.
  const unread = MAJOR_NETWORKS.filter((m) => !ripe.networks.some((n) => n.asn === m.asn))
    .map((m) => ({ asn: m.asn, name: m.name, error: ripe.errors.find((e) => e.startsWith(`RIPEstat, AS${m.asn} `)) ?? null }));
  return {
    readAt: ripe.readAt, snapshotAt: ripe.snapshotAt, networks: ripe.networks,
    unread,
    history: {
      samples: samples.map((s) => ({ at: s.at, minPct: s.minPct })), since: samples[0]?.at ?? null,
      prefixSamples: prefixSamples.map((s) => ({ at: s.at, prefixes: s.prefixes })),
    },
    exchanges: ix.exchanges, errors: [...ripe.errors, ...ix.errors],
  };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadConnectivity(Date.now());
  const ok = body.snapshotAt !== null || body.exchanges !== null;
  sendSourceJson(res, body, { ok, cacheControl: body.errors.includes(RIPE_PENDING_NOTE) ? PENDING_CACHE_CONTROL : CACHE_CONTROL });
}
