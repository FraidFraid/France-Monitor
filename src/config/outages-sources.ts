// src/config/outages-sources.ts : couches et sources Pannes réseau du panneau des sources, hors Watchdog (spec 2026-10-08 panneaux pannes
// § 4) : chaque ligne est datée par sa donnée et nomme sa source avec un lien. Une seule liste pour App.ts (panneau des sources, relèves).
import type { OutagesSource } from '../services/outages-levels.ts';

/** Couches Pannes réseau, un panneau chacune. */
export type OutagesLayerKey = 'outagesElec' | 'outagesTelecom' | 'outagesInternet' | 'outagesCloud';
export const OUTAGES_LAYER_KEYS: readonly OutagesLayerKey[] = ['outagesElec', 'outagesTelecom', 'outagesInternet', 'outagesCloud'];

/** Maître `outages` : vrai si une couche Pannes réseau est active. */
export function hasActiveOutages(layers: Partial<Record<OutagesLayerKey, boolean>>): boolean {
  return OUTAGES_LAYER_KEYS.some((key) => layers[key] === true);
}

/** Relève du navigateur, couche active ou panneau ouvert (spec § 4). */
export const OUTAGES_POLL_MS: Readonly<Record<OutagesLayerKey, number>> = {
  outagesElec: 10 * 60_000, outagesTelecom: 30 * 60_000, outagesInternet: 10 * 60_000, outagesCloud: 30 * 60_000,
};

/** Télécoms nourrit le score France : lu au démarrage et relevé toutes les 30 min même couche éteinte (R16, servi par le cache serveur). */
export const OUTAGES_ALWAYS_POLLED: ReadonlySet<OutagesLayerKey> = new Set<OutagesLayerKey>(['outagesTelecom']);

export const OUTAGES_STATUS_SOURCES = [
  ['arcep', 'ARCEP sites mobiles'], ['edf', 'EDF indisponibilités'], ['iip', 'RTE IIP'], ['sei', 'EDF SEI (îles)'],
] as const satisfies ReadonlyArray<readonly [OutagesSource, string]>;

export type OutagesSourceName = (typeof OUTAGES_STATUS_SOURCES)[number][1];
export const OUTAGES_SOURCE_NAMES: readonly string[] = OUTAGES_STATUS_SOURCES.map(([, name]) => name);

export const OUTAGES_SOURCE_DETAILS: Readonly<Record<OutagesSourceName, { detail: string; link: string }>> = {
  'ARCEP sites mobiles': {
    detail: 'ARCEP, sites mobiles indisponibles déclarés par les opérateurs, fichier quotidien · Licence Ouverte',
    link: 'https://www.data.gouv.fr/datasets/5f7c7fae9cd6c79b58da3e20/',
  },
  'EDF indisponibilités': {
    detail: 'EDF OpenData, indisponibilités des moyens de production (France métropolitaine, unités belges écartées) · Licence Ouverte 2.0',
    link: 'https://opendata.edf.fr/datasets/indisponibilites-des-moyens-de-production-edf-sa',
  },
  'RTE IIP': { detail: 'RTE, plateforme de transparence IIP, messages REMIT de production et de transport, date de publication', link: 'https://iip.cloud-rte-france.com' },
  'EDF SEI (îles)': { detail: 'EDF SEI, météo de l’électricité de La Réunion et eCorsicaWatt, signal horaire · Licence Ouverte 2.0', link: 'https://opendata.edf.fr' },
};

export function outagesSourceDetail(name: string): { detail: string; link: string } | null {
  const found = OUTAGES_STATUS_SOURCES.find(([, n]) => n === name);
  return found ? OUTAGES_SOURCE_DETAILS[found[1]] : null;
}

/** Lignes mises en erreur si le service d'une couche ne se charge pas (B5 complète Internet et Cloud). */
export const OUTAGES_LAYER_SOURCES: Readonly<Record<OutagesLayerKey, readonly OutagesSourceName[]>> = {
  outagesElec: ['EDF indisponibilités', 'RTE IIP', 'EDF SEI (îles)'],
  outagesTelecom: ['ARCEP sites mobiles'],
  outagesInternet: [],
  outagesCloud: [],
};
