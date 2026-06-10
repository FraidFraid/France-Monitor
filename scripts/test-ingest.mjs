/**
 * test-ingest.mjs — Tests de l'ingestion serveur news (sans DB réelle, sans réseau).
 *
 *   npm run test:ingest
 *
 * Couvre :
 *  (a) api/_lib/parse-rss.js sur fixtures RSS 2.0 et Atom
 *  (b) contentHash : déterminisme + sensibilité
 *  (c) api/_lib/server-classifier.js (généré) : cohérence avec le classifier client
 *  (d) computeBackoffMs : logique de backoff pure
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => readFile(path.join(ROOT, 'scripts/fixtures', name), 'utf8');

const { parseRssXml, detectSourceFormat } = await import(
  path.join(ROOT, 'api/_lib/parse-rss.js')
);
const { contentHash, computeBackoffMs, slugifyFeedId } = await import(
  path.join(ROOT, 'api/_lib/db.js')
);
const { classify, CLASSIFIER_VERSION } = await import(
  path.join(ROOT, 'api/_lib/server-classifier.js')
);
const { extractLocations } = await import(
  path.join(ROOT, 'api/_lib/server-geocoder.js')
);
const { FEEDS } = await import(path.join(ROOT, 'api/_lib/feeds-snapshot.js'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

// ─── (a) parse-rss ───

console.log('\nparse-rss.js');
const rssItems = parseRssXml(await fixture('rss-sample.xml'));
const atomItems = parseRssXml(await fixture('atom-sample.xml'));

test('RSS 2.0 : 2 items valides, item sans link ignoré', () => {
  assert.equal(rssItems.length, 2);
});

test('RSS 2.0 : CDATA + entités décodées, HTML strippé', () => {
  assert.equal(rssItems[0].title, 'Attentat déjoué à Paris : trois interpellations');
  assert.equal(rssItems[0].link, 'https://example.fr/articles/attentat-dejoue-paris');
  assert.ok(rssItems[0].description.includes('DGSI'));
  assert.ok(!rssItems[0].description.includes('<p>'), 'HTML doit être strippé');
});

test('RSS 2.0 : fallback guid + dc:date', () => {
  assert.equal(rssItems[1].link, 'https://example.fr/articles/greve-sncf-lyon');
  assert.equal(rssItems[1].pubDate, '2026-06-09T10:30:00Z');
  assert.ok(rssItems[1].title.includes('Grève SNCF'));
});

test('Atom : 2 entries, link href + fallback id', () => {
  assert.equal(atomItems.length, 2);
  assert.equal(atomItems[0].link, 'https://example.fr/atom/vigilance-rouge-gard');
  assert.equal(atomItems[0].pubDate, '2026-06-09T06:00:00Z');
  assert.equal(atomItems[1].link, 'https://example.fr/atom/cyberattaque-chu');
  assert.equal(atomItems[1].pubDate, '2026-06-09T07:45:00Z');
});

test('detectSourceFormat : xml vs html vs unknown', () => {
  assert.equal(detectSourceFormat('<?xml version="1.0"?><rss>'), 'xml');
  assert.equal(detectSourceFormat('<!DOCTYPE html><html>'), 'html');
  assert.equal(detectSourceFormat('plain text'), 'unknown');
});

// ─── (b) contentHash ───

console.log('\ncontentHash');
test('même item 2× → même hash (sha256 hex)', () => {
  const a = contentHash('le-monde', 'https://x.fr/a', 'Titre A');
  const b = contentHash('le-monde', 'https://x.fr/a', 'Titre A');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('feed, link ou title différent → hash différent', () => {
  const base = contentHash('le-monde', 'https://x.fr/a', 'Titre A');
  assert.notEqual(contentHash('le-figaro', 'https://x.fr/a', 'Titre A'), base);
  assert.notEqual(contentHash('le-monde', 'https://x.fr/b', 'Titre A'), base);
  assert.notEqual(contentHash('le-monde', 'https://x.fr/a', 'Titre B'), base);
});

// ─── (c) classifier serveur (cohérence avec src/services/classifier.ts) ───

console.log('\nserver-classifier.js');
test('CLASSIFIER_VERSION exposée', () => {
  assert.equal(typeof CLASSIFIER_VERSION, 'string');
  assert.ok(CLASSIFIER_VERSION.length > 0);
});

const CLASSIFIER_CASES = [
  // [titre, catégorie attendue, sévérité attendue]
  ['Attentat à Paris : plusieurs blessés', 'security', 'critical'],
  ['Vigilance rouge tempête sur la Bretagne', 'weather', 'critical'],
  ['Manifestation des agriculteurs à Toulouse', 'social', 'medium'],
  ['Grève à la SNCF : préavis déposé', 'social', 'low'],
  ['Cyberattaque contre un CHU : fuite de données', 'cyber', 'medium'],
  ['Délestage électrique : blackout évité de justesse', 'energy', 'critical'],
  ['Crue de la Seine : débordement attendu', 'floods', 'medium'],
  // Mitigation bruit PQR : fait divers sans institution → general/info
  ['Vol de bijoux dans le quartier nord', 'general', 'info'],
  // Fait divers AVEC institution → reste security
  ['Cambriolage à la préfecture du Rhône', 'security', 'low'],
  // Aucun mot-clé → fallback general/info
  ['Festival de la bande dessinée : une édition record', 'general', 'info'],
];

for (const [title, category, severity] of CLASSIFIER_CASES) {
  test(`"${title.slice(0, 48)}" → ${category}/${severity}`, () => {
    const result = classify(title);
    assert.equal(result.category, category, `category: got ${result.category}`);
    assert.equal(result.severity, severity, `severity: got ${result.severity}`);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });
}

test('classify retourne toujours un résultat (jamais undefined)', () => {
  const result = classify('');
  assert.equal(result.category, 'general');
  assert.equal(result.severity, 'info');
});

// ─── (d) backoff ───

console.log('\ncomputeBackoffMs');
test('0 échec → 0 ms', () => assert.equal(computeBackoffMs(0), 0));
test('1 échec → 2 min', () => assert.equal(computeBackoffMs(1), 120_000));
test('2 échecs → 5 min', () => assert.equal(computeBackoffMs(2), 300_000));
test('3 échecs → 10 min', () => assert.equal(computeBackoffMs(3), 600_000));
test('10 échecs → plafond 10 min', () => assert.equal(computeBackoffMs(10), 600_000));
test('entrées invalides → 0 ms', () => {
  assert.equal(computeBackoffMs(-1), 0);
  assert.equal(computeBackoffMs(NaN), 0);
});

// ─── Bonus : geocoder (extraction pure, sans réseau) + feeds snapshot ───

console.log('\nserver-geocoder.js / feeds-snapshot.js');
test('extractLocations : préposition "à Lyon"', () => {
  assert.ok(extractLocations('Incendie à Lyon : une usine évacuée').includes('Lyon'));
});

test('feeds snapshot : ids slug déterministes, uniques, champs requis', () => {
  assert.ok(FEEDS.length > 30, `expected >30 feeds, got ${FEEDS.length}`);
  const ids = FEEDS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
  for (const feed of FEEDS) {
    assert.match(feed.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad slug: ${feed.id}`);
    assert.ok(feed.url.startsWith('http'), `bad url: ${feed.url}`);
    assert.ok(Number.isInteger(feed.tier));
  }
});

test('slugifyFeedId : accents + apostrophes', () => {
  assert.equal(slugifyFeedId("L'Obs"), 'l-obs');
  assert.equal(slugifyFeedId('NC la 1ère'), 'nc-la-1ere');
  assert.equal(slugifyFeedId('France 24 FR'), 'france-24-fr');
});

// ─── Résumé ───

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
