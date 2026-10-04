// src/services/environment-levels.ts : retards par source et niveaux des panneaux Environnement (spec 2026-10-04 environnement
// § 1 et § 2 ; contrats § 3.1). Fonctions pures, sans DOM ni réseau, partagées par les services clients, les vues et la carte.
// « n.d. » quand la source manque, jamais une couleur inventée (S4) ; une alerte officielle est reprise telle quelle (E1).
import type {
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
const PARIS_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** « 2026-10-04 » : jour de Paris d'un instant (heure d'été comprise). */
export function parisDayOf(instant: number): string {
  return PARIS_DAY.format(new Date(instant));
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

/** Prochaine carte régulière de vigilance : 04:00 ou 14:00 UTC (06 h et 16 h en été, 05 h et 15 h en hiver). */
export function nextVigilanceMap(now: number): number {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const slots = [midnight + 4 * HOUR_MS, midnight + 14 * HOUR_MS, midnight + 28 * HOUR_MS];
  return slots.find((t) => t > now) ?? midnight + 28 * HOUR_MS;
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
  const top: OfficialColorId = f.counts.rouge > 0 ? 4 : f.counts.orange > 0 ? 3 : f.counts.jaune > 0 ? 2 : 1;
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
 * Pastille Feux (§ 2.4) : rouge si un département est au niveau 4 en J1 ou un foyer majeur (isMajorFoyer) ; orange si niveau 3 ou
 * foyer confirmé non récurrent d'au moins 10 MW (arbitrage 14 du contrôleur) ; jaune si niveau 2, foyer confirmé plus petit ou
 * détection isolée non récurrente en France ; vert sinon ; n.d. si FIRMS (readAt null) et météo des forêts (null) sont en panne.
 * La météo des forêts ne compte que si forestDangerCurrent. La raison réunit les causes du niveau retenu (« ; »). Le 04/10 :
 * 10 départements au niveau 2 et trois foyers confirmés de 1,24 à 3,91 MW donnent jaune, comme la vérification de la spec.
 */
export function firesLevel(f: FiresResponse, now: number): LevelVerdict {
  const fd = f.forestDanger;
  if (f.readAt === null && fd === null) return { level: 'nd', reason: 'FIRMS et météo des forêts indisponibles' };
  const fdCurrent = fd !== null && forestDangerCurrent(fd, now);
  // FIRMS en panne et météo des forêts échue (hors saison) : aucune donnée qui vaille, jamais un vert par défaut.
  if (f.readAt === null && !fdCurrent) return { level: 'nd', reason: 'FIRMS indisponible ; météo des forêts hors saison' };
  const causes: Array<{ level: VigilanceLevel; text: string }> = [];
  if (f.readAt !== null) {
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
  if (fd !== null && fdCurrent) {
    const max = maxForestDanger(fd);
    if (max >= 2) {
      const at = fd.departments.filter((d) => d.j1 === max);
      const where = at.length <= 3 ? at.map((d) => d.name).join(', ') : `${at.length} départements`;
      causes.push({ level: FOREST_DANGER_COLOR[max], text: `danger ${DANGER_WORD[max]} ${dayWordOf(fd.j1Date, now)} : ${where}` });
    }
  }
  const rank: Readonly<Record<VigilanceLevel, number>> = { vert: 0, jaune: 1, orange: 2, rouge: 3 };
  const top = causes.reduce<VigilanceLevel>((m, c) => (rank[c.level] > rank[m] ? c.level : m), 'vert');
  if (top !== 'vert') return { level: top, reason: causes.filter((c) => c.level === top).map((c) => c.text).join(' ; ') };
  if (f.readAt === null) return { level: 'vert', reason: 'danger faible ; FIRMS indisponible' };
  const recurrent = f.foyers.filter((x) => x.recurrent).length;
  const noFoyer = `aucun foyer en France${recurrent > 0 ? ` hors ${recurrent} source${recurrent > 1 ? 's' : ''} récurrente${recurrent > 1 ? 's' : ''} à vérifier` : ''}`;
  if (fd === null) return { level: 'vert', reason: `${noFoyer} ; météo des forêts indisponible` };
  if (!fdCurrent) return { level: 'vert', reason: `${noFoyer} ; météo des forêts hors saison` };
  return { level: 'vert', reason: `${noFoyer}, danger faible` };
}
