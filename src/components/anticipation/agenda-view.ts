// src/components/anticipation/agenda-view.ts : vue pure de l'agenda des risques croisés (onglet Anticipation, 04/11/2026, maquette
// écran 1). Aujourd'hui en trois demi-journées, puis les jours suivants ; les jours sans croisement consécutifs sont regroupés avec
// leurs échéances publiées. Aucun accès réseau ni DOM ; tout texte venu du serveur est échappé.
import type {
  AnticipationAgendaDay,
  AnticipationHalf,
  AnticipationNowResponse,
  AnticipationScenario,
  AnticipationSignal,
  AnticipationSignalDomain,
  AnticipationWord,
} from '../../types/index.ts';
import { ALL_WORDS, isKnownWord, WORD_COLOR_VAR, wordLabel } from '../../services/anticipation-words.ts';
import type { AnticipationVisit } from '../../services/intel-last-visit.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { departementName } from '../layer-panel/health-format.ts';
import { weekdayOf } from '../layer-panel/format.ts';

export const HALF_LABEL: Readonly<Record<AnticipationHalf, string>> = { matin: 'Matin', 'apres-midi': 'Après-midi', soir: 'Soir' };

export const DOMAIN_LABEL: Readonly<Record<AnticipationSignalDomain, string>> = {
  social: 'Manifestations',
  transport: 'Transports',
  energy: 'Énergie',
  telecom: 'Télécoms',
  weather: 'Météo',
  cyber: 'Cyber',
  health: 'Santé',
  fuel: 'Carburant',
  press: 'Presse',
  event: 'Événement',
};

/** Marques « depuis ta dernière visite » d'un scénario. */
export interface VisitMarks {
  isNew: boolean;
  /** Mot plus haut qu'à la visite précédente. */
  raised: boolean;
  /** Heure ISO de la dernière bascule atteinte depuis la visite, sinon null. */
  basculeAt: string | null;
}

export interface AgendaOptions {
  selectedId: string | null;
  marks: ReadonlyMap<string, VisitMarks>;
}

const rank = (w: AnticipationWord | ''): number => (w === '' ? -1 : ALL_WORDS.indexOf(w));
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** « 4/11 » d'un jour AAAA-MM-JJ. */
function shortDate(day: string): string {
  return `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;
}

/** « Aujourd'hui · mer. 4/11 » ou « Jeu. 5/11 » (jour de Paris servi par l'agenda). */
export function dayLabel(day: string, today: string): string {
  const base = `${weekdayOf(day, 'short')} ${shortDate(day)}`;
  return day === today ? `Aujourd'hui · ${base}` : capitalize(base);
}

/** « Rhône · Lyon », « Finistère, Morbihan », « National » pour un scénario sans département. */
export function scenarioPlace(s: AnticipationScenario): string {
  if (s.zone.dept.length === 0) return 'National';
  const names = s.zone.dept.map(departementName).join(', ');
  const commune = s.zone.dept.length === 1 ? s.zone.communes.find((c) => c.trim() !== '' && !/^\d/.test(c)) : undefined;
  return commune ? `${names} · ${commune}` : names;
}

/** Domaines des signaux cités, dans l'ordre de la chaîne, sans doublon. */
export function scenarioDomains(s: AnticipationScenario, signals: Readonly<Record<string, AnticipationSignal>>): string[] {
  const out: string[] = [];
  for (const link of s.chain) {
    for (const id of link.signalIds) {
      const d = signals[id]?.domain;
      const label = d === undefined ? undefined : DOMAIN_LABEL[d];
      if (label !== undefined && !out.includes(label)) out.push(label);
    }
  }
  return out;
}

/** Pastille du mot, à la couleur de son jeton (--sev-*) ; rien pour une crise manquée (mot vide). */
export function wordChip(word: AnticipationWord | ''): string {
  if (word === '') return '';
  // Mot inconnu de ce client : mot brut échappé, couleur neutre.
  const w: string = word;
  const color = (isKnownWord(w) ? WORD_COLOR_VAR[w] : undefined) ?? '--text-muted';
  return `<span class="anr-lvl" style="--c: var(${color})">${escapeHtml(wordLabel(w))}</span>`;
}

/** Pur : marques depuis la visite précédente (null : première visite, aucune marque). */
export function visitMarks(scenarios: readonly AnticipationScenario[], visit: AnticipationVisit | null): Map<string, VisitMarks> {
  const out = new Map<string, VisitMarks>();
  for (const s of scenarios) {
    if (!visit) {
      out.set(s.id, { isNew: false, raised: false, basculeAt: null });
      continue;
    }
    const opened = Date.parse(s.openedAt);
    const before = visit.words[s.id];
    const hits = s.bascules
      .filter((b) => b.state === 'atteint' && b.at !== null && Date.parse(b.at) > visit.since)
      .map((b) => b.at as string)
      .sort((a, b) => Date.parse(b) - Date.parse(a));
    out.set(s.id, {
      isNew: before === undefined && Number.isFinite(opened) && opened > visit.since,
      raised: before !== undefined && rank(s.word) > rank(before),
      basculeAt: hits[0] ?? null,
    });
  }
  return out;
}

function marksHtml(m: VisitMarks | undefined): string {
  if (!m) return '';
  const tags = [m.isNew ? 'nouveau' : '', m.raised ? 'monté' : '', m.basculeAt !== null ? 'bascule atteinte' : ''].filter((t) => t !== '');
  return tags.length === 0 ? '' : `<span class="anr-marks">${tags.map((t) => `<span class="anr-mark">${t}</span>`).join('')}</span>`;
}

function itemHtml(s: AnticipationScenario, data: AnticipationNowResponse, opts: AgendaOptions): string {
  const chips = scenarioDomains(s, data.signals).map((d) => `<span class="anr-chip">${escapeHtml(d)}</span>`).join('');
  const sel = s.id === opts.selectedId;
  return `<button type="button" class="anr-item${sel ? ' is-sel' : ''}" data-scenario="${escapeHtml(s.id)}" aria-pressed="${sel ? 'true' : 'false'}">`
    + `<span class="anr-row"><span class="anr-where">${escapeHtml(scenarioPlace(s))}</span>${wordChip(s.word)}</span>`
    + `<span class="anr-what">${escapeHtml(s.title)}</span>`
    + (chips ? `<span class="anr-chips">${chips}</span>` : '')
    + marksHtml(opts.marks.get(s.id))
    + '</button>';
}

function deadlinesText(days: readonly AnticipationAgendaDay[]): string {
  const all = days.flatMap((d) => d.deadlines.map((x) => `${x.title} (${x.source}, ${shortDate(x.day)})`));
  return all.length === 0 ? '' : ` Échéances connues : ${all.join(' ; ')}.`;
}

/** Agenda complet (titre, aide, jours). */
export function agendaHtml(data: AnticipationNowResponse | null, opts: AgendaOptions): string {
  const head = '<h2>Agenda des risques croisés</h2>'
    + '<p class="anr-hint">7 jours. Chaque ligne croise au moins deux domaines dans un même département. Les échéances viennent des sources officielles.</p>';
  if (!data) return `${head}<p class="anr-hint">Chargement des scénarios…</p>`;
  const byId = new Map(data.scenarios.map((s) => [s.id, s]));
  const pick = (ids: readonly string[]): AnticipationScenario[] =>
    ids.map((id) => byId.get(id)).filter((s): s is AnticipationScenario => s !== undefined);
  const today = data.agenda[0]?.day ?? '';
  const parts: string[] = [];
  let empties: AnticipationAgendaDay[] = [];
  const flushEmpties = (): void => {
    if (empties.length === 0) return;
    const first = empties[0];
    const last = empties[empties.length - 1];
    const label = first === last ? dayLabel(first.day, today) : `${dayLabel(first.day, today)} → ${weekdayOf(last.day, 'short')} ${shortDate(last.day)}`;
    parts.push(`<section class="anr-day" data-agenda-empty="${escapeHtml(first.day)}"><h3>${escapeHtml(label)}</h3>`
      + `<p class="anr-hint">Aucun croisement détecté.${escapeHtml(deadlinesText(empties))}</p></section>`);
    empties = [];
  };
  for (const day of data.agenda) {
    const isToday = day.day === today;
    const scenarios = pick(day.scenarioIds);
    if (!isToday && scenarios.length === 0) {
      empties.push(day);
      continue;
    }
    flushEmpties();
    let body: string;
    if (isToday && day.halves) {
      // Aujourd'hui : toujours les trois demi-journées, chacune « Aucun croisement. » si elle est vide. Demi-journée inconnue : ignorée.
      body = day.halves.filter((h) => Object.hasOwn(HALF_LABEL, h.half)).map((h) => {
        const list = pick(h.scenarioIds);
        return `<div class="anr-half" data-half="${escapeHtml(h.half)}"><h4>${escapeHtml(HALF_LABEL[h.half])}</h4>`
          + (list.length === 0 ? '<p class="anr-empty">Aucun croisement.</p>' : list.map((s) => itemHtml(s, data, opts)).join(''))
          + '</div>';
      }).join('');
    } else if (scenarios.length === 0) {
      body = `<p class="anr-hint">Aucun croisement détecté.${escapeHtml(deadlinesText([day]))}</p>`;
    } else {
      body = scenarios.map((s) => itemHtml(s, data, opts)).join('');
    }
    const extra = scenarios.length > 0 && day.deadlines.length > 0 ? `<p class="anr-hint">${escapeHtml(deadlinesText([day]).trim())}</p>` : '';
    parts.push(`<section class="anr-day" data-agenda-day="${escapeHtml(day.day)}"><h3>${escapeHtml(dayLabel(day.day, today))}</h3>${body}${extra}</section>`);
  }
  flushEmpties();
  return head + parts.join('');
}
