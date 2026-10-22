// src/components/outages-room/timeline.ts : frise des 24 h, rejeu et cascades de la control room des pannes (lot 3, spec 2026-10-21
// § 5.1). Pur. Barres reconstruites à partir du journal (nouvelle → rétablie, niveau le plus haut atteint) et des pannes en cours ;
// rejeu = pannes actives à un instant (journal seul : les antennes et zones des couches ne sont pas rejouées).
import type { OutageCascade, OutageJournalEntry, OutageNetwork, OutageNow } from '../../types/index.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { departementName } from '../layer-panel/health-format.ts';
import { parisClock } from '../layer-panel/outages-format.ts';
import { NETWORK_LABEL } from '../../services/outages-now.ts';

export const TIMELINE_WINDOW_MS = 24 * 3600 * 1000;
/** Partie « à venir » de la frise (22/10/2026) : maintenant au milieu. */
export const TIMELINE_FUTURE_MS = 24 * 3600 * 1000;
/** Fin inconnue d'une panne en cours : dégradé sur 3 h après maintenant. */
const UNKNOWN_TAIL_MS = 3 * 3600 * 1000;
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
  until: number | null;                 // fin prévue d'une panne en cours, quand la source la donne (22/10/2026)
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
      open.set(e.id, { id: e.id, network: e.network, name: e.name, dept: e.dept, level: e.level, start: t, end: null, until: null });
    } else if (bar && e.kind === 'retablie') {
      bar.end = t;
      done.push(bar);
      open.delete(e.id);
    } else if (bar && RANK[e.level] > RANK[bar.level]) {
      bar.level = e.level;
    }
  }
  for (const o of outages) {
    const until = Date.parse(o.until ?? '');
    const known = open.get(o.id);
    if (known) {
      known.until = Number.isFinite(until) ? until : null;
      continue;
    }
    const since = Date.parse(o.since ?? '');
    open.set(o.id, {
      id: o.id, network: o.network, name: o.label ?? o.dept ?? 'France entière', dept: o.dept, level: o.level,
      start: Number.isFinite(since) ? since : now, end: null, until: Number.isFinite(until) ? until : null,
    });
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
const PARIS_HOUR = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' });
const PARIS_DAY = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric' });
const LEVEL_KEY = '<span class="orm-key"><i class="orm-bar--jaune"></i>Vigilance<i class="orm-bar--orange"></i>Alerte<i class="orm-bar--rouge"></i>Crise'
  + '<i class="orm-bar--orange is-prevu"></i>fin prévue<i class="orm-bar--orange is-inconnu"></i>fin inconnue</span>';

/**
 * Graduations : heures rondes de Paris toutes les 6 h (« 6 h »), et à minuit le jour (« jeu. 22 ») avec un trait sur toutes les lignes ;
 * rien trop près des bords ni du milieu, où se lisent « il y a 24 h », « dans 24 h » et « maintenant ».
 */
function axis(from: number, span: number, now: number): { ticks: string; days: string } {
  let ticks = '';
  let days = '';
  const mid = (now - from) / span;
  for (let t = Math.ceil(from / 3_600_000) * 3_600_000; t < from + span; t += 3_600_000) {
    const h = Number(PARIS_HOUR.formatToParts(t).find((p) => p.type === 'hour')?.value ?? NaN);
    const x = (t - from) / span;
    if (h % 6 !== 0) continue;
    if (h === 0) days += `<span class="orm-day" style="left:${pct(t, from, span)}"></span>`;
    if (x < 0.06 || x > 0.94 || Math.abs(x - mid) < 0.05) continue;
    ticks += h === 0
      ? `<span class="is-day" style="left:${pct(t, from, span)}">${escapeHtml(PARIS_DAY.format(t))}</span>`
      : `<span style="left:${pct(t, from, span)}">${h}\u00a0h</span>`;
  }
  return { ticks, days };
}

function barHtml(b: TimelineBar, from: number, span: number, now: number): string {
  const title = `${b.dept !== null ? `${departementName(b.dept)} (${b.dept})` : b.name} · ${parisClock(b.start)} → `
    + `${b.end !== null ? parisClock(b.end) : b.until !== null ? `fin prévue ${parisClock(b.until)}` : 'en cours, fin inconnue'}`;
  const seg = (cls: string, a: number, z: number): string => {
    const left = Math.max((a - from) / span, 0);
    const width = Math.max((Math.min(z, from + span) - Math.max(a, from)) / span, 0.004);
    return `<i class="orm-bar orm-bar--${b.level}${cls}" data-outage="${escapeHtml(b.id)}" style="left:${(left * 100).toFixed(1)}%;width:${(width * 100).toFixed(1)}%" title="${escapeHtml(title)}"></i>`;
  };
  if (b.end !== null) return seg('', b.start, b.end);
  const tail = b.until !== null && b.until > now ? seg(' is-prevu', now, b.until) : seg(' is-inconnu', now, now + UNKNOWN_TAIL_MS);
  return seg(' is-open', b.start, now) + tail;
}

/**
 * Frise (22/10/2026) : maintenant au milieu, les 24 dernières heures à gauche, les 24 prochaines à droite ; une ligne par réseau touché ;
 * une barre = une panne, pleine jusqu'à sa fin ou jusqu'à maintenant, puis hachurée jusqu'à sa fin prévue, ou en dégradé si la fin est
 * inconnue ; couleur du niveau le plus haut atteint ; heures rondes, jour à minuit ; curseur de rejeu (null : direct).
 */
export function friseHtml(bars: readonly TimelineBar[], now: number, cursor: number | null, pastMs = TIMELINE_WINDOW_MS, futureMs = TIMELINE_FUTURE_MS): string {
  const from = now - pastMs;
  const span = pastMs + futureMs;
  const { ticks, days } = axis(from, span, now);
  // Curseur, jours et maintenant tracés dans chaque ligne : la colonne des libellés n'entre pas dans l'échelle du temps.
  const nowLine = `<span class="orm-now" style="left:${pct(now, from, span)}"></span>`;
  const cursorLine = cursor === null ? '' : `<span class="orm-cursor" style="left:${pct(cursor, from, span)}"></span>`;
  const rows = ORDER.filter((n) => bars.some((b) => b.network === n)).map((n) => {
    const cells = bars.filter((b) => b.network === n).map((b) => barHtml(b, from, span, now)).join('');
    return `<div class="orm-frise-row"><span class="orm-frise-label">${NETWORK_LABEL[n]}</span><div class="orm-frise-track">${days}${nowLine}${cells}${cursorLine}</div></div>`;
  }).join('');
  const scale = `${days}<span class="is-start" style="left:0">il y a 24\u00a0h</span>${ticks}`
    + `<span class="is-now" style="left:${pct(now, from, span)}">maintenant</span><span class="is-end" style="left:100%">dans 24\u00a0h</span>`;
  const head = cursor === null
    ? `<h3>Pannes <small>← 24\u00a0h passées · maintenant · 24\u00a0h à venir → · clic dans le passé : revoir la carte à cette heure</small>${LEVEL_KEY}</h3>`
    : `<h3>Carte revue à ${parisClock(cursor)} <button type="button" class="orm-back" data-now>revenir à maintenant</button>${LEVEL_KEY}</h3>`;
  return `${head}<div class="orm-frise-area" data-frise>${rows || '<p class="orm-empty">Aucune panne sur 24 h.</p>'}<div class="orm-frise-row"><span class="orm-frise-label"></span><div class="orm-frise-track orm-frise-ticks">${scale}</div></div></div>`;
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
