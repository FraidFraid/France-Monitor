#!/usr/bin/env node
// scripts/anticipation-recount-missed.mjs : recompte les crises manquées déjà consignées avec la définition du 13/11/2026 (fait nouveau,
// lieu non contredit par le titre : api/_lib/anticipation/press-tags.js). Les anciennes lignes n'ont ni titre ni étiquette : le titre est
// relu par /api/events/detail. Rien n'est effacé : une ligne est AJOUTÉE au journal pour chaque crise écartée (counted: false, raison
// dans outcomeNote), la dernière ligne d'un scénario faisant foi à la relecture. À lancer une fois sur la VM, puis redémarrer fm-api.
//   node scripts/anticipation-recount-missed.mjs [AAAA-MM]        (essai à blanc)
//   APPLY=1 node scripts/anticipation-recount-missed.mjs [AAAA-MM]
import { appendFile, readFile } from 'node:fs/promises';
import { pressTags } from '../api/_lib/anticipation/press-tags.js';

const DIR = process.env.FM_ANTICIPATION_DIR ?? '/var/lib/francemonitor/data/anticipation';
const API = process.env.FM_API ?? 'http://127.0.0.1:3000';
const month = process.argv[2] ?? new Date().toISOString().slice(0, 7);
const file = `${DIR}/journal/${month}.jsonl`;
const REASONS = { suite: "suite d'un fait passé", fait_divers: 'fait divers', lieu: 'lieu contredit par le titre' };

const last = new Map();
for (const line of (await readFile(file, 'utf8')).split('\n')) {
  if (!line.trim()) continue;
  try { const ev = JSON.parse(line); if (ev?.scenario?.id) last.set(ev.scenario.id, ev.scenario); } catch { /* ligne coupée */ }
}
const missed = [...last.values()].filter((s) => s.status === 'manque' && s.counted !== false);
const now = new Date().toISOString();
let kept = 0;
const lines = [];
for (const s of missed) {
  const eventId = /event:(\d+)/.exec(s.id)?.[1];
  if (!eventId) { kept += 1; continue; } // panne rouge ou article isolé : gardé
  let title = '';
  try {
    const res = await fetch(`${API}/api/events/detail?id=${eventId}`, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json();
    title = String((body.event ?? body).title ?? '');
  } catch { /* titre illisible : gardé */ }
  const dept = s.zone?.dept?.[0] ?? null;
  const tags = title ? pressTags(title, dept) : null;
  const why = !tags ? null : tags.nature !== 'fait' ? REASONS[tags.nature] : tags.placeDoubt ? REASONS.lieu : null;
  console.log(`${why ? 'ECARTE' : 'GARDE '} ${String(dept).padEnd(3)} ${(why ?? '').padEnd(28)} ${title.slice(0, 100)}`);
  if (!why) { kept += 1; continue; }
  lines.push(JSON.stringify({ at: now, type: 'manque', scenario: { ...s, counted: false, revisedAt: now, outcomeNote: `Écartée du compte le 13/11/2026 : ${why} (« ${title.slice(0, 160)} »).` } }));
}
console.log(`${missed.length} crises manquées relues : ${kept} gardées, ${lines.length} écartées${process.env.APPLY === '1' ? '' : ' (essai à blanc, APPLY=1 pour écrire)'}`);
if (process.env.APPLY === '1' && lines.length) await appendFile(file, `${lines.join('\n')}\n`);
