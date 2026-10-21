// api/_lib/outages-journal.js : journal des pannes (control room, 21/10/2026). Pur. Compare l'état du tick précédent aux pannes du
// moment : « nouvelle », « aggravee » (niveau qui monte), « attenuee » (niveau qui baisse), « confirmee » (échelon qui monte),
// « retablie » (absente deux ticks de suite : une source qui manque un tick ne fait pas clignoter la panne). Le premier état connu
// (démarrage sans état relu) ne produit aucune entrée : ce qui est déjà en cours n'est pas « nouveau ».

const RANK = { jaune: 1, orange: 2, rouge: 3 };
const RUNG_RANK = { signalee: 0, mesuree: 1, confirmee: 2 };
/** Ticks d'absence avant « rétablie ». */
export const MISSING_TICKS = 2;

/** Nom court d'une panne pour le journal (le client nomme les départements). */
function nameOf(o) {
  return o.label ?? (o.dept !== null ? o.dept : 'France entière');
}

/**
 * @param {{ at: string, items: Record<string, any> } | null} prev
 * @param {import('../../src/types/index.ts').OutageNow[]} next
 * @param {number} now
 * @returns {{ state: { at: string, items: Record<string, any> }, entries: import('../../src/types/index.ts').OutageJournalEntry[] }}
 */
export function diffOutages(prev, next, now) {
  const at = new Date(now).toISOString();
  const items = {};
  const entries = [];
  const entry = (kind, item) => entries.push({ at, kind, id: item.id, network: item.network, name: item.name, dept: item.dept, level: item.level, rung: item.rung });
  const seen = new Set();
  for (const o of next) {
    seen.add(o.id);
    const item = { id: o.id, network: o.network, name: nameOf(o), dept: o.dept, level: o.level, rung: o.rung, missing: 0 };
    items[o.id] = item;
    const before = prev?.items[o.id];
    if (prev === null) continue;
    if (!before) {
      entry('nouvelle', item);
      continue;
    }
    if (RANK[item.level] > RANK[before.level]) entry('aggravee', item);
    else if (RANK[item.level] < RANK[before.level]) entry('attenuee', item);
    if (RUNG_RANK[item.rung] > RUNG_RANK[before.rung]) entry('confirmee', item);
  }
  for (const [id, before] of Object.entries(prev?.items ?? {})) {
    if (seen.has(id)) continue;
    const missing = before.missing + 1;
    if (missing >= MISSING_TICKS) entry('retablie', before);
    else items[id] = { ...before, missing };
  }
  return { state: { at, items }, entries };
}
