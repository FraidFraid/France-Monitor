// src/config/health-sources.ts : sources santé du panneau des sources (spec 2026-10-03 S1). Hors Watchdog : datées par la
// donnée (semaine, millésime), jamais par l'heure de lecture ni passées « en cache figé » au bout de 10 min. Une seule liste
// pour App.ts (panneau des sources, note de situation, historique de qualité) et le tableau de qualité des sources.
import type { DataSourceStatus, WatchdogSnapshot } from '../types/index.ts';
import type { HealthSurveillanceKey } from '../services/health-surveillance.ts';

/** Adresses officielles des sources Santé : une seule liste pour les panneaux, la carte et le panneau des sources. */
export const HEALTH_SOURCE_URL = {
  odisse: 'https://odisse.santepubliquefrance.fr',
  sumeau: 'https://odisse.santepubliquefrance.fr/explore/dataset/sum-eau-indicateurs/',
  sentinelles: 'https://www.sentiweb.fr',
  oms: 'https://www.who.int/emergencies/disease-outbreak-news',
  ecdc: 'https://www.ecdc.europa.eu/en/threats-and-outbreaks/reports-and-data/weekly-threats',
  ansm: 'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments',
  rappelconso: 'https://rappel.conso.gouv.fr',
  apl: 'https://data.drees.solidarites-sante.gouv.fr/explore/dataset/530_l-accessibilite-potentielle-localisee-apl/',
  sae: 'https://data.drees.solidarites-sante.gouv.fr/explore/dataset/707_bases-administratives-sae/',
  finess: 'https://www.data.gouv.fr/fr/datasets/finess-extraction-du-fichier-des-etablissements/',
} as const;

/** Veille sanitaire : source et nom dans le panneau des sources. */
export const HEALTH_STATUS_SOURCES: ReadonlyArray<readonly [HealthSurveillanceKey, string]> = [
  ['syndromic', 'Santé publique France'], ['alerts', 'Odissé alertes'], ['sentinelles', 'Sentinelles'], ['wastewater', 'SUM’eau'],
  // DGS-Urgent retiré du compte des sources (03/11/2026) : le portail PEPS ne répond plus et la page officielle est derrière une
  // vérification anti-robot ; le panneau Veille sanitaire n'en garde qu'un lien vers la page officielle.
  ['international', 'OMS / ECDC'], ['drugs', 'ANSM Médicaments'], ['recalls', 'RappelConso'],
];

/** Offre de soins (fichiers annuels) : source et nom dans le panneau des sources. */
export const HEALTH_OFFER_SOURCES: ReadonlyArray<readonly ['apl' | 'hospitals', string]> = [['apl', 'DREES APL'], ['hospitals', 'DREES SAE / FINESS']];

/**
 * Provenance et lien de chaque ligne santé du panneau des sources (retour d'un médecin, 05/11/2026 : citer les sources).
 * Clé : nom affiché dans le panneau ; le lien mène au jeu de données ou à la page officielle.
 */
const HEALTH_SOURCE_DETAILS: Readonly<Record<string, { detail: string; link: string }>> = {
  'Santé publique France': { detail: 'Odissé : urgences et SOS Médecins, hebdomadaire', link: HEALTH_SOURCE_URL.odisse },
  'Odissé alertes': { detail: 'Santé publique France : alertes épidémiques régionales', link: HEALTH_SOURCE_URL.odisse },
  Sentinelles: { detail: 'Réseau Sentinelles (Inserm, Sorbonne Université)', link: HEALTH_SOURCE_URL.sentinelles },
  'SUM’eau': { detail: 'Santé publique France : surveillance des eaux usées', link: HEALTH_SOURCE_URL.sumeau },
  'OMS / ECDC': { detail: 'OMS (épidémies) et ECDC (menaces hebdomadaires)', link: HEALTH_SOURCE_URL.oms },
  'ANSM Médicaments': { detail: 'ANSM : disponibilité des médicaments', link: HEALTH_SOURCE_URL.ansm },
  RappelConso: { detail: 'RappelConso : rappels de produits', link: HEALTH_SOURCE_URL.rappelconso },
  'DREES APL': { detail: 'DREES : accessibilité potentielle localisée, annuelle', link: HEALTH_SOURCE_URL.apl },
  'DREES SAE / FINESS': { detail: 'DREES, SAE (lits, passages) et FINESS (sites)', link: HEALTH_SOURCE_URL.sae },
};

/** Détail et lien d'une ligne santé du panneau des sources ; null hors santé. */
export function healthSourceDetail(name: string): { detail: string; link: string } | null {
  return HEALTH_SOURCE_DETAILS[name] ?? null;
}

/** Sources des quatre entrées du niveau national de santé (fiche thème Santé de la v2, spec 2026-10-03 § 3.5). */
export const HEALTH_NATIONAL_KEYS: readonly HealthSurveillanceKey[] = ['syndromic', 'alerts', 'sentinelles', 'wastewater'];

/** Les neuf sources santé suivies, dans l'ordre du panneau. */
export const HEALTH_SOURCE_NAMES: readonly string[] = [...HEALTH_STATUS_SOURCES, ...HEALTH_OFFER_SOURCES].map(([, name]) => name);

/** Lignes santé de la note de situation : statuts du panneau des sources (période comprise), identifiés « health:<source> ». */
export function healthReportSources(statuses: readonly DataSourceStatus[]): WatchdogSnapshot[] {
  return [...HEALTH_STATUS_SOURCES, ...HEALTH_OFFER_SOURCES].flatMap(([key, name]) => {
    const status = statuses.find((s) => s.name === name);
    return status ? [{ sourceId: `health:${key}`, status }] : [];
  });
}
