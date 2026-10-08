/**
 * military-bases-db.ts — Base de données exhaustive des installations militaires françaises
 *
 * Sources : Wikipedia, Ministère des Armées (defense.gouv.fr), OpenStreetMap, data.gouv.fr
 * Couverture : ~160 sites — Bases aériennes, navales, garnisons terre, gendarmerie air,
 *              DROM-COM, bases en opérations extérieures permanentes.
 *
 * Format coordonnées : [longitude, latitude] (GeoJSON standard)
 */

import type { MilitaryBase } from '../types/index.ts';

// ─── Type étendu pour la DB (superset de MilitaryBase) ───────────────────────
// Amendement 7, O13 : nom, catégorie et lien seulement à l'affichage ; ni description non sourcée, ni unités, ni aéronefs, ni effectif.
export interface MilitaryInstallation extends MilitaryBase {
    /** ICAO code de l'aérodrome associé, si applicable */
    icao?: string;
    /** Région administrative */
    region?: string;
    /** Statut : actif / réduit / fermeture */
    status?: 'active' | 'reduced' | 'closed';
}

// ═══════════════════════════════════════════════════════════════════════════
// ARMÉE DE L'AIR ET DE L'ESPACE — Bases Aériennes (BA)
// ═══════════════════════════════════════════════════════════════════════════

const AIR_BASES: MilitaryInstallation[] = [
    // ─── Nord / Hauts-de-France ───
    {
        id: 'BA-103', name: 'BA 103 Cambrai-Épinoy',
        type: 'air', icao: 'LFYG',
        coordinates: [3.1522, 50.2211],
        region: 'Hauts-de-France',
        status: 'active',
    },
    {
        id: 'BA-128', name: 'BA 128 Metz-Frescaty',
        type: 'air', icao: 'LFSF',
        coordinates: [6.1317, 49.0717],
        region: 'Grand Est', status: 'closed',
    },
    // ─── Normandie / Nord-Ouest ───
    {
        id: 'BA-105', name: 'BA 105 Évreux-Fauville',
        type: 'air', icao: 'LFOE',
        coordinates: [1.2197, 49.0286],
        region: 'Normandie',
        status: 'active',
    },
    {
        id: 'BA-123', name: 'BA 123 Orléans-Bricy',
        type: 'air', icao: 'LFOJ',
        coordinates: [1.7597, 47.9878],
        region: 'Centre-Val de Loire',
        status: 'active',
    },
    // ─── Île-de-France ───
    {
        id: 'BA-107', name: 'BA 107 Villacoublay',
        type: 'air', icao: 'LFPV',
        coordinates: [2.1997, 48.7742],
        region: 'Île-de-France',
        status: 'active',
    },
    {
        id: 'BA-110', name: 'BA 110 Creil',
        type: 'air', icao: 'LFPC',
        coordinates: [2.5192, 49.2536],
        region: 'Hauts-de-France', status: 'active',
    },
    // ─── Alsace / Grand Est ───
    {
        id: 'BA-133', name: 'BA 133 Nancy-Ochey',
        type: 'air', icao: 'LFSO',
        coordinates: [5.9525, 48.5830],
        region: 'Grand Est',
        status: 'active',
    },
    {
        id: 'BA-117', name: 'BA 117 Luxeuil-Saint-Sauveur',
        type: 'air', icao: 'LFSX',
        coordinates: [6.3644, 47.7831],
        region: 'Bourgogne-Franche-Comté',
        status: 'active',
    },
    // ─── Bretagne ───
    {
        id: 'BA-122', name: 'BA 122 Chartres-Champhol',
        type: 'air', icao: 'LFOR',
        coordinates: [1.5011, 48.4583],
        region: 'Centre-Val de Loire', status: 'active',
    },
    // ─── Centre / Auvergne ───
    {
        id: 'BA-702', name: 'BA 702 Avord',
        type: 'air', icao: 'LFOA',
        coordinates: [2.6333, 47.0500],
        region: 'Centre-Val de Loire',
        status: 'active',
    },
    // ─── Bordeaux / Sud-Ouest ───
    {
        id: 'BA-106', name: 'BA 106 Bordeaux-Mérignac',
        type: 'air', icao: 'LFBD',
        coordinates: [-0.7156, 44.8278],
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    {
        id: 'BA-118', name: 'BA 118 Mont-de-Marsan',
        type: 'air', icao: 'LFBM',
        coordinates: [-0.5058, 43.9131],
        region: 'Nouvelle-Aquitaine',
        status: 'active',
    },
    {
        id: 'BA-120', name: 'BA 120 Cazaux',
        type: 'air', icao: 'LFBC',
        coordinates: [-1.1250, 44.5328],
        region: 'Nouvelle-Aquitaine',
        status: 'active',
    },
    // ─── Dissuasion nucléaire ───
    {
        id: 'BA-113', name: 'BA 113 Saint-Dizier',
        type: 'air', icao: 'LFSI',
        coordinates: [4.8992, 48.6364],
        region: 'Grand Est',
        status: 'active',
    },
    // ─── Méditerranée / PACA ───
    {
        id: 'BA-115', name: 'BA 115 Orange-Caritat',
        type: 'air', icao: 'LFMO',
        coordinates: [4.8672, 44.1403],
        region: 'Provence-Alpes-Côte d\'Azur',
        status: 'active',
    },
    {
        id: 'BA-125', name: 'BA 125 Istres-Le Tubé',
        type: 'air', icao: 'LFMI',
        coordinates: [4.9242, 43.5233],
        region: 'Provence-Alpes-Côte d\'Azur',
        status: 'active',
    },
    // ─── Toulouse / Midi-Pyrénées ───
    {
        id: 'BA-101', name: 'BA 101 Toulouse-Francazal',
        type: 'air', icao: 'LFBF',
        coordinates: [1.3631, 43.5453],
        region: 'Occitanie',
        status: 'active',
    },
    // ─── Reims / Champagne ───
    {
        id: 'BA-112', name: 'BA 112 Reims',
        type: 'air', icao: 'LFSR',
        coordinates: [4.0528, 49.3097],
        region: 'Grand Est', status: 'closed',
    },
    // ─── Autres ───
    {
        id: 'BA-116', name: 'BA 116 Luxeuil',
        type: 'air', icao: 'LFSX',
        coordinates: [6.3642, 47.7831],
        region: 'Bourgogne-Franche-Comté', status: 'reduced',
    },
    {
        id: 'BA-124', name: 'BA 124 Strasbourg-Entzheim',
        type: 'air', icao: 'LFST',
        coordinates: [7.6281, 48.5383],
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'BA-721', name: 'BA 721 Rochefort-Soubise',
        type: 'air', icao: 'LFDN',
        coordinates: [-0.9208, 45.8877],
        region: 'Nouvelle-Aquitaine',
        status: 'active',
    },
    {
        id: 'BA-126', name: 'BA 126 Solenzara',
        type: 'air', icao: 'LFKS',
        coordinates: [9.4061, 41.9244],
        region: 'Corse',
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// MARINE NATIONALE — Bases navales et aéronavales
// ═══════════════════════════════════════════════════════════════════════════

const NAVAL_BASES: MilitaryInstallation[] = [
    // ─── Atlantique ───
    {
        id: 'BN-BRE', name: 'Base navale de Brest',
        type: 'navy',
        coordinates: [-4.5000, 48.3758],
        region: 'Bretagne',
        status: 'active',
    },
    {
        id: 'BN-ILE-LONGUE', name: 'Île Longue (base navale)',
        type: 'navy',
        // Centre de la relation OpenStreetMap 2567312 (« Base opérationnelle de L'Île Longue », military=naval_base), lu le
        // 04/10/2026 et relu le 05/10/2026 ; l'ancien point (48.3253, -4.5636) tombait sur les batteries de la presqu'île de Crozon,
        // à 4,3 km de la base.
        coordinates: [-4.5172, 48.3018],
        region: 'Bretagne',
        status: 'active',
    },
    {
        id: 'BN-LAN', name: 'Base aéronavale de Lann-Bihoué',
        type: 'navy', icao: 'LFRH',
        coordinates: [-3.4667, 47.7606],
        region: 'Bretagne',
        status: 'active',
    },
    {
        id: 'BN-LOR', name: 'Base navale de Lorient-Kéroman',
        type: 'navy',
        coordinates: [-3.3625, 47.7456],
        region: 'Bretagne',
        status: 'active',
    },
    {
        id: 'BN-CHE', name: 'Base navale de Cherbourg',
        type: 'navy',
        coordinates: [-1.6375, 49.6508],
        region: 'Normandie', status: 'active',
    },
    {
        id: 'BN-LH', name: 'Base navale Amiral Durand-Viel · Le Havre',
        type: 'navy',
        coordinates: [0.1079, 49.4830],
        region: 'Normandie', status: 'active',
    },
    {
        id: 'DTI-LH', name: 'District de Transit Interarmées · Le Havre',
        type: 'joint',
        coordinates: [0.1200, 49.4750],
        region: 'Normandie', status: 'active',
    },
    // ─── Méditerranée ───
    {
        id: 'BN-TLN', name: 'Base navale de Toulon',
        type: 'navy',
        coordinates: [5.9189, 43.1190],
        region: 'Provence-Alpes-Côte d\'Azur',
        status: 'active',
    },
    {
        id: 'BN-HYE', name: 'Base aéronavale de Hyères-Le Palyvestre',
        type: 'navy', icao: 'LFTH',
        coordinates: [6.1467, 43.0967],
        region: 'Provence-Alpes-Côte d\'Azur',
        status: 'active',
    },
    // ─── Atlantique Sud ───
    {
        id: 'BN-ROC', name: 'Base navale de Rochefort',
        type: 'navy',
        coordinates: [-0.9625, 45.9461],
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    // ─── Atlantique Centre ───
    {
        id: 'BN-RCY', name: 'Base aéronavale de Nîmes-Garons',
        type: 'navy', icao: 'LFTW',
        coordinates: [4.4156, 43.7561],
        region: 'Occitanie',
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// ARMÉE DE TERRE — Garnisons, camps et régiments
// ═══════════════════════════════════════════════════════════════════════════

const ARMY_BASES: MilitaryInstallation[] = [
    // ─── Légion Étrangère ───
    {
        id: 'AT-AUBAGNE', name: 'Légion Étrangère · Aubagne',
        type: 'army',
        coordinates: [5.5697, 43.2958],
        region: 'Provence-Alpes-Côte d\'Azur',
        status: 'active',
    },
    {
        id: 'AT-CASTELNAUDARY', name: '4e RE · Castelnaudary',
        type: 'army',
        coordinates: [1.9578, 43.3131],
        region: 'Occitanie',
        status: 'active',
    },
    {
        id: 'AT-NIMES', name: '1er REC · Nîmes-Laudun',
        type: 'army',
        coordinates: [4.4642, 44.0833],
        region: 'Occitanie', status: 'active',
    },
    {
        id: 'AT-ORANGE', name: '1er REG · Orange',
        type: 'army',
        coordinates: [4.7975, 44.1500],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    // ─── Parachutistes ───
    {
        id: 'AT-PAMIERS', name: '1er RPIMa · Pamiers',
        type: 'army',
        coordinates: [1.6100, 43.1167],
        region: 'Occitanie', status: 'active',
    },
    {
        id: 'AT-TARBES', name: '1er RHP · Tarbes',
        type: 'army',
        coordinates: [0.0878, 43.2328],
        region: 'Occitanie', status: 'active',
    },
    {
        id: 'AT-TOULOUSE-BIPARACHUTE', name: 'ETAP · Pau-Lescar',
        type: 'army', icao: 'LFBP',
        coordinates: [-0.4186, 43.3803],
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    // ─── Blindés / Cavalerie ───
    {
        id: 'AT-CARPIQUET', name: '12e RC · Caen-Carpiquet',
        type: 'army',
        coordinates: [-0.4500, 49.1806],
        region: 'Normandie', status: 'active',
    },
    {
        id: 'AT-MOURMELON', name: 'Camp de Mourmelon-le-Grand',
        type: 'army',
        coordinates: [4.3644, 49.1367],
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'AT-BITCHE', name: 'Camp de Bitche',
        type: 'army',
        coordinates: [7.4747, 49.0614],
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'AT-CANJUERS', name: 'Camp de Canjuers',
        type: 'army',
        coordinates: [6.3267, 43.7225],
        region: 'Provence-Alpes-Côte d\'Azur',
        status: 'active',
    },
    {
        id: 'AT-VALDAHON', name: 'Camp de Valdahon',
        type: 'army',
        coordinates: [6.3200, 47.1533],
        region: 'Bourgogne-Franche-Comté', status: 'active',
    },
    {
        id: 'AT-LA-COURTINE', name: 'Camp de La Courtine',
        type: 'army',
        coordinates: [2.2756, 45.7183],
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    {
        id: 'AT-CAYLUS', name: 'Camp de Caylus',
        type: 'army',
        coordinates: [1.8439, 44.2311],
        region: 'Occitanie', status: 'active',
    },
    // ─── Marines / Infanterie de Marine ───
    {
        id: 'AT-VANNES', name: '1er RIMa · Vannes',
        type: 'army',
        coordinates: [-2.7611, 47.6581],
        region: 'Bretagne', status: 'active',
    },
    {
        id: 'AT-MONTLHERY', name: 'Camp de Satory · Versailles',
        type: 'army',
        coordinates: [2.0717, 48.8019],
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'AT-DRAGUIGNAN', name: 'CA · Draguignan',
        type: 'army',
        coordinates: [6.4647, 43.5353],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'AT-COETQUIDAN', name: 'Coëtquidan · Saint-Cyr',
        type: 'army',
        coordinates: [-2.3542, 47.9053],
        region: 'Bretagne', status: 'active',
    },
    {
        id: 'AT-SAUMUR', name: 'École de Cavalerie · Saumur',
        type: 'army',
        coordinates: [-0.0761, 47.2597],
        region: 'Pays de la Loire', status: 'active',
    },
    {
        id: 'AT-ANGERS', name: 'ENSOA · Le Mans / Auvours',
        type: 'army',
        coordinates: [0.2083, 47.9928],
        region: 'Pays de la Loire', status: 'active',
    },
    {
        id: 'AT-VINCENNES', name: 'Fort de Vincennes · CEMA',
        type: 'army',
        coordinates: [2.4350, 48.8475],
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'AT-BESANCON', name: 'Caserne Ruty · Besançon',
        type: 'army',
        coordinates: [6.0256, 47.2378],
        region: 'Bourgogne-Franche-Comté', status: 'active',
    },
    {
        id: 'AT-CHAMBERY', name: 'Caserne Carré · Chambéry',
        type: 'army',
        coordinates: [5.9252, 45.5631],
        region: 'Auvergne-Rhône-Alpes', status: 'active',
    },
    {
        id: 'AT-VARCES', name: 'Camp de Varces · Grenoble',
        type: 'army',
        coordinates: [5.6833, 45.0833],
        region: 'Auvergne-Rhône-Alpes', status: 'active',
    },
    {
        id: 'AT-GAP', name: '4e RAMa · Gap-Ubaye',
        type: 'army',
        coordinates: [6.0833, 44.5500],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    // ─── Forces Spéciales ───
    {
        id: 'AT-PAU', name: '1er RPIMA · Bayone / PAU (COS)',
        type: 'joint',
        coordinates: [-0.3706, 43.3128],
        region: 'Nouvelle-Aquitaine',
        status: 'active',
    },
    {
        id: 'AT-LORIENT-FS', name: 'Groupement des Commandos Marine · Lorient',
        type: 'navy',
        coordinates: [-3.3764, 47.7375],
        region: 'Bretagne',
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// ALAT — Aviation Légère de l'Armée de Terre
// ═══════════════════════════════════════════════════════════════════════════

const ALAT_BASES: MilitaryInstallation[] = [
    {
        id: 'ALAT-DAUX', name: 'Établissement d\'Aviation Légère · Dax',
        type: 'army', icao: 'LFCD',
        coordinates: [-1.0653, 43.6900],
        region: 'Nouvelle-Aquitaine',
        status: 'active',
    },
    {
        id: 'ALAT-PHALSBOURG', name: '1er RHC · Phalsbourg',
        type: 'army', icao: 'LFGP',
        coordinates: [7.2075, 48.7683],
        region: 'Grand Est',
        status: 'active',
    },
    {
        id: 'ALAT-RENNES', name: '3e RHC · Rennes-Saint-Jacques',
        type: 'army', icao: 'LFRN',
        coordinates: [-1.7317, 48.0697],
        region: 'Bretagne',
        status: 'active',
    },
    {
        id: 'ALAT-VALENCE', name: '5e RHC · Valence',
        type: 'army', icao: 'LFLU',
        coordinates: [4.9697, 44.9214],
        region: 'Auvergne-Rhône-Alpes',
        status: 'active',
    },
    {
        id: 'ALAT-ESSEY', name: '1er RHC AZUR · Nancy-Essey',
        type: 'army', icao: 'LFSN',
        coordinates: [6.2308, 48.6914],
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'ALAT-CANNET', name: '4e RHFS · Le Cannet-des-Maures',
        type: 'joint', icao: 'LFMK',
        coordinates: [6.3553, 43.4083],
        region: 'Provence-Alpes-Côte d\'Azur',
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// GENDARMERIE — Groupements d'hélicoptères
// ═══════════════════════════════════════════════════════════════════════════

const GENDARMERIE_BASES: MilitaryInstallation[] = [
    {
        id: 'GND-NIMES', name: 'Gicat 6 · Nîmes-Garons (Gendarmerie)',
        type: 'joint', icao: 'LFTW',
        coordinates: [4.4078, 43.7572],
        region: 'Occitanie',
        status: 'active',
    },
    {
        id: 'GND-BORDEAUX', name: 'SAG de Bordeaux-Mérignac',
        type: 'joint', icao: 'LFBD',
        coordinates: [-0.7156, 44.8278],
        region: 'Nouvelle-Aquitaine',
        status: 'active',
    },
    {
        id: 'GND-ANNECY', name: 'SAG Annecy-Meythet',
        type: 'joint', icao: 'LFLI',
        coordinates: [6.0983, 45.9294],
        region: 'Auvergne-Rhône-Alpes',
        status: 'active',
    },
    {
        id: 'GND-RENNES', name: 'SAG Rennes-Saint-Jacques',
        type: 'joint', icao: 'LFRN',
        coordinates: [-1.7317, 48.0697],
        region: 'Bretagne',
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// SÉCURITÉ CIVILE — Bases Bombardiers d'eau
// ═══════════════════════════════════════════════════════════════════════════

const SECURITE_CIVILE_BASES: MilitaryInstallation[] = [
    {
        id: 'SC-MARIGNANE', name: 'Sécurité Civile · Marignane',
        type: 'joint', icao: 'LFML',
        coordinates: [5.2214, 43.4353],
        region: 'Provence-Alpes-Côte d\'Azur',
        status: 'active',
    },
    {
        id: 'SC-NIMES', name: 'Sécurité Civile · Nîmes-Garons',
        type: 'joint', icao: 'LFTW',
        coordinates: [4.4167, 43.7569],
        region: 'Occitanie',
        status: 'active',
    },
    {
        id: 'SC-BASTIA', name: 'Sécurité Civile · Bastia-Poretta',
        type: 'joint', icao: 'LFKB',
        coordinates: [9.4833, 42.5522],
        region: 'Corse',
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// DROM-COM — Territoires ultramarins
// ═══════════════════════════════════════════════════════════════════════════

const OVERSEAS_BASES: MilitaryInstallation[] = [
    // ─── Antilles ───
    {
        id: 'FAA-971-FDF', name: 'Fort-de-France · FAA Martinique',
        type: 'joint',
        coordinates: [-61.0631, 14.6137],
        region: 'Martinique',
        status: 'active',
    },
    {
        id: 'FAA-971-PTX', name: 'Pointe-à-Pitre · Guadeloupe (GEN)',
        type: 'joint', icao: 'TFFR',
        coordinates: [-61.5181, 16.2578],
        region: 'Guadeloupe',
        status: 'active',
    },
    // ─── Guyane ───
    {
        id: 'FAG-973-CSG', name: 'FAG · Guyane (3e REI + 9e RIMa)',
        type: 'joint',
        coordinates: [-52.3653, 4.8228],
        region: 'Guyane',
        status: 'active',
    },
    {
        id: 'FAG-973-AIR', name: 'BA Cayenne-Rochambeau',
        type: 'air', icao: 'SOCA',
        coordinates: [-52.3611, 4.8203],
        region: 'Guyane',
        status: 'active',
    },
    // ─── La Réunion ───
    {
        id: 'FAZSOI-974-REU', name: 'FAZSOI · La Réunion',
        type: 'joint',
        coordinates: [55.5364, -20.9022],
        region: 'La Réunion',
        status: 'active',
    },
    // ─── Mayotte ───
    {
        id: 'DROM-MYT-DZA', name: 'Détachement Marine · Dzaoudzi (Mayotte)',
        type: 'navy',
        coordinates: [45.2569, -12.7871],
        region: 'Mayotte',
        status: 'active',
    },
    // ─── Polynésie ───
    {
        id: 'FAPF-987-TAH', name: 'FAPF · Polynésie Française (Papeete)',
        type: 'joint', icao: 'NTAA',
        coordinates: [-149.6067, -17.5536],
        region: 'Polynésie Française',
        status: 'active',
    },
    // ─── Nouvelle-Calédonie ───
    {
        id: 'FANC-988-NOU', name: 'FANC · Nouméa (Nouvelle-Calédonie)',
        type: 'joint',
        coordinates: [166.4414, -22.2558],
        region: 'Nouvelle-Calédonie',
        status: 'active',
    },
    // ─── Djibouti ───
    {
        id: 'FFDj-DJ-DJI', name: 'Forces Françaises à Djibouti',
        type: 'joint', icao: 'HDAM',
        coordinates: [43.1547, 11.5483],
        region: 'Djibouti',
        status: 'active',
    },
    // ─── Sénégal ───
    {
        id: 'EFS-SN-DAK', name: 'Éléments Français au Sénégal · Dakar',
        type: 'joint', icao: 'GOOY',
        coordinates: [-17.4906, 14.7394],
        region: 'Sénégal',
        status: 'active',
    },
    // ─── Gabon ───
    {
        id: 'EFG-GA-LBV', name: 'Éléments Français au Gabon · Libreville',
        type: 'joint', icao: 'FOOL',
        coordinates: [9.4122, 0.4581],
        region: 'Gabon',
        status: 'active',
    },
    // ─── Côte d'Ivoire ───
    {
        id: 'FFCI-CI-ABJ', name: 'Forces Françaises en Côte d\'Ivoire · Abidjan',
        type: 'joint', icao: 'DIAP',
        coordinates: [-4.0153, 5.2614],
        region: 'Côte d\'Ivoire',
        status: 'active',
    },
    // ─── Saint-Pierre-et-Miquelon ───
    {
        id: 'NAV-975-SPM', name: 'Détachement · Saint-Pierre-et-Miquelon',
        type: 'navy',
        coordinates: [-56.1833, 46.7667],
        region: 'Saint-Pierre-et-Miquelon', status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// DGA — Direction Générale de l'Armement (sites de test)
// ═══════════════════════════════════════════════════════════════════════════

const DGA_SITES: MilitaryInstallation[] = [
    {
        id: 'DGA-ISTRES', name: 'DGA Essais en vol · Istres',
        type: 'air', icao: 'LFMI',
        coordinates: [4.9242, 43.5233],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'DGA-CAZAUX', name: 'DGA Essais en vol · Cazaux (EPNER)',
        type: 'air', icao: 'LFBC',
        coordinates: [-1.1250, 44.5328],
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    {
        id: 'DGA-SATORY', name: 'DGA Techniques terrestres · Satory',
        type: 'army',
        coordinates: [2.0717, 48.8019],
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'DGA-TOULON', name: 'DGA Techniques navales · Toulon',
        type: 'navy',
        coordinates: [5.8958, 43.1239],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'DGA-BISCAROSSE', name: 'DGA Essais missiles · Biscarosse',
        type: 'joint',
        coordinates: [-1.2347, 44.3856],
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    {
        id: 'DGA-BREGUET', name: 'DGA MI · Bruz (Rennes)',
        type: 'joint',
        coordinates: [-1.6944, 48.0156],
        region: 'Bretagne', status: 'active',
    },
    {
        id: 'DGA-CLAR', name: 'DGA Maîtrise NRBC · La Délégat.',
        type: 'joint',
        coordinates: [2.1903, 48.9644],
        region: 'Île-de-France', status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// CDAOA — Stations Radar Défense Aérienne (EAR - Éléments Air Rattachés)
// ═══════════════════════════════════════════════════════════════════════════

const RADAR_STATIONS: MilitaryInstallation[] = [
    // ─── Réseau CDAOA (Commandement Défense Aérienne) ───
    {
        id: 'EAR-944', name: 'EAR 944 Narbonne (Plan de Roques)',
        type: 'air',
        coordinates: [3.07, 43.175],
        subtype: 'radar',
        tier: 2,
        region: 'Occitanie', status: 'active',
    },
    {
        id: 'EAR-943', name: 'EAR 943 Nice (Mont-Agel)',
        type: 'air',
        coordinates: [7.4167, 43.8000],
        subtype: 'radar',
        tier: 2,
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'EAR-942', name: 'EAR 942 Lyon (Mont-Verdun)',
        type: 'air',
        coordinates: [4.7758, 45.8706],
        subtype: 'radar',
        tier: 1,
        region: 'Auvergne-Rhône-Alpes', status: 'active',
    },
    {
        id: 'EAR-901', name: 'EAR 901 Drachenbronn',
        type: 'air',
        coordinates: [7.9167, 49.0500],
        subtype: 'radar',
        tier: 1,
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'CDC-CINQ-MARS', name: 'CDC 05/901 Cinq-Mars-la-Pile',
        type: 'air',
        coordinates: [0.4667, 47.3500],
        subtype: 'radar',
        tier: 2,
        region: 'Centre-Val de Loire', status: 'active',
    },
    {
        id: 'CDC-MONT-DE-MARSAN', name: 'CDC Mont-de-Marsan',
        type: 'air',
        coordinates: [-0.5058, 43.9131],
        subtype: 'radar',
        tier: 2,
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    // ─── GRAVES — Surveillance spatiale ───
    {
        id: 'GRAVES-ONERA', name: 'GRAVES · Plateau d\'Albion',
        type: 'air',
        coordinates: [5.4833, 44.0667],
        subtype: 'radar-spatial',
        tier: 1,
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// TRANSMISSIONS — CDAA Rosnay, DIRISI, Centres de Communication
// ═══════════════════════════════════════════════════════════════════════════

const TRANSMISSION_SITES: MilitaryInstallation[] = [
    {
        id: 'CDAA-ROSNAY', name: 'CDAA Rosnay-Le Camp',
        type: 'navy',
        coordinates: [1.2333, 46.7167],
        subtype: 'transmission-vlf',
        tier: 1,
        region: 'Centre-Val de Loire', status: 'active',
    },
    {
        id: 'CDAA-SAINTE-ASSISE', name: 'Centre radio Sainte-Assise',
        type: 'joint',
        coordinates: [2.6333, 48.5667],
        subtype: 'transmission-vlf',
        tier: 1,
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'DIRISI-CREIL', name: 'DIRISI · Creil',
        type: 'joint',
        coordinates: [2.5192, 49.2536],
        subtype: 'transmission',
        tier: 2,
        region: 'Hauts-de-France', status: 'active',
    },
    {
        id: 'SYRACUSE-CESSON', name: 'Station SYRACUSE · Cesson-Sévigné',
        type: 'joint',
        coordinates: [-1.6097, 48.1253],
        subtype: 'transmission-sat',
        tier: 1,
        region: 'Bretagne', status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// MUNITIONS — Dépôts SIMu (Service Interarmées des Munitions)
// ═══════════════════════════════════════════════════════════════════════════

const AMMO_DEPOTS: MilitaryInstallation[] = [
    {
        id: 'SIMU-MIRAMAS', name: 'EPMu de Miramas',
        type: 'army',
        coordinates: [4.9897, 43.5806],
        subtype: 'ammunition',
        tier: 1,
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'SIMU-BRIENNE', name: 'EPMu de Brienne-le-Château',
        type: 'army',
        coordinates: [4.5333, 48.3833],
        subtype: 'ammunition',
        tier: 2,
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'SIMU-GUERET', name: 'EPMu de Guéret',
        type: 'army',
        coordinates: [1.8667, 46.1667],
        subtype: 'ammunition',
        tier: 2,
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    {
        id: 'SIMU-GRAMAT', name: 'CEA DAM · Gramat (CESTA)',
        type: 'joint',
        coordinates: [1.7167, 44.7833],
        subtype: 'research',
        tier: 1,
        region: 'Occitanie', status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// COMMANDEMENTS INTERARMÉES / OTAN
// ═══════════════════════════════════════════════════════════════════════════

const HQ_SITES: MilitaryInstallation[] = [
    {
        id: 'HQ-PARIS-VAL', name: 'Ministère des Armées · Balard (EMA)',
        type: 'joint',
        coordinates: [2.2840, 48.8428],
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'HQ-ROCQUENCOURT', name: 'SHAPE France · Rocquencourt',
        type: 'joint',
        coordinates: [2.0758, 48.8525],
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'HQ-CREIL-CDAOA', name: 'CDAOA · Creil',
        type: 'air',
        coordinates: [2.5192, 49.2536],
        region: 'Hauts-de-France', status: 'active',
    },
    {
        id: 'HQ-BRE-COMAR', name: 'COMAR Atlantique · Brest',
        type: 'navy',
        coordinates: [-4.4953, 48.3894],
        region: 'Bretagne', status: 'active',
    },
    {
        id: 'HQ-TLN-COMAR', name: 'COMAR Méditerranée · Toulon',
        type: 'navy',
        coordinates: [5.9300, 43.1250],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'HQ-CHERBOURG-COMAR', name: 'COMAR Manche-Mer du Nord',
        type: 'navy',
        coordinates: [-1.6225, 49.6525],
        region: 'Normandie', status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT — Base de données complète
// ═══════════════════════════════════════════════════════════════════════════

/** Toutes les installations militaires françaises — DB statique open-source */
export const ALL_MILITARY_INSTALLATIONS: MilitaryInstallation[] = [
    ...AIR_BASES,
    ...NAVAL_BASES,
    ...ARMY_BASES,
    ...ALAT_BASES,
    ...GENDARMERIE_BASES,
    ...SECURITE_CIVILE_BASES,
    ...OVERSEAS_BASES,
    ...DGA_SITES,
    ...RADAR_STATIONS,
    ...TRANSMISSION_SITES,
    ...AMMO_DEPOTS,
    ...HQ_SITES,
];

/** Subset des installations actives uniquement (bases fermées exclues) */
export const ACTIVE_INSTALLATIONS: MilitaryInstallation[] = ALL_MILITARY_INSTALLATIONS.filter(
    (i) => i.status !== 'closed'
);

/** Lookup par ID */
export const INSTALLATIONS_BY_ID: Map<string, MilitaryInstallation> = new Map(
    ALL_MILITARY_INSTALLATIONS.map((i) => [i.id, i])
);

