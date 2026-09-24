// api/_handlers/ministers/composition.js — route Vercel mince vers la logique
// partagée _shared/ministers.js (dead en prod avant cet audit : seul le
// plugin dev src/plugins/ministers-proxy.ts l'appelait).
// Cache CDN : 6h.

import { handleMinistersRequest, applyMinistersCdnCache } from '../../_shared/ministers.js';

const TTL_SEC = 21600;

/**
 * @param {{ url?: string }} req
 * @param {{ statusCode: number, setHeader: (k: string, v: string) => void, end: (b?: unknown) => unknown }} res
 */
export default async function handler(req, res) {
  applyMinistersCdnCache(res, TTL_SEC);
  const handled = await handleMinistersRequest(req, res);
  if (!handled) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Route ministre inconnue' }));
  }
}
