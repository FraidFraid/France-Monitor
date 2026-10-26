#!/usr/bin/env node
// scripts/score-recorder.mjs : enregistreur de la note nationale sur la VM (minuteur fm-score-recorder, toutes les 15 min). Ouvre le
// site comme un visiteur, dans un Chromium sans écran, avec ?recorder=1 : la page calcule la note avec son propre code et la remet
// dans window.__fmRecorderSnapshot (src/services/situation-history.ts) au lieu de l'envoyer. Le relevé est ajouté au fichier lu par
// /api/situation-history (api/_lib/score-history.js), une ligne JSON par relevé, 35 jours gardés.
//
// Playwright n'est pas une dépendance du projet : PLAYWRIGHT_MODULE désigne celui installé par deploy/oracle/install-score-recorder.sh.
// Profil gardé d'un passage à l'autre (PROFILE_DIR) : le lissage de la note lit le relevé précédent dans le stockage de la page.
//   PLAYWRIGHT_MODULE=/opt/fm-recorder/node_modules/playwright/index.mjs node scripts/score-recorder.mjs
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const URL_TO_RECORD = process.env.FM_RECORDER_URL ?? 'https://www.francemonitor.com/?view=app&recorder=1';
const OUT = process.env.SCORE_HISTORY_FILE ?? '/var/lib/francemonitor/data/score-history.jsonl';
const PROFILE_DIR = process.env.PROFILE_DIR ?? '/var/lib/francemonitor/recorder/profile';
/** Au-delà, le relevé le plus récent part tel quel (sa couverture dit ce qui manquait) ; la page en remet un après 3 min. */
const DEADLINE_MS = Number(process.env.FM_RECORDER_DEADLINE_MS ?? 4.5 * 60_000);
const KEEP_MS = 35 * 24 * 3_600_000;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const started = Date.now();
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true,
  // CHROME_PATH : essai sur un poste avec son Chrome installé ; absent sur la VM (Chromium de Playwright).
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  viewport: { width: 1440, height: 900 },
  // Pas de service worker : une ancienne version de l'appli mise en cache calculerait avec un ancien code.
  serviceWorkers: 'block',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
let snapshot = null;
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(URL_TO_RECORD, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  while (Date.now() - started < DEADLINE_MS) {
    await page.waitForTimeout(5_000);
    snapshot = await page.evaluate(() => window.__fmRecorderSnapshot ?? null);
    if (snapshot?.coverage && snapshot.coverage.read >= snapshot.coverage.total) break;
  }
} finally {
  await context.close();
}

if (!snapshot) {
  console.error(`[score-recorder] ARRET : aucun relevé remis par la page en ${Math.round((Date.now() - started) / 1000)} s`);
  process.exit(1);
}

// Fichier réécrit d'un bloc (fichier temporaire puis renommage) : jamais à moitié écrit pour /api/situation-history.
const now = Date.now();
let kept = [];
try {
  kept = (await readFile(OUT, 'utf8')).split('\n').filter((line) => {
    if (!line.trim()) return false;
    try { return now - Date.parse(JSON.parse(line).capturedAt) < KEEP_MS; } catch { return false; }
  });
} catch {
  // premier relevé
}
kept.push(JSON.stringify(snapshot));
await mkdir(dirname(OUT), { recursive: true });
await writeFile(`${OUT}.tmp`, `${kept.join('\n')}\n`);
await rename(`${OUT}.tmp`, OUT);

const cov = snapshot.coverage;
console.log(`[score-recorder] relevé ${snapshot.capturedAt} : note ${snapshot.score}, ${cov ? `${cov.read}/${cov.total} sources` : 'couverture inconnue'}${cov?.missing?.length ? ` (manquent : ${cov.missing.join(', ')})` : ''}, ${Math.round((now - started) / 1000)} s, ${kept.length} relevés gardés`);
