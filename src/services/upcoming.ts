// src/services/upcoming.ts : échéances annoncées par les sources (26/10/2026). France Monitor ne prévoit rien : il reprend ce que les
// émetteurs publient eux-mêmes pour les jours à venir, attribué et daté, sans le transformer en prévision (finalité : aide à la
// décision, jamais un outil de prédiction). Trois sources aujourd'hui :
//   - Écowatt (RTE) : signal de J+1 à J+3 ;
//   - vigilance Météo-France : carte de J+1, par département ;
//   - prévisions Vigicrues : hausse annoncée sur un tronçon en vigilance (pic, date et fourchette publiés) ;
//   - rassemblements annoncés (couche Manifestations : Démosphère, carte des gilets jaunes) sur 7 jours, jamais confirmés.
// Une source qui n'annonce rien le dit aussi (« aucune alerte annoncée ») : une absence d'annonce est une information, à condition
// d'être attribuée ; une source non lue n'écrit rien (jamais un calme inventé).
import type { EcowattResponse, FloodsResponse, ProtestItem, VigilanceResponse } from '../types/index.ts';
import { readForecast } from './flood-forecast.ts';
import { PHENOMENON_WORD } from './environment-levels.ts';
import type { VigilanceLevel } from './vigilance.ts';
import { parisDay as sharedParisDay, PROTESTS_HORIZON_DAYS as SHARED_HORIZON, upcomingFromSources as sharedUpcoming } from '../../api/_shared/upcoming.js';

export interface UpcomingItem {
  /** Jour concerné, heure de Paris, « AAAA-MM-JJ ». */
  day: string;
  /** Niveau publié par la source ; null : annonce sans niveau (rassemblements). */
  level: VigilanceLevel | null;
  title: string;
  /** Détail éventuel (départements, villes). */
  detail: string | null;
  source: string;
}

export interface UpcomingInput {
  ecowatt: EcowattResponse | null;
  vigilance: VigilanceResponse | null;
  protests: readonly ProtestItem[] | null;
  /** Tronçons Vigicrues en vigilance et leurs stations (prévisions publiées) ; absent ou null : non lus. */
  floods?: FloodsResponse | null;
  now: number;
}

export const PROTESTS_HORIZON_DAYS: number = SHARED_HORIZON;

export function parisDay(ms: number): string {
  return sharedParisDay(ms);
}

/** Échéances des jours à venir, par jour puis par gravité publiée (implémentation partagée : api/_shared/upcoming.js). */
export function upcomingFromSources(input: UpcomingInput): UpcomingItem[] {
  return sharedUpcoming(input, { phenomenonWord: PHENOMENON_WORD, readForecast }) as UpcomingItem[];
}
