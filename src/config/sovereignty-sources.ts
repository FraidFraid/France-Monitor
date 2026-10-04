// src/config/sovereignty-sources.ts : couches et sources Souveraineté du panneau des sources, hors Watchdog (spec 2026-10-04
// souveraineté S1 ; contrats § 3.4 ; amendement 7, S11) : chaque ligne est datée par sa donnée, jamais par l'heure de lecture, et
// nomme sa source avec un lien (attributions affichées). Une seule liste pour App.ts (panneau des sources, note de situation,
// historique de qualité, relèves). La saisie Vigipirate n'est pas une source lue : pas de ligne.
import type { DataSourceStatus, WatchdogSnapshot } from '../types/index.ts';
import type { SovereigntySource } from '../services/sovereignty-levels.ts';

/** Couches Souveraineté, un panneau chacune ; clés gardées (subseaCables est libellée « Connectivité »). */
export type SovereigntyLayerKey = 'military' | 'subseaCables' | 'cyber';
/** Ordre du tiroir et des panneaux. */
export const SOVEREIGNTY_LAYER_KEYS: readonly SovereigntyLayerKey[] = ['military', 'subseaCables', 'cyber'];

/** Dérive le maître `sovereignty` : vrai si une couche Souveraineté est active. */
export function hasActiveSovereignty(layers: Partial<Record<SovereigntyLayerKey, boolean>>): boolean {
  return SOVEREIGNTY_LAYER_KEYS.some((key) => layers[key] === true);
}

/** Clé de la source (retards S2) et nom dans le panneau des sources (hors Watchdog, datés par la donnée). */
export const SOVEREIGNTY_STATUS_SOURCES: ReadonlyArray<readonly [SovereigntySource, string]> = [
  ['adsb-mil', 'Vols militaires'], ['ais-cables', 'Câbles et AIS'], ['certfr', 'CERT-FR'], ['kev', 'CISA KEV'],
  ['ransomware', 'Ransomware.live'], ['hibp', 'Have I Been Pwned'], ['cybermalveillance', 'Cybermalveillance.gouv.fr'],
  // phase B : ['adsb-gnss', 'Grille GNSS'], ['noaa', 'NOAA SWPC'], ['ripestat', 'RIPEstat'], ['gels', 'Registre des gels'],
];

export const SOVEREIGNTY_SOURCE_NAMES: readonly string[] = SOVEREIGNTY_STATUS_SOURCES.map(([, name]) => name);

/**
 * Détail de chaque ligne (`DataSourceStatus.detail`) et lien vers la source (attributions de la spec) : la source, sa licence ou ses
 * conditions, et ce que la ligne date. Ransomware.live : source nommée, lien vers ses conditions d'utilisation (non commercial,
 * attribution obligatoire, aucun nom de victime repris).
 */
export const SOVEREIGNTY_SOURCE_DETAILS: Readonly<Record<string, { detail: string; link: string }>> = {
  'Vols militaires': { detail: 'Données adsb.lol, ODbL 1.0 · relevé du serveur', link: 'https://www.adsb.lol' },
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

/** Lignes mises en erreur si le service d'une couche ne se charge pas. */
export const SOVEREIGNTY_LAYER_SOURCES: Readonly<Record<SovereigntyLayerKey, readonly string[]>> = {
  military: ['Vols militaires'],
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
