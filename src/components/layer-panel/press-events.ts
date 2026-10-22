// src/components/layer-panel/press-events.ts : section « Signalé par la presse » des panneaux Défense et Cyber (22/10/2026). Pur. Le crash
// du Mirage 2000D près de Nancy et les failles PHP du 21/10 ne figuraient dans aucun des deux panneaux, qui ne lisent que leurs sources
// propres (vols, Marine, Vigipirate ; CERT-FR, KEV, revendications) : on y reprend les événements de presse consolidés du sujet, en France,
// en cours, jaunes ou plus ; rouge : étiquette URGENT clignotante, comme sur le fil.
import type { NewsEvent } from '../../types/index.ts';
import { parisDayOf } from '../../services/environment-levels.ts';
import { LEVEL_RANK, eventDisplayLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { normalizeForMatch } from '../../services/classification-guards.ts';
import { listRow } from './frame.ts';
import { countText, dayMonth, parisClock } from './outages-format.ts';

export const PRESS_EVENTS_MAX = 6;
/** Sujet militaire au titre (événements de la catégorie sécurité). */
const MILITARY_RE = /\b(?:militaires?|armee|armees|mirage|rafale|avions? de chasse|base aerienne|marine nationale|soldats?|legion etrangere|regiment|dga|helicopteres? militaires?|a400m|patrouille de france|exercice militaire)\b/;

/** Événements du panneau : Défense (sécurité, sujet militaire) ou Cyber (catégorie cyber) ; ni clos, ni verts, ni à l'étranger. */
export function pressEventsFor(panel: 'defense' | 'cyber', events: readonly NewsEvent[]): NewsEvent[] {
  return events
    .filter((e) => e.status !== 'closed' && e.zone !== 'etranger' && eventDisplayLevel(e.severity, e.peakSeverity) !== 'vert')
    .filter((e) => (panel === 'cyber' ? e.category === 'cyber' : e.category === 'security' && MILITARY_RE.test(normalizeForMatch(e.title))))
    .sort((a, b) => LEVEL_RANK[eventDisplayLevel(b.severity, b.peakSeverity)] - LEVEL_RANK[eventDisplayLevel(a.severity, a.peakSeverity)]
      || Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
    .slice(0, PRESS_EVENTS_MAX);
}

function when(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'n.d.';
  return parisDayOf(t) === parisDayOf(now) ? parisClock(t) : `${dayMonth(parisDayOf(t))} à ${parisClock(t)}`;
}

/** Section en tête du panneau ; aucune si rien n'est signalé. */
export function pressEventsSection(events: readonly NewsEvent[], now: number): FicheSection[] {
  if (events.length === 0) return [];
  const rows = events.map((e) => {
    const level = eventDisplayLevel(e.severity, e.peakSeverity);
    const urgent = level === 'rouge' ? '<span class="nw-urgent" aria-hidden="true">URGENT</span> ' : '';
    const sources = e.sourceNames.length > 0 ? ` · ${escapeHtml(e.sourceNames.slice(0, 3).join(', '))}` : '';
    return listRow({
      text: e.title, value: when(e.lastSeen, now), level,
      noteHtml: `${urgent}${escapeHtml(countText(e.independentCount, 'source indépendante', 'sources indépendantes'))}${sources}`,
    });
  }).join('');
  return [{ id: 'presse', title: 'Signalé par la presse', collapsible: false, open: true, html: rows }];
}
