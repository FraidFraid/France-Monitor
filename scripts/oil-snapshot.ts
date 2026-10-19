// scripts/oil-snapshot.ts : tableau de bord pétrole calculé sur la VM (minuteur fm-oil) avec le code même du navigateur
// (src/services/oil.ts), écrit dans un fichier lu par /api/energy/oil-dashboard. Le navigateur le lit d'abord : une requête au
// lieu d'environ 90 (pages SDES, communiqués mensuels Énergies et Mobilités, Eurostat, JODI) à chaque démarrage.
// Construit par esbuild en un seul fichier Node (npm run build:oil-snapshot → dist-node/oil-snapshot.mjs) :
//   node dist-node/oil-snapshot.mjs --out /var/lib/francemonitor/data/oil-dashboard.json
// Pages lues en direct depuis la VM (mêmes domaines que api/_handlers/oil-proxy.js), DOMParser fourni par happy-dom.
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Window } from 'happy-dom';
import { OIL_SNAPSHOT_VERSION, fetchOilDashboard } from '../src/services/oil.ts';

const UA = 'FranceMonitor/1.0 (tableau de bord petrole ; https://www.francemonitor.com)';
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const OUT = outAt >= 0 ? args[outAt + 1] : 'oil-dashboard.json';
const API_BASE = process.env.FM_API_BASE ?? 'http://127.0.0.1:3000';

const win = new Window();
(globalThis as unknown as { DOMParser: unknown }).DOMParser = win.DOMParser;

// Le service passe par le relais du site (/api/oil-proxy?url=…) : ici, lecture directe de l'adresse relayée.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (raw.startsWith('/api/oil-proxy?')) {
    const target = new URLSearchParams(raw.slice(raw.indexOf('?') + 1)).get('url') ?? '';
    return nativeFetch(target, { ...init, headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow' });
  }
  // Autres routes du site (historique des prix carburants) : l'API locale de la VM.
  if (raw.startsWith('/')) return nativeFetch(`${API_BASE}${raw}`, init);
  return nativeFetch(input, init);
};

async function main(): Promise<void> {
  const t0 = Date.now();
  const dashboard = await fetchOilDashboard({ jodi: true, snapshot: false });
  const body = { version: OIL_SNAPSHOT_VERSION, generatedAt: new Date().toISOString(), dashboard };
  await mkdir(dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body)}\n`, 'utf8');
  await rename(tmp, OUT);
  const s = dashboard.sourceStatus as unknown as Record<string, string>;
  const failed = Object.entries(s).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}=${v}`);
  console.log(`[oil] tableau écrit en ${Math.round((Date.now() - t0) / 1000)} s → ${OUT} ; stocks ${dashboard.stocks.nationalStocksDays ?? 'n.d.'} j ;`
    + ` sources ${failed.length === 0 ? 'toutes lues' : `en défaut : ${failed.join(', ')}`}`);
  await win.happyDOM.close();
}

// Sortie explicite : connexions gardées ouvertes et minuteries du service retiendraient le processus.
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
