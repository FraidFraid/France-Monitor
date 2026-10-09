// src/services/outages-levels.ts : module pur des panneaux Pannes réseau (spec 2026-10-08 panneaux pannes § 1, § 2) : sources et
// retards (S2), seuils partagés avec la situation « Perturbation télécom », niveaux des panneaux. Aucun accès réseau ni DOM.
import type { CloudIncident, CloudOutagesResponse, CloudProvider, CloudStatus, CloudZone, EcowattSignal, InternetOutagesResponse, InternetScope, PowerOutagesResponse, RadarItem, TelecomOutagesResponse } from '../types/index.ts';
import { parisDayOf } from './environment-levels.ts';
import { fleetLevel } from './nuclear-fleet.ts';
import { parisHour } from './traffic-levels.ts';
import { LEVEL_RANK, type VigilanceLevel } from './vigilance.ts';

/** Sources des panneaux Pannes réseau (clé de retard et du panneau des sources). */
export type OutagesSource = 'arcep' | 'edf' | 'iip' | 'sei' | 'ioda' | 'radar' | 'cloud';

const MINUTE_MS = 60_000;

/** Retard (min) au-delà duquel la donnée d'une source est « en retard » ; ARCEP a sa règle propre (isArcepFileLate). */
export const OUTAGES_LATE_AFTER_MIN: Readonly<Record<OutagesSource, number>> = {
  arcep: 0, edf: 120, iip: 60, sei: 26 * 60, ioda: 60, radar: 60, cloud: 120,
};

/** Date absente ou illisible : en retard. */
export function isOutagesDataLate(source: OutagesSource, dataDate: string | null, now: number): boolean {
  if (dataDate === null) return true;
  const t = Date.parse(dataDate);
  if (!Number.isFinite(t)) return true;
  return t + OUTAGES_LATE_AFTER_MIN[source] * MINUTE_MS < now;
}

/** Jour de Paris précédent « AAAA-MM-JJ ». */
function previousDay(day: string): string {
  const t = Date.parse(`${day}T12:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Fichier ARCEP en retard : le fichier du jour (publié vers 11 h à Paris) manque encore après 15 h, ou le fichier servi est plus vieux
 * que la veille. Avant 15 h, le fichier de la veille est normal (spec § 1).
 */
export function isArcepFileLate(fileDay: string | null, now: number): boolean {
  if (fileDay === null) return true;
  const day = parisDayOf(now);
  if (fileDay === day) return false;
  if (fileDay === previousDay(day)) return parisHour(now) >= 15;
  return true;
}

/** Seuils de la situation « Perturbation télécom » (situation-engine.ts) et de la pastille Télécoms : une seule source. */
export const TELECOM_DISRUPTION_THRESHOLDS = {
  deptMedium: 20, deptHigh: 50, deptCritical: 100, nationalHigh: 300, nationalCritical: 600,
} as const;

/** Pastille Télécoms sur les pannes imprévues récentes ; null sans fichier lu. */
export function telecomLevel(r: Pick<TelecomOutagesResponse, 'summary' | 'byDept'>): VigilanceLevel | null {
  if (r.summary === null) return null;
  const t = TELECOM_DISRUPTION_THRESHOLDS;
  const top = Math.max(0, ...r.byDept.filter((d) => d.dept !== null).map((d) => d.recent));
  const national = r.summary.recent;
  if (top >= t.deptCritical || national >= t.nationalCritical) return 'rouge';
  if (top >= t.deptHigh || national >= t.nationalHigh) return 'orange';
  if (top >= t.deptMedium) return 'jaune';
  return 'vert';
}

/**
 * Fichier ARCEP à verser au score, aux situations, à l'indice de stabilité et au brief : null s'il est en retard (isArcepFileLate), car son
 * `summary.recent` se compte par rapport à sa publication et ne dit plus rien du moment. Même chemin « non évalué » que la source muette.
 */
export function telecomIfFresh<T extends Pick<TelecomOutagesResponse, 'file'>>(t: T | null, now: number): T | null {
  return t !== null && t.file !== null && isArcepFileLate(t.file.day, now) ? null : t;
}

/** MW de production perdus en arrêts imprévus en cours (gros chiffre Électricité). */
export function powerUnplannedMw(r: Pick<PowerOutagesResponse, 'unplanned'>): number {
  return Math.round(r.unplanned.reduce((sum, u) => sum + u.lostMw, 0));
}

const ECOWATT_LEVEL: Readonly<Record<EcowattSignal, VigilanceLevel>> = { green: 'vert', orange: 'orange', red: 'rouge' };

/** Pastille Électricité : paliers du parc nucléaire (fleetLevel) sur les arrêts imprévus, relevée par Écowatt s'il est plus grave. */
export function powerLevel(r: Pick<PowerOutagesResponse, 'unplanned'>, ecowatt: EcowattSignal | null): VigilanceLevel {
  const own = fleetLevel(powerUnplannedMw(r));
  const signal = ecowatt === null ? 'vert' : ECOWATT_LEVEL[ecowatt];
  return LEVEL_RANK[signal] > LEVEL_RANK[own] ? signal : own;
}

/** Lieu touché en ce moment (un seul par lieu, quel que soit le nombre de signaux ou de sources qui le disent). */
export interface InternetLivePlace {
  /** Clé de dédoublonnage : « national », « dept:23 », « asn:3215 », « radar:<id> » (panne Radar localisée sans réseau). */
  key: string;
  scope: InternetScope;
  label: string;
  dept: string | null;
  asn: number | null;
  /** Source qui a fait entrer le lieu ; IODA prime quand les deux le disent. */
  source: 'ioda' | 'radar';
  /** Nature de l'élément Radar qui a fait entrer le lieu (anomalie de trafic ou panne annotée), null pour IODA. */
  radarKind: RadarItem['kind'] | null;
}

/** Élément Radar en cours : national par sa portée structurée (`national`), jamais par son libellé ni par un texte affiché (P29). */
export function radarPlace(item: RadarItem): InternetLivePlace {
  const base = { label: item.label, dept: null, source: 'radar' as const, radarKind: item.kind };
  if (item.national) return { ...base, key: 'national', scope: 'national', asn: null };
  if (item.asn !== null) return { ...base, key: `asn:${item.asn}`, scope: 'operateur', asn: item.asn };
  return { ...base, key: `radar:${item.id}`, scope: 'inconnu', asn: null };
}

/**
 * Niveau d'un lieu en cours : rouge pour le pays entier, sauf une anomalie de trafic Cloudflare Radar, jamais plus qu'orange (spec § 3.1 ;
 * seule une panne annotée NATIONWIDE de la France seule est rouge, R40) ; orange pour un opérateur ou un lieu non localisé ; jaune pour
 * un département. Pastille et lignes du panneau lisent cette seule règle.
 */
export function internetPlaceLevel(p: InternetLivePlace): VigilanceLevel {
  if (p.scope === 'national') return p.radarKind === 'anomalie' ? 'orange' : 'rouge';
  return p.scope === 'departement' ? 'jaune' : 'orange';
}

/**
 * Lieux en cours, dédoublonnés (P13) : IODA publie un événement par source de signal (bgp, ping-slash24, merit-nt…) et une même panne
 * d'opérateur peut figurer chez IODA et chez Radar. Écartés : événements terminés, « ouverts depuis plus de 7 jours » (probables
 * recalages), régions IODA sans département, et tout Radar en retard ou jamais lu (P14). Gros chiffre et pastille Internet lisent cette liste.
 */
export function internetLive(r: InternetOutagesResponse, now: number): InternetLivePlace[] {
  const places = new Map<string, InternetLivePlace>();
  for (const e of r.events) {
    if (!e.ongoing || e.staleOpen) continue;
    const ioda = { label: e.label, source: 'ioda' as const, radarKind: null };
    if (e.scope === 'national') places.set('national', { ...ioda, key: 'national', scope: 'national', dept: null, asn: null });
    else if (e.scope === 'departement' && e.dept !== null) places.set(`dept:${e.dept}`, { ...ioda, key: `dept:${e.dept}`, scope: 'departement', dept: e.dept, asn: null });
    else if (e.scope === 'operateur' && e.asn !== null) places.set(`asn:${e.asn}`, { ...ioda, key: `asn:${e.asn}`, scope: 'operateur', dept: null, asn: e.asn });
  }
  if (!isOutagesDataLate('radar', r.radar.readAt, now)) {
    for (const item of r.radar.items) {
      if (item.end !== null) continue;
      const place = radarPlace(item);
      const kept = places.get(place.key);
      // Même lieu : IODA reste prioritaire ; entre deux éléments Radar, le plus grave (une panne remplace une anomalie), quel que soit
      // l'ordre des éléments (le serveur les trie du plus récent au plus ancien).
      if (!kept || (kept.source === 'radar' && kept.radarKind === 'anomalie' && place.radarKind === 'panne')) places.set(place.key, place);
    }
  }
  return [...places.values()];
}

/**
 * Pastille Internet sur les lieux en cours (internetLive) : rouge si le pays entier (jamais pour une anomalie de trafic Radar :
 * internetPlaceLevel), orange pour un opérateur, un élément Radar ou trois départements, jaune pour un ou deux départements, vert sinon ;
 * null sans lecture IODA réussie ou si elle est en retard (jamais « vert » ni une couleur d'événements figés sur une source muette).
 */
export function internetLevel(r: InternetOutagesResponse, now: number): VigilanceLevel | null {
  if (isOutagesDataLate('ioda', r.iodaReadAt, now)) return null;
  const live = internetLive(r, now);
  if (live.some((p) => internetPlaceLevel(p) === 'rouge')) return 'rouge';
  const depts = live.filter((p) => p.scope === 'departement').length;
  if (live.some((p) => internetPlaceLevel(p) === 'orange' || p.source === 'radar') || depts >= 3) return 'orange';
  return depts > 0 ? 'jaune' : 'vert';
}

/** Noms des sept fournisseurs (même table que le collecteur, api/_lib/outages-cloud.js : le client n'importe pas api/). */
export const CLOUD_PROVIDER_LABEL: Readonly<Record<CloudProvider, string>> = {
  ovhcloud: 'OVHcloud', scaleway: 'Scaleway', cloudflare: 'Cloudflare', gcp: 'Google Cloud', aws: 'AWS', outscale: 'Outscale', azure: 'Azure',
};
/** Statut d'une zone en mots (le statut d'une zone est celui de son fournisseur, jamais un statut mondial) : carte et panneau disent pareil. */
export const CLOUD_STATUS_WORD: Readonly<Record<CloudStatus, string>> = {
  operational: 'opérationnel', maintenance: 'maintenance', degraded: 'performances dégradées', partial: 'panne partielle', major: 'panne majeure', unknown: 'inconnu',
};
/** Fournisseurs dont la zone « opérationnelle » est déduite de l'absence d'incident publié : ils ne publient aucun état par région (P4, P5, P30). */
const CLOUD_DEDUCED_PROVIDERS: ReadonlySet<CloudProvider> = new Set(['gcp', 'aws']);
/** Texte d'une zone déduite : jamais « opérationnel » (rien n'est publié), ni daté. */
export const CLOUD_NO_INCIDENT_TEXT = 'aucun incident publié';
/** Zone dont le « opérationnel » n'est qu'une absence d'incident (GCP, AWS : aucune date d'état) : sans état publié, elle n'est pas colorée comme un état. */
export function isDeducedZone(provider: CloudProvider, zone: Pick<CloudZone, 'status' | 'updatedAt'>): boolean {
  return zone.status === 'operational' && zone.updatedAt === null && CLOUD_DEDUCED_PROVIDERS.has(provider);
}
/** Mots des sources de signal d'IODA ; une source inconnue est dite par son nom brut. */
export function internetSignalWord(signal: string): string {
  const words: Readonly<Record<string, string>> = { bgp: 'signal BGP', 'ping-slash24': 'sonde ping', 'merit-nt': 'télescope réseau', gtr: 'trafic Google' };
  return words[signal] ?? signal;
}
/** Niveau d'un incident en cours selon son impact (pastille et puces de la vue Cloud). */
export const CLOUD_IMPACT_LEVEL: Readonly<Record<CloudIncident['impact'], VigilanceLevel>> = { none: 'jaune', minor: 'jaune', major: 'orange', critical: 'rouge' };
/** Niveau d'une zone selon son statut ; opérationnel, maintenance et inconnu n'ont pas de niveau d'alerte. */
export const CLOUD_ZONE_LEVEL: Partial<Readonly<Record<CloudStatus, VigilanceLevel>>> = { degraded: 'jaune', partial: 'orange', major: 'rouge' };

/** Ce que le panneau Cloud peut dire du moment : incidents en cours et zones des seuls fournisseurs à jour. */
export interface CloudLive {
  /** Fournisseurs dont la dernière lecture réussie date de moins de 2 h (spec § 1) ; les autres sont « en retard » et sans couleur. */
  freshProviders: CloudProvider[];
  /** Incidents « en cours » touchant la France (pas « surveillé », pas « ailleurs »), d'un fournisseur à jour. */
  incidents: CloudIncident[];
  zones: CloudZone[];
}

/**
 * Lecture du moment, fournisseur par fournisseur (P8, P14) : les pages en échec gardent leurs dernières données sans limite de durée
 * côté serveur ; passé lecture + 2 h, leurs zones et leurs incidents ne colorent plus et ne se comptent plus. Le gros chiffre Cloud
 * (incidents.length) et la pastille lisent cette liste.
 */
export function cloudLive(r: CloudOutagesResponse, now: number): CloudLive {
  const fresh = r.providers.filter((p) => !isOutagesDataLate('cloud', p.readAt, now));
  const freshProviders = fresh.map((p) => p.provider);
  return {
    freshProviders,
    incidents: r.incidents.filter((i) => i.state === 'en-cours' && freshProviders.includes(i.provider)),
    zones: fresh.flatMap((p) => p.zones),
  };
}

/**
 * Pastille Cloud sur cloudLive : incidents en cours (impact) et zones françaises (statut) ; maintenance et « surveillé » ne colorent pas,
 * pas plus que les incidents « ailleurs » (statut mondial, P2). null si aucun fournisseur n'est à jour (jamais lu ou tous en retard :
 * jamais « vert » sur une source muette).
 */
export function cloudLevel(r: CloudOutagesResponse, now: number): VigilanceLevel | null {
  const live = cloudLive(r, now);
  if (live.freshProviders.length === 0) return null;
  const levels: VigilanceLevel[] = [
    ...live.incidents.map((i) => CLOUD_IMPACT_LEVEL[i.impact]),
    ...live.zones.map((z) => CLOUD_ZONE_LEVEL[z.status]).filter((l): l is VigilanceLevel => l !== undefined),
  ];
  return levels.reduce<VigilanceLevel>((max, l) => (LEVEL_RANK[l] > LEVEL_RANK[max] ? l : max), 'vert');
}
