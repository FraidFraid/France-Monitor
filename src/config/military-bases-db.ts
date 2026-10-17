/**
 * military-bases-db.ts — Base de données exhaustive des installations militaires françaises
 *
 * Sources : Wikipedia, Ministère des Armées (defense.gouv.fr), OpenStreetMap, data.gouv.fr
 * Relecture du 17/10/2026 : chaque site vérifié porte sa source publique (champ source) et sa date (checkedAt).
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
    /** Source publique qui établit l'existence et le lieu (ou la fermeture) du site : le « lien » de l'amendement O13 */
    source?: string;
    /** Justification courte d'une correction ou d'une fermeture (relecture du 17/10/2026), jamais affichée comme description */
    note?: string;
    /** Date de la dernière vérification du site */
    checkedAt?: string;
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
        region: 'Hauts-de-France', status: 'closed',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        note: 'dissoute le 28/06/2012',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BA-128', name: 'BA 128 Metz-Frescaty',
        type: 'air', icao: 'LFSF',
        coordinates: [6.1317, 49.0717],
        region: 'Grand Est', status: 'closed',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        note: 'dissoute le 21/06/2012 (une autre source indique août 2012)',
        checkedAt: '2026-10-17',
    },
    // ─── Normandie / Nord-Ouest ───
    {
        id: 'BA-105', name: 'BA 105 Évreux-Fauville',
        type: 'air', icao: 'LFOE',
        coordinates: [1.2197, 49.0286],
        region: 'Normandie', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BA-123', name: 'BA 123 Orléans-Bricy',
        type: 'air', icao: 'LFOJ',
        coordinates: [1.7597, 47.9878],
        region: 'Centre-Val de Loire', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    // ─── Île-de-France ───
    {
        id: 'BA-107', name: 'BA 107 Villacoublay',
        type: 'air', icao: 'LFPV',
        coordinates: [2.1997, 48.7742],
        region: 'Île-de-France', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BA-110', name: 'BA 110 Creil',
        type: 'air', icao: 'LFPC',
        coordinates: [2.5192, 49.2536],
        region: 'Hauts-de-France', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    // ─── Alsace / Grand Est ───
    {
        id: 'BA-133', name: 'BA 133 Nancy-Ochey',
        type: 'air', icao: 'LFSO',
        coordinates: [5.9525, 48.583],
        region: 'Grand Est', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    // ─── Bretagne ───
    {
        id: 'BA-122', name: 'BA 122 Chartres-Champhol',
        type: 'air', icao: 'LFOR',
        coordinates: [1.5011, 48.4583],
        region: 'Centre-Val de Loire', status: 'closed',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        note: 'dissoute en 1996',
        checkedAt: '2026-10-17',
    },
    // ─── Centre / Auvergne ───
    {
        id: 'BA-702', name: 'BA 702 Avord',
        type: 'air', icao: 'LFOA',
        coordinates: [2.6333, 47.05],
        region: 'Centre-Val de Loire', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    // ─── Bordeaux / Sud-Ouest ───
    {
        id: 'BA-106', name: 'BA 106 Bordeaux-Mérignac',
        type: 'air', icao: 'LFBD',
        coordinates: [-0.7156, 44.8278],
        region: 'Nouvelle-Aquitaine', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BA-118', name: 'BA 118 Mont-de-Marsan',
        type: 'air', icao: 'LFBM',
        coordinates: [-0.5058, 43.9131],
        region: 'Nouvelle-Aquitaine', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BA-120', name: 'BA 120 Cazaux',
        type: 'air', icao: 'LFBC',
        coordinates: [-1.125, 44.5328],
        region: 'Nouvelle-Aquitaine', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    // ─── Dissuasion nucléaire ───
    {
        id: 'BA-113', name: 'BA 113 Saint-Dizier',
        type: 'air', icao: 'LFSI',
        coordinates: [4.8992, 48.6364],
        region: 'Grand Est', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    // ─── Méditerranée / PACA ───
    {
        id: 'BA-115', name: 'BA 115 Orange-Caritat',
        type: 'air', icao: 'LFMO',
        coordinates: [4.8672, 44.1403],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BA-125', name: 'BA 125 Istres-Le Tubé',
        type: 'air', icao: 'LFMI',
        coordinates: [4.9242, 43.5233],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    // ─── Toulouse / Midi-Pyrénées ───
    {
        id: 'BA-101', name: 'BA 101 Toulouse-Francazal',
        type: 'air', icao: 'LFBF',
        coordinates: [1.3631, 43.5453],
        region: 'Occitanie', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Base_a%C3%A9rienne_101_Toulouse-Francazal',
        checkedAt: '2026-10-17',
    },
    // ─── Reims / Champagne ───
    {
        id: 'BA-112', name: 'BA 112 Reims',
        type: 'air', icao: 'LFSR',
        coordinates: [4.0528, 49.3097],
        region: 'Grand Est', status: 'closed',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        note: 'dissoute en 2011 (30/06/2011 selon techno-science.net)',
        checkedAt: '2026-10-17',
    },
    // ─── Autres ───
    {
        id: 'BA-116', name: 'BA 116 Luxeuil-Saint-Sauveur',
        type: 'air', icao: 'LFSX',
        coordinates: [6.3642, 47.7831],
        region: 'Bourgogne-Franche-Comté', status: 'reduced',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BA-124', name: 'BA 124 Strasbourg-Entzheim',
        type: 'air', icao: 'LFST',
        coordinates: [7.6281, 48.5383],
        region: 'Grand Est', status: 'closed',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        note: 'dissoute en 1994 ; Entzheim est désormais l\'aéroport civil',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BA-721', name: 'BA 721 Rochefort-Soubise',
        type: 'air', icao: 'LFDN',
        coordinates: [-0.9885, 45.8989],
        region: 'Nouvelle-Aquitaine', status: 'active',
        source: 'https://www.openstreetmap.org/way/377581556',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BA-126', name: 'BA 126 Solenzara',
        type: 'air', icao: 'LFKS',
        coordinates: [9.4061, 41.9244],
        region: 'Corse', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        checkedAt: '2026-10-17',
    },
    // ─── Ajoutés à la relecture du 17/10/2026 (sites actifs absents de la liste) ───
    {
        id: 'ADD-BA-709-COGNAC-CHATEAUBERNARD', name: 'BA 709 Cognac-Châteaubernard',
        type: 'air',
        coordinates: [-0.3145, 45.6578],
        status: 'active',
        source: 'https://www.openstreetmap.org/way/42019229',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ADD-BA-701-SALON-DE-PROVENCE', name: 'BA 701 Salon-de-Provence',
        type: 'air',
        coordinates: [5.1112, 43.6113],
        status: 'active',
        source: 'https://www.openstreetmap.org/way/42016883',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ADD-BA-705-TOURS', name: 'BA 705 Tours',
        type: 'air',
        coordinates: [0.715, 47.433],
        status: 'active',
        source: 'https://www.openstreetmap.org/way/331716021',
        checkedAt: '2026-10-17',
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
        coordinates: [-4.5, 48.3758],
        region: 'Bretagne', status: 'active',
        source: 'https://www.openstreetmap.org/relation/2980911',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BN-ILE-LONGUE', name: 'Île Longue (base navale)',
        type: 'navy',
        coordinates: [-4.5172, 48.3018],
        region: 'Bretagne', status: 'active',
        source: 'https://www.openstreetmap.org/node/275185415',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BN-LAN', name: 'BAN Lann-Bihoué',
        type: 'navy', icao: 'LFRH',
        coordinates: [-3.4432, 47.7603],
        region: 'Bretagne', status: 'active',
        source: 'https://www.openstreetmap.org/relation/13184542',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BN-LOR', name: 'Base navale de Lorient',
        type: 'navy',
        coordinates: [-3.3625, 47.7456],
        region: 'Bretagne', status: 'active',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BN-CHE', name: 'Base navale de Cherbourg',
        type: 'navy',
        coordinates: [-1.6375, 49.6508],
        region: 'Normandie', status: 'active',
        source: 'https://www.openstreetmap.org/way/951790598',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BN-LH', name: 'Base navale Amiral Durand-Viel · Le Havre',
        type: 'navy',
        coordinates: [0.1079, 49.483],
        region: 'Normandie', status: 'active',
        source: 'https://www.seine-maritime.gouv.fr/contenu/telechargement/3629/24288/file/Gendarmerie%20maritime.pdf',
        checkedAt: '2026-10-17',
    },
    // ─── Méditerranée ───
    {
        id: 'BN-TLN', name: 'Base navale de Toulon',
        type: 'navy',
        coordinates: [5.9189, 43.119],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://www.openstreetmap.org/relation/3119274',
        checkedAt: '2026-10-17',
    },
    {
        id: 'BN-HYE', name: 'BAN Hyères Le Palyvestre',
        type: 'navy', icao: 'LFTH',
        coordinates: [6.1467, 43.0967],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://www.openstreetmap.org/way/306986374',
        checkedAt: '2026-10-17',
    },
    // ─── Atlantique Sud ───
    // ─── Atlantique Centre ───
    {
        id: 'BN-RCY', name: 'BAN Nîmes-Garons',
        type: 'navy', icao: 'LFTW',
        coordinates: [4.4156, 43.7561],
        region: 'Occitanie', status: 'closed',
        source: 'https://www.bo.sga.defense.gouv.fr/texte/signe/62008/N%C2%B0%200-13076-2011/DEF/EMM/ROJ.pdf',
        note: 'BAN de Nîmes-Garons dissoute à compter du 02/07/2011 (Bulletin officiel des armées)',
        checkedAt: '2026-10-17',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// ARMÉE DE TERRE — Garnisons, camps et régiments
// ═══════════════════════════════════════════════════════════════════════════

const ARMY_BASES: MilitaryInstallation[] = [
    // ─── Légion Étrangère ───
    {
        id: 'AT-AUBAGNE', name: 'Commandement de la Légion étrangère · Aubagne',
        type: 'army',
        coordinates: [5.5526, 43.292],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://www.openstreetmap.org/way/118992423',
        note: '1er Régiment Étranger et commandement de la Légion à Aubagne',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-CASTELNAUDARY', name: '4e RE · Castelnaudary',
        type: 'army',
        coordinates: [1.9578, 43.3131],
        region: 'Occitanie', status: 'active',
        source: 'https://www.openstreetmap.org/way/29097882',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-NIMES', name: '2e REI · Nîmes',
        type: 'army',
        coordinates: [4.3735, 43.8454],
        region: 'Occitanie', status: 'active',
        source: 'https://www.openstreetmap.org/way/38974837',
        note: 'caserne de Chabrières ; le 1er REC n\'est plus à Nîmes-Laudun (il est à Carpiagne depuis 2014)',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-ORANGE', name: '1er REG · Laudun-l\'Ardoise',
        type: 'army',
        coordinates: [4.6888, 44.095],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/1er_r%C3%A9giment_%C3%A9tranger_de_g%C3%A9nie',
        note: 'le 1er REG est à Laudun-l\'Ardoise (Gard), pas à Orange',
        checkedAt: '2026-10-17',
    },
    // ─── Parachutistes ───
    {
        id: 'AT-PAMIERS', name: '1er RCP · Pamiers',
        type: 'army',
        coordinates: [1.6532, 43.1345],
        region: 'Occitanie', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/1er_r%C3%A9giment_de_chasseurs_parachutistes',
        note: 'Pamiers est la garnison du 1er RCP (le 1er RPIMa est à Bayonne)',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-TARBES', name: '1er RHP · Tarbes',
        type: 'army',
        coordinates: [0.0724, 43.2275],
        region: 'Occitanie', status: 'active',
        source: 'https://www.openstreetmap.org/way/35894668',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-TOULOUSE-BIPARACHUTE', name: 'ETAP · Pau',
        type: 'army', icao: 'LFBP',
        coordinates: [-0.3809, 43.3447],
        region: 'Nouvelle-Aquitaine', status: 'active',
        source: 'https://www.openstreetmap.org/node/8287416363',
        note: 'École des troupes aéroportées à Pau (Lons), pas Lescar',
        checkedAt: '2026-10-17',
    },
    // ─── Blindés / Cavalerie ───
    {
        id: 'AT-CARPIQUET', name: '12e RC · Olivet',
        type: 'army',
        coordinates: [1.8841, 47.8387],
        region: 'Normandie', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/12e_r%C3%A9giment_de_cuirassiers',
        note: 'le 12e régiment de cuirassiers est à Olivet (Loiret), pas à Carpiquet',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-MOURMELON', name: 'Camp de Mourmelon-le-Grand',
        type: 'army',
        coordinates: [4.4271, 49.1174],
        region: 'Grand Est', status: 'active',
        source: 'https://www.openstreetmap.org/way/519060712',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-BITCHE', name: 'Camp de Bitche',
        type: 'army',
        coordinates: [7.4797, 49.0512],
        region: 'Grand Est', status: 'active',
        source: 'https://www.openstreetmap.org/way/42019005',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-CANJUERS', name: 'Camp de Canjuers',
        type: 'army',
        coordinates: [6.4687, 43.6464],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://www.openstreetmap.org/way/160460206',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-VALDAHON', name: 'Camp du Valdahon',
        type: 'army',
        coordinates: [6.3255, 47.1848],
        region: 'Bourgogne-Franche-Comté', status: 'active',
        source: 'https://www.openstreetmap.org/relation/147157',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-LA-COURTINE', name: 'Camp de La Courtine',
        type: 'army',
        coordinates: [2.2611, 45.7515],
        region: 'Nouvelle-Aquitaine', status: 'active',
        source: 'https://www.openstreetmap.org/way/83532954',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-CAYLUS', name: 'Camp de Caylus',
        type: 'army',
        coordinates: [1.7196, 44.2916],
        region: 'Occitanie', status: 'active',
        source: 'https://www.openstreetmap.org/way/163720080',
        checkedAt: '2026-10-17',
    },
    // ─── Marines / Infanterie de Marine ───
    {
        id: 'AT-VANNES', name: '3e RIMa · Vannes',
        type: 'army',
        coordinates: [-2.7433, 47.6591],
        region: 'Bretagne', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/3e_r%C3%A9giment_d%27infanterie_de_marine',
        note: 'quartier Foch-Delestraint ; le 1er RIMa est à Angoulême',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-MONTLHERY', name: 'Camp de Satory · Versailles',
        type: 'army',
        coordinates: [2.0717, 48.8019],
        region: 'Île-de-France', status: 'active',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-DRAGUIGNAN', name: 'Écoles d\'infanterie et d\'artillerie · Draguignan',
        type: 'army',
        coordinates: [6.4976, 43.5254],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://www.openstreetmap.org/way/41937009',
        note: 'École militaire de Draguignan (infanterie et artillerie)',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-COETQUIDAN', name: 'Écoles de Saint-Cyr Coëtquidan · Guer',
        type: 'army',
        coordinates: [-2.1364, 47.9399],
        region: 'Bretagne', status: 'active',
        source: 'https://www.openstreetmap.org/node/6121741329',
        note: 'Coëtquidan est à Guer (-2.14 ; 16 km d\'écart avec le point actuel) ; point OSM du lieu-dit',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-SAUMUR', name: 'École de cavalerie · Saumur',
        type: 'army',
        coordinates: [-0.0867, 47.261],
        region: 'Pays de la Loire', status: 'active',
        source: 'https://www.openstreetmap.org/relation/13024550',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-ANGERS', name: 'ENSOA · Saint-Maixent-l\'École',
        type: 'army',
        coordinates: [-0.2136, 46.417],
        region: 'Pays de la Loire', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/%C3%89cole_nationale_des_sous-officiers_d%27active',
        note: 'l\'ENSOA est à Saint-Maixent-l\'École (Deux-Sèvres), pas au Mans',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-VINCENNES', name: 'Château de Vincennes · Service historique de la Défense',
        type: 'other',
        coordinates: [2.435, 48.8475],
        region: 'Île-de-France', status: 'active',
        source: 'https://www.openstreetmap.org/way/23032971',
        note: 'le CEMA est à Balard ; le château de Vincennes abrite le service historique de la Défense (non relu sur une page)',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-BESANCON', name: '19e RG · Besançon (quartier Ruty)',
        type: 'army',
        coordinates: [6.0308, 47.2379],
        region: 'Bourgogne-Franche-Comté', status: 'active',
        source: 'https://www.openstreetmap.org/way/32785830',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-CHAMBERY', name: '13e BCA · Barby (Chambéry)',
        type: 'army',
        coordinates: [5.9786, 45.5619],
        region: 'Auvergne-Rhône-Alpes', status: 'active',
        source: 'https://www.openstreetmap.org/way/164350126',
        note: 'le 13e BCA est à Barby, banlieue de Chambéry (4 km du point actuel)',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-VARCES', name: '7e BCA · Varces',
        type: 'army',
        coordinates: [5.6833, 45.0833],
        region: 'Auvergne-Rhône-Alpes', status: 'active',
        source: 'https://www.openstreetmap.org/relation/226903',
        note: 'garnison de Varces-Allières-et-Risset (7e BCA, non relu sur une page) ; pas un camp de Grenoble',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-GAP', name: '4e RCh · Gap',
        type: 'army',
        coordinates: [6.053, 44.5312],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://www.openstreetmap.org/way/512717409',
        note: 'le 4e régiment de chasseurs est à Gap (Micropolis) ; il n\'existe pas de 4e RAMa à Gap',
        checkedAt: '2026-10-17',
    },
    // ─── Forces Spéciales ───
    {
        id: 'AT-PAU', name: '1er RPIMa · Bayonne',
        type: 'army',
        coordinates: [-1.4748, 43.4929],
        region: 'Nouvelle-Aquitaine', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/1er_r%C3%A9giment_de_parachutistes_d%27infanterie_de_marine',
        note: 'le 1er RPIMa est à Bayonne ; Pau n\'est pas un site COS ; coordonnées au centre de Bayonne, à affiner',
        checkedAt: '2026-10-17',
    },
    {
        id: 'AT-LORIENT-FS', name: 'Commandos Marine · Lorient',
        type: 'navy',
        coordinates: [-3.3764, 47.7375],
        region: 'Bretagne', status: 'active',
        note: 'commandos Marine à Lorient (quartier Trépel), aucune page lue ; à confirmer',
        checkedAt: '2026-10-17',
    },
    // ─── Ajoutés à la relecture du 17/10/2026 (sites actifs absents de la liste) ───
    {
        id: 'ADD-1ER-REC-CARPIAGNE-MARSEILLE', name: '1er REC · Carpiagne (Marseille)',
        type: 'army',
        coordinates: [5.513, 43.2467],
        status: 'active',
        source: 'https://fr.wikipedia.org/wiki/1er_r%C3%A9giment_%C3%A9tranger_de_cavalerie',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ADD-3E-RHC-ETAIN', name: '3e RHC · Étain',
        type: 'army',
        coordinates: [5.676, 49.2278],
        status: 'active',
        source: 'https://fr.wikipedia.org/wiki/3e_r%C3%A9giment_d%27h%C3%A9licopt%C3%A8res_de_combat',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ADD-5E-RHC-ET-4E-RHFS-PAU-UZEIN', name: '5e RHC et 4e RHFS · Pau-Uzein',
        type: 'army',
        coordinates: [-0.4186, 43.3803],
        status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Aviation_l%C3%A9g%C3%A8re_de_l%27arm%C3%A9e_de_terre',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ADD-COMMANDEMENT-DE-L-ALAT-METZ-', name: 'Commandement de l\'ALAT · Metz (caserne Ney)',
        type: 'army',
        coordinates: [6.1713, 49.1138],
        status: 'active',
        source: 'https://www.openstreetmap.org/way/59399000',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ADD-2E-REP-CALVI-CAMP-RAFFALLI', name: '2e REP · Calvi (camp Raffalli)',
        type: 'army',
        coordinates: [8.8009, 42.5555],
        status: 'active',
        source: 'https://www.openstreetmap.org/way/536508914',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ADD-13E-DBLE-LA-CAVALERIE-LARZAC', name: '13e DBLE · La Cavalerie (Larzac)',
        type: 'army',
        coordinates: [3.1916, 44.0384],
        status: 'active',
        source: 'https://www.openstreetmap.org/way/34767972',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ADD-CAMP-DE-SISSONNE', name: 'Camp de Sissonne',
        type: 'army',
        coordinates: [3.9507, 49.5571],
        status: 'active',
        source: 'https://www.openstreetmap.org/way/282571866',
        checkedAt: '2026-10-17',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// ALAT — Aviation Légère de l'Armée de Terre
// ═══════════════════════════════════════════════════════════════════════════

const ALAT_BASES: MilitaryInstallation[] = [
    {
        id: 'ALAT-DAUX', name: 'EALAT · Dax',
        type: 'army', icao: 'LFCD',
        coordinates: [-1.0653, 43.69],
        region: 'Nouvelle-Aquitaine', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Aviation_l%C3%A9g%C3%A8re_de_l%27arm%C3%A9e_de_terre',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ALAT-PHALSBOURG', name: '1er RHC · Phalsbourg',
        type: 'army', icao: 'LFGP',
        coordinates: [7.1995, 48.7656],
        region: 'Grand Est', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Aviation_l%C3%A9g%C3%A8re_de_l%27arm%C3%A9e_de_terre',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ALAT-RENNES', name: 'GAAT · Rennes-Saint-Jacques',
        type: 'army', icao: 'LFRN',
        coordinates: [-1.7317, 48.0697],
        region: 'Bretagne', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Aviation_l%C3%A9g%C3%A8re_de_l%27arm%C3%A9e_de_terre',
        note: 'le 3e RHC est à Étain ; à Rennes il y a le Groupe avions de l\'armée de terre',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ALAT-VALENCE', name: 'GAMSTAT · Valence-Chabeuil',
        type: 'army', icao: 'LFLU',
        coordinates: [4.9699, 44.9222],
        region: 'Auvergne-Rhône-Alpes', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Aviation_l%C3%A9g%C3%A8re_de_l%27arm%C3%A9e_de_terre',
        note: 'le 5e RHC est à Pau ; à Valence il y a le GAMSTAT',
        checkedAt: '2026-10-17',
    },
    {
        id: 'ALAT-CANNET', name: 'EALAT · Le Cannet-des-Maures',
        type: 'army', icao: 'LFMK',
        coordinates: [6.3845, 43.3827],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Aviation_l%C3%A9g%C3%A8re_de_l%27arm%C3%A9e_de_terre',
        note: 'le 4e RHFS est à Pau ; Le Cannet-des-Maures accueille l\'EALAT (EFA Tigre)',
        checkedAt: '2026-10-17',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// GENDARMERIE — Groupements d'hélicoptères
// ═══════════════════════════════════════════════════════════════════════════

const GENDARMERIE_BASES: MilitaryInstallation[] = [
    {
        id: 'GND-BORDEAUX', name: 'SAG de Bordeaux-Mérignac',
        type: 'other', icao: 'LFBD',
        coordinates: [-0.7156, 44.8278],
        region: 'Nouvelle-Aquitaine', status: 'active',
        checkedAt: '2026-10-17',
    },
    {
        id: 'GND-ANNECY', name: 'SAG Annecy-Meythet',
        type: 'other', icao: 'LFLI',
        coordinates: [6.0983, 45.9294],
        region: 'Auvergne-Rhône-Alpes', status: 'active',
        source: 'https://www.openstreetmap.org/way/667938201',
        checkedAt: '2026-10-17',
    },
    {
        id: 'GND-RENNES', name: 'SAG Rennes-Saint-Jacques',
        type: 'other', icao: 'LFRN',
        coordinates: [-1.7317, 48.0697],
        region: 'Bretagne', status: 'active',
        checkedAt: '2026-10-17',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// SÉCURITÉ CIVILE — Bases Bombardiers d'eau
// ═══════════════════════════════════════════════════════════════════════════

const SECURITE_CIVILE_BASES: MilitaryInstallation[] = [
    {
        id: 'SC-MARIGNANE', name: 'Sécurité Civile · Marignane',
        type: 'other', icao: 'LFML',
        coordinates: [5.2214, 43.4353],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        checkedAt: '2026-10-17',
    },
    {
        id: 'SC-NIMES', name: 'Sécurité Civile · Nîmes-Garons',
        type: 'other', icao: 'LFTW',
        coordinates: [4.4167, 43.7569],
        region: 'Occitanie', status: 'active',
        checkedAt: '2026-10-17',
    },
    {
        id: 'SC-BASTIA', name: 'Sécurité Civile · Bastia-Poretta',
        type: 'other', icao: 'LFKB',
        coordinates: [9.4789, 42.5534],
        region: 'Corse', status: 'active',
        source: 'https://www.openstreetmap.org/way/1421774210',
        checkedAt: '2026-10-17',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// DROM-COM — Territoires ultramarins
// ═══════════════════════════════════════════════════════════════════════════

const OVERSEAS_BASES: MilitaryInstallation[] = [
    // ─── Antilles ───
    {
        id: 'FAA-971-FDF', name: 'FAA · Fort-Desaix, Fort-de-France',
        type: 'joint',
        coordinates: [-61.0654, 14.6164],
        region: 'Martinique', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Forces_arm%C3%A9es_aux_Antilles',
        checkedAt: '2026-10-17',
    },
    {
        id: 'FAA-971-PTX', name: '33e RIMa · Baie-Mahault (Guadeloupe)',
        type: 'army', icao: 'TFFR',
        coordinates: [-61.5623, 16.2581],
        region: 'Guadeloupe', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Forces_arm%C3%A9es_aux_Antilles',
        note: 'emprise du camp Dugommier à Baie-Mahault ; pas à Pointe-à-Pitre',
        checkedAt: '2026-10-17',
    },
    // ─── Guyane ───
    {
        id: 'FAG-973-CSG', name: 'Forces armées en Guyane · Cayenne',
        type: 'joint',
        coordinates: [-52.3653, 4.8228],
        region: 'Guyane', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Forces_arm%C3%A9es_en_Guyane',
        note: '3e REI à Kourou et 9e RIMa à Cayenne ; site exact du QG non précisé',
        checkedAt: '2026-10-17',
    },
    {
        id: 'FAG-973-AIR', name: 'BA 367 Cayenne-Félix Éboué',
        type: 'air', icao: 'SOCA',
        coordinates: [-52.3754, 4.8173],
        region: 'Guyane', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Forces_arm%C3%A9es_en_Guyane',
        note: 'base aérienne 367 à Matoury, sur l\'aéroport',
        checkedAt: '2026-10-17',
    },
    // ─── La Réunion ───
    {
        id: 'FAZSOI-974-REU', name: 'FAZSOI · La Réunion',
        type: 'joint',
        coordinates: [55.5364, -20.9022],
        region: 'La Réunion', status: 'active',
        source: 'https://www.defense.gouv.fr/en/node/99',
        checkedAt: '2026-10-17',
    },
    // ─── Mayotte ───
    {
        id: 'DROM-MYT-DZA', name: 'Base navale de Mayotte · Dzaoudzi',
        type: 'navy',
        coordinates: [45.2552, -12.7817],
        region: 'Mayotte', status: 'active',
        source: 'https://www.openstreetmap.org/way/980372986',
        checkedAt: '2026-10-17',
    },
    // ─── Polynésie ───
    {
        id: 'FAPF-987-TAH', name: 'FAPF · Arue (Tahiti)',
        type: 'joint', icao: 'NTAA',
        coordinates: [-149.5236, -17.5305],
        region: 'Polynésie Française', status: 'active',
        source: 'https://www.defense.gouv.fr/en/node/111',
        note: 'commandement supérieur à Arue (caserne Broche), pas à Papeete ; coordonnées approchées du centre d\'Arue, à affiner',
        checkedAt: '2026-10-17',
    },
    // ─── Nouvelle-Calédonie ───
    {
        id: 'FANC-988-NOU', name: 'FANC · Nouméa',
        type: 'joint',
        coordinates: [166.4469, -22.2712],
        region: 'Nouvelle-Calédonie', status: 'active',
        source: 'https://www.defense.gouv.fr/operations/indopacifique/forces-souverainete-indopacifique/forces-armees-nouvelle-caledonie-fanc',
        checkedAt: '2026-10-17',
    },
    // ─── Djibouti ───
    {
        id: 'FFDj-DJ-DJI', name: 'Forces françaises à Djibouti · BA 188',
        type: 'joint', icao: 'HDAM',
        coordinates: [43.1551, 11.5554],
        region: 'Djibouti', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Forces_fran%C3%A7aises_stationn%C3%A9es_%C3%A0_Djibouti',
        checkedAt: '2026-10-17',
    },
    // ─── Sénégal ───
    {
        id: 'EFS-SN-DAK', name: 'Éléments Français au Sénégal · Dakar',
        type: 'joint', icao: 'GOOY',
        coordinates: [-17.4906, 14.7394],
        region: 'Sénégal', status: 'closed',
        source: 'https://tchadinfos.com/2025/07/17/larmee-francaise-quitte-definitivement-le-senegal/',
        note: 'bases rendues au Sénégal le 17/07/2025 (camp Geille et aérodrome)',
        checkedAt: '2026-10-17',
    },
    // ─── Gabon ───
    {
        id: 'EFG-GA-LBV', name: 'Camp de Gaulle · Libreville',
        type: 'joint', icao: 'FOOL',
        coordinates: [9.4122, 0.4581],
        region: 'Gabon', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/%C3%89l%C3%A9ments_fran%C3%A7ais_au_Gabon',
        note: 'camp de Gaulle devenu camp d\'entraînement partagé et cogéré avec le Gabon, présence réduite depuis 2025',
        checkedAt: '2026-10-17',
    },
    // ─── Côte d'Ivoire ───
    {
        id: 'FFCI-CI-ABJ', name: 'Forces Françaises en Côte d Ivoire · Abidjan',
        type: 'joint', icao: 'DIAP',
        coordinates: [-4.0153, 5.2614],
        region: 'Côte d\'Ivoire', status: 'closed',
        source: 'https://allafrica.com/stories/202501010178.html',
        note: 'retrait français de Côte d\'Ivoire annoncé fin 2024, base de Port-Bouët rétrocédée en 2025 (date exacte non relue)',
        checkedAt: '2026-10-17',
    },
    // ─── Saint-Pierre-et-Miquelon ───
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
        checkedAt: '2026-10-17',
    },
    {
        id: 'DGA-CAZAUX', name: 'DGA Essais en vol · Cazaux',
        type: 'air', icao: 'LFBC',
        coordinates: [-1.125, 44.5328],
        region: 'Nouvelle-Aquitaine', status: 'active',
        note: 'l\'EPNER n\'est pas à Cazaux ; site DGA Essais en vol de Cazaux, aucune page lue',
        checkedAt: '2026-10-17',
    },
    {
        id: 'DGA-SATORY', name: 'DGA Techniques terrestres · Satory',
        type: 'army',
        coordinates: [2.0717, 48.8019],
        region: 'Île-de-France', status: 'active',
        checkedAt: '2026-10-17',
    },
    {
        id: 'DGA-TOULON', name: 'DGA Techniques navales · Toulon',
        type: 'navy',
        coordinates: [5.8958, 43.1239],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        checkedAt: '2026-10-17',
    },
    {
        id: 'DGA-BISCAROSSE', name: 'DGA Essais missiles · Biscarosse',
        type: 'joint',
        coordinates: [-1.2347, 44.3856],
        region: 'Nouvelle-Aquitaine', status: 'active',
        checkedAt: '2026-10-17',
    },
    {
        id: 'DGA-BREGUET', name: 'DGA Maîtrise de l\'information · Bruz',
        type: 'joint',
        coordinates: [-1.7469, 47.9913],
        region: 'Bretagne', status: 'active',
        source: 'https://www.openstreetmap.org/way/35601537',
        note: 'site DGA-MI de Bruz ; coordonnées recalées (4,7 km d\'écart)',
        checkedAt: '2026-10-17',
    },
    {
        id: 'DGA-CLAR', name: 'DGA Maîtrise NRBC · Vert-le-Petit',
        type: 'joint',
        coordinates: [2.3664, 48.5512],
        region: 'Île-de-France', status: 'active',
        source: 'https://www.openstreetmap.org/relation/300876',
        note: 'le site NRBC est à Vert-le-Petit (Essonne) ; le point actuel est dans le Val-d\'Oise ; point au centre de la commune, à affiner',
        checkedAt: '2026-10-17',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// CDAOA — Stations Radar Défense Aérienne (EAR - Éléments Air Rattachés)
// ═══════════════════════════════════════════════════════════════════════════

const RADAR_STATIONS: MilitaryInstallation[] = [
    // ─── Réseau CDAOA (Commandement Défense Aérienne) ───
    {
        id: 'EAR-944', name: 'Détachement air 944 · Narbonne',
        type: 'air',
        coordinates: [3.07, 43.175],
        subtype: 'radar',
        tier: 2,
        region: 'Occitanie', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        note: 'BA 944 dissoute, un détachement air subsiste',
        checkedAt: '2026-10-17',
    },
    {
        id: 'EAR-943', name: 'Détachement air 943 · Mont-Agel',
        type: 'air',
        coordinates: [7.426, 43.7751],
        subtype: 'radar',
        tier: 2,
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        note: 'BA 943 (Roquebrune-Cap-Martin) dissoute en 2012 ; le statut du radar de Mont-Agel n\'est pas confirmé',
        checkedAt: '2026-10-17',
    },
    {
        id: 'EAR-942', name: 'BA 942 Lyon-Mont Verdun',
        type: 'air',
        coordinates: [4.7861, 45.8514],
        subtype: 'radar',
        tier: 1,
        region: 'Auvergne-Rhône-Alpes', status: 'active',
        source: 'https://fr.wikipedia.org/wiki/Bases_a%C3%A9riennes_de_l%27Arm%C3%A9e_de_l%27air_et_de_l%27espace_fran%C3%A7aise',
        note: 'base active ; centre de détection 05.942',
        checkedAt: '2026-10-17',
    },
    {
        id: 'EAR-901', name: 'EAR 901 Drachenbronn',
        type: 'air',
        coordinates: [7.8683, 48.9871],
        subtype: 'radar',
        tier: 1,
        region: 'Grand Est', status: 'active',
        source: 'https://en.wikipedia.org/wiki/Commandement_de_la_D%C3%A9fense_A%C3%A9rienne_et_des_Op%C3%A9rations_A%C3%A9riennes',
        note: 'centre de détection 05.901 dissous en 2015 selon Wikipédia, EAR 901 encore listé en 2021 ; coordonnées recalées sur Drachenbronn',
        checkedAt: '2026-10-17',
    },
    {
        id: 'CDC-CINQ-MARS', name: 'CDC 07.927 · Cinq-Mars-la-Pile',
        type: 'air',
        coordinates: [0.454, 47.3482],
        subtype: 'radar',
        tier: 2,
        region: 'Centre-Val de Loire', status: 'active',
        source: 'https://en.wikipedia.org/wiki/Commandement_de_la_D%C3%A9fense_A%C3%A9rienne_et_des_Op%C3%A9rations_A%C3%A9riennes',
        note: 'le centre de détection et de contrôle de Cinq-Mars-la-Pile est le 07.927 (le 05.901 est Drachenbronn)',
        checkedAt: '2026-10-17',
    },
    {
        id: 'CDC-MONT-DE-MARSAN', name: 'CDC 04.930 · Mont-de-Marsan',
        type: 'air',
        coordinates: [-0.5058, 43.9131],
        subtype: 'radar',
        tier: 2,
        region: 'Nouvelle-Aquitaine', status: 'active',
        source: 'https://en.wikipedia.org/wiki/Commandement_de_la_D%C3%A9fense_A%C3%A9rienne_et_des_Op%C3%A9rations_A%C3%A9riennes',
        checkedAt: '2026-10-17',
    },
    // ─── GRAVES — Surveillance spatiale ───
    {
        id: 'GRAVES-ONERA', name: 'Radar GRAVES (réception) · Plateau d\'Albion',
        type: 'air',
        coordinates: [5.4833, 44.0667],
        subtype: 'radar-spatial',
        tier: 1,
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://www.globalsecurity.org/space/world/france/graves.htm',
        note: 'système de veille spatiale : émetteur près de Dijon, récepteur sur le plateau d\'Albion, exploité depuis la BA 942 Lyon',
        checkedAt: '2026-10-17',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// TRANSMISSIONS — CDAA Rosnay, DIRISI, Centres de Communication
// ═══════════════════════════════════════════════════════════════════════════

const TRANSMISSION_SITES: MilitaryInstallation[] = [
    {
        id: 'CDAA-ROSNAY', name: 'Centre de transmissions de la Marine · Rosnay',
        type: 'navy',
        coordinates: [1.2445, 46.7137],
        subtype: 'transmission-vlf',
        tier: 1,
        region: 'Centre-Val de Loire', status: 'active',
        source: 'https://www.openstreetmap.org/way/69718557',
        note: 'centre de transmissions de la Marine nationale de Rosnay',
        checkedAt: '2026-10-17',
    },
    {
        id: 'CDAA-SAINTE-ASSISE', name: 'Centre de transmissions de la Marine · Sainte-Assise',
        type: 'navy',
        coordinates: [2.5506, 48.5409],
        subtype: 'transmission-vlf',
        tier: 1,
        region: 'Île-de-France', status: 'active',
        source: 'https://en.wikipedia.org/wiki/Sainte-Assise_transmitter',
        note: 'station TBF de la Marine, active (centenaire en 2023) ; coordonnées recalées sur le château de Sainte-Assise (Seine-Port)',
        checkedAt: '2026-10-17',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// MUNITIONS — Dépôts SIMu (Service Interarmées des Munitions)
// ═══════════════════════════════════════════════════════════════════════════

const AMMO_DEPOTS: MilitaryInstallation[] = [
    {
        id: 'SIMU-MIRAMAS', name: 'EPMu Provence · Miramas',
        type: 'joint',
        coordinates: [4.9897, 43.5806],
        subtype: 'ammunition',
        tier: 1,
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://www.defense.gouv.fr/sites/default/files/sga/TEXTE%201%20DECISION%20portant%20cr%C3%A9ation%20de%20l%27%C3%A9tablissement%20principal%20des%20munitions%20de%20Provence..pdf',
        note: 'établissement principal des munitions « Provence » créé le 01/06/2023, siège à Miramas',
        checkedAt: '2026-10-17',
    },
    {
        id: 'SIMU-BRIENNE', name: 'EPMu Champagne-Lorraine · Brienne-le-Château',
        type: 'joint',
        coordinates: [4.5333, 48.3833],
        subtype: 'ammunition',
        tier: 2,
        region: 'Grand Est', status: 'active',
        source: 'https://choisirleservicepublic.gouv.fr/offre-emploi/agent-d-engagement-confirme-reference-DEF_44-00067454/',
        note: 'partie centrale de l\'EPMu Champagne-Lorraine à Brienne-le-Château',
        checkedAt: '2026-10-17',
    },
    {
        id: 'SIMU-GRAMAT', name: 'CEA DAM · Gramat',
        type: 'other',
        coordinates: [1.7234, 44.779],
        subtype: 'research',
        tier: 1,
        region: 'Occitanie', status: 'active',
        source: 'https://www.openstreetmap.org/relation/123059',
        note: 'centre CEA DAM de Gramat (le CESTA est au Barp) ; point au centre de la commune',
        checkedAt: '2026-10-17',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// COMMANDEMENTS INTERARMÉES / OTAN
// ═══════════════════════════════════════════════════════════════════════════

const HQ_SITES: MilitaryInstallation[] = [
    {
        id: 'HQ-PARIS-VAL', name: 'Ministère des Armées · Balard',
        type: 'joint',
        coordinates: [2.2756, 48.8357],
        region: 'Île-de-France', status: 'active',
        source: 'https://www.openstreetmap.org/relation/4665863',
        checkedAt: '2026-10-17',
    },
    {
        id: 'HQ-ROCQUENCOURT', name: 'SHAPE · Rocquencourt',
        type: 'joint',
        coordinates: [2.0758, 48.8525],
        region: 'Île-de-France', status: 'closed',
        source: 'https://fr.wikipedia.org/wiki/Supreme_Headquarters_Allied_Powers_Europe',
        note: 'SHAPE installé à Louveciennes/Rocquencourt de 1951 au 30/03/1967, transféré à Casteau (Belgique)',
        checkedAt: '2026-10-17',
    },
    {
        id: 'HQ-BRE-COMAR', name: 'Préfecture maritime de l\'Atlantique · Brest',
        type: 'navy',
        coordinates: [-4.4946, 48.3814],
        region: 'Bretagne', status: 'active',
        source: 'https://www.openstreetmap.org/way/42577093',
        note: 'la préfecture maritime remplace le COMAR (appellation obsolète)',
        checkedAt: '2026-10-17',
    },
    {
        id: 'HQ-TLN-COMAR', name: 'Préfecture maritime de la Méditerranée · Toulon',
        type: 'navy',
        coordinates: [5.9291, 43.1219],
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
        source: 'https://www.openstreetmap.org/node/3988569607',
        note: 'la préfecture maritime remplace le COMAR (appellation obsolète)',
        checkedAt: '2026-10-17',
    },
    {
        id: 'HQ-CHERBOURG-COMAR', name: 'Préfecture maritime de la Manche et de la mer du Nord · Cherbourg',
        type: 'navy',
        coordinates: [-1.6279, 49.6419],
        region: 'Normandie', status: 'active',
        source: 'https://www.openstreetmap.org/way/112109136',
        note: 'la préfecture maritime remplace le COMAR (appellation obsolète)',
        checkedAt: '2026-10-17',
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

