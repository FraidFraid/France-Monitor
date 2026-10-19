// scripts/vm-snapshot.ts : relevés calculés sur la VM avec le code même du navigateur, écrits dans un fichier que l'API sert tel
// quel ; le navigateur les lit d'abord (une requête) et ne refait le calcul lui-même que si le relevé manque ou est trop vieux.
//   --what oil  : tableau de bord pétrole (minuteur fm-oil, 3 h) ; ~90 requêtes du navigateur évitées (SDES, communiqués, JODI)
//   --what fuel : tension carburants nationale (minuteur fm-fuel, 15 min) ; 98 pages du flux des prix carburants évitées
// Construit par esbuild en un seul fichier Node (npm run build:vm-snapshot → dist-node/vm-snapshot.mjs) :
//   node dist-node/vm-snapshot.mjs --what oil --out /var/lib/francemonitor/data/oil-dashboard.json
// Pages lues en direct depuis la VM (relais du site réécrits vers l'adresse relayée), DOMParser fourni par happy-dom ; le
// localStorage du service (historique de la tension carburants sur 7 jours) est gardé dans un fichier à côté du relevé.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Window } from 'happy-dom';
import { OIL_SNAPSHOT_VERSION, fetchOilDashboard } from '../src/services/oil.ts';
import { FUEL_SNAPSHOT_VERSION, fetchFuelTensionDashboard } from '../src/services/fuel-tension.ts';

const UA = 'FranceMonitor/1.0 (releves de la VM ; https://www.francemonitor.com)';
const args = process.argv.slice(2);
const arg = (name: string, def: string): string => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? def : def; };
const WHAT = arg('--what', 'oil');
const OUT = arg('--out', `${WHAT}-snapshot.json`);
const STORE = arg('--store', `${OUT}.storage.json`);
const API_BASE = process.env.FM_API_BASE ?? 'http://127.0.0.1:3000';

const win = new Window();
(globalThis as unknown as { DOMParser: unknown }).DOMParser = win.DOMParser;

// localStorage du service gardé d'un passage à l'autre (historique de la tension carburants).
const store: Record<string, string> = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, string> : {};
const localStorage = {
  getItem: (k: string): string | null => store[k] ?? null,
  setItem: (k: string, v: string): void => { store[k] = String(v); },
  removeItem: (k: string): void => { delete store[k]; },
};
(globalThis as unknown as { window: unknown }).window = { localStorage };

// Relais du site (/api/oil-proxy?url=…, /api/fuel-prices-proxy?url=…) : lecture directe de l'adresse relayée ; autres routes du
// site (historique des prix carburants) : l'API locale de la VM.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^\/api\/[a-z-]*proxy\?/.test(raw)) {
    const target = new URLSearchParams(raw.slice(raw.indexOf('?') + 1)).get('url') ?? '';
    return nativeFetch(target, { ...init, headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow' });
  }
  if (raw.startsWith('/')) return nativeFetch(`${API_BASE}${raw}`, init);
  return nativeFetch(input, init);
};

async function build(): Promise<{ version: number; summary: string; body: unknown }> {
  if (WHAT === 'fuel') {
    const dashboard = await fetchFuelTensionDashboard(undefined, { snapshot: false });
    return { version: FUEL_SNAPSHOT_VERSION, body: dashboard,
      summary: `${dashboard.national.stationCount} stations, ${dashboard.national.departmentCount} départements, tension ${dashboard.national.tensionLevel}${dashboard.degraded ? ' (dégradé)' : ''}` };
  }
  const dashboard = await fetchOilDashboard({ jodi: true, snapshot: false });
  const failed = Object.entries(dashboard.sourceStatus as unknown as Record<string, string>).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}=${v}`);
  return { version: OIL_SNAPSHOT_VERSION, body: dashboard,
    summary: `stocks ${dashboard.stocks.nationalStocksDays ?? 'n.d.'} j ; sources ${failed.length === 0 ? 'toutes lues' : `en défaut : ${failed.join(', ')}`}` };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const { version, summary, body } = await build();
  const file = { version, generatedAt: new Date().toISOString(), dashboard: body };
  await mkdir(dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file)}\n`, 'utf8');
  await rename(tmp, OUT);
  writeFileSync(STORE, JSON.stringify(store));
  console.log(`[${WHAT}] relevé écrit en ${Math.round((Date.now() - t0) / 1000)} s → ${OUT} ; ${summary}`);
  await win.happyDOM.close();
}

// Sortie explicite : connexions gardées ouvertes et minuteries du service retiendraient le processus.
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
