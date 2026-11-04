// src/components/anticipation/scenario-view.ts : vue pure de la fiche d'un scénario (onglet Anticipation, 04/11/2026, maquette écran 1).
// Échelle des sept mots (le mot actif à la couleur de son jeton --sev-*), chaîne de preuves avec source et heure de Paris, inconnues,
// bascules, ce qui l'infirmerait, vérifications, retours. Aucun accès réseau ni DOM ; tout texte venu du serveur est échappé.
import type { AnticipationChainLink, AnticipationScenario, AnticipationSignal } from '../../types/index.ts';
import { ALL_WORDS, isKnownWord, WORD_COLOR_VAR, WORD_LABEL, WORD_RANGE, wordLabel } from '../../services/anticipation-words.ts';
import { parisDay } from '../../services/paris-day.js';
import { escapeHtml } from '../france-intel-events.ts';
import { localClock } from '../layer-panel/format.ts';
import { dayLabel, scenarioPlace } from './agenda-view.ts';

/** État des boutons de retour : rien envoyé, envoi en cours, enregistré, déjà noté, échec. */
export type FeedbackState = 'idle' | 'sending' | 'ok' | 'deja' | 'erreur';

export interface ScenarioViewOptions {
  /** Jour de Paris d'aujourd'hui (AAAA-MM-JJ). */
  today: string;
  feedback: FeedbackState;
}

/** Noms lisibles des sources des relevés (identifiants de api/_lib/anticipation/signals.js) ; inconnue : l'identifiant tel quel. */
export const SOURCE_LABEL: Readonly<Record<string, string>> = {
  sncf: 'SNCF',
  'meteo-france': 'Météo-France',
  rte: 'RTE',
  prefecture: 'Préfecture',
  cgt: 'CGT',
  demosphere: 'Démosphère',
  gdelt: 'GDELT',
  ddosia: 'NoName057(16)',
  'cloudflare-radar': 'Cloudflare Radar',
  'prix-carburants': 'Prix des carburants',
  'football-data': 'football-data.org',
  arcep: 'ARCEP',
  edf: 'EDF',
  enedis: 'Enedis',
  presse: 'Presse',
};

export const BETA_TEXT = 'BÊTA · hypothèses à vérifier, pas des prévisions';
const WARN = '<p class="anr-warn">Hypothèse à vérifier, produite par des règles publiques à partir de sources ouvertes. Ne remplace ni les alertes officielles ni les sources primaires.</p>';
const PARIS = 'Europe/Paris';

const clock = (iso: string | null): string | null => {
  const t = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(t) ? localClock(t, PARIS) : null;
};
const sourceName = (s: AnticipationSignal): string => SOURCE_LABEL[s.source] ?? s.source;

/** « CGT, Démosphère · 08:55 » : sources des signaux cités et heure (Paris) du plus récent ; vide sans signal connu. */
export function stepSource(link: AnticipationChainLink, signals: Readonly<Record<string, AnticipationSignal>>): string {
  const cited = link.signalIds.map((id) => signals[id]).filter((s): s is AnticipationSignal => s !== undefined);
  if (cited.length === 0) return '';
  const names = [...new Set(cited.map(sourceName))];
  const latest = Math.max(...cited.map((s) => Date.parse(s.publishedAt ?? s.observedAt)).filter((t) => Number.isFinite(t)));
  const at = Number.isFinite(latest) ? ` · ${localClock(latest, PARIS)}` : '';
  return `${names.join(', ')}${at}`;
}

/** Fenêtre lisible : « aujourd'hui 14:00 → 22:00 » ou « jeu. 5/11 07:00 → 21:00 ». */
function windowText(s: AnticipationScenario, today: string): string {
  const from = Date.parse(s.window.from);
  const to = Date.parse(s.window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'n.d.';
  const day = parisDay(from);
  const label = day === today ? 'aujourd\'hui' : dayLabel(day, today).toLowerCase();
  const end = parisDay(to) === day ? localClock(to, PARIS) : `${dayLabel(parisDay(to), today).toLowerCase()} ${localClock(to, PARIS)}`;
  return `${label} ${localClock(from, PARIS)} → ${end}`;
}

function scaleHtml(s: AnticipationScenario): string {
  const cells = ALL_WORDS.map((w) => {
    const on = w === s.word;
    const color = WORD_COLOR_VAR[w];
    return `<span${on ? ` class="is-on" style="--c: var(${color ?? '--text-muted'})"` : ''}>${escapeHtml(WORD_LABEL[w])}</span>`;
  }).join('');
  // Mot inconnu de ce client (serveur plus récent) : mot brut échappé, couleur neutre, sans fourchette.
  const word: string = s.word;
  const known = isKnownWord(word);
  const label = wordLabel(word);
  const note = word === ''
    ? '<p class="anr-scalenote">Crise relevée sans scénario émis : aucun mot attribué.</p>'
    : `<p class="anr-scalenote"><b style="color: var(${(known ? WORD_COLOR_VAR[word] : undefined) ?? '--text-muted'})">${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</b>`
      + `${known ? ` (${WORD_RANGE[word]})` : ''}${ruleText(s.ruleId)}${s.why ? ` : ${escapeHtml(s.why)}` : ''}. Mot attribué par règle écrite, pas par l'IA.</p>`;
  return `<div class="anr-scale" role="img" aria-label="Échelle de probabilité">${cells}</div>${note}`;
}

/** Nom court des règles de croisement (api/_lib/anticipation/rules/*.js) ; règle inconnue : non nommée. */
export const RULE_LABEL: Readonly<Record<string, string>> = {
  'mobilisation-transports': 'mobilisation × transports',
  'evenement-mobilisation': 'événement × mobilisation × transports',
  'social-cyber': 'crise sociale × cyber',
  'tempete-reseaux': 'tempête × électricité × télécoms',
  'chaleur-sante': 'chaleur × électricité × santé',
  'greve-carburant': 'grève × carburant',
};
const ruleText = (ruleId: string): string => {
  const label = RULE_LABEL[ruleId];
  return label ? ` d'après la règle \u00ab\u00a0${escapeHtml(label)}\u00a0\u00bb` : '';
};

const list = (items: readonly string[], cls = ''): string =>
  items.length === 0 ? '<p class="anr-empty">n.d.</p>'
    : `<ul>${items.map((t) => `<li${cls ? ` class="${cls}"` : ''}>${escapeHtml(t)}</li>`).join('')}</ul>`;
const sec = (title: string, body: string): string => `<section class="anr-sec"><h4>${escapeHtml(title)}</h4>${body}</section>`;

function feedbackHtml(state: FeedbackState): string {
  const done = state === 'ok' || state === 'deja';
  const disabled = done || state === 'sending' ? ' disabled' : '';
  const buttons = ([['utile', 'Utile'], ['deja_su', 'Déjà su'], ['faux', 'Faux']] as const)
    .map(([vote, label]) => `<button type="button" data-vote="${vote}"${disabled}>${label}</button>`).join('');
  const msg = state === 'ok' ? 'Merci' : state === 'deja' ? 'Déjà noté' : state === 'erreur' ? 'Envoi impossible, réessayez plus tard' : '';
  // Zone annoncée toujours présente (vide avant le vote) : un lecteur d'écran entend « Merci » ou « Déjà noté ».
  return `<div class="anr-fb">${buttons}</div><p class="anr-fb-state" role="status" aria-live="polite">${msg}</p>`;
}

/** Fiche complète ; null : aucun scénario pour le jour choisi. */
export function scenarioHtml(s: AnticipationScenario | null, signals: Readonly<Record<string, AnticipationSignal>>, opts: ScenarioViewOptions): string {
  if (!s) {
    return '<div class="anr-card"><h3>Aucun scénario ouvert</h3>'
      + '<p class="anr-hint">Aucun croisement entre domaines n\'est relevé pour ce jour. Les échéances publiées restent dans l\'agenda.</p>'
      + `${WARN}</div>`;
  }
  const opened = clock(s.openedAt) ?? 'n.d.';
  const revised = clock(s.revisedAt);
  const meta = `Scénario · ${scenarioPlace(s)} · ${windowText(s, opts.today)} · ouvert à ${opened}`
    + (revised !== null && s.revisedAt !== s.openedAt ? `, revu à ${revised}` : '');
  const chain = s.chain.map((link, i) => {
    const src = stepSource(link, signals);
    return `<div class="anr-step"><i>${i + 1}</i><div>${escapeHtml(link.text)}${src ? ` <span class="anr-src">${escapeHtml(src)}</span>` : ''}</div></div>`;
  }).join('');
  const bascules = s.bascules.length === 0 ? '<p class="anr-empty">n.d.</p>' : s.bascules.map((b) => {
    const hit = b.state === 'atteint';
    const at = hit ? clock(b.at) : null;
    const st = hit ? `Atteint${at ? ` ${at}` : ''}` : 'surveillé';
    return `<div class="anr-trig${hit ? ' is-hit' : ''}"><span>${escapeHtml(b.label)}</span><span class="anr-st">${st}</span></div>`;
  }).join('');
  return '<div class="anr-card">'
    + `<p class="anr-meta">${escapeHtml(meta)}</p>`
    + `<h3>${escapeHtml(s.title)}</h3>`
    + scaleHtml(s)
    + sec('Pourquoi : le croisement', `<div class="anr-chain">${chain}</div>`)
    + sec('Inconnu', list(s.unknowns, 'anr-unk'))
    + sec('Indicateurs de bascule', bascules)
    + sec('Ce qui l\'infirmerait', list(s.disconfirmers))
    + sec('À vérifier avant d\'agir', list(s.verify) + '<div class="anr-actions"><button type="button" data-fly>Voir sur la carte</button></div>')
    + sec('Ce scénario vous a-t-il servi ?', feedbackHtml(opts.feedback))
    + WARN
    + '</div>';
}
