#!/usr/bin/env node
// scripts/fetch-drone-restrictions.mjs : zones drones DGAC « vol interdit » hors agglomérations, métropole (spec 2026-10-04
// souveraineté § 3.2 ; contrats § 1.2, § 8 B21). Lancé à la main (rafraîchissement mensuel au plus), User-Agent FranceMonitor imposé
// par api/_lib/source-http.js : GetCapabilities (édition du jeu), deux comptes (RESULTTYPE=hits), puis les zones par pages de 2 000
// sans SORTBY (ordre naturel de la clé, vérifié le 04/10/2026 : 5 543 identifiants distincts sur trois pages). Écrit
// public/data/drone-restrictions.json, daté, sous 1,5 Mio ; au-delà de la borne, rien n'est écrit.
import { writeFileSync } from 'node:fs';
import {
  DRONES_FILE_PATH, MAX_FILE_BYTES, assertCompleteRead, droppedIds, NON_AGGLO_CQL, PAGE_SIZE, VOL_INTERDIT_CQL, buildDroneZonesFile, capabilitiesUrl, editionFromCapabilities,
  hitsUrl, numberMatchedOf, pageUrl,
} from '../api/_lib/drone-zones.js';
import { fetchStrictJson, fetchStrictText } from '../api/_lib/source-http.js';

/** Pause entre deux requêtes au service public. */
const PAUSE_MS = 3_000;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const edition = editionFromCapabilities(await fetchStrictText(capabilitiesUrl(), { expect: 'xml', timeoutMs: 120_000 }));
if (!edition) throw new Error('édition du jeu introuvable dans GetCapabilities');
await sleep(PAUSE_MS);
const volInterdit = numberMatchedOf(await fetchStrictText(hitsUrl(VOL_INTERDIT_CQL), { expect: 'xml', timeoutMs: 60_000 }));
await sleep(PAUSE_MS);
const nonAgglomeration = numberMatchedOf(await fetchStrictText(hitsUrl(NON_AGGLO_CQL), { expect: 'xml', timeoutMs: 60_000 }));
if (volInterdit === null || nonAgglomeration === null) throw new Error('comptes WFS illisibles');

const features = [];
for (let start = 0; start < nonAgglomeration; start += PAGE_SIZE) {
  await sleep(PAUSE_MS);
  const page = await fetchStrictJson(pageUrl(NON_AGGLO_CQL, start), { timeoutMs: 300_000 });
  if (!Array.isArray(page?.features)) throw new Error(`page ${start} illisible`);
  features.push(...page.features);
  console.log(`page ${start} : ${page.features.length} zones`);
  if (page.features.length < PAGE_SIZE) break;
}

assertCompleteRead(features, nonAgglomeration);
const dropped = droppedIds(features);
if (dropped.length > 0) console.log(`zones écartées (anneaux dégénérés) : ${dropped.join(', ')}`);

const file = buildDroneZonesFile({ features, edition, volInterdit, nonAgglomeration, generatedAt: new Date().toISOString() });
const text = `${JSON.stringify(file)}\n`;
const bytes = Buffer.byteLength(text);
if (bytes > MAX_FILE_BYTES) throw new Error(`fichier de ${bytes} octets, au-delà de la borne de ${MAX_FILE_BYTES} : simplification à revoir`);
writeFileSync(DRONES_FILE_PATH, text);
console.log(`${file.counts.kept} zones gardées sur ${nonAgglomeration} hors agglomération (${volInterdit} « vol interdit » en métropole), édition ${edition}, ${bytes} octets`);
