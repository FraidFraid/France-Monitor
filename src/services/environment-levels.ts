// src/services/environment-levels.ts : retards par source et niveaux des panneaux Environnement (spec 2026-10-04 environnement
// § 1 et § 2 ; contrats § 3.1). Fonctions pures, sans DOM ni réseau, partagées par les services clients, les vues et la carte.
// « n.d. » quand la source manque, jamais une couleur inventée (S4) ; une alerte officielle est reprise telle quelle (E1).
import type {
  AirEpisode, AirQualityResponse, DroughtLevel, DroughtResponse, EarthquakesResponse, Quake,
  FireFoyer, FiresResponse, FloodStation, FloodsResponse, ForestDanger, ForestDangerLevel, OfficialColorId, VigilanceEcheance,
  VigilancePeriod, VigilancePhenomenonId, VigilanceResponse,
} from '../types/index.ts';
import type { LayerLevel, LevelVerdict } from './traffic-levels.ts';
import type { VigilanceLevel } from './vigilance.ts';

export type { LayerLevel, LevelVerdict };

export type EnvironmentSource =
  | 'vigilance' | 'vigicrues' | 'hubeau' | 'radar' | 'firms' | 'mdf' | 'mtg-frp'
  | 'vigieau' | 'atmo' | 'bcsf' | 'refmar';

/** Minutes après la date de la donnée au-delà desquelles elle est « en retard » (tableau S2 de la spec). */
export const ENVIRONMENT_LATE_AFTER_MIN: Readonly<Record<EnvironmentSource, number>> = {
  vigilance: 15 * 60, // update_time + 15 h
  vigicrues: 30, // relevé du serveur + 30 min
  hubeau: 60, // dernière mesure d'une station + 1 h
  radar: 15, // observedAt + 15 min
  firms: 14 * 60, // dernière acquisition sur la zone + 14 h
  mdf: 30 * 60, // publication + 30 h, en saison seulement
  'mtg-frp': 60, // observation + 60 min
  vigieau: 36 * 60, // asOf + 36 h
  atmo: 36 * 60, // date_maj + 36 h
  bcsf: 30, // relevé du serveur + 30 min
  refmar: 30, // dernière mesure + 30 min
};

/** Saison de la météo des forêts : juin à septembre (Paris), ou publication de moins de 72 h. */
export const FOREST_DANGER_SEASON = { fromMonth: 6, toMonth: 9, offSeasonAfterHours: 72 } as const;

/** Foyer « majeur » de la pastille rouge : FRP cumulée d'au moins 100 MW (spec § 2.4). */
export const MAJOR_FOYER_MW = 100;
/**
 * Seuil de l'orange (arbitrage 14 du contrôleur) : un foyer confirmé non récurrent de moins de 10 MW cumulés sur 24 h compte comme une
 * détection isolée (jaune), sur la pastille, la carte et la tuile « Météo ».
 */
export const ORANGE_FOYER_MW = 10;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const PARIS_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Champs de l'heure murale de Paris d'un instant, sans dépendre du format de la locale. */
function parisParts(instant: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const out: Record<string, number> = {};
  for (const p of PARIS_PARTS.formatToParts(new Date(instant))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second };
}

/** Décalage de Paris par rapport à UTC à cet instant (ms) : 1 h en hiver, 2 h en été. */
function parisOffsetMs(instant: number): number {
  const p = parisParts(instant);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

/** Instant correspondant à `hour` h (heure murale de Paris) du jour « AAAA-MM-JJ ». */
function parisWallToInstant(day: string, hour: number): number {
  const [y, m, d] = day.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  const guess = wall - parisOffsetMs(wall - HOUR_MS);
  return wall - parisOffsetMs(guess);
}

/** « 2026-10-04 » : jour de Paris d'un instant (heure d'été comprise). */
export function parisDayOf(instant: number): string {
  const p = parisParts(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Jour suivant d'un jour « AAAA-MM-JJ » (calendrier, sans fuseau). */
export function nextDayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** « aujourd’hui », « demain », sinon « le 06/10 » (jour de Paris). */
export function dayWordOf(day: string, now: number): string {
  const today = parisDayOf(now);
  if (day === today) return 'aujourd’hui';
  if (day === nextDayOf(today)) return 'demain';
  return `le ${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export function forestDangerSeason(publishedAt: string | null, now: number): 'en-saison' | 'hors-saison' {
  const month = Number(parisDayOf(now).slice(5, 7));
  if (month >= FOREST_DANGER_SEASON.fromMonth && month <= FOREST_DANGER_SEASON.toMonth) return 'en-saison';
  const t = publishedAt === null ? Number.NaN : Date.parse(publishedAt);
  return Number.isFinite(t) && now - t < FOREST_DANGER_SEASON.offSeasonAfterHours * HOUR_MS ? 'en-saison' : 'hors-saison';
}

/** Date absente ou illisible : en retard ; 'mdf' hors saison : jamais en retard. */
export function isEnvironmentDataLate(source: EnvironmentSource, dataDate: string | null, now: number): boolean {
  if (source === 'mdf' && forestDangerSeason(dataDate, now) === 'hors-saison') return false;
  if (dataDate === null) return true;
  const t = Date.parse(dataDate);
  if (!Number.isFinite(t)) return true;
  return t + ENVIRONMENT_LATE_AFTER_MIN[source] * MINUTE_MS < now;
}

/** Prochaine carte régulière de vigilance : 06 h ou 16 h, heure de Paris toute l'année (04:00 et 14:00 UTC en été, 05:00 et 15:00 UTC en hiver). */
export function nextVigilanceMap(now: number): number {
  const today = parisDayOf(now);
  const candidates = [today, nextDayOf(today)].flatMap((day) => [6, 16].map((h) => parisWallToInstant(day, h)));
  return candidates.find((t) => t > now) ?? candidates[candidates.length - 1];
}

// ─── Vigilance météo (spec § 2.1) ───

/** Couleur officielle (1 à 4) vers l'échelle L1. */
export const OFFICIAL_COLOR_LEVEL: Readonly<Record<OfficialColorId, VigilanceLevel>> = { 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge' };

/** Phénomènes de la vigilance Météo-France, en minuscules (phrases et raisons de pastille). */
export const PHENOMENON_WORD: Readonly<Record<VigilancePhenomenonId, string>> = {
  1: 'vent violent', 2: 'pluie-inondation', 3: 'orages', 4: 'crues', 5: 'neige-verglas', 6: 'canicule', 7: 'grand froid', 8: 'avalanches',
  9: 'vagues-submersion',
};

/** `max` noms au plus, puis « et 1 autre » ou « et N autres ». */
function namesList(names: readonly string[], max: number): string {
  if (names.length <= max) return names.join(', ');
  const rest = names.length - max;
  return `${names.slice(0, max).join(', ')} et ${rest} autre${rest > 1 ? 's' : ''}`;
}

export function vigilancePeriodOf(v: VigilanceResponse, echeance: VigilanceEcheance): VigilancePeriod | null {
  return v.periods.find((p) => p.echeance === echeance) ?? null;
}

/**
 * Pastille Vigilance (§ 2.1) : couleur maximale de l'échéance (départements et domaines littoraux) ; raison
 * « pluie-inondation : Aude, Pyrénées-Orientales » (phénomène qui atteint cette couleur dans le plus de départements, puis le
 * plus petit identifiant ; départements dans l'ordre de la liste) ; n.d. sans carte.
 */
export function vigilanceLevel(v: VigilanceResponse, echeance: VigilanceEcheance = 'J'): LevelVerdict {
  const period = v.updateTime === null ? null : vigilancePeriodOf(v, echeance);
  if (!period) return { level: 'nd', reason: 'carte de vigilance Météo-France indisponible' };
  const top = period.maxColor;
  if (top === 1) return { level: 'vert', reason: 'aucune vigilance jaune ou plus' };
  const byPhenomenon = new Map<VigilancePhenomenonId, string[]>();
  const add = (id: VigilancePhenomenonId, name: string): void => { byPhenomenon.set(id, [...(byPhenomenon.get(id) ?? []), name]); };
  for (const d of period.departments) for (const p of d.phenomena) if (p.color === top) add(p.id, d.name);
  for (const c of period.coast) if (c.color === top) add('9', c.name);
  const first = [...byPhenomenon.entries()].sort((a, b) => b[1].length - a[1].length || Number(a[0]) - Number(b[0]))[0];
  return { level: OFFICIAL_COLOR_LEVEL[top], reason: first ? `${PHENOMENON_WORD[first[0]]} : ${namesList(first[1], 3)}` : 'vigilance en cours' };
}

// ─── Crues (spec § 2.2) ───

/**
 * Pastille Crues (§ 2.2) : niveau maximal des tronçons ; raison « Têt, Agly, Réart, Tech (Méditerranée Ouest) » (tronçons au
 * niveau maximal, groupés par territoire, quatre noms au plus par territoire) ; n.d. si readAt null.
 */
export function floodsLevel(f: FloodsResponse): LevelVerdict {
  if (f.readAt === null) return { level: 'nd', reason: 'Vigicrues indisponible' };
  // Niveau et raison viennent des mêmes tronçons : ils ne peuvent pas se contredire.
  const top = f.sections.reduce<OfficialColorId>((m, x) => (x.level > m ? x.level : m), 1);
  if (top === 1) return { level: 'vert', reason: 'aucun tronçon en vigilance jaune ou plus' };
  const groups = new Map<string, string[]>();
  for (const s of f.sections.filter((x) => x.level === top)) {
    const territory = s.territory.name ?? `territoire ${s.territory.code}`;
    groups.set(territory, [...(groups.get(territory) ?? []), s.name]);
  }
  const reason = [...groups.entries()].map(([territory, names]) => `${namesList(names, 4)} (${territory})`).join(' ; ');
  return { level: OFFICIAL_COLOR_LEVEL[top], reason: reason || 'tronçons en vigilance' };
}

/** Station en retard : dernière mesure + 1 h. */
export function stationLate(s: FloodStation, now: number): boolean {
  return isEnvironmentDataLate('hubeau', s.lastAt, now);
}

// ─── Feux de forêt (spec § 2.4) ───

/** Foyer de la pastille rouge : confirmé, non récurrent, au moins 100 MW cumulés ; une confiance faible n'est jamais rouge. */
export function isMajorFoyer(f: FireFoyer): boolean {
  return f.confirmed && !f.recurrent && f.frpTotalMw >= MAJOR_FOYER_MW && f.confidenceMax !== 'faible';
}

/**
 * Couleur d'un foyer : rouge confirmé non récurrent ≥ 100 MW ; orange confirmé non récurrent ≥ 10 MW ; jaune isolé non récurrent, ou
 * confirmé de moins de 10 MW (compté comme une détection isolée, arbitrage 14 du contrôleur) ; gris récurrent.
 */
export function foyerLevel(f: FireFoyer): VigilanceLevel | 'gris' {
  if (f.recurrent) return 'gris';
  if (isMajorFoyer(f)) return 'rouge';
  return f.confirmed && f.frpTotalMw >= ORANGE_FOYER_MW ? 'orange' : 'jaune';
}

/** Niveau de danger de la météo des forêts (1 faible à 4 très élevé) vers l'échelle L1. */
export const FOREST_DANGER_COLOR: Readonly<Record<ForestDangerLevel, VigilanceLevel>> = { 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge' };
const DANGER_WORD: Readonly<Record<ForestDangerLevel, string>> = { 1: 'faible', 2: 'modéré', 3: 'élevé', 4: 'très élevé' };

/** La météo des forêts colore tant que son J1 est aujourd'hui ou plus tard (jour de Paris) : hors saison, ses niveaux échus ne colorent plus. */
export function forestDangerCurrent(fd: ForestDanger, now: number): boolean {
  return fd.j1Date >= parisDayOf(now);
}

/** Niveau J1 le plus haut des départements (1 sans département). */
export function maxForestDanger(fd: ForestDanger): ForestDangerLevel {
  return fd.departments.reduce<ForestDangerLevel>((m, d) => (d.j1 > m ? d.j1 : m), 1);
}

function mw(v: number): string {
  return `${Math.round(v)} MW`;
}

/**
 * Âge au-delà duquel une collecte des feux ne compte plus : 2 jours après sa lecture, comme le serveur qui ne la sert plus
 * (api/_lib/fires-collect.js, LAST_TTL_SEC). Le client garde la collecte précédente après une erreur : un onglet resté ouvert
 * compterait sinon de vieilles détections.
 */
const FIRES_COLLECTION_MAX_AGE_MS = 2 * 86_400_000;

/** Détections FIRMS d'une réponse : à l'heure, en retard (S2) ou indisponibles (S3). */
export type FirmsState = 'ok' | 'late' | 'down';

/**
 * État des détections FIRMS à l'instant `now` : indisponibles sans collecte servie (readAt null) ; en retard 14 h après la
 * dernière acquisition sur la zone ; indisponibles encore si la collecte a été lue il y a 2 jours ou plus (ou à une date
 * illisible). Seul « ok » compte, pour la pastille, la carte des foyers et les entrées du score.
 */
export function firmsState(f: FiresResponse, now: number): FirmsState {
  if (f.readAt === null) return 'down';
  if (f.lastAcquisitionAt !== null && isEnvironmentDataLate('firms', f.lastAcquisitionAt, now)) return 'late';
  const readAt = Date.parse(f.readAt);
  return Number.isFinite(readAt) && now - readAt < FIRES_COLLECTION_MAX_AGE_MS ? 'ok' : 'down';
}

/** Météo des forêts d'une réponse : du jour, en retard (publication + 30 h), échue hors saison, ou indisponible. */
type MdfState = 'ok' | 'late' | 'off' | 'down';

function mdfState(fd: ForestDanger | null, now: number): MdfState {
  if (fd === null) return 'down';
  if (!forestDangerCurrent(fd, now)) return 'off';
  return isEnvironmentDataLate('mdf', fd.publishedAt, now) ? 'late' : 'ok';
}

const FIRMS_DOWN_WORDS: Readonly<Record<Exclude<FirmsState, 'ok'>, string>> = { late: 'détections FIRMS en retard', down: 'détections FIRMS indisponibles' };
const MDF_DOWN_WORDS: Readonly<Record<Exclude<MdfState, 'ok'>, string>> = {
  late: 'météo des forêts en retard', off: 'météo des forêts hors saison', down: 'météo des forêts indisponible',
};

/** Raison du n.d. : les deux sources indisponibles, chacune nommée ; « niveau suspendu » quand l'une n'est qu'en retard. */
function firesNdReason(firms: Exclude<FirmsState, 'ok'>, mdf: Exclude<MdfState, 'ok'>): string {
  if (firms === 'down' && mdf === 'down') return 'FIRMS et météo des forêts indisponibles';
  const firmsWords = firms === 'late' ? FIRMS_DOWN_WORDS.late : 'FIRMS indisponible';
  const reason = `${firmsWords} ; ${MDF_DOWN_WORDS[mdf]}`;
  return firms === 'late' || mdf === 'late' ? `niveau suspendu : ${reason}` : reason;
}

/**
 * Pastille Feux (§ 2.4) : rouge si un département est au niveau 4 en J1 ou un foyer majeur (isMajorFoyer) ; orange si niveau 3 ou
 * foyer confirmé non récurrent d'au moins 10 MW (arbitrage 14 du contrôleur) ; jaune si niveau 2, foyer confirmé plus petit ou
 * détection isolée non récurrente en France ; vert sinon. Une source en retard compte comme indisponible (S2) : FIRMS en retard ou
 * en panne (firmsState), météo des forêts absente, échue hors saison ou en retard. n.d. seulement si les deux sont indisponibles ;
 * sinon l'autre colore seule la pastille et la panne ou le retard est nommé dans la raison. Seule fonction de la pastille : panneau,
 * part « Feux » de la tuile « Météo » (environment-inputs.ts). La raison réunit les causes du niveau retenu (« ; »). Le 04/10 :
 * 10 départements au niveau 2 et trois foyers confirmés de 1,24 à 3,91 MW donnent jaune, comme la vérification de la spec.
 */
export function firesLevel(f: FiresResponse, now: number): LevelVerdict {
  const fd = f.forestDanger;
  const firms = firmsState(f, now);
  const mdf = mdfState(fd, now);
  if (firms !== 'ok' && mdf !== 'ok') return { level: 'nd', reason: firesNdReason(firms, mdf) };
  const causes: Array<{ level: VigilanceLevel; text: string }> = [];
  if (firms === 'ok') {
    const active = f.foyers.filter((x) => !x.recurrent);
    const major = active.filter(isMajorFoyer);
    const confirmed = active.filter((x) => foyerLevel(x) === 'orange');
    const small = active.filter((x) => x.confirmed && foyerLevel(x) === 'jaune');
    const isolated = active.filter((x) => !x.confirmed);
    if (major.length > 0) {
      const top = major.reduce((a, b) => (b.frpTotalMw > a.frpTotalMw ? b : a));
      causes.push({ level: 'rouge', text: major.length > 1 ? `${major.length} foyers confirmés d’au moins ${MAJOR_FOYER_MW} MW` : `foyer confirmé de ${mw(top.frpTotalMw)}` });
    } else if (confirmed.length > 0) {
      causes.push({ level: 'orange', text: confirmed.length > 1 ? `${confirmed.length} foyers confirmés en France` : 'un foyer confirmé en France' });
    } else if (small.length > 0) {
      // Arbitrage 14 du contrôleur : moins de 10 MW cumulés, compté comme une détection isolée (jaune).
      const what = small.length > 1 ? `${small.length} foyers confirmés` : 'un foyer confirmé';
      causes.push({ level: 'jaune', text: `${what} de moins de ${ORANGE_FOYER_MW} MW en France` });
    } else if (isolated.length > 0) {
      causes.push({ level: 'jaune', text: isolated.length > 1 ? `${isolated.length} détections isolées en France` : 'une détection isolée en France' });
    }
  }
  if (fd !== null && mdf === 'ok') {
    const max = maxForestDanger(fd);
    if (max >= 2) {
      const at = fd.departments.filter((d) => d.j1 === max);
      const where = at.length <= 3 ? at.map((d) => d.name).join(', ') : `${at.length} départements`;
      causes.push({ level: FOREST_DANGER_COLOR[max], text: `danger ${DANGER_WORD[max]} ${dayWordOf(fd.j1Date, now)} : ${where}` });
    }
  }
  const rank: Readonly<Record<VigilanceLevel, number>> = { vert: 0, jaune: 1, orange: 2, rouge: 3 };
  const top = causes.reduce<VigilanceLevel>((m, c) => (rank[c.level] > rank[m] ? c.level : m), 'vert');
  if (top !== 'vert') {
    // Une source en panne ou en retard se voit même quand l'autre colore la pastille (S2, S3) ; hors saison n'est pas une panne.
    const outage = firms !== 'ok' ? [FIRMS_DOWN_WORDS[firms]] : mdf === 'down' || mdf === 'late' ? [MDF_DOWN_WORDS[mdf]] : [];
    return { level: top, reason: [...causes.filter((c) => c.level === top).map((c) => c.text), ...outage].join(' ; ') };
  }
  if (firms !== 'ok') return { level: 'vert', reason: `danger faible ; ${firms === 'late' ? FIRMS_DOWN_WORDS.late : 'FIRMS indisponible'}` };
  const recurrent = f.foyers.filter((x) => x.recurrent).length;
  const noFoyer = `aucun foyer en France${recurrent > 0 ? ` hors ${recurrent} source${recurrent > 1 ? 's' : ''} récurrente${recurrent > 1 ? 's' : ''} à vérifier` : ''}`;
  return { level: 'vert', reason: mdf === 'ok' ? `${noFoyer}, danger faible` : `${noFoyer} ; ${MDF_DOWN_WORDS[mdf]}` };
}

// ─── Phase B (tâche 20) : sécheresse, qualité de l'air, séismes ───

/** Niveaux VigiEau qui colorent la pastille, du plus grave au moins grave ; la vigilance (sensibilisation) ne colore jamais. */
const DROUGHT_PILL: ReadonlyArray<readonly [Exclude<DroughtLevel, 'vigilance'>, VigilanceLevel, string]> = [
  ['crise', 'rouge', 'en crise'], ['alerte_renforcee', 'orange', 'en alerte renforcée'], ['alerte', 'jaune', 'en alerte'],
];

function countWord(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

/** Pastille Sécheresse (§ 3.1) : un stock (E2), affiché, jamais dans le score ; n.d. sans aucun département lu. */
export function droughtLevel(d: DroughtResponse): LevelVerdict {
  if (!d.departments.some((x) => x.available)) return { level: 'nd', reason: 'arrêtés VigiEau indisponibles' };
  for (const [key, level, words] of DROUGHT_PILL) {
    const n = d.counts[key];
    if (n > 0) return { level, reason: `${countWord(n, 'département')} ${words}` };
  }
  return { level: 'vert', reason: 'aucune restriction au-delà de la vigilance' };
}

function episodeWords(list: readonly AirEpisode[]): string {
  const first = list[0];
  if (!first) return '';
  const others = list.length - 1;
  return `${first.pollutant}, ${first.zone}${others > 0 ? ` et ${countWord(others, 'autre')}` : ''}`;
}

/**
 * Pastille Qualité de l'air (§ 3.2) : rouge si un épisode atteint le seuil d'alerte ; orange en information-recommandation ;
 * jaune si au moins une commune est en indice mauvais (4) ou pire ; vert sinon ; n.d. si les deux couches manquent. Un état non
 * reconnu ne colore pas (il est affiché gris, texte publié).
 */
export function airQualityLevel(a: AirQualityResponse): LevelVerdict {
  if (a.episodesUpdatedAt === null && a.index.communes === 0) return { level: 'nd', reason: 'Atmo France indisponible' };
  const alerte = a.episodes.filter((e) => e.state === 'alerte');
  if (alerte.length > 0) return { level: 'rouge', reason: `seuil d’alerte : ${episodeWords(alerte)}` };
  const information = a.episodes.filter((e) => e.state === 'information');
  if (information.length > 0) return { level: 'orange', reason: `information-recommandation : ${episodeWords(information)}` };
  const bad = a.index.departments.reduce((n, d) => n + d.mauvais + d.tresMauvaisEtPlus, 0);
  if (bad > 0) return { level: 'jaune', reason: `${countWord(bad, 'commune')} en indice mauvais ou pire` };
  return { level: 'vert', reason: a.episodesUpdatedAt === null ? 'épisodes indisponibles ; aucune commune en indice mauvais' : 'aucun épisode de pollution prévu' };
}

/** Fenêtre de la pastille et de la situation sismique (amendement 6). */
export const QUAKE_WINDOW_MS = 72 * 3_600_000;

/** « En France » au sens du lot (amendement 2) : polygone métropolitain ou eaux françaises, calculé par la route. */
export function quakeInFrance(q: Quake): boolean {
  return q.inFrance;
}

/** « proche de Gap » tiré de la description publiée ; la description entière quand elle ne nomme pas de lieu (EMSC : région). */
export function quakePlace(q: Pick<Quake, 'description'>): string {
  const m = /proche de\s+(.+?)\s*$/i.exec(q.description);
  return m ? `proche de ${m[1]}` : q.description;
}

/** Magnitude au dixième avec la virgule (« 4,3 ») pour les phrases des raisons et des situations. */
export function magnitudeText(m: number): string {
  return m.toFixed(1).replace('.', ',');
}

/** Pastille Séismes (§ 3.3) : sur les 72 dernières heures, en France ; rouge dès 5, orange dès 4, jaune dès 3, vert sinon. */
export function earthquakesLevel(q: EarthquakesResponse, now: number): LevelVerdict {
  if (q.readAt === null) return { level: 'nd', reason: 'BCSF-RéNaSS et EMSC indisponibles' };
  let top: Quake | null = null;
  for (const x of q.quakes) {
    const t = Date.parse(x.at);
    if (!quakeInFrance(x) || !Number.isFinite(t) || t > now || now - t > QUAKE_WINDOW_MS) continue;
    if (top === null || x.magnitude > top.magnitude) top = x;
  }
  if (top === null || top.magnitude < 3) return { level: 'vert', reason: 'aucun séisme de magnitude 3 ou plus en France sur 72 h' };
  const level: VigilanceLevel = top.magnitude >= 5 ? 'rouge' : top.magnitude >= 4 ? 'orange' : 'jaune';
  return { level, reason: `séisme de magnitude ${magnitudeText(top.magnitude)} ${quakePlace(top)}` };
}
