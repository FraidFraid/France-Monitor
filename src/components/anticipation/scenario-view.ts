// src/components/anticipation/scenario-view.ts : vue pure de la fiche d'une hypothèse (onglet Anticipation, 04/11/2026, maquette écran 1 ;
// lecture simplifiée le 13/11/2026 : l'essentiel d'abord, le reste en sections repliables).
// Échelle des sept mots (le mot actif à la couleur de son jeton --sev-*), chaîne de preuves avec source et heure de Paris, inconnues,
// bascules, ce qui l'infirmerait, vérifications, retours. Aucun accès réseau ni DOM ; tout texte venu du serveur est échappé.
import { arretesPageOf } from '../../services/prefecture-arretes-pages.ts';
import type { AnticipationChainLink, AnticipationDoc, AnticipationScenario, AnticipationSignal } from '../../types/index.ts';
import { ALL_WORDS, isKnownWord, SCALE_COLOR_VAR, WORD_LABEL, WORD_RANGE, wordLabel } from '../../services/anticipation-words.ts';
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
  // Chaque mot porte sa couleur (barre au-dessus du libellé) ; le mot attribué est mis en avant, les autres restent atténués.
  const cells = ALL_WORDS.map((w) =>
    `<span${w === s.word ? ' class="is-on"' : ''} style="--c: var(${SCALE_COLOR_VAR[w]})">${escapeHtml(WORD_LABEL[w])}</span>`).join('');
  // Mot inconnu de ce client (serveur plus récent) : mot brut échappé, couleur neutre, sans fourchette.
  const word: string = s.word;
  const known = isKnownWord(word);
  const label = wordLabel(word);
  const note = word === ''
    ? '<p class="anr-scalenote">Crise relevée sans hypothèse émise avant : aucun niveau attribué.</p>'
    : `<p class="anr-scalenote"><b style="color: var(${known ? SCALE_COLOR_VAR[word] : '--text-muted'})">${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</b>`
      + `${known ? ` (${WORD_RANGE[word]})` : ''}${s.why ? ` : ${escapeHtml(plainWhy(s.why))}` : ''}. Niveau fixé par une règle écrite${ruleText(s.ruleId)}, pas par l'IA.</p>`;
  return `<div class="anr-scale" role="img" aria-label="Échelle de probabilité, du moins au plus probable">${cells}</div>${note}`;
}

/** Nom court des règles de croisement (api/_lib/anticipation/rules/*.js) ; règle inconnue : non nommée. */
export const RULE_LABEL: Readonly<Record<string, string>> = {
  'mobilisation-transports': 'mobilisation × transports',
  'evenement-mobilisation': 'événement × mobilisation × transports',
  'social-cyber': 'crise sociale × cyber',
  'tempete-reseaux': 'tempête × électricité × télécoms',
  'chaleur-sante': 'chaleur × électricité × santé',
  'greve-carburant': 'grève × carburant',
  'lycees-mobilisation': 'incidents dans les lycées × mobilisation',
  'alertes-serie': 'série de fausses alertes',
  'crue-inondation': 'vigilance crues × pluie-inondation × réseaux',
  'froid-electricite': 'grand froid × électricité',
  'neige-transports': 'neige-verglas × transports',
};
const ruleText = (ruleId: string): string => {
  const label = RULE_LABEL[ruleId];
  return label ? ` (\u00ab\u00a0${escapeHtml(label)}\u00a0\u00bb)` : '';
};

/** Raison du niveau en mots courants (le serveur écrit « bascule atteinte »). */
export const plainWhy = (why: string): string => why.replace(/bascule atteinte/g, 'un signe constaté');

const list = (items: readonly string[], cls = ''): string =>
  items.length === 0 ? '<p class="anr-empty">n.d.</p>'
    : `<ul>${items.map((t) => `<li${cls ? ` class="${cls}"` : ''}>${escapeHtml(t)}</li>`).join('')}</ul>`;
const sec = (title: string, body: string): string => `<section class="anr-sec"><h4>${escapeHtml(title)}</h4>${body}</section>`;
/** Section repliable (clé `data-k` : la salle garde l'état ouvert ou fermé d'une relève à l'autre) ; le compte s'affiche à côté du titre. */
const fold = (key: string, title: string, body: string, n: number | null, open = false): string =>
  `<details class="anr-sec anr-fold" data-k="${key}"${open ? ' open' : ''}><summary><h4>${escapeHtml(title)}</h4>`
  + `${n === null ? '' : `<span class="anr-count">${n}</span>`}</summary>${body}</details>`;

const NB = '\u202f';
const count = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NB);

const FLOOD_KIND: Readonly<Record<string, string>> = { urgences: 'Urgences', seveso_haut: 'Seveso seuil haut', seveso_bas: 'Seveso seuil bas', ehpad: 'EHPAD' };

/** Établissements en zone de crue cartographiée (règle crue) : nommés, avec la commune, le cours d'eau et le scénario de crue. */
export function floodHtml(s: AnticipationScenario): string {
  const f = s.exposure?.flood;
  if (!f || f.sites.length === 0) return '';
  const items = f.sites.map((x) => {
    const kind = FLOOD_KIND[x.kind] ?? x.kind;
    const where = [x.commune, x.river ? `crue ${x.river}` : null, x.scenario === 'moyen' ? 'crue moyenne' : 'crue extrême seulement'].filter((v): v is string => Boolean(v)).join(' · ');
    return `<li><b>${escapeHtml(kind)}</b> ${escapeHtml(x.name)}${x.places ? ` (${count(x.places)}\u00a0places)` : ''}<small class="anr-scalenote"> ${escapeHtml(where)}</small></li>`;
  }).join('');
  const more = f.total > f.sites.length ? `${f.sites.length} sur ${f.total} affichés. ` : '';
  return sec('Établissements en zone de crue cartographiée', `<ul>${items}</ul><p class="anr-scalenote">${more}${escapeHtml(f.source)}. Seuls les territoires à risque important sont cartographiés : un établissement absent de cette liste n’est pas pour autant hors d’eau.</p>`);
}

/** Phrase de l'hypothèse (maillon « Hypothèse : … » de la chaîne) sans son préfixe, et les faits qui la fondent. */
export function splitChain(s: AnticipationScenario): { guess: string | null; facts: AnticipationChainLink[] } {
  const isGuess = (l: AnticipationChainLink): boolean => /^hypoth[eè]se\s*:/i.test(l.text.trim());
  const link = s.chain.find(isGuess);
  const text = link ? link.text.trim().replace(/^hypoth[eè]se\s*:\s*/i, '') : '';
  return { guess: text ? text.charAt(0).toUpperCase() + text.slice(1) : null, facts: s.chain.filter((l) => !isGuess(l)) };
}

/** Enjeux exposés dans la zone (comptes par département, sources datées) ; rien pour un scénario national. */
export function exposureHtml(s: AnticipationScenario): string {
  const e = s.exposure;
  if (!e) return '';
  const lines = [
    `${count(e.urgences)} service${e.urgences > 1 ? 's' : ''} d'urgences, ${count(e.passages)}\u00a0passages par an${e.mainHospitals.length ? ` (dont ${e.mainHospitals.join(', ')})` : ''}`,
    `${count(e.ehpad)} EHPAD, ${count(e.ehpadPlaces)}\u00a0places`,
    `${count(e.sevesoHaut)} site${e.sevesoHaut > 1 ? 's' : ''} Seveso seuil haut, ${count(e.sevesoBas)} seuil bas`,
  ];
  return floodHtml(s) + fold('enjeux', 'Ce qui est exposé dans le département', `${list(lines)}<p class="anr-scalenote">${escapeHtml(e.sources.join(' · '))}. Comptes du département entier, pas de la seule zone touchée.</p>`, null);
}

function feedbackHtml(state: FeedbackState): string {
  const done = state === 'ok' || state === 'deja';
  const disabled = done || state === 'sending' ? ' disabled' : '';
  const buttons = ([['utile', 'Utile'], ['deja_su', 'Déjà su'], ['faux', 'Faux']] as const)
    .map(([vote, label]) => `<button type="button" data-vote="${vote}"${disabled}>${label}</button>`).join('');
  const msg = state === 'ok' ? 'Merci' : state === 'deja' ? 'Déjà noté' : state === 'erreur' ? 'Envoi impossible, réessayez plus tard' : '';
  // Zone annoncée toujours présente (vide avant le vote) : un lecteur d'écran entend « Merci » ou « Déjà noté ».
  return `<div class="anr-fb">${buttons}</div><p class="anr-fb-state" role="status" aria-live="polite">${msg}</p>`;
}

/** Adresse d'un document affichable : https sur un site en .gouv.fr seulement (même garde que le serveur), sinon null. */
export function safeDocUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'gouv.fr' || u.hostname.endsWith('.gouv.fr')) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Aperçu du document officiel d'une bascule atteinte (numéro, préfecture, date, horaires, extrait) et lien d'ouverture en un clic. */
export function docHtml(doc: AnticipationDoc | undefined): string {
  const url = safeDocUrl(doc?.url);
  if (!doc || !url) return '';
  const published = doc.publishedOn && /^\d{4}-\d{2}-\d{2}$/.test(doc.publishedOn)
    ? `publié le ${doc.publishedOn.slice(8, 10)}/${doc.publishedOn.slice(5, 7)}/${doc.publishedOn.slice(0, 4)}` : null;
  const hours = doc.hours && doc.hours.length === 2 ? `de ${doc.hours[0]} à ${doc.hours[1]}` : null;
  const head = [doc.act ? `n\u00b0\u00a0${doc.act}` : null, doc.issuer, published, hours].filter((x): x is string => Boolean(x)).join(' · ');
  return '<div class="anr-doc">'
    + `<p class="anr-doc-head">${escapeHtml(doc.title ?? 'Arrêté préfectoral')}</p>`
    + (head ? `<p class="anr-doc-meta">${escapeHtml(head)}</p>` : '')
    + (doc.excerpt ? `<blockquote>${escapeHtml(doc.excerpt)}</blockquote>` : '')
    + `<a class="anr-doc-open" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Voir l'arrêté (PDF officiel)</a>`
    + '</div>';
}

/** Lien vers la page officielle où paraîtra l'arrêté (bascule surveillée, ou atteinte sans document) ; rien si la préfecture n'est pas connue. */
export function arretesLinkHtml(depts: readonly string[]): string {
  const page = arretesPageOf(depts);
  const url = safeDocUrl(page?.url);
  if (!page || !url) return '';
  return '<div class="anr-doc-where"><span>Pas encore d\'arrêté relevé</span>'
    + `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(page.label)}<span aria-hidden="true"> ↗</span></a></div>`;
}

/** Fiche complète ; null : aucune hypothèse pour le jour choisi. L'essentiel d'abord (quoi, où, quand, niveau, pourquoi, quoi vérifier), le reste replié. */
export function scenarioHtml(s: AnticipationScenario | null, signals: Readonly<Record<string, AnticipationSignal>>, opts: ScenarioViewOptions): string {
  if (!s) {
    return '<div class="anr-card"><h3>Aucune hypothèse pour ce jour</h3>'
      + '<p class="anr-hint">Aucun rapprochement de signaux n\'est relevé pour ce jour. Les échéances publiées restent dans la liste.</p>'
      + `${WARN}</div>`;
  }
  const opened = clock(s.openedAt) ?? 'n.d.';
  const revised = clock(s.revisedAt);
  const meta = `${scenarioPlace(s)} · ${windowText(s, opts.today)} · repérée à ${opened}`
    + (revised !== null && s.revisedAt !== s.openedAt ? `, mise à jour à ${revised}` : '');
  const { guess, facts } = splitChain(s);
  const chain = facts.map((link, i) => {
    const src = stepSource(link, signals);
    return `<div class="anr-step"><i>${i + 1}</i><div>${escapeHtml(link.text)}${src ? ` <span class="anr-src">${escapeHtml(src)}</span>` : ''}</div></div>`;
  }).join('');
  const hits = s.bascules.filter((b) => b.state === 'atteint').length;
  const bascules = s.bascules.length === 0 ? '<p class="anr-empty">n.d.</p>' : s.bascules.map((b) => {
    const hit = b.state === 'atteint';
    const at = hit ? clock(b.at) : null;
    const st = hit ? `Constaté${at ? ` à ${at}` : ''}` : 'pas encore';
    const doc = hit ? docHtml(b.doc) : '';
    const foot = doc || (b.id === 'arrete' ? arretesLinkHtml(s.zone.dept) : '');
    return `<div class="anr-bas${hit ? ' is-hit' : ''}"><div class="anr-trig${hit ? ' is-hit' : ''}"><i class="anr-dot" aria-hidden="true"></i>`
      + `<span class="anr-lbl">${escapeHtml(b.label)}</span><span class="anr-st">${st}</span></div>${foot}</div>`;
  }).join('');
  return '<div class="anr-card">'
    + `<p class="anr-meta">${escapeHtml(meta)}</p>`
    + `<h3>${escapeHtml(s.title)}</h3>`
    + (guess ? `<p class="anr-lead"><span>Ce qui pourrait arriver</span>${escapeHtml(guess)}</p>` : '')
    + scaleHtml(s)
    + sec('Pourquoi on le pense', chain ? `<div class="anr-chain">${chain}</div>` : '<p class="anr-empty">n.d.</p>')
    + sec('À vérifier avant d\'agir', list(s.verify) + '<div class="anr-actions"><button type="button" data-fly>Voir sur la carte</button></div>')
    + fold('signes', 'Signes qui renforcent l\'hypothèse', '<p class="anr-scalenote">Faits surveillés : s\'ils se produisent, l\'hypothèse se renforce.</p>' + bascules, hits > 0 ? hits : null, hits > 0)
    + fold('inconnu', 'Ce qu\'on ne sait pas', list(s.unknowns, 'anr-unk'), s.unknowns.length)
    + fold('contre', 'Ce qui écarterait l\'hypothèse', list(s.disconfirmers), s.disconfirmers.length)
    + exposureHtml(s)
    + sec('Cette fiche vous a-t-elle servi ?', feedbackHtml(opts.feedback))
    + WARN
    + '</div>';
}
