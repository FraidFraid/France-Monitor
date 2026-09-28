#!/usr/bin/env node
/**
 * classification-labels.mjs — Jeu annoté de la classification (spec § 5.1).
 *
 *   sample <instantané.json> [--force]  tire ~210 articles (critical ≤ 40, 80 high, 90 medium/low/info ;
 *                                        graine fixe) → tests/fixtures/classification/labels.json, étiquettes vides
 *   review                               → .superpowers/classification/review.html (non versionné) :
 *                                        « À étiqueter » à l'aveugle + « À vérifier » (20 étiquettes de Claude)
 *   apply <corrections.json>             reporte l'export de la page dans labels.json
 *   stats                                accord analyste / Claude
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABELS = path.join(ROOT, 'tests/fixtures/classification/labels.json');
const REVIEW = path.join(ROOT, '.superpowers/classification/review.html');
const LEVELS = ['info', 'low', 'medium', 'high', 'critical'];
const SEED = 20260928;
const rank = (/** @type {string} */ s) => LEVELS.indexOf(s);

/** Générateur pseudo-aléatoire déterministe (mulberry32). @param {number} seed */
function mulberry32(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @template T @param {T[]} items @param {() => number} rand @returns {T[]} */
function shuffled(items, rand) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** @param {Record<string, any>} a */
function toLabelEntry(a) {
  return {
    id: a.id, feedId: a.feedId, feedName: a.feedName ?? null, title: a.title,
    description: String(a.description ?? '').slice(0, 200),
    current: { category: a.category, severity: a.severity, scoredBy: a.scoredBy ?? null },
    expected: null, why: '', claude: null, reviewedBy: null,
  };
}

/** @param {{ takenAt: string, articles: Array<Record<string, any>> }} snapshot @param {number} [seed] */
export function sampleForLabels(snapshot, seed = SEED) {
  const rand = mulberry32(seed);
  const taken = Date.parse(snapshot.takenAt);
  const pool = snapshot.articles.filter((a) => !a.publishedAt || Date.parse(a.publishedAt) <= taken);
  const critical = pool.filter((a) => a.severity === 'critical').slice(0, 40);
  const high = shuffled(pool.filter((a) => a.severity === 'high'), rand).slice(0, 80);
  const rest = shuffled(pool.filter((a) => ['medium', 'low', 'info'].includes(a.severity)), rand).slice(0, 90);
  return [...critical, ...high, ...rest].map(toLabelEntry);
}

/**
 * Aveugle : ce que Claude juge grave (high+) et ce que la production note critical (les
 * abaissements contestables). Vérification : 20 étiquettes de Claude tirées parmi les autres.
 * @param {Array<Record<string, any>>} labels @param {number} [seed]
 */
export function reviewSelection(labels, seed = SEED) {
  const labelled = labels.filter((l) => l.expected);
  const isBlind = (/** @type {Record<string, any>} */ l) => rank(l.expected.severity) >= 3 || l.current?.severity === 'critical';
  const blind = labelled.filter(isBlind);
  const check = shuffled(labelled.filter((l) => !isBlind(l)), mulberry32(seed)).slice(0, 20);
  return { blind, check };
}

/**
 * @param {Array<Record<string, any>>} labels
 * @param {Array<{ id: number, mode: 'blind' | 'check', agree?: boolean, severity: string, inFrance: boolean, ongoing: boolean }>} corrections
 */
export function applyCorrections(labels, corrections) {
  for (const c of corrections) {
    if (!LEVELS.includes(c.severity)) throw new Error(`gravité inconnue pour l'article ${c.id} : ${c.severity}`);
  }
  const byId = new Map(corrections.map((c) => [c.id, c]));
  return labels.map((l) => {
    const c = byId.get(l.id);
    if (!c) return l;
    const answer = { severity: c.severity, inFrance: c.inFrance, ongoing: c.ongoing };
    if (c.mode === 'blind') return { ...l, claude: l.expected, expected: answer, reviewedBy: 'analyste-aveugle' };
    if (c.agree) return { ...l, claude: l.expected, reviewedBy: 'analyste-verifie' };
    return { ...l, claude: l.expected, expected: answer, why: `${l.why} (corrigé en relecture)`.trim(), reviewedBy: 'analyste-verifie' };
  });
}

/** @param {Array<Record<string, any>>} labels */
export function labelStats(labels) {
  const blind = labels.filter((l) => l.reviewedBy === 'analyste-aveugle' && l.claude && l.expected);
  const check = labels.filter((l) => l.reviewedBy === 'analyste-verifie' && l.claude && l.expected);
  const share = (/** @type {Array<Record<string, any>>} */ rows, /** @type {(l: Record<string, any>) => boolean} */ ok) =>
    rows.length === 0 ? 1 : rows.filter(ok).length / rows.length;
  return {
    total: labels.length,
    blind: {
      count: blind.length,
      exact: share(blind, (l) => l.expected.severity === l.claude.severity),
      withinOne: share(blind, (l) => Math.abs(rank(l.expected.severity) - rank(l.claude.severity)) <= 1),
      inFrance: share(blind, (l) => l.expected.inFrance === l.claude.inFrance),
      ongoing: share(blind, (l) => l.expected.ongoing === l.claude.ongoing),
    },
    check: {
      count: check.length,
      agree: share(check, (l) => l.expected.severity === l.claude.severity && l.expected.inFrance === l.claude.inFrance && l.expected.ongoing === l.claude.ongoing),
    },
  };
}

/** Page de relecture autonome (thème sombre par défaut). @param {{ blind: Array<Record<string, any>>, check: Array<Record<string, any>> }} selection */
export function reviewHtml(selection) {
  const blind = selection.blind.map((l) => ({ id: l.id, title: l.title, description: l.description }));
  const check = selection.check.map((l) => ({ id: l.id, title: l.title, description: l.description, expected: l.expected, why: l.why }));
  const data = JSON.stringify({ blind, check }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Annotation classification</title>
<style>
:root{--bg:#0f1115;--fg:#e6e6e6;--muted:#9aa0a6;--card:#171a21;--line:#2a2f3a;--accent:#4c8dff;--warn:#ffb020}
@media (prefers-color-scheme: light){:root{--bg:#fafafa;--fg:#1d1d1f;--muted:#5f6368;--card:#fff;--line:#ddd;--accent:#1a5fd6;--warn:#a15c00}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:0 16px 32px}
.bar{position:sticky;top:0;background:var(--bg);padding:12px 0;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:center;flex-wrap:wrap}
h1{font-size:17px;margin:20px 0 4px}
article{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:10px 0}
article.missing{border-color:var(--warn)}
h2{font-size:15px;margin:0 0 4px}
p{margin:4px 0;color:var(--muted)}
p.label{color:var(--fg)}
label{margin-right:12px;white-space:nowrap}
button{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:8px 14px;font:inherit;cursor:pointer}
#status{color:var(--warn)}
</style></head><body><main>
<div class="bar"><strong>Annotation</strong><button id="export">Exporter les corrections</button><span id="status"></span></div>
<h1>À étiqueter (<span id="nb"></span>) — votre jugement, sans voir le mien</h1>
<p>Gravité : ce que France Monitor doit afficher. Étranger sans effet déclaré sur la France : modéré au plus. Procès, rappel d’un fait passé, hypothèse : faible au plus. Dans le doute, le niveau le plus bas.</p>
<div id="blind"></div>
<h1>À vérifier (<span id="nc"></span>) — mes étiquettes</h1>
<p>Décochez « D’accord » pour corriger.</p>
<div id="check"></div>
</main><script>
var DATA = ${data};
var LEVELS = [['info', 'aucun impact'], ['low', 'faible'], ['medium', 'modéré'], ['high', 'élevé'], ['critical', 'critique']];
document.getElementById('nb').textContent = String(DATA.blind.length);
document.getElementById('nc').textContent = String(DATA.check.length);
function yesNo(v) { return v ? 'oui' : 'non'; }
function select(name, options, value) {
  var s = document.createElement('select'); s.setAttribute('data-' + name, '');
  var empty = document.createElement('option'); empty.value = ''; empty.textContent = '—'; s.append(empty);
  options.forEach(function (o) { var opt = document.createElement('option'); opt.value = o[0]; opt.textContent = o[1]; opt.selected = o[0] === value; s.append(opt); });
  return s;
}
function field(text, control) { var l = document.createElement('label'); l.append(text + ' ', control); return l; }
function card(item, mode) {
  var el = document.createElement('article');
  el.dataset.id = String(item.id); el.dataset.mode = mode;
  var h = document.createElement('h2'); h.textContent = item.title;
  var d = document.createElement('p'); d.textContent = item.description;
  el.append(h, d);
  var yn = [['oui', 'oui'], ['non', 'non']];
  var sev = select('sev', LEVELS, mode === 'check' ? item.expected.severity : '');
  var fr = select('fr', yn, mode === 'check' ? yesNo(item.expected.inFrance) : '');
  var on = select('on', yn, mode === 'check' ? yesNo(item.expected.ongoing) : '');
  var controls = document.createElement('div');
  if (mode === 'check') {
    var mine = document.createElement('p'); mine.className = 'label';
    mine.textContent = 'Mon étiquette : ' + item.expected.severity + ' · en France : ' + yesNo(item.expected.inFrance) + ' · en cours : ' + yesNo(item.expected.ongoing) + ' — ' + item.why;
    el.append(mine);
    var agree = document.createElement('input'); agree.type = 'checkbox'; agree.checked = true; agree.setAttribute('data-agree', '');
    controls.append(field('D’accord', agree));
    controls.addEventListener('change', function (e) { if (e.target !== agree) agree.checked = false; });
  }
  controls.append(field('Gravité', sev), field('En France', fr), field('En cours', on));
  el.append(controls);
  return el;
}
DATA.blind.forEach(function (item) { document.getElementById('blind').append(card(item, 'blind')); });
DATA.check.forEach(function (item) { document.getElementById('check').append(card(item, 'check')); });
document.getElementById('export').addEventListener('click', function () {
  var missing = 0;
  var corrections = Array.prototype.map.call(document.querySelectorAll('article'), function (el) {
    var sev = el.querySelector('[data-sev]').value, fr = el.querySelector('[data-fr]').value, on = el.querySelector('[data-on]').value;
    var agreeBox = el.querySelector('[data-agree]');
    var complete = sev !== '' && fr !== '' && on !== '';
    el.classList.toggle('missing', !complete);
    if (!complete) missing += 1;
    return { id: Number(el.dataset.id), mode: el.dataset.mode, agree: agreeBox ? agreeBox.checked : undefined, severity: sev, inFrance: fr === 'oui', ongoing: on === 'oui' };
  });
  var status = document.getElementById('status');
  if (missing > 0) { status.textContent = missing + ' article(s) incomplet(s), encadrés en orange.'; return; }
  status.textContent = '';
  var url = URL.createObjectURL(new Blob([JSON.stringify(corrections, null, 2)], { type: 'application/json' }));
  var a = document.createElement('a'); a.href = url; a.download = 'corrections.json'; a.click();
  URL.revokeObjectURL(url);
});
</script></body></html>
`;
}

async function readLabels() {
  return JSON.parse(await readFile(LABELS, 'utf8'));
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === 'sample') {
    if (!arg) throw new Error('usage : sample <instantané.json> [--force]');
    if (existsSync(LABELS) && !process.argv.includes('--force')) {
      if ((await readLabels()).some((/** @type {{ expected: unknown }} */ l) => l.expected)) {
        throw new Error('labels.json contient déjà des étiquettes : --force pour écraser');
      }
    }
    const entries = sampleForLabels(JSON.parse(await readFile(arg, 'utf8')));
    await mkdir(path.dirname(LABELS), { recursive: true });
    await writeFile(LABELS, `${JSON.stringify(entries, null, 2)}\n`);
    console.log(`${entries.length} articles → ${path.relative(ROOT, LABELS)}`);
  } else if (command === 'review') {
    const selection = reviewSelection(await readLabels());
    await mkdir(path.dirname(REVIEW), { recursive: true });
    await writeFile(REVIEW, reviewHtml(selection));
    console.log(`${selection.blind.length} à étiqueter, ${selection.check.length} à vérifier → ${path.relative(ROOT, REVIEW)}`);
  } else if (command === 'apply') {
    if (!arg) throw new Error('usage : apply <corrections.json>');
    const corrections = JSON.parse(await readFile(arg, 'utf8'));
    await writeFile(LABELS, `${JSON.stringify(applyCorrections(await readLabels(), corrections), null, 2)}\n`);
    console.log(`${corrections.length} réponses reportées → ${path.relative(ROOT, LABELS)}`);
  } else if (command === 'stats') {
    console.log(JSON.stringify(labelStats(await readLabels()), null, 2));
  } else {
    throw new Error('commande : sample | review | apply | stats');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
