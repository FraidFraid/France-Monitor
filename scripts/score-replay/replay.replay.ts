// scripts/score-replay/replay.replay.ts : rejeu de l'indice national sur des instants passés (26/10/2026). Recalcule la note avec le
// moteur réel (buildFranceCountrySnapshot, computeISNR), jamais une copie de la formule, à partir de la presse archivée en base
// (/api/news, articles déjà classés et géolocalisés par le serveur). Sert à mesurer un réglage du moteur AVANT de le mettre en ligne.
//
// Limites, écrites dans chaque rapport : seules la presse et l'ISNR qui en découle sont rejoués. Les autres entrées (cyber, énergie,
// transports, défense, finance, météo) ne sont pas archivées : elles sont vides, donc la note rejouée est une note « presse seule »,
// à comparer entre réglages et entre journées, pas à la note affichée ce jour-là (voir la colonne « note relevée »).
//
// Deux modes de presse :
//   page    : les 1 000 articles les plus récents des 24 h, comme la page les charge (src/services/rss.ts, fetchFromIngestApi) ;
//   complet : tous les articles des 24 h ;
//   evenements : tous les articles des 24 h, un seul par événement consolidé (eventId du serveur) : un sujet repris par cent
//                médias compte une fois.
//
// Lancement (hors de la suite de tests) :
//   npm run replay:score
//   REPLAY_AT=2026-10-17T18:09:00Z,2026-10-12T12:00:00Z npm run replay:score
//   REPLAY_OUT=docs/rejeu/rejeu-2026-10-26.md npm run replay:score
// Cache des articles : node_modules/.cache/score-replay (une lecture de la base par instant et par mode).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { it } from 'vitest';
import { buildFranceCountrySnapshot, type FranceRawData } from '../../src/services/france-country-intel.ts';
import { computeISNR, findDepartmentByCoords } from '../../src/services/stability-index.ts';
import { mapIngestItem, type IngestApiItem } from '../../src/services/rss.ts';
import type { ISNRData, NewsItem } from '../../src/types/index.ts';

const SITE = process.env.REPLAY_SITE ?? 'https://www.francemonitor.com';
const CACHE_DIR = path.resolve('node_modules/.cache/score-replay');
const DAY_MS = 24 * 3_600_000;
const PAGE_LIMIT = 1000;
const MAX_PAGES = 12;

/** Instants rejoués par défaut : journées calmes de référence, montée lycéenne, journée du 17/10 et sa nuit. */
const DEFAULT_INSTANTS: ReadonlyArray<{ at: string; label: string }> = [
  { at: '2026-10-12T12:00:00Z', label: 'dimanche 12/10, journée de référence' },
  { at: '2026-10-13T18:00:00Z', label: 'lundi 13/10, mobilisation lycéenne' },
  { at: '2026-10-14T18:00:00Z', label: 'mardi 14/10' },
  { at: '2026-10-16T12:00:00Z', label: 'jeudi 16/10, veille du 17' },
  { at: '2026-10-17T18:09:00Z', label: 'vendredi 17/10, soirée de la mobilisation' },
  { at: '2026-10-18T01:38:00Z', label: 'nuit du 17 au 18/10' },
  { at: '2026-10-21T12:00:00Z', label: 'mardi 21/10, crash d’un Mirage près de Nancy' },
];

type Mode = 'page' | 'complet' | 'evenements';

async function fetchJson(url: string): Promise<unknown> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) throw new Error(`${url} : HTTP ${resp.status}`);
  return resp.json();
}

/** Articles archivés des 24 h avant `atMs` (mode page : les 1 000 plus récents ; complet : tous, par pages). */
async function archivedItems(atMs: number, mode: Mode): Promise<IngestApiItem[]> {
  const file = path.join(CACHE_DIR, `${new Date(atMs).toISOString().replace(/[:.]/g, '-')}-${mode}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8')) as IngestApiItem[];
  } catch {
    // pas encore en cache
  }
  const since = new Date(atMs - DAY_MS).toISOString();
  const out: IngestApiItem[] = [];
  let until = new Date(atMs).toISOString();
  for (let page = 0; page < (mode === 'page' ? 1 : MAX_PAGES); page += 1) {
    const body = await fetchJson(`${SITE}/api/news?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=${PAGE_LIMIT}`) as { items?: IngestApiItem[] };
    const items = body.items ?? [];
    out.push(...items);
    if (items.length < PAGE_LIMIT) break;
    const oldest = items[items.length - 1]?.publishedAt;
    if (!oldest) break;
    // Page suivante : strictement avant le plus ancien article lu (les articles de la même seconde sont dédoublonnés plus bas).
    until = new Date(Date.parse(oldest) - 1).toISOString();
  }
  const unique = [...new Map(out.map((i) => [i.id, i])).values()];
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(unique));
  return unique;
}

/** Note relevée ce jour-là par l'ancien historique (créneau de 6 h qui contient l'instant), ou null. */
async function recordedSlots(): Promise<Map<string, { score: number | null; capturedAt: string | null; situations: string[] }>> {
  const body = await fetchJson(`${SITE}/api/situation-history?days=30`) as { slots?: Array<Record<string, unknown>> };
  const map = new Map<string, { score: number | null; capturedAt: string | null; situations: string[] }>();
  for (const s of body.slots ?? []) {
    const situations = Array.isArray(s.situations) ? s.situations.map((x) => String((x as { id?: unknown }).id ?? '')) : [];
    map.set(String(s.slotKey), { score: typeof s.score === 'number' ? s.score : null, capturedAt: typeof s.capturedAt === 'string' ? s.capturedAt : null, situations });
  }
  return map;
}

function slotKeyOf(atMs: number): string {
  const d = new Date(atMs);
  const h = Math.floor(d.getUTCHours() / 6) * 6;
  return `${d.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:00`;
}

function rawFromPress(newsItems: NewsItem[], isnrData: ISNRData): FranceRawData {
  return {
    newsItems, isnrData, cyber: null, meteoAlerts: [], floodSegments: [], railTrains: [], roadEvents: [], urbanJamCount: 0,
    telecomOutages: null, cableAlerts: [], gnssDegraded: null, militaryFlightsCount: 0, maritimeCount: 0, activeFires: [],
    marketData: [], ecowattResponse: null, gasState: null, nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] },
    briefLang: 'fr', oilDashboard: null, fuelTensionDashboard: null,
  };
}

/** Un article par événement consolidé (le plus ancien, comme le premier signalement) ; les articles sans événement restent. */
function onePerEvent(items: NewsItem[]): NewsItem[] {
  const seen = new Set<number>();
  return [...items].sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime()).filter((i) => {
    if (i.eventId === undefined) return true;
    if (seen.has(i.eventId)) return false;
    seen.add(i.eventId);
    return true;
  });
}

/**
 * Étendue sociale (mesure à l'essai) : départements distincts où un article social de gravité moyenne ou plus est localisé par ses
 * coordonnées (jamais par la région du média : un journal régional ne fait pas une manifestation dans chaque département).
 */
function socialBreadth(items: NewsItem[]): number {
  const depts = new Set<string>();
  for (const i of items) {
    const level = i.threat?.level;
    if (i.threat?.category !== 'social' || (level !== 'medium' && level !== 'high' && level !== 'critical')) continue;
    if (i.lon === undefined || i.lat === undefined) continue;
    const d = findDepartmentByCoords(i.lon, i.lat);
    if (d) depts.add(d);
  }
  return depts.size;
}

const avg = (xs: number[]): number => (xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));

interface Row {
  label: string; at: string; mode: Mode; articles: number; hours: number; high: number; critical: number;
  isnr: number; social: number; socialDepts: number; breadth: number; security: number; signal: number; score: number;
  situations: string; recorded: string;
}

async function replay(at: string, label: string, mode: Mode, slots: Awaited<ReturnType<typeof recordedSlots>>): Promise<Row> {
  const atMs = Date.parse(at);
  const mapped = (await archivedItems(atMs, mode === 'page' ? 'page' : 'complet')).map(mapIngestItem).filter((i): i is NewsItem => i !== null);
  const items = mode === 'evenements' ? onePerEvent(mapped) : mapped;
  const oldest = items.reduce((m, i) => Math.min(m, i.pubDate.getTime()), atMs);
  const isnr = computeISNR(items, [], [], null, '24h', null, atMs);
  const snap = buildFranceCountrySnapshot(rawFromPress(items, isnr), { now: atMs });
  const rec = slots.get(slotKeyOf(atMs));
  return {
    label, at, mode,
    articles: items.length,
    hours: Math.round((atMs - oldest) / 3_600_000 * 10) / 10,
    high: snap.signals.highNews,
    critical: snap.signals.criticalNews,
    isnr: isnr.nationalScore,
    social: avg(isnr.scores.map((s) => s.dimensions.social)),
    socialDepts: isnr.scores.filter((s) => s.dimensions.social >= 40 || s.dimensions.security >= 50).length,
    breadth: socialBreadth(mapped),
    security: snap.axes.security,
    signal: snap.axes.signal,
    score: snap.score,
    situations: snap.situations.map((s) => `${s.id} (${s.severity})`).join(', ') || 'aucune',
    recorded: rec?.score != null ? `${rec.score} à ${rec.capturedAt?.slice(11, 16)} (${rec.situations.join(', ') || 'aucune'})` : 'pas de relevé',
  };
}

function report(rows: Row[]): string {
  const head = '| Instant (UTC) | Mode | Articles | Heures couvertes | Élevés | Critiques | ISNR national | Social moyen | Départements tendus | Étendue sociale | Sécurité | Signal | Note presse seule | Situations | Note relevée ce jour-là |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map((r) => `| ${r.at.slice(0, 16).replace('T', ' ')} · ${r.label} | ${r.mode} | ${r.articles} | ${r.hours} | ${r.high} | ${r.critical} | ${r.isnr} | ${r.social} | ${r.socialDepts} | ${r.breadth} | ${r.security} | ${r.signal} | ${r.score} | ${r.situations} | ${r.recorded} |`);
  return [
    `# Rejeu de l'indice national (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
    '',
    'Moteur réel du dépôt, presse archivée seule : les autres entrées (cyber, énergie, transports, défense, finance, météo) sont vides.',
    'La « note presse seule » se compare entre réglages et entre journées ; la « note relevée » est celle de l\'ancien historique, toutes sources comprises.',
    '',
    head, sep, ...lines, '',
  ].join('\n');
}

it('rejeu de l’indice', { timeout: 15 * 60_000 }, async () => {
  const instants = process.env.REPLAY_AT
    ? process.env.REPLAY_AT.split(',').map((at) => ({ at: at.trim(), label: '' }))
    : DEFAULT_INSTANTS;
  const modes: Mode[] = process.env.REPLAY_MODES ? process.env.REPLAY_MODES.split(',') as Mode[] : ['page', 'complet', 'evenements'];
  const slots = await recordedSlots();
  const rows: Row[] = [];
  for (const { at, label } of instants) {
    for (const mode of modes) rows.push(await replay(at, label, mode, slots));
  }
  const md = report(rows);
  process.stdout.write(`\n${md}\n`);
  if (process.env.REPLAY_OUT) {
    await mkdir(path.dirname(process.env.REPLAY_OUT), { recursive: true });
    await writeFile(process.env.REPLAY_OUT, md);
  }
});
