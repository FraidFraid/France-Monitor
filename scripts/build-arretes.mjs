#!/usr/bin/env node
// scripts/build-arretes.mjs : arrêtés préfectoraux liés aux rassemblements (drones, interdictions, encadrement), relevés dans les
// recueils des actes administratifs des préfectures suivies (api/_lib/arretes-prefectoraux.js) → public/data/arretes-prefectoraux.json.
// En production, le minuteur fm-arretes (toutes les heures) écrit dans /var/lib/francemonitor/data, lu par /api/social/protests.
//   node scripts/build-arretes.mjs [--out <fichier.json>]
// Recueils déjà lus gardés dans le fichier (pas de nouveau téléchargement) ; 12 PDF neufs au plus par préfecture et par passage.
// Aucune donnée personnelle publiée : nature de l'arrêté, jours, heures, communes et phrase qui décrit le rassemblement.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractText, getDocumentProxy } from 'unpdf';
import { PREFECTURES, analyseRecueil, nextPages, publishedDay, recueilLinks } from '../api/_lib/arretes-prefectoraux.js';

const UA = 'FranceMonitor/1.0 (veille des arretes prefectoraux ; https://www.francemonitor.com)';
const MAX_NEW_PER_SITE = 12;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const KEEP_DAYS = 21;

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = outArg >= 0 ? args[outArg + 1] : fileURLToPath(new URL('../public/data/arretes-prefectoraux.json', import.meta.url));

/** Lecture avec une nouvelle tentative (coupure passagère du site), jamais plus. */
async function fetchOk(url, as, tries = 2) {
  for (let i = 0; ; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000), redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return as === 'bytes' ? new Uint8Array(await res.arrayBuffer()) : await res.text();
    } catch (err) {
      if (i + 1 >= tries) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/**
 * Recueils du mois (et du mois précédent) d'une préfecture : page d'entrée, puis année et mois, trois niveaux au plus. Les PDF de
 * chaque page sont gardés (la page d'entrée de la Gironde en met deux « à la une »), et la descente continue jusqu'aux mois.
 */
async function recueilsOf(p, now) {
  const visited = new Set();
  const found = new Map();
  let pages = [`${p.site}${p.root}`];
  for (let depth = 0; depth < 3 && pages.length > 0; depth += 1) {
    const next = [];
    for (const url of pages) {
      visited.add(url);
      const html = await fetchOk(url, 'text');
      for (const l of recueilLinks(html, p.site)) if (!found.has(l.href)) found.set(l.href, l);
      next.push(...nextPages(html, p.site, now).filter((u) => !visited.has(u)));
    }
    pages = [...new Set(next)];
  }
  return [...found.values()];
}

async function readPrevious() {
  try { return JSON.parse(await readFile(OUT, 'utf8')); } catch { return null; }
}

async function main() {
  const now = Date.now();
  const previous = await readPrevious();
  const known = new Map((previous?.recueils ?? []).map((r) => [r.url, r]));
  const recueils = [];
  const prefectures = [];
  for (const p of PREFECTURES) {
    const state = { dept: p.dept, label: p.label, readAt: null, scanned: 0, error: null };
    try {
      const links = await recueilsOf(p, now);
      let fresh = 0;
      for (const l of links) {
        const old = known.get(l.href);
        if (old) { recueils.push(old); continue; }
        if (fresh >= MAX_NEW_PER_SITE) continue;
        fresh += 1;
        try {
          const bytes = await fetchOk(l.href, 'bytes');
          if (bytes.byteLength > MAX_PDF_BYTES) continue;
          const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: false });
          const publishedOn = publishedDay(text[0] ?? '') ?? publishedDay(text.slice(0, 2).join(' '));
          recueils.push({ url: l.href, dept: p.dept, prefecture: p.label, label: l.text.slice(0, 160), publishedOn, acts: analyseRecueil(text, publishedOn) });
          state.scanned += 1;
        } catch (err) {
          console.warn(`[arretes] ${p.label} : recueil illisible ${l.href} (${err.message})`);
        }
      }
      state.readAt = new Date(now).toISOString();
    } catch (err) {
      state.error = String(err.message ?? err).slice(0, 200);
      // Site injoignable : les recueils déjà lus de cette préfecture restent servis.
      recueils.push(...[...known.values()].filter((r) => r.dept === p.dept));
    }
    prefectures.push(state);
  }
  const limit = new Date(now - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const kept = [...new Map(recueils.map((r) => [r.url, r])).values()].filter((r) => !r.publishedOn || r.publishedOn >= limit);
  const body = { version: 1, generatedAt: new Date(now).toISOString(), prefectures, recueils: kept };
  await mkdir(dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body)}\n`, 'utf8');
  await rename(tmp, OUT);
  const acts = kept.reduce((n, r) => n + r.acts.length, 0);
  console.log(`[arretes] ${kept.length} recueils, ${acts} arrêtés utiles → ${OUT}`);
  for (const s of prefectures) console.log(`  ${s.label} : ${s.error ? `erreur ${s.error}` : `${s.scanned} recueil(s) neuf(s)`}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
