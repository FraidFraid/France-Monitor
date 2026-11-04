// src/AnticipationNotePage.ts : note d'anticipation de 7 h, page imprimable (/anticipation/note, 04/11/2026, maquette écran 2).
// Feuille claire A4 : en une phrase, scénarios du jour, sept jours, depuis hier. Les relevés absents au moment de la note sont
// listés discrètement en bas. `?day=AAAA-MM-JJ` choisit une autre note. Tout texte venu du serveur est échappé.
import './styles/anticipation-pages.css';
import type { AnticipationNote, AnticipationScenario, AnticipationStatus } from './types/index.ts';
import { fetchAnticipationNote } from './services/anticipation.ts';
import { WORD_LABEL } from './services/anticipation-words.ts';
import { scenarioPlace } from './components/anticipation/agenda-view.ts';
import { escapeHtml } from './components/france-intel-events.ts';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PARIS = 'Europe/Paris';

/** `?day=` valide (AAAA-MM-JJ) ou undefined : la note la plus récente. */
export function dayFromSearch(search: string): string | undefined {
  const day = new URLSearchParams(search).get('day');
  return day !== null && DAY_RE.test(day) ? day : undefined;
}

const STATUS_TEXT: Readonly<Partial<Record<AnticipationStatus, string>>> = {
  arrive: 'arrivé',
  pas_arrive: 'pas arrivé',
  indecidable: 'indécidable',
  expire: 'expiré',
  manque: 'crise manquée',
};

const wordText = (s: AnticipationScenario): string => (s.word === '' ? 'n.d.' : WORD_LABEL[s.word]);

/** Première bascule encore surveillée, sinon la dernière atteinte ; « n.d. » sans bascule. */
function basculeText(s: AnticipationScenario): string {
  const watching = s.bascules.find((b) => b.state === 'surveille');
  const b = watching ?? s.bascules[0];
  return b ? b.label : 'n.d.';
}

function longDate(day: string, hhmm: string | null): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const cap = date.charAt(0).toUpperCase() + date.slice(1);
  return hhmm ? `${cap} · ${hhmm}` : cap;
}

function dayMonthName(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function todayTable(list: readonly AnticipationScenario[]): string {
  if (list.length === 0) return '<p class="anp-none">Aucun scénario ouvert pour aujourd’hui.</p>';
  const rows = list.map((s) => `<tr><td>${escapeHtml(scenarioPlace(s))}</td><td>${escapeHtml(s.title)}</td>`
    + `<td class="anp-p">${escapeHtml(wordText(s))}</td><td>${escapeHtml(basculeText(s))}</td></tr>`).join('');
  return `<table><thead><tr><th>Où</th><th>Scénario</th><th>Probabilité</th><th>Bascule à surveiller</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** « Jeu. 5/11 » : jour de la semaine abrégé et date, sans dépendre du libellé « Aujourd'hui · ». */
function shortDayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' });
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${d}/${String(m).padStart(2, '0')}`;
}

function weekTable(note: AnticipationNote): string {
  if (note.week.length === 0) return '<p class="anp-none">Aucun scénario ouvert pour les sept prochains jours.</p>';
  const rows = note.week.map(({ day, scenario }) => `<tr><td class="anp-nw">${escapeHtml(shortDayLabel(day))}</td>`
    + `<td>${escapeHtml(scenarioPlace(scenario))} : ${escapeHtml(scenario.title)}</td><td class="anp-p">${escapeHtml(wordText(scenario))}</td></tr>`).join('');
  return `<table><tbody>${rows}</tbody></table>`;
}

function sinceYesterday(note: AnticipationNote): string {
  const { opened, closed } = note.sinceYesterday;
  if (opened.length === 0 && closed.length === 0) return '<p class="anp-none">Rien de nouveau depuis hier.</p>';
  const open = opened.map((s) => `<li><b>Nouveau</b> : ${escapeHtml(scenarioPlace(s))}, ${escapeHtml(s.title)} (${escapeHtml(wordText(s))}).</li>`);
  const shut = closed.map((s) => {
    const word = s.word === '' ? '' : ` (${escapeHtml(wordText(s))})`;
    return `<li><b>Clos</b> : ${escapeHtml(scenarioPlace(s))}, ${escapeHtml(s.title)} <b>${escapeHtml(STATUS_TEXT[s.status] ?? s.status)}</b>${word}.</li>`;
  });
  return `<ul>${[...open, ...shut].join('')}</ul>`;
}

/** Feuille complète de la note (HTML, texte échappé). */
export function noteHtml(note: AnticipationNote): string {
  const hhmm = new Date(note.generatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: PARIS });
  const degraded = note.degraded.length > 0
    ? `<p class="anp-degraded">Sources non lues au moment de la note : ${note.degraded.map(escapeHtml).join(', ')}.</p>` : '';
  return `<article class="anp-paper">
    <div class="anp-hd"><span>FRANCE MONITOR · NOTE D’ANTICIPATION · BÊTA</span><span>${escapeHtml(longDate(note.day, hhmm))}</span></div>
    <h1>Note d’anticipation du ${escapeHtml(dayMonthName(note.day))}</h1>
    <div class="anp-bluf"><b>En une phrase :</b> ${escapeHtml(note.bluf)}</div>
    <h2>Scénarios du jour</h2>${todayTable(note.today)}
    <h2>Les 7 prochains jours</h2>${weekTable(note)}
    <h2>Depuis hier</h2>${sinceYesterday(note)}
    <div class="anp-ft">Probabilités exprimées sur l’échelle standard des services de renseignement (mots et fourchettes). Chaque scénario cite ses sources ; méthode et bilan publics : <a href="/methodology.html#anticipation">francemonitor.com/methodology.html#anticipation</a>. Hypothèses à vérifier, pas des prévisions officielles.</div>
    ${degraded}
  </article>`;
}

const bar = (): string => `<nav class="anp-bar" aria-label="Note d’anticipation">
    <a href="/?view=app#live">Retour à la carte</a><a href="/anticipation/bilan">Bilan public</a><a href="/methodology.html#anticipation">Méthode</a>
    <button type="button" data-anp-print>Imprimer ou enregistrer en PDF</button></nav>`;

/** Monte la page ; la note se charge après un premier rendu « chargement ». */
export function renderAnticipationNotePage(container: HTMLElement): void {
  document.documentElement.classList.remove('fm-landing-mode');
  document.body.classList.remove('fm-landing-mode');
  document.title = 'Note d’anticipation · France Monitor';
  const day = dayFromSearch(window.location.search);
  container.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'anp-page';
  page.innerHTML = `${bar()}<div class="anp-body"><p class="anp-none" role="status">Chargement de la note…</p></div>`;
  container.appendChild(page);
  page.querySelector('[data-anp-print]')?.addEventListener('click', () => window.print());
  const body = page.querySelector('.anp-body') as HTMLElement;
  void fetchAnticipationNote(day).then((note) => {
    body.innerHTML = note ? noteHtml(note)
      : `<article class="anp-paper"><h1>Aucune note pour ce jour</h1><p class="anp-none">La note de 7 h n’a pas été publiée${day ? ` pour le ${escapeHtml(dayMonthName(day))}` : ''}. Elle paraît chaque matin à 7 h (heure de Paris).</p></article>`;
  }).catch(() => {
    body.innerHTML = '<article class="anp-paper"><h1>Note indisponible</h1><p class="anp-none">Le service d’anticipation ne répond pas. Réessayez dans quelques minutes.</p></article>';
  });
}
