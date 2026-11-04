// src/AnticipationBilanPage.ts : bilan public de l'anticipation (/anticipation/bilan, 04/11/2026, maquette écran 3).
// Quatre chiffres, « Les mots tiennent-ils parole ? » en effectifs (le pourcentage n'apparaît que si le serveur le donne, à partir de
// 30 scénarios clos pour un mot), règles de croisement avec leur test d'arrivée public et le drapeau « en revue ». « Mon département »
// montre les scénarios ouverts du département choisi et le lien du flux Atom des alertes : ni courriel ni compte.
import './styles/anticipation-pages.css';
import type { AnticipationBilan, AnticipationScenario, AnticipationWord } from './types/index.ts';
import { fetchAnticipationBilan, fetchAnticipationNow } from './services/anticipation.ts';
import { V1_WORDS, WORD_COLOR_VAR, WORD_LABEL } from './services/anticipation-words.ts';
import { scenarioPlace, wordChip } from './components/anticipation/agenda-view.ts';
import { escapeHtml } from './components/france-intel-events.ts';
import { DEPARTEMENT_CODES, departementName } from './components/layer-panel/health-format.ts';

/** Flux Atom des alertes de France Monitor (national : le flux n'a pas de filtre par département). */
export const ATOM_FEED_URL = '/api/alerts/atom';
const MAX_DEPT_SCENARIOS = 3;
const MONTH_RE = /^\d{4}-\d{2}$/;

/** Ce que chaque mot promet (milieu de sa fourchette), pour le trait de repère de la barre. */
const PROMISE: Readonly<Partial<Record<AnticipationWord, number>>> = { peu_probable: 30, possibilite_reelle: 45, probable: 65, tres_probable: 85 };

const isWord = (w: string): w is AnticipationWord => w in WORD_LABEL;
const wordName = (w: string): string => (isWord(w) ? WORD_LABEL[w] : w);

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const kpi = (value: number, caption: string, cls = ''): string =>
  `<div class="anb-kpi"><div class="anb-v ${cls}">${value}</div><div class="anb-c">${escapeHtml(caption)}</div></div>`;

function wordRow(w: AnticipationBilan['byWord'][number]): string {
  const share = w.closed > 0 ? Math.round((w.arrived / w.closed) * 100) : 0;
  const promise = isWord(w.word) ? PROMISE[w.word] : undefined;
  const color = isWord(w.word) ? WORD_COLOR_VAR[w.word] : undefined;
  const count = w.closed === 0 ? 'n.d.' : `${w.arrived} sur ${w.closed}`;
  const pct = w.percent !== null ? ` · ${w.percent}\u00a0%` : '';
  const track = w.closed === 0 ? '<div class="anb-track"></div>'
    : `<div class="anb-track"><div class="anb-obs" style="width:${share}%;${color ? `background:var(${color})` : ''}"></div>${promise !== undefined ? `<div class="anb-exp" style="left:${promise}%"></div>` : ''}</div>`;
  return `<div class="anb-b"><span>${escapeHtml(wordName(w.word))} (${w.closed})</span>${track}<span class="anb-n">${count}${pct}</span></div>`;
}

function ruleRow(r: AnticipationBilan['byRule'][number]): string {
  const none = r.emitted === 0;
  const nd = '<span class="anb-nd">n.d.</span>';
  const flag = r.inReview ? ' <span class="anb-review">en revue</span>' : '';
  return `<tr><td><b>${escapeHtml(r.title)}</b>${flag}<small>Arrivée constatée si : ${escapeHtml(r.arrivalTest)}</small></td>`
    + `<td>${r.emitted}</td><td>${none ? nd : r.arrived}</td><td>${none ? nd : r.useful}</td></tr>`;
}

/** Corps de la page : chiffres, mots, règles (HTML, texte échappé). */
export function bilanHtml(b: AnticipationBilan): string {
  const words = b.byWord.length === 0 ? '<p class="anb-hint">Aucun scénario clos ce mois-ci.</p>' : `<div class="anb-bars">${b.byWord.map(wordRow).join('')}</div>`;
  const rules = b.byRule.length === 0 ? '<p class="anb-hint">Aucune règle active.</p>'
    : `<table class="anb-tbl anb-rules"><thead><tr><th>Règle</th><th>Émis</th><th>Arrivés</th><th>Utile*</th></tr></thead><tbody>${b.byRule.map(ruleRow).join('')}</tbody></table>`;
  return `<h2>Bilan des scénarios · ${escapeHtml(monthLabel(b.month))}</h2>
    <div class="anb-kpis">${kpi(b.emitted, 'scénarios émis')}${kpi(b.arrived, 'arrivés', 'anb-ok')}${kpi(b.notArrived, 'pas arrivés')}${kpi(b.missed, 'crises manquées (aucun scénario)', b.missed > 0 ? 'anb-ko' : '')}</div>
    ${b.undecided > 0 ? `<p class="anb-hint">${b.undecided} scénario${b.undecided > 1 ? 's' : ''} sans issue décidable (données manquantes), non compté${b.undecided > 1 ? 's' : ''} ci-dessus.</p>` : ''}
    <div class="anb-two">
      <section class="anb-box"><h3>Les mots tiennent-ils parole ?</h3>${words}
        <p class="anb-hint">Barre : part arrivée. Trait : ce que le mot promet. Effectifs affichés ; le pourcentage n’apparaît qu’à partir de 30 scénarios clos pour un mot.</p></section>
      <section class="anb-box"><h3>Règles de croisement</h3>${rules}
        <p class="anb-hint">* votes « utile » des lecteurs. Une règle qui produit surtout des fausses alertes est mise en revue, puis corrigée ou retirée. <a href="/methodology.html#anticipation">Méthode complète</a>.</p></section>
    </div>`;
}

/** Section « Mon département » : scénarios ouverts du département (3 au plus) et lien du flux Atom. */
export function deptSectionHtml(code: string, scenarios: readonly AnticipationScenario[]): string {
  const mine = scenarios.filter((s) => s.zone.dept.includes(code) && s.word !== '');
  const list = mine.length === 0 ? `<p class="anb-hint">Aucun scénario ouvert pour ${escapeHtml(departementName(code))} en ce moment.</p>`
    : `<ul class="anb-scs">${mine.slice(0, MAX_DEPT_SCENARIOS).map((s) => `<li class="anb-sc">${wordChip(s.word)} ${escapeHtml(s.title)} <span class="anb-nd">${escapeHtml(scenarioPlace(s))}</span></li>`).join('')}</ul>`;
  return `<h3>${escapeHtml(code)} · ${escapeHtml(departementName(code))}</h3>${list}
    <p class="anb-hint">Pour suivre les alertes dans un lecteur de flux : <a href="${ATOM_FEED_URL}">flux Atom des alertes</a>. Ce flux est national, il n’existe pas encore de flux par département. Aucune adresse électronique ni compte.</p>`;
}

function deptSelect(current: string): string {
  const opts = DEPARTEMENT_CODES.map((c) => `<option value="${escapeHtml(c)}"${c === current ? ' selected' : ''}>${escapeHtml(c)} · ${escapeHtml(departementName(c))}</option>`).join('');
  return `<section class="anb-dept"><b>Mon département</b><label class="anb-sr" for="anb-dept-select">Département</label>
    <select id="anb-dept-select"><option value="">Choisir…</option>${opts}</select>
    <span class="anb-hint">Ses scénarios ouverts et le lien du flux d’alertes</span></section><div class="anb-dept-result" aria-live="polite"></div>`;
}

const legend = (): string => `<p class="anb-legend">Mots utilisés pour l’instant : ${V1_WORDS.map((w) => escapeHtml(WORD_LABEL[w])).join(', ')}.</p>`;

/** Monte la page ; `?month=AAAA-MM` et `?dept=NN` sont lus et gardés dans l'adresse. */
export function renderAnticipationBilanPage(container: HTMLElement): void {
  document.documentElement.classList.remove('fm-landing-mode');
  document.body.classList.remove('fm-landing-mode');
  document.title = 'Bilan de l’anticipation · France Monitor';
  const params = new URLSearchParams(window.location.search);
  const monthParam = params.get('month');
  const month = monthParam !== null && MONTH_RE.test(monthParam) ? monthParam : undefined;
  const deptParam = params.get('dept');
  const initialDept = deptParam !== null && DEPARTEMENT_CODES.includes(deptParam) ? deptParam : '';
  container.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'anb-page';
  page.innerHTML = `<header class="anb-top"><a href="/?view=app#live">France Monitor</a><span class="anb-beta">BÊTA · hypothèses à vérifier, pas des prévisions</span></header>
    <main class="anb-wrap"><nav class="anb-nav"><a href="/anticipation/note">Note du jour</a><a href="/sources-quality">Sources &amp; qualité</a><a href="/methodology.html#anticipation">Méthode</a></nav>
    <div class="anb-main"><p class="anb-hint" role="status">Chargement du bilan…</p></div></main>`;
  container.appendChild(page);
  const main = page.querySelector('.anb-main') as HTMLElement;
  void fetchAnticipationBilan(month).then((b) => {
    main.innerHTML = `${bilanHtml(b)}${deptSelect(initialDept)}${legend()}`;
    const select = main.querySelector('select') as HTMLSelectElement;
    const result = main.querySelector('.anb-dept-result') as HTMLElement;
    let scenarios: Promise<readonly AnticipationScenario[]> | null = null;
    const show = (code: string): void => {
      const url = new URL(window.location.href);
      if (code) url.searchParams.set('dept', code); else url.searchParams.delete('dept');
      window.history.replaceState({}, '', url);
      if (!code) { result.innerHTML = ''; return; }
      scenarios ??= fetchAnticipationNow().then((n) => n.scenarios).catch(() => []);
      void scenarios.then((list) => { if (select.value === code) result.innerHTML = `<section class="anb-box">${deptSectionHtml(code, list)}</section>`; });
    };
    select.addEventListener('change', () => show(select.value));
    if (initialDept) show(initialDept);
  }).catch(() => {
    main.innerHTML = '<p class="anb-hint" role="alert">Bilan indisponible. Réessayez dans quelques minutes.</p>';
  });
}
