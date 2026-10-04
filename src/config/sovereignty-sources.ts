// src/config/sovereignty-sources.ts : couches et sources Souveraineté du panneau des sources, hors Watchdog (spec 2026-10-04
// souveraineté S1 ; contrats § 3.4 ; amendement 7, S11) : chaque ligne est datée par sa donnée, jamais par l'heure de lecture, et
// nomme sa source avec un lien (attributions affichées). Une seule liste pour App.ts (panneau des sources, note de situation,
// historique de qualité, relèves). La saisie Vigipirate n'est pas une source lue : pas de ligne ; la relecture quotidienne de la page
// du SGDSN par le serveur (O14) en a une, « Vigipirate (page du SGDSN) », datée par cette lecture (arbitrage du contrôleur, A15).
import type { DataSourceStatus, WatchdogSnapshot } from '../types/index.ts';
import { MILITARY_FIGURE_LABEL, type SovereigntySource } from '../services/sovereignty-levels.ts';

/** Couches Souveraineté, un panneau chacune ; clés gardées (subseaCables est libellée « Connectivité »). */
export type SovereigntyLayerKey = 'military' | 'subseaCables' | 'cyber';
/** Ordre du tiroir et des panneaux. */
export const SOVEREIGNTY_LAYER_KEYS: readonly SovereigntyLayerKey[] = ['military', 'subseaCables', 'cyber'];

/** Dérive le maître `sovereignty` : vrai si une couche Souveraineté est active. */
export function hasActiveSovereignty(layers: Partial<Record<SovereigntyLayerKey, boolean>>): boolean {
  return SOVEREIGNTY_LAYER_KEYS.some((key) => layers[key] === true);
}

/** Clé de la source (retards S2) et nom dans le panneau des sources (hors Watchdog, datés par la donnée). */
export const SOVEREIGNTY_STATUS_SOURCES = [
  ['adsb-mil', 'Vols militaires'], ['vigipirate', 'Vigipirate (page du SGDSN)'], ['ais-cables', 'Câbles et AIS'], ['certfr', 'CERT-FR'],
  ['kev', 'CISA KEV'], ['ransomware', 'Ransomware.live'], ['hibp', 'Have I Been Pwned'], ['cybermalveillance', 'Cybermalveillance.gouv.fr'],
  // phase B : ['adsb-gnss', 'Grille GNSS'], ['noaa', 'NOAA SWPC'], ['ripestat', 'RIPEstat'], ['gels', 'Registre des gels'],
] as const satisfies ReadonlyArray<readonly [SovereigntySource, string]>;

/** Nom d'une ligne Souveraineté du panneau des sources : un nom mal écrit ne compile pas. */
export type SovereigntySourceName = (typeof SOVEREIGNTY_STATUS_SOURCES)[number][1];

/** Noms des lignes, en `string` pour les comparer aux noms du panneau des sources (`names.includes(s.name)`). */
export const SOVEREIGNTY_SOURCE_NAMES: readonly string[] = SOVEREIGNTY_STATUS_SOURCES.map(([, name]) => name);

/**
 * Détail de chaque ligne (`DataSourceStatus.detail`) et lien vers la source (attributions de la spec) : la source, sa licence ou ses
 * conditions, et ce que la ligne date. Ransomware.live : source nommée, lien vers ses conditions d'utilisation (non commercial,
 * attribution obligatoire, aucun nom de victime repris).
 */
export const SOVEREIGNTY_SOURCE_DETAILS: Readonly<Record<SovereigntySourceName, { detail: string; link: string }>> = {
  // O9 : même libellé que le gros chiffre du panneau Défense, sa légende et sa tuile.
  'Vols militaires': { detail: `Données adsb.lol, ODbL 1.0 · ${MILITARY_FIGURE_LABEL}, relevé du serveur`, link: 'https://www.adsb.lol' },
  'Vigipirate (page du SGDSN)': {
    detail: 'SGDSN, page Vigipirate relue chaque jour par le serveur (empreinte du texte, sans le reprendre)', link: 'https://www.sgdsn.gouv.fr/vigipirate',
  },
  'Câbles et AIS': {
    detail: 'Relais AIS du serveur · câbles Shom (CC BY-SA) et OpenStreetMap (ODbL 1.0)',
    link: 'https://www.data.gouv.fr/datasets/conduites-et-cables-sous-marins-repertories-par-le-shom/',
  },
  'CERT-FR': { detail: 'ANSSI, alertes et avis · Licence ouverte 2.0', link: 'https://www.cert.ssi.gouv.fr' },
  'CISA KEV': { detail: 'CISA, vulnérabilités exploitées · domaine public', link: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog' },
  'Ransomware.live': { detail: 'Source : Ransomware.live · revendications non confirmées, conditions d’utilisation', link: 'https://www.ransomware.live/t&c' },
  'Have I Been Pwned': { detail: 'Have I Been Pwned, CC BY 4.0 · fuites publiées en .fr', link: 'https://haveibeenpwned.com/PwnedWebsites' },
  'Cybermalveillance.gouv.fr': { detail: 'Cybermalveillance.gouv.fr, alertes et actualités', link: 'https://www.cybermalveillance.gouv.fr' },
};

/** Détail et lien d'une ligne du panneau des sources, null hors Souveraineté (StatusPanel rend le lien, texte échappé). */
export function sovereigntySourceDetail(name: string): { detail: string; link: string } | null {
  const found = SOVEREIGNTY_STATUS_SOURCES.find(([, n]) => n === name);
  return found ? SOVEREIGNTY_SOURCE_DETAILS[found[1]] : null;
}

/** Lignes mises en erreur si le service d'une couche ne se charge pas. */
export const SOVEREIGNTY_LAYER_SOURCES: Readonly<Record<SovereigntyLayerKey, readonly SovereigntySourceName[]>> = {
  military: ['Vols militaires', 'Vigipirate (page du SGDSN)'],
  subseaCables: ['Câbles et AIS'],
  cyber: ['CERT-FR', 'CISA KEV', 'Ransomware.live', 'Have I Been Pwned', 'Cybermalveillance.gouv.fr'],
};

/** Lignes Souveraineté de la note de situation : statuts du panneau des sources (période comprise), identifiés « sovereignty:<clé> ». */
export function sovereigntyReportSources(statuses: readonly DataSourceStatus[]): WatchdogSnapshot[] {
  return SOVEREIGNTY_STATUS_SOURCES.flatMap(([key, name]) => {
    const status = statuses.find((s) => s.name === name);
    return status ? [{ sourceId: `sovereignty:${key}`, status }] : [];
  });
}

/** Relève (ms) : military 2 min, subseaCables 5 min, cyber 15 min (cadences des collectes du serveur). */
export const SOVEREIGNTY_POLL_MS: Readonly<Record<SovereigntyLayerKey, number>> = {
  military: 2 * 60_000, subseaCables: 5 * 60_000, cyber: 15 * 60_000,
};

/** Les trois nourrissent le score : lues au démarrage et relevées sans arrêt (arbitrage 21). */
export const SOVEREIGNTY_ALWAYS_POLLED: ReadonlySet<SovereigntyLayerKey> = new Set<SovereigntyLayerKey>(['military', 'subseaCables', 'cyber']);
