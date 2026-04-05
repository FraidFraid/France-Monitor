/**
 * gas-pir-proxy.ts — Vite dev plugin
 *
 * Passthrough stateless pour /api/energy/gas-pir.
 * Même logique que api/energy/gas-pir.js, sans cache in-process
 * (le cache est uniquement utile en prod Vercel pour amortir les cold starts).
 *
 * Stratégie de fetch :
 *   - Le filtre ?points= de l'API ENTSOG ne fonctionne pas correctement.
 *   - On interroge par operatorKey pour les deux TSOs français :
 *     - FR-TSO-0003 (NaTran) : Taisnières (ITP-00115), Oltingue (ITP-00039), Obergailbach (ITP-00137)
 *     - FR-TSO-0002 (TERÉGA) : VIP PIRINEOS (ITP-00304) = Biriatou + Larrau fusionnés depuis oct. 2014
 */

import type { Plugin } from 'vite';

const ENTSOG_URL = 'https://transparency.entsog.eu/api/v1/operationaldata';
// PIR points attendus dans la réponse après merge des deux opérateurs
const PIR_POINTS = ['ITP-00304', 'ITP-00137', 'ITP-00115', 'ITP-00039'];

function isoDate(deltaDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function buildUrl(operatorKey: string, from: string, to: string): string {
  const url = new URL(ENTSOG_URL);
  url.searchParams.set('indicator', 'Physical Flow');
  url.searchParams.set('periodType', 'day');
  url.searchParams.set('operatorKey', operatorKey);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('limit', '300');
  return url.toString();
}

interface EntsogItem {
  pointKey: string;
  pointLabel: string;
  directionKey: string;
  value: number | null | string;
  periodFrom: string | null;
}

interface PirPoint {
  pointKey: string;
  pointLabel: string;
  flowGWhDay: number;
  periodFrom: string | null;
}

function extractNetFlow(items: EntsogItem[], pointKey: string): PirPoint | null {
  const pointItems = items.filter(it => it.pointKey === pointKey);
  if (pointItems.length === 0) return null;

  const byDir: Record<string, EntsogItem[]> = { entry: [], exit: [] };
  for (const it of pointItems) {
    if (it.directionKey === 'entry' || it.directionKey === 'exit') {
      byDir[it.directionKey].push(it);
    }
  }

  function latestValue(dirItems: EntsogItem[]): { value: number; periodFrom: string } | null {
    const sorted = dirItems
      .filter(it => it.value !== null && it.value !== '' && it.value !== undefined)
      .sort((a, b) => (b.periodFrom ?? '').localeCompare(a.periodFrom ?? ''));
    if (sorted.length === 0) return null;
    return { value: Number(sorted[0].value), periodFrom: sorted[0].periodFrom ?? '' };
  }

  const entryResult = latestValue(byDir.entry);
  const exitResult = latestValue(byDir.exit);
  if (!entryResult && !exitResult) return null;

  const entryGWh = entryResult ? entryResult.value / 1_000_000 : 0;
  const exitGWh = exitResult ? exitResult.value / 1_000_000 : 0;
  const flowNet = entryGWh - exitGWh;

  const periodFrom = [entryResult?.periodFrom, exitResult?.periodFrom]
    .filter((x): x is string => Boolean(x))
    .sort()
    .at(-1) ?? null;

  const pointLabel = pointItems[0]?.pointLabel ?? pointKey;
  return { pointKey, pointLabel, flowGWhDay: flowNet, periodFrom };
}

export function gasPirProxyPlugin(): Plugin {
  return {
    name: 'gas-pir-proxy',
    configureServer(server) {
      server.middlewares.use('/api/energy/gas-pir', async (_req, res) => {
        try {
          const from = isoDate(-3);
          const to = isoDate(0);

          // Deux requêtes parallèles par operatorKey (le filtre ?points= est ignoré par l'API ENTSOG)
          const [r1, r2] = await Promise.all([
            fetch(buildUrl('FR-TSO-0003', from, to), { signal: AbortSignal.timeout(15_000) }),
            fetch(buildUrl('FR-TSO-0002', from, to), { signal: AbortSignal.timeout(15_000) }),
          ]);

          if (!r1.ok) throw new Error(`ENTSOG FR-TSO-0003 HTTP ${r1.status}`);
          if (!r2.ok) throw new Error(`ENTSOG FR-TSO-0002 HTTP ${r2.status}`);

          const [j1, j2] = await Promise.all([
            r1.json() as Promise<{ operationaldata?: EntsogItem[] }>,
            r2.json() as Promise<{ operationaldata?: EntsogItem[] }>,
          ]);
          const items = [...(j1.operationaldata ?? []), ...(j2.operationaldata ?? [])];

          const points = PIR_POINTS
            .map(key => extractNetFlow(items, key))
            .filter((p): p is PirPoint => p !== null);

          let status: 'ok' | 'partial' | 'error' = 'error';
          if (points.length === PIR_POINTS.length) status = 'ok';
          else if (points.length > 0) status = 'partial';

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ points, fetchedAt: new Date().toISOString(), status }));
        } catch (err) {
          console.error('[gas-pir-proxy]', err);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ points: [], fetchedAt: new Date().toISOString(), status: 'error', error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
