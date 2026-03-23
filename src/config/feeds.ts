/**
 * feeds.ts — Liste des flux RSS français, triés par tier (fiabilité).
 * Pattern WorldMonitor : chaque flux a un tier, une région optionnelle, et un type.
 *
 * Dernière vérification : 2026-02-27
 * - AFP, Reuters, Le Parisien, Les Echos : pas de RSS public (403/404)
 * - La 1ère DOM-TOM : flux cassés (redirigent vers HTML)
 * - Ajout de nombreux flux alternatifs fonctionnels
 */

import type { Feed } from '../types/index.ts';

const USE_LOCAL_RSS_PROXY = import.meta.env.VITE_USE_LOCAL_RSS_PROXY === 'true';

// ═══ Tier 1 — Agences nationales (haute fiabilité) ═══
const TIER1: Feed[] = [
    { name: 'France Info', url: 'https://www.franceinfo.fr/titres.rss', tier: 1 },
    { name: 'Le Monde', url: 'https://www.lemonde.fr/rss/une.xml', tier: 1 },
    { name: 'Le Figaro', url: 'https://www.lefigaro.fr/rss/figaro_flash-actu.xml', tier: 1 },
    { name: 'RFI', url: 'https://www.rfi.fr/fr/rss', tier: 1 },
];

// ═══ Tier 2 — Nationaux (bonne couverture) ═══
const TIER2: Feed[] = [
    { name: 'Libération', url: 'https://www.liberation.fr/arc/outboundfeeds/rss-all/', tier: 2 },
    { name: '20 Minutes', url: 'https://www.20minutes.fr/feeds/rss-une.xml', tier: 2 },
    { name: 'BFM TV', url: 'https://www.bfmtv.com/rss/news-24-7/', tier: 2 },
    { name: 'France 24 FR', url: 'https://www.france24.com/fr/rss', tier: 2 },
    { name: 'Europe 1', url: 'https://www.europe1.fr/rss.xml', tier: 2 },
    { name: 'Courrier International', url: 'https://www.courrierinternational.com/feed/all/rss.xml', tier: 2 },
    { name: 'Mediapart', url: 'https://www.mediapart.fr/articles/feed', tier: 2 },
    { name: "L'Obs", url: 'https://www.nouvelobs.com/rss.xml', tier: 2 },
    { name: 'Marianne', url: 'https://www.marianne.net/rss.xml', tier: 2 },
    { name: 'Slate FR', url: 'https://www.slate.fr/rss.xml', tier: 2 },
];

// ═══ Tier 2b — Économie & Finance ═══
const TIER2_ECO: Feed[] = [
    { name: 'Challenges', url: 'https://www.challenges.fr/rss.xml', tier: 2, type: 'economy' },
];

// ═══ Flux Cloudflare (activés seulement avec Scrapling explicite) ═══
const TIER_CLOUDFLARE: Feed[] = [
    { name: 'Les Échos', url: 'https://services.lesechos.fr/rss/les-echos-une.xml', tier: 2, type: 'economy' },
    { name: 'La Voix du Nord', url: 'https://www.lavoixdunord.fr/rss', tier: 3, region: 'Hauts-de-France' },
    { name: 'Paris Normandie', url: 'https://www.paris-normandie.fr/rss', tier: 3, region: 'Normandie' },
];

// ═══ Tier 2c — Science & Tech ═══
const TIER2_TECH: Feed[] = [
    { name: 'Numerama', url: 'https://www.numerama.com/feed/', tier: 2, type: 'tech' },
    { name: '01net', url: 'https://www.01net.com/rss/info/flux-rss/flux-toutes-les-actualites/', tier: 2, type: 'tech' },
    { name: 'Futura Sciences', url: 'https://www.futura-sciences.com/rss/actualites.xml', tier: 2, type: 'tech' },
    { name: 'Sciences et Avenir', url: 'https://www.sciencesetavenir.fr/rss.xml', tier: 2, type: 'tech' },
];

// ═══ Tier 3 — PQR (Presse Quotidienne Régionale) ═══
const TIER3: Feed[] = [
    // Ouest
    { name: 'Ouest-France', url: 'https://www.ouest-france.fr/rss/france', tier: 3, region: 'Bretagne' },
    { name: 'Le Télégramme', url: 'https://www.letelegramme.fr/rss.xml', tier: 3, region: 'Bretagne' },

    // Sud-Ouest
    { name: 'Sud Ouest', url: 'https://www.sudouest.fr/rss.xml', tier: 3, region: 'Nouvelle-Aquitaine' },
    { name: 'La Dépêche', url: 'https://www.ladepeche.fr/rss.xml', tier: 3, region: 'Occitanie' },
    { name: 'Midi Libre', url: 'https://www.midilibre.fr/rss.xml', tier: 3, region: 'Occitanie' },

    // Sud-Est
    { name: 'Le Progrès', url: 'https://www.leprogres.fr/rss', tier: 3, region: 'Auvergne-Rhône-Alpes' },
    { name: 'Le Dauphiné', url: 'https://www.ledauphine.com/rss', tier: 3, region: 'Auvergne-Rhône-Alpes' },
    { name: 'Nice Matin', url: 'https://www.nicematin.com/rss', tier: 3, region: 'PACA' },

    // Est
    { name: "L'Est Républicain", url: 'https://www.estrepublicain.fr/rss', tier: 3, region: 'Grand Est' },
    { name: 'DNA', url: 'https://www.dna.fr/rss', tier: 3, region: 'Grand Est' },
];

// ═══ Tier 3 — Outre-mer ═══
const TIER3_DOMTOM: Feed[] = [
    // Nouvelle-Calédonie (seul flux la1ere fonctionnel)
    { name: 'NC la 1ère', url: 'https://la1ere.francetvinfo.fr/nouvellecaledonie/rss', tier: 3, region: 'Nouvelle-Calédonie' },

    // Guadeloupe
    { name: 'Guadeloupe.fr', url: 'https://www.guadeloupe.fr/rss', tier: 3, region: 'Guadeloupe' },

    // Réunion
    { name: 'Zinfos974', url: 'https://www.zinfos974.com/feed', tier: 3, region: 'La Réunion' },
    { name: 'Imaz Press Réunion', url: 'https://www.imazpress.com/feed', tier: 3, region: 'La Réunion' },

    // Mayotte
    { name: 'Mayotte Hebdo', url: 'https://www.mayottehebdo.com/feed/', tier: 3, region: 'Mayotte' },
];

// ═══ Tier 4 — Régionaux secondaires & Opinion ═══
const TIER4: Feed[] = [
    { name: 'France Bleu', url: 'https://www.francebleu.fr/rss/a-la-une.xml', tier: 4 },
    { name: 'Actu.fr', url: 'https://actu.fr/rss.xml', tier: 4 },
    { name: 'Atlantico', url: 'https://atlantico.fr/rss.xml', tier: 4 },
    { name: 'Valeurs Actuelles', url: 'https://www.valeursactuelles.com/feed', tier: 4 },
];

/** Tous les flux, triés par tier (1 = plus fiable) */
export const ALL_FEEDS: Feed[] = [
    ...TIER1,
    ...TIER2,
    ...TIER2_ECO,
    ...(USE_LOCAL_RSS_PROXY ? TIER_CLOUDFLARE : []),
    ...TIER2_TECH,
    ...TIER3,
    ...TIER3_DOMTOM,
    ...TIER4,
];

/** Flux par tier */
export function getFeedsByTier(tier: number): Feed[] {
    return ALL_FEEDS.filter((f) => f.tier === tier);
}

/** Flux par région */
export function getFeedsByRegion(region: string): Feed[] {
    return ALL_FEEDS.filter((f) => f.region === region);
}

/** Flux par type */
export function getFeedsByType(type: string): Feed[] {
    return ALL_FEEDS.filter((f) => f.type === type);
}

/** Stats des flux */
export function getFeedStats(): { total: number; byTier: Record<number, number>; byType: Record<string, number> } {
    const byTier: Record<number, number> = {};
    const byType: Record<string, number> = {};
    for (const feed of ALL_FEEDS) {
        byTier[feed.tier] = (byTier[feed.tier] ?? 0) + 1;
        const t = feed.type ?? 'general';
        byType[t] = (byType[t] ?? 0) + 1;
    }
    return { total: ALL_FEEDS.length, byTier, byType };
}

/**
 * Flux cassés / protégés (pour référence)
 * - AFP : URL morte (cdn.afp.com)
 * - Reuters : 401 (auth requise)
 * - Le Parisien : 404 (flux supprimés)
 * - Les Échos : 403 (Cloudflare)
 * - La Voix du Nord : 403 (Cloudflare)
 * - Paris Normandie : 403 (Cloudflare)
 * - La 1ère DOM-TOM : redirigent vers HTML (sauf NC)
 * - L'Équipe : 403/404
 */
