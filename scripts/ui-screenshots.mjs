#!/usr/bin/env node
// scripts/ui-screenshots.mjs — captures de contrôle de la v2 (spec 2026-09-29 § 9) : Chrome sans
// interface, 1 600 × 1 000 et 390 × 844, après 25 s de chargement, dans un contexte neuf (nouvelle
// visite). Playwright n'est pas une dépendance du projet : PLAYWRIGHT_MODULE désigne un playwright
// déjà présent sur le poste, CHROME_PATH le Chrome installé.
//   PLAYWRIGHT_MODULE=/…/node_modules/playwright/index.mjs node scripts/ui-screenshots.mjs [url] [dossier]
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const url = process.argv[2] ?? 'http://localhost:3001/?view=app';
const outDir = process.argv[3] ?? '.superpowers/screens';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const executablePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '');
const browser = await chromium.launch({ executablePath, headless: true });
try {
  for (const [name, width, height] of [['bureau', 1600, 1000], ['telephone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(25_000);
    const file = path.join(outDir, `${stamp}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
}
