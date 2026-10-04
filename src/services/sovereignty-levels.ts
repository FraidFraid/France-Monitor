// src/services/sovereignty-levels.ts : retards par source, niveaux et gravités des panneaux Souveraineté (spec 2026-10-04
// souveraineté § 1, § 2.1 à § 2.4 ; contrats § 3.1 ; amendement 7 : conformité aux autorités). Fonctions pures, sans DOM ni réseau,
// partagées par les services clients, les vues, la carte et le score. « n.d. » quand la source manque ou se tait, jamais une couleur
// inventée (V1, S3) ; un niveau ou un statut officiel est repris tel quel (V4, O1).
import type {
  CableAlert, CablesWatchResponse, CertFrItem, CyberResponse, GnssDegradedCounts, MilitaryEmergency, MilitaryResponse,
  RansomwareSummary, SituationSeverity, VigipirateEntry, VigipiratePageCheck,
} from '../types/index.ts';
import { parisDayOf } from './environment-levels.ts';
import { emergencyColoursPill, isEmergencyConfirmed, type LayerLevel, type LevelVerdict } from './traffic-levels.ts';
import { LEVEL_RANK, type VigilanceLevel } from './vigilance.ts';

export type { LayerLevel, LevelVerdict };

export type SovereigntySource =
  | 'adsb-mil' | 'ais-cables' | 'certfr' | 'kev' | 'ransomware' | 'hibp' | 'cybermalveillance'
  | 'adsb-gnss' | 'noaa' | 'ripestat' | 'gels';

/** Minutes après la date de référence de chaque source au-delà desquelles la donnée est « en retard » (tableau S2 de la spec). */
export const SOVEREIGNTY_LATE_AFTER_MIN: Readonly<Record<SovereigntySource, number>> = {
  'adsb-mil': 10,            // readAt + 10 min
  'ais-cables': 15,          // aisLastMessageAt + 15 min (amendement 5 : la veille relève toutes les quelques minutes ; le flux muet reste dit par la garde T3 du serveur)
  certfr: 6 * 60,            // certfr.readAt + 6 h
  kev: 26 * 60,              // kev.readAt + 26 h
  ransomware: 24 * 60,       // lastModified + 24 h
  hibp: 26 * 60,             // hibp.readAt + 26 h
  cybermalveillance: 6 * 60, // readAt + 6 h (lecture horaire, même règle que le CERT-FR)
  'adsb-gnss': 40,           // readAt (dernière collecte complète) + 40 min
  noaa: 3 * 60,              // scalesAt + 3 h
  ripestat: 10 * 60,         // snapshotAt (query_time) + 10 h
  gels: 26 * 60,             // dateCheckedAt + 26 h (une publication ancienne n'est jamais en retard)
};

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PARIS_CLOCK = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Date absente ou illisible : en retard. */
export function isSovereigntyDataLate(source: SovereigntySource, dataDate: string | null, now: number): boolean {
  if (dataDate === null) return true;
  const t = Date.parse(dataDate);
  if (!Number.isFinite(t)) return true;
  return t + SOVEREIGNTY_LATE_AFTER_MIN[source] * MINUTE_MS < now;
}

/** « 16:48 » : heure de Paris d'une date ISO ; « n.d. » si absente ou illisible. */
function clockOf(iso: string | null): string {
  const t = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(t) ? PARIS_CLOCK.format(new Date(t)) : 'n.d.';
}

/** Jours de Paris révolus entre le jour « AAAA-MM-JJ » et l'instant `now` (0 le jour même) ; NaN si le jour est illisible. */
function parisDaysSince(day: string, now: number): number {
  const m = DAY_RE.exec(day);
  if (!m) return Number.NaN;
  const [ty, tm, td] = parisDayOf(now).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / DAY_MS);
}

/** « 28/09 » d'un jour « AAAA-MM-JJ ». */
function dayMonthOf(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

// ─── Vigipirate (posture saisie, jamais « en retard ») ───

/** Forme lue ici de la saisie Vigipirate : le jour de la saisie. */
export type VigipirateDated = Pick<VigipirateEntry, 'saisiLe'>;

/** Saisie Vigipirate : jamais « en retard » ; rappel « à vérifier sur sgdsn.gouv.fr » au-delà de 120 jours après `saisiLe`. */
export const VIGIPIRATE_REMINDER_DAYS = 120;

/** Vrai au-delà de 120 jours de Paris après la saisie ; une date illisible demande toujours la vérification. */
export function vigipirateReminderDue(entry: VigipirateDated, now: number): boolean {
  const days = parisDaysSince(entry.saisiLe, now);
  return !Number.isFinite(days) || days > VIGIPIRATE_REMINDER_DAYS;
}

/** Durée du stade « alerte attentat », renouvelable sur décision expresse du Premier ministre (page du SGDSN, O14). */
export const VIGIPIRATE_ALERTE_ATTENTAT_DAYS = 12;

/**
 * Fin des 12 jours d'une « alerte attentat » (O14) : jour « AAAA-MM-JJ » à afficher « jusqu'au JJ/MM, sauf renouvellement par le
 * Premier ministre » ; null pour un autre stade ou un début illisible.
 */
export function vigipirateAlertEnd(entry: Pick<VigipirateEntry, 'stade' | 'depuis'>): string | null {
  if (entry.stade !== 'alerte-attentat') return null;
  const m = DAY_RE.exec(entry.depuis);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + VIGIPIRATE_ALERTE_ATTENTAT_DAYS)).toISOString().slice(0, 10);
}

/**
 * Page officielle modifiée après la saisie (O14) : jour de Paris de la modification lue par le serveur, s'il est postérieur au jour de
 * la saisie (« niveau à revérifier sur sgdsn.gouv.fr (page modifiée le JJ/MM) ») ; null si la page n'a jamais été relue, si son
 * empreinte n'a pas changé ou si elle a changé au plus tard le jour de la saisie. Saisie illisible : toute modification compte.
 */
export function vigipiratePageChangedOn(entry: VigipirateDated, check: VigipiratePageCheck | null): string | null {
  const changedAt = check?.pageChangedAt ?? null;
  const t = changedAt === null ? Number.NaN : Date.parse(changedAt);
  if (!Number.isFinite(t)) return null;
  const day = parisDayOf(t);
  return !DAY_RE.test(entry.saisiLe) || day > entry.saisiLe ? day : null;
}

// ─── Défense (spec § 2.1 ; amendement 7, O7, O9, O10) ───

/** Libellé du gros chiffre Défense (O9), repris tel quel par la légende, la tuile et la fiche. */
export const MILITARY_FIGURE_LABEL = 'aéronefs militaires ou d’État visibles en ADS-B au-dessus de la métropole';

/**
 * Gros chiffre Défense (O9, O10) : appareils comptés au-dessus de la France, français par département et autres, montrés ou masqués
 * (PIA, LADD) ; jamais les appareils hors de France.
 */
export function militaryCounts(m: Pick<MilitaryResponse, 'frenchByDept' | 'others' | 'maskedOthers'>): { francais: number; autres: number; total: number } {
  const francais = m.frenchByDept.reduce((sum, d) => sum + d.count, 0);
  const autres = m.others.length + m.maskedOthers;
  return { francais, autres, total: francais + autres };
}

/** Code du transpondeur (S3 : « 7500 (intervention illicite) »). */
const SQUAWK_WORD: Readonly<Record<MilitaryEmergency['squawk'], string>> = {
  '7500': 'intervention\u00a0illicite', '7600': 'panne\u00a0radio', '7700': 'urgence',
};

function codeWord(e: MilitaryEmergency): string {
  return `${e.squawk}\u00a0(${SQUAWK_WORD[e.squawk]})`;
}

/** Lieu d'un appareil masqué : département, mer territoriale, approches ou hors de France (jamais une position). */
function placeWord(e: MilitaryEmergency): string {
  if (e.dept !== null) return `Dépt\u00a0${e.dept}`;
  if (e.inFrance) return 'mer territoriale';
  return e.overFrance ? 'approches de la France' : 'hors de France';
}

/** Indicatif, sinon adresse, d'un appareil montré ; « appareil d’État français » ou identité protégée et lieu d'un appareil masqué (O10). */
function aircraftWord(e: MilitaryEmergency): string {
  if (!e.masked) return e.callsign ?? `adresse ${e.icao24}`;
  const who = e.family === 'francais' ? 'appareil d’État français' : 'appareil à identité protégée (PIA ou LADD)';
  return `${who} · ${placeWord(e)}`;
}

/** Couleur d'une urgence : rouge 7500, orange 7700 ou 7600, si elle colore (emergencyColoursPill) ; jaune si vue une fois au-dessus
 *  de la France ou de ses approches ; gris hors des approches. */
export function militaryEmergencyLevel(e: MilitaryEmergency): VigilanceLevel | 'gris' {
  if (emergencyColoursPill(e)) return e.squawk === '7500' ? 'rouge' : 'orange';
  return e.overFrance ? 'jaune' : 'gris';
}

/** Mailles à précision GNSS dégradée à partir desquelles la pastille passe à l'orange et « Signal défense » s'ouvre (O7). */
export const GNSS_SITUATION_CELLS = 3;

/**
 * Pastille Défense (§ 2.1) : rouge pour un 7500 affiché sur deux relevés au-dessus de la France ou à moins de 40 km ; orange pour un
 * 7700 ou un 7600 ; jaune pour une urgence vue une seule fois ; vert sinon ; n.d. si adsb.lol est en panne (readAt null ou en retard).
 * Phase B : `gnssDegradedCells` (compte glissant de 24 h, sans lieu, O17) ≥ 3 donne orange, 1 ou 2 jaune (le plus haut des deux règles).
 */
export function defenseLevel(m: MilitaryResponse, now: number, gnssDegradedCells?: number): LevelVerdict {
  if (m.readAt === null) return { level: 'nd', reason: 'adsb.lol indisponible' };
  if (isSovereigntyDataLate('adsb-mil', m.readAt, now)) return { level: 'nd', reason: `non évalué · adsb.lol muet depuis ${clockOf(m.readAt)}` };
  const colouring = m.emergencies.filter(emergencyColoursPill);
  const hijack = colouring.find((e) => e.squawk === '7500');
  const serious = colouring.find((e) => e.squawk === '7700' || e.squawk === '7600');
  const once = m.emergencies.find((e) => e.overFrance && !isEmergencyConfirmed(e));
  let verdict: LevelVerdict;
  if (hijack) verdict = { level: 'rouge', reason: `${codeWord(hijack)} affiché sur deux relevés, non confirmé par les autorités : ${aircraftWord(hijack)}` };
  else if (serious) verdict = { level: 'orange', reason: `${codeWord(serious)} affiché sur deux relevés : ${aircraftWord(serious)}` };
  else if (once) verdict = { level: 'jaune', reason: `${codeWord(once)} vu une fois, à confirmer : ${aircraftWord(once)}` };
  else {
    verdict = {
      level: 'vert',
      reason: m.emergencies.length === 0
        ? 'aucun code d’urgence affiché par un aéronef militaire ou d’État visible en ADS-B au-dessus de la métropole ou de ses approches'
        : 'aucun code d’urgence au-dessus de la métropole ou de ses approches (urgence vue hors des approches)',
    };
  }
  const cells = gnssDegradedCells ?? 0;
  if (cells > 0) {
    const gnss: VigilanceLevel = cells >= GNSS_SITUATION_CELLS ? 'orange' : 'jaune';
    const current = verdict.level === 'nd' ? -1 : LEVEL_RANK[verdict.level];
    if (LEVEL_RANK[gnss] > current) {
      verdict = {
        level: gnss,
        reason: `${plural(cells, 'maille à précision GNSS dégradée', 'mailles à précision GNSS dégradée')} (plus de 10\u00a0% des aéronefs), à vérifier`,
      };
    }
  }
  return verdict;
}

/**
 * Urgence qui ouvre « Signal défense » (O7) : un 7500 affiché sur deux relevés au-dessus de la France ou de ses approches. Les 7700 et
 * 7600 restent des urgences aériennes du panneau et du moniteur d'alertes, sans situation.
 */
export function isDefenseSituationEmergency(e: MilitaryEmergency): boolean {
  return e.squawk === '7500' && emergencyColoursPill(e);
}

/**
 * Gravité de « Signal défense » (O7) : moyenne pour un 7500 affiché sur deux relevés (« code 7500 affiché par le transpondeur, à
 * confirmer par les autorités ») ou pour 3 mailles GNSS dégradées sur 24 h ; élevée seulement si ces 3 mailles s'ajoutent à deux jours
 * UTC complets de suite à 3 mailles ou plus ; null sinon. Jamais un nombre d'aéronefs : un aéronef observé n'est pas un événement.
 */
export function defenseSituationSeverity(
  emergencies: readonly MilitaryEmergency[], gnss: GnssDegradedCounts | null,
): Extract<SituationSeverity, 'medium' | 'high'> | null {
  const gnssNow = gnss !== null && gnss.rolling24h >= GNSS_SITUATION_CELLS;
  if (gnssNow && gnss.previousUtcDays.every((n) => n !== null && n >= GNSS_SITUATION_CELLS)) return 'high';
  return gnssNow || emergencies.some(isDefenseSituationEmergency) ? 'medium' : null;
}

// ─── Connectivité (spec § 2.2) ───

/** Couleur d'une alerte câble : orange confirmée, jaune vue une fois ; gris si l'AIS est muet (non évaluée). */
export function cableAlertLevel(a: CableAlert, evaluated: boolean): VigilanceLevel | 'gris' {
  if (!evaluated) return 'gris';
  return a.confirmed ? 'orange' : 'jaune';
}

function vesselWord(a: CableAlert): string {
  return `${a.name ?? `MMSI ${a.mmsi}`} (${a.cableName ?? 'câble sans nom'})`;
}

/**
 * Relevé de la veille des câbles au-delà duquel elle ne tourne plus : relevé du serveur toutes les 5 min, cache CDN de 2 min et
 * relecture de 5 min (route /api/sovereignty/cables-watch) ; au-delà de 15 min, l'état de l'AIS n'est plus connu.
 */
export const CABLES_WATCH_STALE_MIN = 15;

/**
 * Pastille Connectivité, phase A : orange si une alerte confirmée, jaune si vue une fois, vert sinon ; n.d. si l'AIS est muet ou jamais
 * lu, ou si le relevé du serveur a plus de 15 min (la veille ne tourne plus). Les raisons disent « à vérifier », jamais « menace ».
 */
export function cablesLevel(c: CablesWatchResponse, now: number): LevelVerdict {
  if (c.readAt === null) return { level: 'nd', reason: 'relais AIS jamais lu' };
  if (!c.evaluated) return { level: 'nd', reason: `non évalué · AIS muet depuis ${clockOf(c.aisLastMessageAt)}` };
  const readAt = Date.parse(c.readAt);
  if (!Number.isFinite(readAt) || readAt + CABLES_WATCH_STALE_MIN * MINUTE_MS < now) {
    return { level: 'nd', reason: `non évalué · veille des câbles non relevée depuis ${clockOf(c.readAt)}` };
  }
  const confirmed = c.alerts.filter((a) => a.confirmed);
  if (confirmed.length > 0) {
    return { level: 'orange', reason: `${plural(confirmed.length, 'navire lent confirmé', 'navires lents confirmés')} sur un câble, à vérifier : ${vesselWord(confirmed[0])}` };
  }
  const once = c.alerts.filter((a) => !a.confirmed);
  if (once.length > 0) {
    return { level: 'jaune', reason: `${plural(once.length, 'navire lent vu une fois', 'navires lents vus une fois')} sur un câble, à vérifier : ${vesselWord(once[0])}` };
  }
  return { level: 'vert', reason: 'aucun navire lent à moins de 500\u00a0m d’un câble' };
}

// ─── Vigilance cyber (spec § 2.3 ; amendement 7, O1 à O4) ───

/** Date d'un élément CERT-FR : dernière version, sinon première. Âge en jours de Paris révolus. */
export function certfrDate(item: CertFrItem): string {
  return item.lastVersion ?? item.firstVersion;
}

export function certfrAgeDays(item: CertFrItem, now: number): number {
  return parisDaysSince(certfrDate(item), now);
}

/** Âge depuis la publication (première version), en jours de Paris révolus : règle des 7 jours de la pastille (O2). */
export function certfrPublishedAgeDays(item: CertFrItem, now: number): number {
  return parisDaysSince(item.firstVersion, now);
}

/** Alerte au statut « en cours » repris du CERT-FR (O1) ; jamais une alerte close, un avis ni un statut non lu. */
export function isCertFrAlertOpen(item: CertFrItem): boolean {
  return item.kind === 'alerte' && item.status === 'en-cours';
}

/**
 * Mention d'exploitation (O3) : « exploitation signalée par le CERT-FR » quand le texte de l'alerte le dit ; sinon la vulnérabilité du
 * catalogue KEV ; sinon « non inscrite au catalogue KEV » si la page a été lue ; null si rien n'est su. Jamais « pas d'exploitation
 * connue ».
 */
export function certfrExploitationText(item: CertFrItem): string | null {
  if (item.exploited === true) return 'exploitation signalée par le CERT-FR';
  const kev = item.kevCves[0];
  if (kev !== undefined) return `vulnérabilité exploitée ${kev} (catalogue KEV de la CISA)`;
  return item.exploited === false ? 'non inscrite au catalogue KEV' : null;
}

/** Rapport des revendications de la semaine à la moyenne (RansomwareSummary.ratio), null sans moyenne. */
export function claimsRatio(r: RansomwareSummary | null): number | null {
  return r?.ratio ?? null;
}

/** Âge de publication en deçà duquel une alerte en cours met la pastille à l'orange (O2). */
export const CERTFR_RECENT_DAYS = 7;
/** Rapport des revendications au-delà duquel la pastille passe au jaune, jamais plus haut (O4). */
export const CLAIMS_RATIO_JAUNE = 1.5;

/** Publication la plus récente d'abord, puis référence décroissante (l'ordre de la réponse ne compte pas). */
function byPublication(a: CertFrItem, b: CertFrItem): number {
  return b.firstVersion.localeCompare(a.firstVersion) || b.ref.localeCompare(a.ref, 'fr', { numeric: true });
}

/**
 * Pastille Vigilance cyber (§ 2.3 ; O2, O4) : rouge si deux alertes en cours ont été publiées depuis moins de 7 jours ; orange si une
 * seule ; jaune si une alerte en cours est publiée depuis 7 jours ou plus, si un avis de moins de 7 jours cite une vulnérabilité du
 * catalogue KEV, ou si les revendications dépassent 1,5 fois la moyenne (jaune au plus, même au-delà de 3 fois) ; vert sinon. n.d. si
 * le CERT-FR est en panne (readAt null ou en retard), ou si une alerte de moins de 7 jours a un statut non lu et que rien ne colore déjà
 * en orange. Le 04/10 : orange (ALE-011, publiée le 28/09).
 */
export function cyberLevel(c: CyberResponse, now: number): LevelVerdict {
  if (c.certfr.readAt === null) return { level: 'nd', reason: 'CERT-FR indisponible' };
  if (isSovereigntyDataLate('certfr', c.certfr.readAt, now)) return { level: 'nd', reason: `non évalué · CERT-FR non relu depuis ${clockOf(c.certfr.readAt)}` };
  const isRecent = (a: CertFrItem): boolean => certfrPublishedAgeDays(a, now) < CERTFR_RECENT_DAYS;
  const open = c.certfr.alerts.filter(isCertFrAlertOpen).sort(byPublication);
  const recent = open.filter(isRecent);
  if (recent.length >= 2) {
    return { level: 'rouge', reason: `${recent.length} alertes CERT-FR en cours publiées depuis moins de 7\u00a0jours : ${recent.map((a) => a.ref).join(', ')}` };
  }
  if (recent.length === 1) {
    const a = recent[0];
    const exploitation = certfrExploitationText(a);
    return { level: 'orange', reason: `${a.ref} en cours, publiée le ${dayMonthOf(a.firstVersion)}${exploitation === null ? '' : ` : ${exploitation}`}` };
  }
  const unread = c.certfr.alerts.filter((a) => a.status === null && isRecent(a)).sort(byPublication);
  if (unread.length > 0) return { level: 'nd', reason: `non évalué · statut de ${unread[0].ref} non lu` };
  if (open.length === 1) return { level: 'jaune', reason: `${open[0].ref} en cours, publiée le ${dayMonthOf(open[0].firstVersion)}` };
  if (open.length > 1) {
    return {
      level: 'jaune',
      reason: `${open.length} alertes CERT-FR en cours, la plus récente publiée le ${dayMonthOf(open[0].firstVersion)} : ${open.map((a) => a.ref).join(', ')}`,
    };
  }
  const avis = c.certfr.avis.find((a) => certfrAgeDays(a, now) < CERTFR_RECENT_DAYS && a.kevCves.length > 0);
  if (avis) return { level: 'jaune', reason: `${avis.ref} : avis citant la vulnérabilité exploitée ${avis.kevCves[0]} (catalogue KEV de la CISA)` };
  const ratio = claimsRatio(c.ransomware);
  if (ratio !== null && ratio > CLAIMS_RATIO_JAUNE) {
    return { level: 'jaune', reason: `hausse des revendications, non confirmées : ${ratio.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} fois la moyenne` };
  }
  return { level: 'vert', reason: 'aucune alerte CERT-FR en cours ni vulnérabilité exploitée citée par un avis de moins de 7\u00a0jours' };
}
