// api/_lib/outages-cascade.js : pannes en cascade (control room des pannes, lot 3, spec 2026-10-21 § 5.3). Pur. Un même département,
// ou le pays entier, touché par au moins deux réseaux dont les débuts tiennent dans 6 h (« électricité 10 h 12 → antennes 10 h 40 →
// internet 10 h 55 »). Une étape par réseau (sa panne la plus ancienne du territoire), dans l'ordre des débuts.

export const CASCADE_WINDOW_MS = 6 * 3600 * 1000;
const RANK = { jaune: 1, orange: 2, rouge: 3 };

/**
 * @param {Array<{ id: string, network: string, scope: string, dept: string | null, national: boolean, level: 'jaune' | 'orange' | 'rouge', since: string | null }>} outages
 */
export function cascadesOf(outages) {
  const groups = new Map();
  for (const o of outages) {
    const t = Date.parse(o.since ?? '');
    if (!Number.isFinite(t)) continue;
    const key = o.scope === 'departement' && o.dept ? `dept:${o.dept}` : o.national ? 'national' : null;
    if (key === null) continue;
    const g = groups.get(key) ?? { key, dept: key === 'national' ? null : o.dept, national: key === 'national', byNetwork: new Map() };
    const before = g.byNetwork.get(o.network);
    if (!before || t < before.t) g.byNetwork.set(o.network, { id: o.id, network: o.network, since: o.since, t, level: o.level });
    else if (RANK[o.level] > RANK[before.level]) before.level = o.level;
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    const steps = [...g.byNetwork.values()].sort((a, b) => a.t - b.t);
    // Fenêtre de 6 h qui réunit le plus de réseaux (la première en cas d'égalité).
    let best = [];
    for (let i = 0; i < steps.length; i += 1) {
      const inWindow = steps.filter((s) => s.t >= steps[i].t && s.t - steps[i].t <= CASCADE_WINDOW_MS);
      if (inWindow.length > best.length) best = inWindow;
    }
    if (best.length < 2) continue;
    const level = best.reduce((m, s) => (RANK[s.level] > RANK[m] ? s.level : m), 'jaune');
    out.push({ key: g.key, dept: g.dept, national: g.national, level, steps: best.map(({ id, network, since }) => ({ id, network, since })) });
  }
  return out.sort((a, b) => RANK[b.level] - RANK[a.level] || b.steps.length - a.steps.length);
}
