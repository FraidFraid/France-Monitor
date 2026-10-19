// src/components/layer-panel/flux-pietons.ts : vue pure du panneau Flux piétons (prévisions publiées par flux_osint). Onglets de
// phase (arrivée, dispersion), choix de l'événement, affluence estimée, rues les plus chargées, lecture de la carte, méthode et
// limites. Avertissement ESTIMATIONS MODÉLISÉES en tête, toujours. Aucune donnée individuelle ; aucun effet sur l'indice.
import type { FluxEvent, FluxIndex, FluxPhase } from '../../types/index.ts';
import { BAND_WORD, FLUX_WARNING, bandHex, saturationBand, type FluxBand } from '../../services/flux-pietons.ts';
import { momentWord, onSiteAt, relativeLabel } from '../../services/flux-timeline.ts';
import { frDateTime } from '../../services/webcams.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { emptyLine, listRow, loadingBody, type LayerView } from './frame.ts';
import { NBSP, frNumber } from './format.ts';
import { note } from './traffic-format.ts';

export const FLUX_THEME = 'Manifestations';
export const FLUX_TITLE = 'Foule estimée';
export const FLUX_PHASES: readonly { id: FluxPhase; label: string }[] = [
  { id: 'arrivee', label: 'Arrivée' },
  { id: 'depart', label: 'Dispersion' },
];
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

export interface FluxViewInput {
  index: FluxIndex | null;
  error: string | null;
  selectedId: string | null;
  phase: FluxPhase;
  /** Lecture du GeoJSON de l'événement choisi. */
  geo: 'idle' | 'loading' | 'ready' | 'error';
  open: OpenFn;
  nowMs: number;
  /** Bornes du curseur (minutes par rapport au début annoncé) ; null : pas de rejeu (publication ancienne, carte non lue). */
  replay?: { min: number; max: number } | null;
  /** Instant affiché sur la carte ; null : totaux de la phase choisie. */
  instant?: number | null;
}

const people = (n: number): string => `${frNumber(Math.round(n), 0)}${NBSP}personne${Math.round(n) > 1 ? 's' : ''}`;

/** Date de l'événement : « 17/10/2026 à 12:52 » (heure de Paris), « date n.d. » sinon. */
function when(e: FluxEvent): string {
  return (e.debut ? frDateTime(e.debut) : null) ?? 'date n.d.';
}

/** Mot sur la place de l'événement dans le temps : à venir, en cours (3 h), passé. */
export function eventTiming(e: FluxEvent, nowMs: number): 'à venir' | 'en cours' | 'passé' | 'date inconnue' {
  const t = e.debut ? Date.parse(e.debut) : Number.NaN;
  if (!Number.isFinite(t)) return 'date inconnue';
  if (t > nowMs) return 'à venir';
  return nowMs - t < 3 * 3_600_000 ? 'en cours' : 'passé';
}

function eventsSection(index: FluxIndex, selected: FluxEvent | null, nowMs: number, open: OpenFn): FicheSection {
  const rows = index.evenements.map((e) => listRow({
    text: `${e.ville} · ${when(e)}`,
    value: eventTiming(e, nowMs),
    note: `${e.lieuSuppose ? 'Lieu supposé : ' : ''}${e.lieu}`,
    color: e.id === selected?.id ? 'var(--text-accent)' : null,
    data: { 'flux-event': e.id }, link: true,
  })).join('');
  return {
    id: 'evenements', title: 'Événements', collapsible: true, open: open('evenements', selected === null || index.evenements.length > 1),
    summary: escapeHtml(`${frNumber(index.evenements.length, 0)} prévision${index.evenements.length > 1 ? 's' : ''}`),
    html: rows + note('Clic : la carte passe à cet événement. Seuls les rassemblements réels (couche Manifestations, saisie manuelle) sont calculés, avant qu’ils aient lieu.'),
  };
}

/** Fourchette affichée en tête : probable (1 chance sur 2) si publiée, sinon la large (8 sur 10). */
export function fluxRange(a: FluxEvent['affluence']): { low: number; high: number; words: string } {
  return a.p25 !== null && a.p75 !== null
    ? { low: a.p25, high: a.p75, words: '1 chance sur 2' }
    : { low: a.p10, high: a.p90, words: '8 chances sur 10' };
}

function selectedSection(e: FluxEvent, geo: FluxViewInput['geo'], open: OpenFn): FicheSection {
  const a = e.affluence;
  const r = fluxRange(a);
  const lieu = e.lieuSuppose
    ? `${e.lieu} (${e.lieu.startsWith('Centre de') ? 'lieu non précisé par l’annonce' : 'lieu habituel supposé : la source n’en donne pas'})`
    : e.lieu;
  const html = kvRow('Lieu', escapeHtml(lieu))
    + kvRow('Date', escapeHtml(when(e)))
    + kvRow('Affluence estimée', escapeHtml(`${people(a.p50)} (médiane)`))
    + kvRow('Fourchette probable', escapeHtml(`${frNumber(r.low, 0)} à ${frNumber(r.high, 0)} (${r.words})`))
    + (r.words === '1 chance sur 2' ? kvRow('Fourchette large', escapeHtml(`${frNumber(a.p10, 0)} à ${frNumber(a.p90, 0)} (8 chances sur 10)`)) : '')
    + (a.plafond !== null ? kvRow('Plafond du lieu', escapeHtml(`${people(a.plafond)} debout à moins de 300${NBSP}m${
      a.partPlafonnee !== null && a.partPlafonnee > 0 ? ` · atteint dans ${Math.round(a.partPlafonnee * 100)}${NBSP}% des tirages` : ''}`)) : '')
    + kvRow('Base', escapeHtml(a.base))
    + kvRow('Météo', escapeHtml(e.meteo?.replace(/_/g, ' ') ?? 'n.d.'))
    + kvRow('Cortège', escapeHtml(e.cortege ? 'parcours simulé' : 'rassemblement sans parcours connu'))
    + kvRow('Recalage', escapeHtml(e.recale ? 'recalé sur des comptages' : 'aucun comptage'))
    + kvRow('Calculé le', escapeHtml(frDateTime(e.calculeLe) ?? 'n.d.'))
    + (geo === 'loading' ? note('Carte en cours de lecture…') : '')
    + (geo === 'error' ? '<p class="fmk-callout lp-callout">Carte de cet événement illisible pour le moment.</p>' : '');
  return { id: 'evenement', title: 'Événement choisi', collapsible: true, open: open('evenement', true), summary: escapeHtml(e.ville), html };
}

function streetsSection(e: FluxEvent, phase: FluxPhase, open: OpenFn): FicheSection {
  const top = e.resume.topRues;
  const rows = top.map((r) => {
    const band = saturationBand(r.pSaturation);
    return listRow({
      text: r.rue, value: people(r.chargeP90), color: bandHex(band),
      note: `densité ${r.densiteP90.toFixed(2).replace('.', ',')}${NBSP}pers/m² · saturation ${Math.round(r.pSaturation * 100)}${NBSP}%`,
    });
  }).join('');
  return {
    id: 'rues', title: 'Rues les plus chargées', collapsible: true, open: open('rues', true),
    summary: escapeHtml(`${frNumber(e.resume.satures, 0)} saturée${e.resume.satures > 1 ? 's' : ''} probable${e.resume.satures > 1 ? 's' : ''}`),
    html: (top.length === 0 ? emptyLine('Aucune rue chargée.') : rows)
      + note(`Valeurs hautes (9 tirages sur 10 en dessous), à l’arrivée.${phase === 'depart' ? ' La carte montre la dispersion : survoler une rue pour ses valeurs.' : ''}`)
      + (e.resume.goulots > 0 ? note(`${frNumber(e.resume.goulots, 0)} goulot${e.resume.goulots > 1 ? 's' : ''} probable${e.resume.goulots > 1 ? 's' : ''} sur le parcours du cortège.`) : ''),
  };
}

/** Heure de Paris d'un instant du rejeu, « 18:42 », ou null si la date de l'événement est inconnue. */
function clockAt(e: FluxEvent, atMin: number): string | null {
  const t = e.debut ? Date.parse(e.debut) : Number.NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t + atMin * 60_000).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
}

/** Ligne du curseur : « début − 12 min · 18:48 · arrivées · ≈ 340 personnes sur place » (médiane de l'affluence). */
export function replayLabel(e: FluxEvent, atMin: number | null): string {
  if (atMin === null || !e.temps) return 'Faire glisser le curseur, ou lancer la lecture, pour rejouer l’arrivée puis la dispersion.';
  const clock = clockAt(e, atMin);
  const here = Math.round(onSiteAt(e.affluence.p50, e.temps, atMin));
  return [relativeLabel(atMin), clock, momentWord(e.temps, atMin), `≈${NBSP}${frNumber(here, 0)}${NBSP}personne${here > 1 ? 's' : ''} sur place`]
    .filter((x): x is string => x !== null).join(' · ');
}

function replaySection(e: FluxEvent, replay: { min: number; max: number }, instant: number | null, open: OpenFn): FicheSection {
  const t = e.temps;
  const value = instant ?? replay.min;
  const html = `<div class="flux-replay">`
    + `<div class="flux-replay-head"><button type="button" class="flux-play" data-flux-play aria-label="Lire le rejeu">▶</button>`
    + `<span class="flux-replay-label" data-flux-time-label aria-live="polite">${escapeHtml(replayLabel(e, instant))}</span></div>`
    + `<input type="range" class="flux-replay-range" data-flux-time min="${replay.min}" max="${replay.max}" step="1" value="${value}" aria-label="Instant du rejeu">`
    + `<div class="flux-replay-scale"><span>${escapeHtml(relativeLabel(replay.min))}</span><span>${escapeHtml(relativeLabel(replay.max))}</span></div></div>`
    + (t ? note(`Hypothèses : arrivées étalées sur ${frNumber(t.arriveeMin, 0)}${NBSP}min avant le début, rassemblement de ${frNumber(t.dureeMin, 0)}${NBSP}min, dispersion sur ${frNumber(t.departMin, 0)}${NBSP}min, marche à ${String(t.vitesse).replace('.', ',')}${NBSP}m/s. Une rue s’allume quand les marcheurs y passent, plus tôt quand elle est loin du point.`) : '')
    + note('Couleur : débit de la rue à cet instant rapporté à sa capacité (environ 73 personnes par minute et par mètre) ; valeurs hautes. Cliquer un onglet revient aux totaux de la phase.');
  return { id: 'rejeu', title: 'Rejouer l’arrivée et la dispersion', collapsible: true, open: open('rejeu', true), html };
}

function readingSection(open: OpenFn): FicheSection {
  const bands: FluxBand[] = ['fluide', 'jaune', 'orange', 'rouge'];
  const html = bands.map((b) => listRow({ text: BAND_WORD[b], color: bandHex(b) })).join('')
    + note('Épaisseur : nombre de personnes passées dans la rue pendant la phase. Couleur : part des 500\u00a0tirages où le débit dépasse la capacité de la rue (diagramme de Weidmann, environ 73\u00a0personnes par minute et par mètre de largeur).')
    + note('Tirets : 5, 10 et 20\u00a0minutes de marche depuis le point de rassemblement (point blanc).');
  return { id: 'lecture', title: 'Lire la carte', collapsible: true, open: open('lecture', false), html };
}

function methodSection(index: FluxIndex, open: OpenFn): FicheSection {
  const html = (index.methode ? note(index.methode) : '')
    + note('Calcul : flux_osint (programme séparé), données ouvertes seulement : réseau piéton OpenStreetMap, carroyage INSEE, équipements BPE, arrêts de transport, météo Open-Meteo.')
    + note('Aucune donnée individuelle, aucun suivi de personne, aucun réseau social ; aucun organisateur ni participant identifié.')
    + note('Limites : l’affluence vient d’un modèle appris sur les chiffres de presse, bruités. La fourchette probable (1 chance sur 2) est affichée en tête, la large (8 sur 10) en détail ; toutes deux sont vérifiées sur les chiffres passés. Plafond : le lieu et les rues à moins de 300\u00a0m ne contiennent pas plus de monde debout (1,5\u00a0personne par m²). Le lieu est supposé (place habituelle, ou centre de la commune) quand l’annonce ne le donne pas.')
    + note('Rassemblements calculés : ceux annoncés dans les 7 prochains jours en métropole (Démosphère, saisie manuelle), et ceux de la ville suivie ; un rassemblement passé depuis plus de 24\u00a0h n’est plus affiché.')
    + note('Recalcul toutes les 15\u00a0minutes. Cette couche n’a aucun effet sur l’indice de stabilité, les situations ni la synthèse.')
    + kvRow('Publication', escapeHtml(frDateTime(index.generatedAt) ?? 'n.d.'));
  return { id: 'methode', title: 'Méthode et limites', collapsible: true, open: open('methode', false), tone: 'reference', html };
}

const WARNING_HTML = (text: string): string => `<p class="fmk-callout lp-callout flux-warning">${escapeHtml(text)}</p>`;

export function selectedFluxEvent(index: FluxIndex | null, selectedId: string | null): FluxEvent | null {
  if (!index || index.evenements.length === 0) return null;
  return index.evenements.find((e) => e.id === selectedId) ?? null;
}

export function buildFluxView(input: FluxViewInput): LayerView {
  const { index, error, phase, open } = input;
  const tabs = FLUX_PHASES.map((p) => ({ id: p.id, label: p.label }));
  if (index === null && error === null) {
    return { head: { theme: FLUX_THEME, title: FLUX_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  if (index === null) {
    return {
      head: { theme: FLUX_THEME, title: FLUX_TITLE, level: null, figure: { value: 'n.d.', caption: 'prévisions', level: null }, status: ['publication illisible'] },
      sections: [], bodyHtml: WARNING_HTML(FLUX_WARNING) + '<p class="fmk-callout lp-callout">Prévisions illisibles pour le moment. Nouvel essai dans 15\u00a0minutes.</p>',
    };
  }
  const e = selectedFluxEvent(index, input.selectedId);
  if (!e && index.evenements.length > 0) {
    // Aucune ville par défaut : la carte montre tous les rassemblements prévus, un clic (carte ou liste) en ouvre un.
    const n = index.evenements.length;
    return {
      head: { theme: FLUX_THEME, title: FLUX_TITLE, level: null, figure: { value: String(n), caption: `prévision${n > 1 ? 's' : ''} publiée${n > 1 ? 's' : ''}`, level: null }, status: ['ESTIMATIONS MODÉLISÉES'] },
      sections: [eventsSection(index, null, input.nowMs, open), readingSection(open), methodSection(index, open)],
      bodyHtml: WARNING_HTML(index.avertissement)
        + emptyLine('Clique sur un rassemblement, sur la carte ou dans la liste, pour voir ses rues et le rejeu.'),
    };
  }
  if (!e) {
    return {
      head: { theme: FLUX_THEME, title: FLUX_TITLE, level: null, figure: { value: '0', caption: 'prévision publiée', level: null }, status: ['ESTIMATIONS MODÉLISÉES'] },
      sections: [methodSection(index, open)],
      bodyHtml: WARNING_HTML(index.avertissement)
        + emptyLine('Aucun rassemblement annoncé à venir. Une prévision apparaît dès qu’un rassemblement est annoncé dans les 7 prochains jours.'),
    };
  }
  return {
    head: {
      theme: FLUX_THEME, title: FLUX_TITLE, level: null,
      figure: { value: `≈${NBSP}${frNumber(e.affluence.p50, 0)}`, caption: `personnes estimées · ${e.ville}, ${when(e)}`, level: null },
      status: ['ESTIMATIONS MODÉLISÉES', eventTiming(e, input.nowMs)],
    },
    // Pendant le rejeu, aucun onglet surligné : la carte montre un instant, pas les totaux d'une phase (clic = retour aux totaux).
    tabs, activeTab: input.instant != null ? '' : phase,
    sections: [selectedSection(e, input.geo, open),
      ...(input.replay && e.temps ? [replaySection(e, input.replay, input.instant ?? null, open)] : []),
      streetsSection(e, phase, open), eventsSection(index, e, input.nowMs, open), readingSection(open), methodSection(index, open)],
    bodyHtml: WARNING_HTML(index.avertissement)
      + (error !== null ? '<p class="fmk-callout lp-callout">Relecture impossible : dernières prévisions conservées.</p>' : ''),
  };
}
