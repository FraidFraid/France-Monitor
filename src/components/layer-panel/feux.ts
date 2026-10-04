// src/components/layer-panel/feux.ts : vue pure du panneau Feux de forêt (spec 2026-10-04 environnement § 2.4 ; contrats § 4.1),
// aucun accès réseau ni DOM. Onglet Veille : météo des forêts (danger officiel par département, E1), détections satellite en France
// regroupées en foyers par le serveur (satellite, confiance, FRP, âge : E3 ; sources récurrentes à part, jamais un feu), hauteur
// du panache par foyer (profil radar de démonstration, sommets d'écho, note sur la pyroconvection : module gardé en entier), jour
// aéronautique, méthode. Onglet Dossier d'un feu : grands incidents (porte de 40 détections et 300 MW) et dossier OSINT
// (feux-dossier.ts). Chaque partie porte sa date (S1), « (en retard) » retire les couleurs (S2), une panne est nommée (S3).
import type {
  FireFoyer, FireObservationFeedState, FiresResponse, FirmsSourceId, ForestDanger, ForestDangerLevel, LocatedFireIncident, RadarColumnResult,
} from '../../types/index.ts';
import { departementAeronauticalDay, aeronauticalLine } from '../../services/aeronautical-day.ts';
import {
  firesLevel, firmsState, forestDangerCurrent, foyerLevel, isEnvironmentDataLate, maxForestDanger,
} from '../../services/environment-levels.ts';
import { FIRMS_PENDING_NOTE, FIRMS_TOO_OLD_ERROR, MDF_ERROR_PREFIX, isProgressNote } from '../../services/environment-source.ts';
import { situationLevel } from '../../services/vigilance.ts';
import { wildfireSeverity } from '../../services/wildfire-dossier.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { radarProfileErrorHtml, radarProfileHtml, radarProfileLoadingHtml } from '../radar-profile-view.ts';
import { stackedDayBars, type DayStack } from './chart.ts';
import { departementName } from './health-format.ts';
import { NBSP, frNumber } from './format.ts';
import {
  barRow, emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerHeadModel, type LayerTab, type LayerView,
} from './frame.ts';
import {
  ENVIRONMENT_THEME, FOREST_DANGER_LEVEL, FOREST_DANGER_WORD, SATELLITE_WORD, dataMs, formatAge, formatFrp, glueEnvUnits, note, parisDayWord,
  plural, readErrors, sourceDown, stamp,
} from './environment-format.ts';
import { dossierSections, incidentPlace, SEVERITY_WORD, type FeuxDossierInput, type OpenFn } from './feux-dossier.ts';

export { dossierSections, renderDeclaredBlock, renderFactRow, type FeuxDossierInput } from './feux-dossier.ts';

export const FEUX_TITLE = 'Feux de forêt';
export type FeuxTab = 'veille' | 'dossier';
export const FEUX_TABS: readonly FeuxTab[] = ['veille', 'dossier'];
const TAB_LABEL: Readonly<Record<FeuxTab, string>> = { veille: 'Veille', dossier: 'Dossier d’un feu' };

export interface FeuxViewInput {
  fires: FiresResponse | null;
  firesError: string | null;
  /** MTG-FRP (démonstration) : état dérivé de la lecture, jamais « ACTIF » codé. */
  mtgFrp: FireObservationFeedState | null;
  options: { gibs: boolean; mtgFrp: boolean; echoTops: boolean; echoTopsAvailable: boolean; forestDangerFill: boolean };
  /** Profil « Hauteur du panache » demandé, par identifiant de foyer. */
  plume: ReadonlyMap<string, RadarColumnResult | 'loading' | 'error'>;
  tab: FeuxTab;
  /** Incidents DBSCAN (détections en France non récurrentes) qui franchissent MAJOR_FIRE_GATE (40 détections, 300 MW). */
  majorIncidents: LocatedFireIncident[];
  /** Incident ouvert dans l'onglet « Dossier d'un feu ». */
  dossier: FeuxDossierInput | null;
  canFocus: boolean;
  now: number;
  open: OpenFn;
}

const MAX_FOYERS = 12;
const DAILY_DAYS = 10;
const FIRMS_URL = 'https://firms.modaps.eosdis.nasa.gov/active_fire/';
const MDF_URL = 'https://meteofrance.com/meteo-des-forets';
const MTG_URL = 'https://lsa-saf.eumetsat.int/en/news/news/release-of-mtg-fire-radiative-power-product-as-demonstration/';
const CNRS_URL = 'https://www.cnrs.fr/fr/la-recherche/expertise-scientifique/esco-incendies-de-foret-et-ville';
/** Détections non récurrentes de la courbe : au moins jaune dans la pastille et sur la carte (une détection isolée est jaune). */
const DETECTION_FILL = 'var(--sev-yellow)';
const RECURRENT_FILL = 'var(--cat-feu-recurrent)';
const LEVELS_DESC: readonly ForestDangerLevel[] = [4, 3, 2, 1];
/** Produits FIRMS lus par le serveur, en clair. */
const FIRMS_PRODUCT: Readonly<Record<FirmsSourceId, string>> = {
  VIIRS_SNPP_NRT: 'Suomi NPP', VIIRS_NOAA20_NRT: 'NOAA-20', VIIRS_NOAA21_NRT: 'NOAA-21', MODIS_NRT: 'MODIS (Terra, Aqua)', VIIRS_SNPP_PUBLIC_24H: 'Suomi NPP (CSV public)',
};
/** Départements de métropole (01 à 95, 2A, 2B) : la règle française du jour aéronautique (30 min) n'y vaut qu'en métropole. */
const METROPOLE_DEPT = /^(?:0[1-9]|[1-8]\d|9[0-5]|2[AB])$/;
const PYROCONVECTION = `Pyroconvection : un panache très développé (sommets d’écho au-delà de 8${NBSP}km, réflectivité en altitude) peut signaler un feu `
  + 'intense et une propagation plus erratique. FranceMonitor ne produit pas ce diagnostic : le profil est une aide à la lecture.';

// ─── Lectures communes ───

/** Erreur de la météo des forêts (le serveur les nomme « Météo des forêts : … »). */
const isMdfError = (e: string): boolean => e.startsWith(MDF_ERROR_PREFIX);
/** Cycle FIRMS en cours (FIRMS_PENDING_NOTE, phrase du serveur) : une note d'avancement, jamais une panne. */
const isCollecting = (e: string): boolean => e === FIRMS_PENDING_NOTE;
/** Dernière collecte de plus de 2 jours, plus servie (FIRMS_TOO_OLD_ERROR, phrase du serveur) : panne prolongée. */
const isTooOld = (e: string): boolean => e === FIRMS_TOO_OLD_ERROR;

/** Pannes FIRMS du dernier essai (ni note d'avancement, ni erreur de la météo des forêts). */
function firmsFailures(f: FiresResponse): string[] {
  return f.errors.filter((e) => !isProgressNote(e) && !isMdfError(e));
}

/** Produits FIRMS non lus au dernier essai, en clair. */
function productsDown(f: FiresResponse): string[] {
  return f.sources.filter((x) => !x.ok).map((x) => FIRMS_PRODUCT[x.id]);
}

/** Aucun produit FIRMS lu au dernier essai : la collecte précédente est servie avec sa propre date. */
function previousServed(f: FiresResponse): boolean {
  return f.readAt !== null && f.sources.length > 0 && f.sources.every((x) => !x.ok);
}

/** Collecte servie mais lecture FIRMS incomplète au dernier essai (produit en panne, lignes écartées, collecte précédente servie). */
function firmsIncomplete(f: FiresResponse): boolean {
  return f.readAt !== null && (firmsFailures(f).length > 0 || f.sources.some((x) => !x.ok));
}

/** Mention courte de l'en-tête : « lecture FIRMS incomplète : NOAA-21 non lu » ; rien de lu : collecte précédente servie. */
function incompleteWords(f: FiresResponse, now: number): string {
  if (previousServed(f) && f.readAt !== null) return `dernier essai FIRMS en échec : collecte du ${dateAt(f.readAt, now)} servie`;
  const down = productsDown(f);
  return down.length > 0 ? `lecture FIRMS incomplète : ${down.join(', ')} non ${down.length > 1 ? 'lus' : 'lu'}` : 'lecture FIRMS incomplète';
}

/** Aucune collecte encore servie, première collecte en cours sans panne : dit comme tel, jamais « injoignable ». */
function firstCollecting(f: FiresResponse): boolean {
  return f.readAt === null && f.errors.some(isCollecting) && firmsFailures(f).length === 0;
}

function noteText(e: string): string {
  return isCollecting(e) ? `Note : ${e} (la nouvelle collecte sera servie à la prochaine lecture).` : `Note : ${e}.`;
}

/** Jour d'une barre des courbes (« 23/09 ») : date du jour, à midi UTC, sans fuseau. */
function dayTick(ms: number): string {
  return new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

/** Collecte servie qui ne compte plus (firmsState : en retard, ou lue il y a 2 jours ou plus) : foyers sans couleur, « (en retard) ». */
function firmsLate(f: FiresResponse, now: number): boolean {
  return f.readAt !== null && firmsState(f, now) !== 'ok';
}

function mdfLate(fd: ForestDanger, now: number): boolean {
  return isEnvironmentDataLate('mdf', fd.publishedAt, now);
}

/** « 03/10 à 16:50 » (heure de Paris de la publication). */
function dateAt(iso: string, now: number): string {
  const ms = dataMs(iso);
  return ms === null ? 'n.d.' : absoluteTime(ms, now, 'fr', { withDate: true }).replace(' ', ' à ');
}

function dangerCounts(fd: ForestDanger, key: 'j1' | 'j2'): Record<ForestDangerLevel, number> {
  const out: Record<ForestDangerLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const d of fd.departments) out[d[key]] += 1;
  return out;
}

function foyerKind(f: FireFoyer): string {
  if (f.recurrent) return 'source récurrente';
  return f.confirmed ? 'foyer confirmé' : 'détection isolée';
}

function deptLabel(code: string): string {
  return `${departementName(code)} (${code})`;
}

// ─── En-tête ───

function figureOf(f: FiresResponse, now: number): LayerHeadModel['figure'] {
  const fd = f.forestDanger;
  if (fd === null) return { value: 'n.d.', caption: 'départements par niveau de danger : météo des forêts indisponible', level: null };
  if (!forestDangerCurrent(fd, now)) {
    return { value: 'n.d.', caption: `météo des forêts hors saison, dernière publication le ${dateAt(fd.publishedAt, now)}`, level: null };
  }
  const max = maxForestDanger(fd);
  const counts = dangerCounts(fd, 'j1');
  const late = mdfLate(fd, now);
  return {
    value: frNumber(counts[max], 0),
    caption: `départements en danger ${FOREST_DANGER_WORD[max]} ${parisDayWord(fd.j1Date, now)} (météo des forêts) · ${frNumber(counts[3] + counts[4], 0)} élevé ou très élevé${late ? ' (en retard)' : ''}`,
    level: late ? null : FOREST_DANGER_LEVEL[max],
  };
}

function stamps(f: FiresResponse, now: number): string {
  const firms = f.readAt === null ? (firstCollecting(f) ? 'FIRMS : collecte en cours' : 'FIRMS injoignable')
    : stamp('FIRMS', f.lastAcquisitionAt, firmsLate(f, now), now);
  const fd = f.forestDanger;
  const mdf = fd === null ? 'météo des forêts injoignable'
    : !forestDangerCurrent(fd, now) ? 'météo des forêts hors saison'
      : stamp('météo des forêts', fd.publishedAt, mdfLate(fd, now), now);
  return `${firms} · ${mdf}`;
}

function lead(f: FiresResponse): string | null {
  if (f.readAt === null) return null;
  const active = f.foyers.filter((x) => !x.recurrent);
  const confirmed = active.filter((x) => x.confirmed);
  const isolated = active.filter((x) => !x.confirmed);
  const recurrent = f.foyers.filter((x) => x.recurrent);
  const parts: string[] = [];
  const top = [...confirmed].sort((a, b) => b.frpTotalMw - a.frpTotalMw)[0];
  if (top) parts.push(`${plural(confirmed.length, 'foyer confirmé', 'foyers confirmés')} en France, le plus puissant : ${deptLabel(top.dept)}, ${formatFrp(top.frpTotalMw)}.`);
  else if (isolated.length > 0) parts.push(`Aucun foyer confirmé en France ; ${plural(isolated.length, 'détection isolée', 'détections isolées')}.`);
  else parts.push('Aucune détection en France hors des sources récurrentes.');
  if (recurrent.length > 0) parts.push(`${plural(recurrent.length, 'source récurrente', 'sources récurrentes')} à vérifier, probablement industrielles (${recurrent.map((r) => departementName(r.dept)).join(', ')}).`);
  if (f.abroadCount > 0) parts.push(`${plural(f.abroadCount, 'détection', 'détections')} hors de France, non comptées.`);
  return parts.join(' ');
}

function headOf(input: FeuxViewInput, f: FiresResponse): LayerHeadModel {
  const { now } = input;
  // Pastille : firesLevel seule (FIRMS en retard ou en panne, la météo des forêts du jour colore seule, retard nommé ; spec § 2.4).
  const verdict = firesLevel(f, now);
  return {
    theme: ENVIRONMENT_THEME, title: FEUX_TITLE, figure: figureOf(f, now),
    level: verdict.level,
    // Lecture FIRMS incomplète : dite en tête, sans changer la couleur de la pastille.
    status: [glueEnvUnits(verdict.reason), stamps(f, now), ...(firmsIncomplete(f) ? [incompleteWords(f, now)] : [])],
    lead: firmsLate(f, now) ? null : lead(f),
  };
}

// ─── Météo des forêts ───

function dangerBars(fd: ForestDanger, key: 'j1' | 'j2', colored: boolean): string {
  const counts = dangerCounts(fd, key);
  return LEVELS_DESC.map((l) => {
    const pct = (counts[l] / Math.max(1, fd.departments.length)) * 100;
    const label = FOREST_DANGER_WORD[l].charAt(0).toUpperCase() + FOREST_DANGER_WORD[l].slice(1);
    return colored
      ? barRow({ label, pct, value: frNumber(counts[l], 0), level: FOREST_DANGER_LEVEL[l] })
      : listRow({ text: label, value: frNumber(counts[l], 0), level: 'gris' });
  }).join('');
}

function namedLevels(fd: ForestDanger, key: 'j1' | 'j2', dayWord: string): string {
  return LEVELS_DESC.filter((l) => l >= 2).map((l) => {
    const names = fd.departments.filter((d) => d[key] === l).map((d) => d.name).sort((a, b) => a.localeCompare(b, 'fr'));
    return names.length === 0 ? '' : note(`Danger ${FOREST_DANGER_WORD[l]} ${dayWord} : ${names.join(', ')}.`);
  }).join('');
}

function seasonChart(fd: ForestDanger, colored: boolean): string {
  if (!colored || fd.history.length === 0) return '';
  const days: DayStack[] = fd.history.map((h) => ({
    day: Date.parse(`${h.date}T12:00:00Z`),
    // Départements au niveau 2 ou plus (spec E5) : le niveau 1 « faible » n'est pas tracé.
    parts: [
      { value: h.n4, color: 'var(--sev-red)', label: 'très élevé' }, { value: h.n3, color: 'var(--sev-orange)', label: 'élevé' },
      { value: h.n2, color: 'var(--sev-yellow)', label: 'modéré' },
    ],
  }));
  const chart = stackedDayBars(days, {
    label: 'Départements par niveau de danger de la météo des forêts, par jour de la saison', value: (v) => frNumber(v, 0), tick: dayTick,
    emptyNote: 'aucun département en danger sur la période',
  });
  const first = fd.history[0];
  const last = fd.history[fd.history.length - 1];
  return chart + note(`Saison ${last.date.slice(0, 4)} : ${plural(fd.history.length, 'jour')} publiés, du ${dayTick(Date.parse(`${first.date}T12:00:00Z`))} au ${dayTick(Date.parse(`${last.date}T12:00:00Z`))} ; chaque barre est datée par le jour de validité J1 (une publication du 22/09 figure au 23/09) ; danger modéré ou plus, le niveau faible n’est pas tracé.`);
}

/** Lignes de la météo des forêts écartées par le serveur (illisibles, en double) alors que le fichier est servi : nommées (S3). */
function mdfReadNote(f: FiresResponse): string {
  const errors = f.errors.filter(isMdfError).map(glueEnvUnits);
  return errors.length > 0 ? note(`Lecture incomplète : ${errors.join(' ; ')}.`) : '';
}

function forestDangerSection(input: FeuxViewInput, f: FiresResponse | null): FicheSection {
  const { now, open, options } = input;
  const base = { id: 'meteo-forets', title: 'Météo des forêts', collapsible: true, open: open('meteo-forets', true) };
  const toggle = `<button type="button" class="lp-toggle" data-forest-fill aria-pressed="${options.forestDangerFill}">`
    + `${options.forestDangerFill ? 'Masquer le remplissage de la carte' : 'Colorer les départements sur la carte'}</button>`;
  const fd = f?.forestDanger ?? null;
  if (f === null || fd === null) return { ...base, summary: 'n.d.', html: sourceDown('météo des forêts') };
  if (!forestDangerCurrent(fd, now)) {
    return {
      ...base, summary: 'hors saison',
      html: emptyLine(`Hors saison, dernière publication le ${dateAt(fd.publishedAt, now)} : niveaux échus, sans couleur.`)
        + dangerBars(fd, 'j1', false) + note('La météo des forêts est publiée de juin à l’automne ; hors saison, ses derniers niveaux ne colorent ni la pastille ni la carte.')
        + mdfReadNote(f),
    };
  }
  const late = mdfLate(fd, now);
  const day1 = parisDayWord(fd.j1Date, now);
  const day2 = parisDayWord(fd.j2Date, now);
  const max = maxForestDanger(fd);
  const counts = dangerCounts(fd, 'j1');
  return {
    ...base,
    summary: escapeHtml(`${frNumber(counts[max], 0)} en danger ${FOREST_DANGER_WORD[max]} ${day1}${late ? ' (en retard)' : ''}`),
    html: `<p class="fmk-note">${escapeHtml(`${day1.charAt(0).toUpperCase()}${day1.slice(1)} (J1)`)}</p>` + dangerBars(fd, 'j1', !late) + namedLevels(fd, 'j1', day1)
      + `<p class="fmk-note">${escapeHtml(`${day2.charAt(0).toUpperCase()}${day2.slice(1)} (J2)`)}</p>` + dangerBars(fd, 'j2', !late) + namedLevels(fd, 'j2', day2)
      + note(`Publication Météo-France du ${dateAt(fd.publishedAt, now)}${late ? ' (en retard)' : ''} ; niveau officiel par département, repris tel quel.`)
      + mdfReadNote(f)
      + seasonChart(fd, !late) + toggle,
  };
}

// ─── Détections en France ───

function plumeHtml(foyerId: string, state: RadarColumnResult | 'loading' | 'error' | undefined, input: FeuxViewInput): string {
  const { options, now } = input;
  const body = state === undefined ? ''
    : state === 'loading' ? radarProfileLoadingHtml()
      : state === 'error' ? radarProfileErrorHtml() : radarProfileHtml(state, now);
  const tops = options.echoTopsAvailable
    ? `<button type="button" class="lp-toggle" data-echo-tops aria-pressed="${options.echoTops}">${options.echoTops ? 'Masquer les sommets d’écho' : 'Sommets d’écho sur la carte'}</button>`
    : note('Sommets d’écho indisponibles : le manifeste radar n’en publie pas.');
  return `<details class="lp-plume" data-plume-foyer="${escapeHtml(foyerId)}"${state !== undefined ? ' open' : ''}>`
    + '<summary>Hauteur du panache (démonstration)</summary>'
    + body + tops + note(PYROCONVECTION) + '</details>';
}

function foyerRow(fo: FireFoyer, late: boolean, input: FeuxViewInput): string {
  const { canFocus, now } = input;
  const last = dataMs(fo.lastAt);
  const parts = [
    fo.satellites.map((s) => SATELLITE_WORD[s]).join(', '),
    `confiance ${fo.confidenceMax}`,
    `${plural(fo.detections, 'détection')}, ${plural(fo.passes, 'passage')}`,
    last === null ? null : `dernière à ${absoluteTime(last, now, 'fr')} (${formatAge(last, now)})`,
    fo.recurrent ? 'récurrent, à vérifier, probablement industriel' : null,
  ].filter((x): x is string => x !== null);
  const level = late ? 'gris' : foyerLevel(fo);
  return listRow({
    text: `${deptLabel(fo.dept)} · ${foyerKind(fo)}`, value: formatFrp(fo.frpTotalMw), level, note: parts.join(' · '),
    ...(canFocus ? { data: { foyer: fo.id }, link: true } : {}),
  }) + plumeHtml(fo.id, input.plume.get(fo.id), input);
}

function dailyChart(f: FiresResponse): string {
  const days = f.daily.days;
  if (days.length === 0) return note('Détections par jour : aucun jour encore gardé par le serveur.');
  const stacks: DayStack[] = days.map((d) => ({
    day: Date.parse(`${d.date}T12:00:00Z`),
    parts: [
      { value: Math.max(0, d.france - d.recurrent), color: DETECTION_FILL, label: 'en France, non récurrentes' },
      { value: d.recurrent, color: RECURRENT_FILL, label: 'récurrentes, à vérifier' },
    ],
  }));
  const chart = stackedDayBars(stacks, { label: 'Détections en France par jour, récurrentes à part', value: (v) => frNumber(v, 0), tick: dayTick });
  const building = days.length < DAILY_DAYS ? note(`Référence en construction (${plural(days.length, 'jour')} sur ${DAILY_DAYS}).`) : '';
  return chart + building + note('Jour d’acquisition en temps universel ; récurrentes en gris, à part des autres détections.');
}

function nextPassesNote(f: FiresResponse, now: number): string {
  const upcoming = f.nextPasses.filter((p) => (dataMs(p.expectedAt) ?? 0) > now).slice(0, 4);
  if (upcoming.length === 0) return '';
  const list = upcoming.map((p) => `${SATELLITE_WORD[p.satellite]} vers ${absoluteTime(dataMs(p.expectedAt) ?? now, now, 'fr')}`).join(', ');
  return note(`Prochains passages attendus (estimés d’après ceux de la veille) : ${list}.`);
}

function observationOptions(input: FeuxViewInput): string {
  const { options, mtgFrp, now } = input;
  const gibs = `<button type="button" class="lp-toggle" data-gibs aria-pressed="${options.gibs}">${options.gibs ? 'Masquer' : 'Afficher'}</button>`;
  const mtg = `<button type="button" class="lp-toggle" data-mtg aria-pressed="${options.mtgFrp}">${options.mtgFrp ? 'Masquer' : 'Afficher'}</button>`;
  return listRow({ text: 'Imagerie satellite (fumée, feux)', valueHtml: gibs, note: 'NASA GIBS, VIIRS Suomi NPP, dernière image disponible' })
    + listRow({ text: 'MTG-FRP (démonstration)', valueHtml: mtg, note: mtgFrpState(mtgFrp, now) });
}

/**
 * État du produit MTG-FRP tiré de sa lecture (jamais « ACTIF » codé) : « (en retard) » 60 min après l'observation (S2, constante de
 * la tâche 1), lu à l'affichage ; « dernière valide gardée » seulement quand la dernière lecture a échoué (état 'stale').
 */
export function mtgFrpState(feed: FireObservationFeedState | null, now: number): string {
  if (feed === null) return 'non lu';
  const late = feed.observedAt !== null && isEnvironmentDataLate('mtg-frp', new Date(feed.observedAt).toISOString(), now);
  const observed = feed.observedAt === null ? null
    : `observation ${absoluteTime(feed.observedAt, now, 'fr')} (${formatAge(feed.observedAt, now)})${late ? ' (en retard)' : ''}`;
  switch (feed.status) {
    case 'ok': return observed ?? 'observation sans date';
    case 'stale': return `${observed ?? 'observation sans date'}, dernière valide gardée`;
    case 'loading': return 'chargement…';
    case 'not-configured': return 'non configuré';
    case 'error': return 'source indisponible';
  }
}

/**
 * Panne FIRMS du dernier essai alors qu'une collecte est servie, AVANT la liste (S3 : jamais un calme lu d'abord) : produit et erreur
 * nommés ; aucun produit lu : collecte précédente servie avec sa propre date (les règles du retard s'appliquent à sa dernière
 * acquisition).
 */
function firmsOutageCallout(f: FiresResponse, now: number): string {
  if (!firmsIncomplete(f) || f.readAt === null) return '';
  const errors = firmsFailures(f).map(glueEnvUnits);
  const down = productsDown(f);
  const detail = errors.length > 0 ? errors.join(' ; ') : `${down.join(', ')} non ${down.length > 1 ? 'lus' : 'lu'}`;
  const text = previousServed(f)
    ? `Collecte du ${dateAt(f.readAt, now)} servie avec sa date : aucun produit FIRMS lu au dernier essai (${detail}).`
    : `Lecture FIRMS incomplète : ${detail}.`;
  return `<p class="fmk-callout lp-callout">${escapeHtml(text)}</p>`;
}

/** Aucune collecte servie : collecte de plus de 2 jours plus servie, cause de la panne. */
function firmsDownNotes(f: FiresResponse): string {
  const failures = firmsFailures(f);
  const others = failures.filter((e) => !isTooOld(e)).map(glueEnvUnits);
  return (failures.some(isTooOld) ? note('Dernière collecte FIRMS de plus de 2 jours : plus servie, aucune détection comptée.') : '')
    + (others.length > 0 ? note(`Cause : ${others.join(' ; ')}.`) : '');
}

/** Notes d'avancement du serveur (cycle FIRMS en cours…), dites comme notes, jamais comme pannes. */
function progressNotes(f: FiresResponse): string {
  return f.errors.filter(isProgressNote).map((e) => note(noteText(e))).join('');
}

function detectionsSection(input: FeuxViewInput, f: FiresResponse | null): FicheSection {
  const { now, open } = input;
  const base = { id: 'detections', title: 'Détections en France, 24 h', collapsible: true, open: open('detections', true) };
  if (f === null || f.readAt === null) {
    // Première collecte en cours, sans panne : dite comme telle, jamais « source indisponible » ni « aucune détection ».
    const collecting = f !== null && firstCollecting(f);
    const head = collecting ? emptyLine('Collecte FIRMS en cours : détections à la prochaine lecture.') : sourceDown('détections NASA FIRMS');
    const notes = f === null ? '' : firmsDownNotes(f) + progressNotes(f);
    return { ...base, summary: collecting ? 'collecte en cours' : 'n.d.', html: head + notes + observationOptions(input) };
  }
  const late = firmsLate(f, now);
  const confirmed = f.foyers.filter((x) => x.confirmed && !x.recurrent).length;
  const isolated = f.foyers.filter((x) => !x.confirmed && !x.recurrent).length;
  const recurrent = f.foyers.filter((x) => x.recurrent).length;
  const shown = f.foyers.slice(0, MAX_FOYERS).map((fo) => foyerRow(fo, late, input)).join('');
  const rest = f.foyers.length - MAX_FOYERS;
  const incomplete = firmsIncomplete(f);
  // Lecture incomplète : jamais le calme « Aucune détection en France », seulement ce qui a été lu.
  const none = incomplete ? 'Aucune détection lue en France sur les 24 dernières heures.' : 'Aucune détection en France sur les 24 dernières heures.';
  const list = f.foyers.length === 0 ? emptyLine(none) : shown
    + (rest > 0 ? note(`${plural(rest, 'autre foyer', 'autres foyers')}, plus faibles.`) : '');
  const abroad = listRow({ text: 'Détections hors de France (non comptées)', value: frNumber(f.abroadCount, 0), level: 'gris' });
  const last = dataMs(f.lastAcquisitionAt);
  const lastLine = last === null ? note('Aucune acquisition sur la zone.')
    : note(`Dernière acquisition sur la zone : ${absoluteTime(last, now, 'fr')} (${formatAge(last, now)})${late ? ' (en retard)' : ''}.`);
  return {
    ...base,
    summary: escapeHtml(`${plural(confirmed, 'confirmé')} · ${plural(isolated, 'isolé')} · ${plural(recurrent, 'récurrent')}${late ? ' (en retard)' : ''}`
      + `${incomplete ? ' · lecture incomplète' : ''}`),
    html: firmsOutageCallout(f, now) + list + abroad + lastLine + progressNotes(f) + nextPassesNote(f, now) + dailyChart(f) + observationOptions(input)
      + (input.canFocus ? note('Clic sur un foyer : le foyer sur la carte.') : ''),
  };
}

// ─── Jour aéronautique ───

function aeronauticalSection(input: FeuxViewInput, f: FiresResponse | null): FicheSection {
  const { now, open } = input;
  const base = { id: 'jour-aeronautique', title: 'Jour aéronautique', collapsible: true, open: open('jour-aeronautique', false) };
  const codes = new Set<string>();
  for (const fo of f?.foyers ?? []) if (!fo.recurrent) codes.add(fo.dept);
  const fd = f?.forestDanger ?? null;
  if (fd !== null && forestDangerCurrent(fd, now)) for (const d of fd.departments) if (d.j1 >= 3) codes.add(d.dept);
  const rows = [...codes].filter((code) => METROPOLE_DEPT.test(code)).sort((a, b) => departementName(a).localeCompare(departementName(b), 'fr')).flatMap((code) => {
    const day = departementAeronauticalDay(code, now);
    if (day === null) return [];
    const line = aeronauticalLine(day, now);
    return [listRow({ text: deptLabel(code), note: line.text })];
  });
  const rule = note(`Règle française en métropole : jour aéronautique de 30${NBSP}min avant le lever à 30${NBSP}min après le coucher du Soleil, au centroïde du département, heure de Paris ; départements de métropole seulement.`);
  if (rows.length === 0) return { ...base, summary: 'aucun', html: emptyLine('Aucun département avec un foyer ou un danger élevé.') + rule };
  return { ...base, summary: escapeHtml(plural(rows.length, 'département')), html: rows.join('') + rule };
}

// ─── Méthode et sources ───

function methodSection(input: FeuxViewInput, f: FiresResponse | null): FicheSection {
  const { now, open, firesError, mtgFrp } = input;
  const errors = f?.errors ?? [];
  const state = (text: string | null): string => text ?? (firesError !== null ? 'source indisponible' : 'chargement…');
  const firmsText = f === null ? null : f.readAt === null ? 'source indisponible'
    : `dernière acquisition ${f.lastAcquisitionAt ? dateAt(f.lastAcquisitionAt, now) : 'n.d.'}${firmsLate(f, now) ? ' (en retard)' : ''} · collecte du serveur ${dateAt(f.readAt, now)}`;
  const sources = f === null ? '' : f.sources.map((s) => `${FIRMS_PRODUCT[s.id]} ${s.ok ? 'lu' : 'en panne'}`).join(', ');
  const fd = f?.forestDanger ?? null;
  const mdfText = f === null ? null : fd === null ? 'source indisponible'
    : `publication du ${dateAt(fd.publishedAt, now)}${!forestDangerCurrent(fd, now) ? ' (hors saison)' : mdfLate(fd, now) ? ' (en retard)' : ''}`;
  const rows = [
    kvRow('Détections', `${sourceLinkHtml('NASA FIRMS', FIRMS_URL)} · ${escapeHtml(state(firmsText))}`),
    ...(sources ? [kvRow('Produits lus', escapeHtml(sources))] : []),
    kvRow('Danger', `${sourceLinkHtml('Météo-France, météo des forêts', MDF_URL)} · ${escapeHtml(state(mdfText))}`),
    kvRow('Intensité (démonstration)', `${sourceLinkHtml('MTG-FRP, EUMETSAT LSA SAF', MTG_URL)} · ${escapeHtml(mtgFrpState(mtgFrp, now))}`),
    kvRow('Panache (démonstration)', escapeHtml('Météo-France DPRadar, colonne du radar le plus proche')),
  ].join('');
  const html = rows
    + note('Périmètre : départements français seulement (point dans le polygone du département) ; les détections hors de France sont comptées à part, en gris.')
    + note(`Capteurs : VIIRS (Suomi NPP, NOAA-20, NOAA-21 ; confiance en lettres, faible, nominale, haute) et MODIS (Terra, Aqua ; confiance de 0 à 100). Latence d’environ 3${NBSP}h ; les passages sur la France sont groupés (vers 01${NBSP}h à 03${NBSP}h et 11${NBSP}h à 13${NBSP}h UTC), d’où des heures sans observation. En retard au-delà de 14${NBSP}h après la dernière acquisition.`)
    + note(`Foyer : détections à moins de 1${NBSP}km et de 12${NBSP}h l’une de l’autre ; confirmé dès deux passages (satellite et heure d’acquisition) ; une confiance faible n’est jamais rouge.`)
    + note(`Récurrence : une source vue à moins de 1${NBSP}km au moins 5 des 10 derniers jours est « à vérifier, probablement industrielle » et ne compte jamais comme feu. Exception : un foyer d’au moins 100${NBSP}MW ou de confiance haute apparu depuis 7 jours au plus n’est jamais récurrent.`)
    + note(`Pastille : rouge si un département est au danger très élevé ou si un foyer confirmé non récurrent cumule au moins 100${NBSP}MW ; orange si danger élevé ou foyer confirmé non récurrent d’au moins 10${NBSP}MW ; jaune si danger modéré, foyer confirmé plus petit ou détection isolée non récurrente ; une source en retard compte comme en panne ; n.d. si FIRMS et la météo des forêts sont en panne ou en retard ; la panne ou le retard d’une source est nommé dans la raison, même quand l’autre colore la pastille.`)
    + note(`Météo des forêts : niveau officiel de danger (1 faible à 4 très élevé), publié chaque jour vers 16${NBSP}h${NBSP}50 de juin à l’automne pour le lendemain et le surlendemain ; ce n’est pas une carte des incendies.`)
    + `<p class="fmk-note">${escapeHtml('Expertise sur les feux de forêt : ')}${sourceLinkHtml('CNRS, expertise scientifique collective', CNRS_URL)}.</p>`
    + readErrors(errors.filter((e) => !isProgressNote(e)).map(glueEnvUnits)) + errors.filter(isProgressNote).map((e) => note(noteText(e))).join('');
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', html, summary: '4 sources' };
}

// ─── Onglet « Dossier d'un feu » ───

function incidentsSection(input: FeuxViewInput): FicheSection {
  const { majorIncidents, now, open } = input;
  const base = { id: 'incidents', title: 'Grands incidents', collapsible: true, open: open('incidents', true) };
  if (majorIncidents.length === 0) {
    return { ...base, summary: 'aucun', html: emptyLine(`Aucun incident ne franchit la porte du dossier (40 détections et 300${NBSP}MW).`) };
  }
  const rows = majorIncidents.map((i) => {
    const severity = wildfireSeverity(i);
    const last = dataMs(i.endDatetime);
    return listRow({
      text: incidentPlace(i), value: formatFrp(i.frpTotal), level: situationLevel(severity),
      note: `${plural(i.detectionsCount, 'détection')} · sévérité ${SEVERITY_WORD[severity]}${last === null ? '' : ` · dernière détection ${formatAge(last, now)}`}`,
      data: { incident: i.id }, link: true,
    });
  }).join('');
  return { ...base, summary: escapeHtml(plural(majorIncidents.length, 'incident')), html: rows + note('Clic sur un incident : son dossier, observé et déclaré côte à côte.') };
}

// ─── Assemblage ───

function tabsOf(input: FeuxViewInput): LayerTab[] {
  return FEUX_TABS.map((id) => ({ id, label: TAB_LABEL[id], count: id === 'dossier' ? input.majorIncidents.length : null }));
}

function sectionsOf(input: FeuxViewInput, f: FiresResponse | null): FicheSection[] {
  if (input.tab === 'dossier') {
    return [incidentsSection(input), ...(input.dossier ? dossierSections(input.dossier, input.now, input.open) : [])];
  }
  return [forestDangerSection(input, f), detectionsSection(input, f), aeronauticalSection(input, f), methodSection(input, f)];
}

export function buildFeuxView(input: FeuxViewInput): LayerView {
  const { fires: f, firesError, now } = input;
  const tabs = tabsOf(input);
  if (f === null && firesError === null) {
    return { head: { theme: ENVIRONMENT_THEME, title: FEUX_TITLE, status: ['chargement…'] }, tabs, activeTab: input.tab, sections: [], bodyHtml: loadingBody() };
  }
  if (f === null) {
    return {
      head: {
        theme: ENVIRONMENT_THEME, title: FEUX_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'départements par niveau de danger (météo des forêts)', level: null },
        status: ['FIRMS et météo des forêts injoignables'],
      },
      tabs, activeTab: input.tab, sections: sectionsOf(input, null), bodyHtml: sourceErrorCallout(null, now),
    };
  }
  return {
    head: headOf(input, f), tabs, activeTab: input.tab, sections: sectionsOf(input, f),
    bodyHtml: firesError !== null ? sourceErrorCallout(dataMs(f.readAt), now) : undefined,
  };
}
