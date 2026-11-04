// src/components/anticipation/AnticipationRoom.ts : salle de l'onglet Anticipation (04/11/2026, maquette écran 1), montée sur la carte
// quand l'onglet est actif, comme la salle des pannes. Bandeau BÊTA et titre en haut, agenda à gauche, fiche à droite, légende et
// curseur des 7 jours en bas. La carte (départements colorés par mot) est pilotée par le pilote à partir des rappels onFocus et onDay.
import type { AnticipationNowResponse, AnticipationScenario, AnticipationVote, AnticipationWord } from '../../types/index.ts';
import { readAnticipationVote, sendAnticipationFeedback } from '../../services/anticipation.ts';
import { V1_WORDS, WORD_COLOR_VAR, WORD_LABEL } from '../../services/anticipation-words.ts';
import { beginAnticipationVisit, recordAnticipationVisit, type AnticipationVisit } from '../../services/intel-last-visit.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { weekdayOf } from '../layer-panel/format.ts';
import { agendaHtml, dayLabel, visitMarks } from './agenda-view.ts';
import { BETA_TEXT, scenarioHtml, type FeedbackState } from './scenario-view.ts';

const VOTES: readonly AnticipationVote[] = ['utile', 'deja_su', 'faux'];
const isVote = (v: string | undefined): v is AnticipationVote => VOTES.some((x) => x === v);

export class AnticipationRoom {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly agenda: HTMLElement;
  private readonly card: HTMLElement;
  private readonly slider: HTMLElement;
  private data: AnticipationNowResponse | null = null;
  private day: string | null = null;
  private picked: string | null = null;
  private readonly feedback = new Map<string, FeedbackState>();
  private readonly visit: AnticipationVisit | null = beginAnticipationVisit();
  private focusCb: ((s: AnticipationScenario) => void) | null = null;
  private dayCb: ((day: string) => void) | null = null;
  /** Sous la barre des pastilles posée sur la carte, comme la salle des pannes (sa hauteur dépend de la largeur). */
  private readonly resize: ResizeObserver | null = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.placeBelowPills());
  private observedPills: Element | null = null;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'anr';
    const top = document.createElement('div');
    top.className = 'anr-top';
    this.title = document.createElement('div');
    this.title.className = 'anr-maptitle';
    const beta = document.createElement('span');
    beta.className = 'anr-beta';
    beta.textContent = BETA_TEXT;
    top.append(this.title, beta);
    this.agenda = document.createElement('div');
    this.agenda.className = 'anr-col anr-agenda';
    this.card = document.createElement('div');
    this.card.className = 'anr-col anr-side';
    this.card.setAttribute('aria-live', 'polite');
    const body = document.createElement('div');
    body.className = 'anr-body';
    body.append(this.agenda, this.card);
    const bottom = document.createElement('div');
    bottom.className = 'anr-bottom';
    const legend = document.createElement('div');
    legend.className = 'anr-legend';
    legend.innerHTML = [...V1_WORDS].reverse().map((w: AnticipationWord) =>
      `<span><i class="anr-dot" style="--c: var(${WORD_COLOR_VAR[w] ?? '--text-muted'})"></i>${escapeHtml(WORD_LABEL[w])}</span>`).join('');
    this.slider = document.createElement('div');
    this.slider.className = 'anr-slider';
    this.slider.setAttribute('role', 'group');
    this.slider.setAttribute('aria-label', 'Jour affiché sur la carte');
    bottom.append(legend, this.slider);
    this.el.append(top, body, bottom);
    this.el.addEventListener('click', (ev) => this.onClick(ev));
    host.appendChild(this.el);
    this.render();
  }

  onFocus(cb: (s: AnticipationScenario) => void): void { this.focusCb = cb; }
  onDay(cb: (day: string) => void): void { this.dayCb = cb; }

  setData(d: AnticipationNowResponse): void {
    this.data = d;
    const days = d.agenda.map((a) => a.day);
    if (this.day === null || !days.includes(this.day)) this.day = days[0] ?? null;
    if (this.picked !== null && !d.scenarios.some((s) => s.id === this.picked)) this.picked = null;
    this.render();
    // Visite notée à chaque affichage : la prochaine session comparera à ce qui a été vu (la visite de cette session reste figée).
    recordAnticipationVisit(Object.fromEntries(d.scenarios.filter((s) => s.word !== '').map((s) => [s.id, s.word as AnticipationWord])));
  }

  setDay(day: string): void {
    if (day === this.day) return;
    this.day = day;
    this.picked = null;
    this.render();
  }

  /** Aucune réponse lisible et rien en mémoire (première lecture en échec). */
  setUnavailable(): void {
    if (this.data) return;
    this.agenda.innerHTML = '<h2>Agenda des risques croisés</h2><p class="anr-hint">Scénarios indisponibles pour le moment : nouvel essai dans une minute.</p>';
  }

  /** Jour affiché (AAAA-MM-JJ) ; null avant la première réponse. */
  currentDay(): string | null { return this.day; }

  destroy(): void {
    this.resize?.disconnect();
    this.el.remove();
  }

  private dayIds(): string[] {
    return this.data?.agenda.find((a) => a.day === this.day)?.scenarioIds ?? [];
  }

  /** Scénario affiché : celui choisi, sinon le premier du jour. */
  private current(): AnticipationScenario | null {
    const scenarios = this.data?.scenarios ?? [];
    const id = this.picked ?? this.dayIds()[0];
    return scenarios.find((s) => s.id === id) ?? null;
  }

  private placeBelowPills(): void {
    const host = this.el.parentElement;
    const pills = host?.parentElement?.querySelector('.floating-panel-switcher');
    if (!host || !pills) return;
    if (this.resize && pills !== this.observedPills) {
      this.resize.disconnect();
      this.resize.observe(pills);
      this.resize.observe(host);
      this.observedPills = pills;
    }
    const top = pills.getBoundingClientRect().bottom - host.getBoundingClientRect().top;
    if (top > 0) this.el.style.setProperty('--anr-top', `${Math.round(top + 8)}px`);
  }

  private feedbackOf(id: string): FeedbackState {
    const known = this.feedback.get(id);
    if (known) return known;
    return readAnticipationVote(id) ? 'deja' : 'idle';
  }

  private render(): void {
    this.placeBelowPills();
    const d = this.data;
    const today = d?.agenda[0]?.day ?? '';
    const s = this.current();
    this.agenda.innerHTML = agendaHtml(d, { selectedId: s?.id ?? null, marks: visitMarks(d?.scenarios ?? [], this.visit) });
    this.card.innerHTML = d ? scenarioHtml(s, d.signals, { today, feedback: s ? this.feedbackOf(s.id) : 'idle' }) : '';
    const n = this.dayIds().length;
    const hits = (d?.scenarios ?? []).filter((x) => this.dayIds().includes(x.id) && x.bascules.some((b) => b.state === 'atteint')).length;
    this.title.innerHTML = !d || this.day === null ? 'Anticipation'
      : `<b>${escapeHtml(dayLabel(this.day, ''))}</b> · ${n} scénario${n > 1 ? 's' : ''} ouvert${n > 1 ? 's' : ''}`
        + (hits > 0 ? ` · ${hits} bascule${hits > 1 ? 's' : ''} atteinte${hits > 1 ? 's' : ''}` : '');
    this.slider.innerHTML = (d?.agenda ?? []).map((a) => {
      const label = a.day === today ? 'Auj.' : weekdayOf(a.day, 'short').replace(/^./, (c) => c.toUpperCase());
      const on = a.day === this.day;
      return `<button type="button" data-day="${escapeHtml(a.day)}" aria-pressed="${on ? 'true' : 'false'}"${a.scenarioIds.length > 0 ? ' class="has-sc"' : ''}>${escapeHtml(label)}</button>`;
    }).join('');
  }

  private vote(s: AnticipationScenario, vote: AnticipationVote): void {
    if (this.feedbackOf(s.id) !== 'idle' && this.feedbackOf(s.id) !== 'erreur') return;
    this.feedback.set(s.id, 'sending');
    this.render();
    void sendAnticipationFeedback(s.id, vote).then((r) => {
      this.feedback.set(s.id, r);
      this.render();
    });
  }

  private onClick(ev: Event): void {
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    const day = target.closest<HTMLElement>('[data-day]')?.dataset.day;
    if (day !== undefined) {
      this.setDay(day);
      this.dayCb?.(day);
      return;
    }
    const vote = target.closest<HTMLElement>('button[data-vote]')?.dataset.vote;
    const s = this.current();
    if (isVote(vote)) {
      if (s) this.vote(s, vote);
      return;
    }
    if (target.closest('[data-fly]')) {
      if (s) this.focusCb?.(s);
      return;
    }
    const id = target.closest<HTMLElement>('[data-scenario]')?.dataset.scenario;
    const picked = id === undefined ? undefined : this.data?.scenarios.find((x) => x.id === id);
    if (picked) {
      // Scénario d'un autre jour (ou fenêtre hors du jour affiché) : la carte passe à son premier jour.
      const own = this.data?.agenda.find((a) => a.scenarioIds.includes(picked.id))?.day;
      const moved = own !== undefined && !this.dayIds().includes(picked.id);
      if (moved) this.day = own;
      this.picked = picked.id;
      this.render();
      if (moved) this.dayCb?.(own);
      this.focusCb?.(picked);
    }
  }
}
