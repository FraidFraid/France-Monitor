// src/components/outages-room/timeline.ts : frise des 24 h, rejeu et cascades de la control room des pannes (lot 3, spec 2026-10-21
// § 5.1). Pur. Barres reconstruites à partir du journal (nouvelle → rétablie, niveau le plus haut atteint) et des pannes en cours ;
// rejeu = pannes actives à un instant (journal seul : les antennes et zones des couches ne sont pas rejouées).
import type { OutageCascade, OutageJournalEntry, OutageNetwork, OutageNow } from '../../types/index.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { departementName } from '../layer-panel/health-format.ts';
import { parisClock } from '../layer-panel/outages-format.ts';
import { NETWORK_LABEL } from '../../services/outages-now.ts';

export const TIMELINE_WINDOW_MS = 24 * 3600 * 1000;
const RANK = { jaune: 1, orange: 2, rouge: 3 } as const;
const ORDER: readonly OutageNetwork[] = ['mobile', 'internet', 'electricite', 'cloud', 'gaz', 'eau', 'urgence', 'paiement', 'tv'];

export interface TimelineBar {
  id: string;
  network: OutageNetwork;
  name: string;
  dept: string | null;
  level: 'jaune' | 'orange' | 'rouge';
  start: number;
  end: number | null;                   // null : en cours
}

/** Barres des 24 dernières heures, réseau par réseau, plus anciennes d'abord. */
export function timelineBars(journal: readonly OutageJournalEntry[], outages: readonly OutageNow[], now: number, windowMs = TIMELINE_WINDOW_MS): TimelineBar[] {
  const from = now - windowMs;
  const open = new Map<string, TimelineBar>();
  const done: TimelineBar[] = [];
  for (const e of [...journal].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    const bar = open.get(e.id);
    if (e.kind === 'nouvelle') {
      open.set(e.id, { id: e.id, network: e.network, name: e.name, dept: e.dept, level: e.level, start: t, end: null });
    } else if (bar && e.kind === 'retablie') {
      bar.end = t;
      done.push(bar);
      open.delete(e.id);
    } else if (bar && RANK[e.level] > RANK[bar.level]) {
      bar.level = e.level;
    }
  }
  for (const o of outages) {
    if (open.has(o.id)) continue;
    const since = Date.parse(o.since ?? '');
    open.set(o.id, { id: o.id, network: o.network, name: o.label ?? o.dept ?? 'France entière', dept: o.dept, level: o.level, start: Number.isFinite(since) ? since : now, end: null });
  }
  return [...done, ...open.values()]
    .filter((b) => b.end === null || b.end > from)
    .map((b) => ({ ...b, start: Math.max(b.start, from) }))
    .sort((a, b) => ORDER.indexOf(a.network) - ORDER.indexOf(b.network) || a.start - b.start);
}

/** Pannes actives à l'instant `t` (rejeu). */
export function activeAt(bars: readonly TimelineBar[], t: number): TimelineBar[] {
  return bars.filter((b) => b.start <= t && (b.end === null || b.end > t));
}

const pct = (t: number, from: number, span: number): string => `${(Math.min(Math.max((t - from) / span, 0), 1) * 100).toFixed(1)}%`;

/** Frise : une ligne par réseau touché, graduations toutes les 6 h, curseur de rejeu (null : direct). */
export function friseHtml(bars: readonly TimelineBar[], now: number, cursor: number | null, windowMs = TIMELINE_WINDOW_MS): string {
  const from = now - windowMs;
  // Curseur tracé dans chaque ligne : la colonne des libellés n'entre pas dans l'échelle du temps.
  const cursorLine = cursor === null ? '' : `<span class="orm-cursor" style="left:${pct(cursor, from, windowMs)}"></span>`;
  const rows = ORDER.filter((n) => bars.some((b) => b.network === n)).map((n) => {
    const cells = bars.filter((b) => b.network === n).map((b) => {
      const left = (b.start - from) / windowMs;
      const width = Math.max(((b.end ?? now) - b.start) / windowMs, 0.004);
      const title = `${b.dept !== null ? `${departementName(b.dept)} (${b.dept})` : b.name} · ${parisClock(b.start)} → ${b.end === null ? 'en cours' : parisClock(b.end)}`;
      return `<i class="orm-bar orm-bar--${b.level}" data-outage="${escapeHtml(b.id)}" style="left:${(left * 100).toFixed(1)}%;width:${(width * 100).toFixed(1)}%" title="${escapeHtml(title)}"></i>`;
    }).join('');
    return `<div class="orm-frise-row"><span class="orm-frise-label">${NETWORK_LABEL[n]}</span><div class="orm-frise-track">${cells}${cursorLine}</div></div>`;
  }).join('');
  const ticks = [0, 6, 12, 18, 24].map((h) => `<span style="left:${pct(from + h * 3600_000, from, windowMs)}">${parisClock(from + h * 3600_000)}</span>`).join('');
  const head = cursor === null
    ? '<h3>Frise des 24 dernières heures <small>(clic : rejeu)</small></h3>'
    : `<h3>Rejeu à ${parisClock(cursor)} <button type="button" class="orm-back" data-now>maintenant</button></h3>`;
  return `${head}<div class="orm-frise-area" data-frise>${rows || '<p class="orm-empty">Aucune panne sur 24 h.</p>'}<div class="orm-frise-row"><span class="orm-frise-label"></span><div class="orm-frise-track orm-frise-ticks">${ticks}</div></div></div>`;
}

/** Cascades : territoire, puis réseaux dans l'ordre des débuts, avec l'heure. */
export function cascadeHtml(cascades: readonly OutageCascade[]): string {
  if (cascades.length === 0) return '';
  const rows = cascades.map((c) => {
    const where = c.dept !== null ? `${departementName(c.dept)} (${c.dept})` : 'France entière';
    const chain = c.steps.map((s) => `${NETWORK_LABEL[s.network]} ${s.since ? parisClock(Date.parse(s.since)) : 'n.d.'}`).join(' → ');
    return `<div class="orm-cascade"><span class="orm-dot orm-dot--${c.level}" aria-hidden="true"></span><span><b>${escapeHtml(where)}</b><small>${escapeHtml(chain)}</small></span></div>`;
  }).join('');
  return `<h3>Pannes en cascade</h3>${rows}`;
}
