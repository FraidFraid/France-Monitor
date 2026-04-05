/**
 * gas-pir-proxy.ts — Vite dev plugin
 *
 * Passthrough stateless pour /api/energy/gas-pir.
 * Même logique que api/energy/gas-pir.js, sans cache in-process
 * (le cache est uniquement utile en prod Vercel pour amortir les cold starts).
 */

import type { Plugin } from 'vite';

const ENTSOG_URL = 'https://transparency.entsog.eu/api/v1/operationaldata';
const PIR_POINTS = ['ITP-00033', 'ITP-00018', 'ITP-00137', 'ITP-00115', 'ITP-00039'];

function isoDate(deltaDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
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
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        try {
          const from = isoDate(-3);
          const to = isoDate(0);

          const url = new URL(ENTSOG_URL);
          url.searchParams.set('indicator', 'Physical Flow');
          url.searchParams.set('periodType', 'day');
          url.searchParams.set('points', PIR_POINTS.join(','));
          url.searchParams.set('from', from);
          url.searchParams.set('to', to);
          url.searchParams.set('limit', '100');

          const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
          if (!resp.ok) throw new Error(`ENTSOG HTTP ${resp.status}`);

          const json = await resp.json() as { operationaldata?: EntsogItem[] };
          const items = json.operationaldata ?? [];

          const points = PIR_POINTS
            .map(key => extractNetFlow(items, key))
            .filter((p): p is PirPoint => p !== null);

          let status: 'ok' | 'partial' | 'error' = 'error';
          if (points.length === PIR_POINTS.length) status = 'ok';
          else if (points.length > 0) status = 'partial';

          res.statusCode = 200;
          res.end(JSON.stringify({ points, fetchedAt: new Date().toISOString(), status }));
        } catch (err) {
          console.error('[gas-pir-proxy]', err);
          res.statusCode = 200;
          res.end(JSON.stringify({ points: [], fetchedAt: new Date().toISOString(), status: 'error', error: String(err) }));
        }
      });
    },
  };
}
