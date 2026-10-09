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
}

/** Élément Radar en cours : national par sa portée structurée (`national`), jamais par son libellé ni par un texte affiché (P29). */
export function radarPlace(item: RadarItem): InternetLivePlace {
  if (item.national) return { key: 'national', scope: 'national', label: item.label, dept: null, asn: null, source: 'radar' };
  if (item.asn !== null) return { key: `asn:${item.asn}`, scope: 'operateur', label: item.label, dept: null, asn: item.asn, source: 'radar' };
  return { key: `radar:${item.id}`, scope: 'inconnu', label: item.label, dept: null, asn: null, source: 'radar' };
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
    if (e.scope === 'national') places.set('national', { key: 'national', scope: 'national', label: e.label, dept: null, asn: null, source: 'ioda' });
    else if (e.scope === 'departement' && e.dept !== null) places.set(`dept:${e.dept}`, { key: `dept:${e.dept}`, scope: 'departement', label: e.label, dept: e.dept, asn: null, source: 'ioda' });
    else if (e.scope === 'operateur' && e.asn !== null) places.set(`asn:${e.asn}`, { key: `asn:${e.asn}`, scope: 'operateur', label: e.label, dept: null, asn: e.asn, source: 'ioda' });
  }
  if (!isOutagesDataLate('radar', r.radar.readAt, now)) {
    for (const item of r.radar.items) {
      if (item.end !== null) continue;
      const place = radarPlace(item);
      if (!places.has(place.key)) places.set(place.key, place);
    }
  }
  return [...places.values()];
}

/**
 * Pastille Internet sur les lieux en cours (internetLive) : rouge si le pays entier, orange pour un opérateur, une panne Radar ou
 * trois départements, jaune pour un ou deux départements, vert sinon ; null sans lecture IODA réussie ou si elle est en retard
 * (jamais « vert » ni une couleur d'événements figés sur une source muette).
 */
export function internetLevel(r: InternetOutagesResponse, now: number): VigilanceLevel | null {
  if (isOutagesDataLate('ioda', r.iodaReadAt, now)) return null;
  const live = internetLive(r, now);
  if (live.some((p) => p.scope === 'national')) return 'rouge';
  const depts = live.filter((p) => p.scope === 'departement').length;
  if (live.some((p) => p.scope === 'operateur' || p.source === 'radar') || depts >= 3) return 'orange';
  return depts > 0 ? 'jaune' : 'vert';
}

/** Noms des sept fournisseurs (même table que le collecteur, api/_lib/outages-cloud.js : le client n'importe pas api/). */
export const CLOUD_PROVIDER_LABEL: Readonly<Record<CloudProvider, string>> = {
  ovhcloud: 'OVHcloud', scaleway: 'Scaleway', cloudflare: 'Cloudflare', gcp: 'Google Cloud', aws: 'AWS', outscale: 'Outscale', azure: 'Azure',
};
const IMPACT_LEVEL: Readonly<Record<CloudIncident['impact'], VigilanceLevel>> = { none: 'jaune', minor: 'jaune', major: 'orange', critical: 'rouge' };
const ZONE_LEVEL: Partial<Readonly<Record<CloudStatus, VigilanceLevel>>> = { degraded: 'jaune', partial: 'orange', major: 'rouge' };

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
    ...live.incidents.map((i) => IMPACT_LEVEL[i.impact]),
    ...live.zones.map((z) => ZONE_LEVEL[z.status]).filter((l): l is VigilanceLevel => l !== undefined),
  ];
  return levels.reduce<VigilanceLevel>((max, l) => (LEVEL_RANK[l] > LEVEL_RANK[max] ? l : max), 'vert');
}
