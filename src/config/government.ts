/**
 * government.ts — Métadonnées et fallback du gouvernement français.
 * Source de secours : décret JORF du 12 octobre 2025 (composition du Gouvernement)
 * + données officielles Élysée / Service-Public.
 * La composition live est résolue dynamiquement dans src/services/ministers.ts.
 * Dernier contrôle : 2026-03-25
 */

import type { EventCategory } from '../types/index.ts';
import { GOUVERNEMENT_DATA } from './government-data.js';

export interface Minister {
  id: string;                    // Slug unique stable
  prenom: string;
  nom: string;
  titre: string;                 // Titre officiel complet
  titreShort: string;            // Libellé court pour les badges
  isPresident?: boolean;         // true pour le Président de la République
  isPM?: boolean;                // true pour le Premier Ministre
  photoUrl?: string;             // Photo officielle france.gouv.fr ou Wikidata
  wikidataId?: string;           // Q-code pour enrichissement async
  parti?: string;
  nuanceCode?: string;           // Code nuance RNE (cohérence avec PARTY_COLORS)
  dateNomination?: string;       // ISO date
  emailCabinet?: string;         // Contact cabinet (public)
  siteMinistere?: string;        // URL du ministère
  servicePublicUrl?: string;     // Fiche officielle annuaire Service-Public
  appointmentUrl?: string;       // Nomination / référence JORF
  appointmentLabel?: string;     // Libellé de la nomination (ex: 'Décret de nomination')
  officePhone?: string;          // Téléphone standard officiel
  officeEmail?: string;          // Email officiel direct si disponible
  agendaUrl?: string;            // Page agenda officielle si connue
  rssUrl?: string;               // RSS communiqués/agenda officiel
  twitter?: string;              // Handle sans @
  sourceLabel?: string;          // Ex: JORF, Élysée, Service-Public
  sourceUrl?: string;            // Source officielle primaire
  sourceUpdatedAt?: string;      // ISO date
  verificationStatus?: 'official-live' | 'official-directory' | 'official-static' | 'fallback-static';
  sourceKind?: 'official' | 'fallback' | 'enrichment';
  identityConfidence?: 'high' | 'medium' | 'low';
  sourceChain?: Array<{ label: string; url?: string; kind?: 'official' | 'fallback' | 'enrichment'; updatedAt?: string }>;
  openDataLinks?: Array<{ label: string; url: string; source?: string }>;
  categories: EventCategory[];   // Catégories d'événements liées
  portefeuilles: string[];       // Mots-clés domaines
}

export const GOUVERNEMENT = GOUVERNEMENT_DATA as unknown as Minister[];

// ─── Mapping rapide catégorie → ministres ─────────────────────────────────────

export function getMinistersForCategories(categories: EventCategory[]): Minister[] {
  if (categories.length === 0) return [...GOUVERNEMENT];
  const seen = new Set<string>();
  const result: Minister[] = [];
  // Président puis PM toujours en premier
  const president = getPresident();
  if (president) { seen.add(president.id); result.push(president); }
  const pm = getPM();
  if (pm) { seen.add(pm.id); result.push(pm); }
  for (const cat of categories) {
    for (const minister of GOUVERNEMENT) {
      if (minister.isPM || minister.isPresident) continue;
      if (!seen.has(minister.id) && minister.categories.includes(cat)) {
        seen.add(minister.id);
        result.push(minister);
      }
    }
  }
  return result;
}

export function getPresident(): Minister {
  return GOUVERNEMENT.find(m => m.isPresident)!;
}

export function getPM(): Minister {
  return GOUVERNEMENT.find(m => m.isPM)!;
}

export function getMinisterById(id: string): Minister | undefined {
  return GOUVERNEMENT.find(m => m.id === id);
}
