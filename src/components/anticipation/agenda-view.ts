// src/components/anticipation/agenda-view.ts : vue pure de l'agenda (onglet Anticipation, 04/11/2026, maquette
// écran 1 ; lecture simplifiée le 13/11/2026 : résumé du jour, hypothèses identiques regroupées par lieu, aide repliée). Aujourd'hui en trois demi-journées, puis les jours suivants ; les jours sans croisement consécutifs sont regroupés avec
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
  const tags = [m.isNew ? 'nouveau' : '', m.raised ? 'en hausse' : '', m.basculeAt !== null ? 'signe constaté' : ''].filter((t) => t !== '');
  return tags.length === 0 ? '' : `<span class="anr-marks">${tags.map((t) => `<span class="anr-mark">${t}</span>`).join('')}</span>`;
}

function itemHtml(s: AnticipationScenario, data: AnticipationNowResponse, opts: AgendaOptions): string {
  const chips = scenarioDomains(s, data.signals).map((d) => `<span class="anr-chip">${escapeHtml(d)}</span>`).join('');
  const sel = s.id === opts.selectedId;
  return `<button type="button" class="anr-item${sel ? ' is-sel' : ''}" data-scenario="${escapeHtml(s.id)}" aria-pressed="${sel ? 'true' : 'false'}">`
    + `<span class="anr-row"><span class="anr-where">${escapeHtml(s.title)}</span>${wordChip(s.word)}</span>`
    + `<span class="anr-what">${escapeHtml(scenarioPlace(s))}</span>`
    + (chips ? `<span class="anr-chips">${chips}</span>` : '')
    + marksHtml(opts.marks.get(s.id))
    + '</button>';
}

/** Pur : hypothèses de même règle et de même titre réunies, dans l'ordre d'arrivée (une seule : groupe d'un élément). */
export function groupScenarios(list: readonly AnticipationScenario[]): AnticipationScenario[][] {
  const groups = new Map<string, AnticipationScenario[]>();
  for (const s of list) {
    const key = `${s.ruleId}\n${s.title}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.values()];
}

/** Mot le plus haut d'un groupe (vide si aucun mot attribué). */
function topWord(items: readonly AnticipationScenario[]): AnticipationWord | '' {
  return items.reduce<AnticipationWord | ''>((best, s) => (rank(s.word) > rank(best) ? s.word : best), '');
}

/** « 8 départements » quand chaque hypothèse porte un seul département, sinon « 8 zones ». */
function groupCount(items: readonly AnticipationScenario[]): string {
  return `${items.length}\u00a0${items.every((s) => s.zone.dept.length === 1) ? 'départements' : 'zones'}`;
}

const wordColor = (word: string): string => (isKnownWord(word) ? WORD_COLOR_VAR[word] : undefined) ?? '--text-muted';

/** Une ligne par groupe : le titre une seule fois, puis un bouton par lieu (pastille à la couleur de son niveau), du plus au moins probable. */
function groupHtml(items: readonly AnticipationScenario[], data: AnticipationNowResponse, opts: AgendaOptions): string {
  const first = items[0];
  if (first === undefined) return '';
  if (items.length === 1) return itemHtml(first, data, opts);
  const domains = [...new Set(items.flatMap((s) => scenarioDomains(s, data.signals)))];
  const chips = domains.map((d) => `<span class="anr-chip">${escapeHtml(d)}</span>`).join('');
  const places = [...items].sort((a, b) => rank(b.word) - rank(a.word)).map((s) => {
    const sel = s.id === opts.selectedId;
    const word: string = s.word;
    const place = scenarioPlace(s);
    const label = word === '' ? place : `${place}, ${wordLabel(word)}`;
    return `<button type="button" class="anr-place${sel ? ' is-sel' : ''}" data-scenario="${escapeHtml(s.id)}" aria-pressed="${sel ? 'true' : 'false'}"`
      + ` aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">`
      + `<i class="anr-pip" style="--c: var(${wordColor(word)})" aria-hidden="true"></i>${escapeHtml(place)}${marksHtml(opts.marks.get(s.id))}</button>`;
  }).join('');
  return '<div class="anr-group">'
    + `<span class="anr-row"><span class="anr-where">${escapeHtml(first.title)}</span>${wordChip(topWord(items))}</span>`
    + `<span class="anr-what">${escapeHtml(groupCount(items))} · choisir un lieu pour le détail</span>`
    + `<span class="anr-places">${places}</span>`
    + (chips ? `<span class="anr-chips">${chips}</span>` : '')
    + '</div>';
}

const listHtml = (list: readonly AnticipationScenario[], data: AnticipationNowResponse, opts: AgendaOptions): string =>
  groupScenarios(list).map((g) => groupHtml(g, data, opts)).join('');

/** Aide repliée : les mots de la page en quatre lignes. */
export const HELP_HTML = '<details class="anr-help" data-k="aide"><summary>Comment lire cette page</summary><ul>'
  + '<li><b>Une hypothèse</b> : plusieurs signaux relevés au même endroit et au même moment font penser qu\u2019un problème peut suivre. Ce n\u2019est pas une prévision.</li>'
  + '<li><b>Le niveau</b> (peu probable, possibilité réelle, probable, très probable) dépend surtout du nombre de sources indépendantes. Avec une seule source, il reste « peu probable ».</li>'
  + '<li><b>Un signe constaté</b> : un fait surveillé qui renforce l\u2019hypothèse vient de se produire (arrêté publié, seuil dépassé).</li>'
  + '<li><b>La fiche</b>, à droite, dit pourquoi on le pense, ce qu\u2019on ignore et quoi vérifier avant d\u2019agir.</li>'
  + '</ul></details>';

/** Résumé d'ouverture : ce qu'il faut retenir d'aujourd'hui en quelques lignes, sinon le prochain jour concerné. */
export function summaryHtml(data: AnticipationNowResponse): string {
  const byId = new Map(data.scenarios.map((s) => [s.id, s]));
  const of = (day: AnticipationAgendaDay | undefined): AnticipationScenario[] =>
    (day?.scenarioIds ?? []).map((id) => byId.get(id)).filter((s): s is AnticipationScenario => s !== undefined);
  const today = data.agenda[0];
  const groups = groupScenarios(of(today)).sort((a, b) => rank(topWord(b)) - rank(topWord(a)));
  let body: string;
  if (groups.length === 0) {
    const next = data.agenda.slice(1).find((d) => of(d).length > 0);
    const n = next ? of(next).length : 0;
    body = '<p>Rien à signaler aujourd\u2019hui.'
      + (next ? ` Prochain jour concerné : ${escapeHtml(dayLabel(next.day, today?.day ?? '').toLowerCase())} (${n}\u00a0hypothèse${n > 1 ? 's' : ''}).` : '')
      + '</p>';
  } else {
    const shown = groups.slice(0, 4);
    const rest = groups.length - shown.length;
    body = `<ul>${shown.map((g) => {
      const first = g[0];
      if (first === undefined) return '';
      const where = g.length > 1 ? groupCount(g) : scenarioPlace(first);
      return `<li><span><b>${escapeHtml(first.title)}</b> · ${escapeHtml(where)}</span>${wordChip(topWord(g))}</li>`;
    }).join('')}</ul>${rest > 0 ? `<p>et ${rest} autre${rest > 1 ? 's' : ''}, plus bas.</p>` : ''}`;
  }
  return `<section class="anr-sum" aria-label="À retenir aujourd'hui"><h3>À retenir aujourd\u2019hui</h3>${body}</section>`;
}

/** Échéances publiées des jours donnés, une par ligne (titre, puis source et date) ; vide sans échéance. */
function deadlinesHtml(days: readonly AnticipationAgendaDay[]): string {
  const all = days.flatMap((d) => d.deadlines.map((x) =>
    `<li>${escapeHtml(x.title)} <small>${escapeHtml(`${x.source}, ${shortDate(x.day)}`)}</small></li>`));
  return all.length === 0 ? '' : `<p class="anr-dl-h">Échéances connues</p><ul class="anr-dl">${all.join('')}</ul>`;
}

const CALM = '<p class="anr-hint">Rien à signaler.</p>';

/** Agenda complet (titre, aide, jours). */
export function agendaHtml(data: AnticipationNowResponse | null, opts: AgendaOptions): string {
  const title = '<h2>Ce qui pourrait arriver · 7 jours</h2>';
  if (!data) return `${title}<p class="anr-hint">Chargement des hypothèses…</p>`;
  const head = title + summaryHtml(data) + HELP_HTML;
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
      + `${CALM}${deadlinesHtml(empties)}</section>`);
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
    if (isToday && day.halves && scenarios.length > 0) {
      // Aujourd'hui avec au moins une hypothèse : les trois demi-journées, « Rien à signaler. » pour une demi-journée vide (un jour
      // entièrement calme tient en une ligne, plus bas). Demi-journée inconnue : ignorée.
      body = day.halves.filter((h) => Object.hasOwn(HALF_LABEL, h.half)).map((h) => {
        const list = pick(h.scenarioIds);
        return `<div class="anr-half" data-half="${escapeHtml(h.half)}"><h4>${escapeHtml(HALF_LABEL[h.half])}</h4>`
          + (list.length === 0 ? '<p class="anr-empty">Rien à signaler.</p>' : listHtml(list, data, opts))
          + '</div>';
      }).join('');
    } else if (scenarios.length === 0) {
      body = CALM + deadlinesHtml([day]);
    } else {
      body = listHtml(scenarios, data, opts);
    }
    const extra = scenarios.length > 0 ? deadlinesHtml([day]) : '';
    parts.push(`<section class="anr-day" data-agenda-day="${escapeHtml(day.day)}"><h3>${escapeHtml(dayLabel(day.day, today))}</h3>${body}${extra}</section>`);
  }
  flushEmpties();
  return head + parts.join('');
}
