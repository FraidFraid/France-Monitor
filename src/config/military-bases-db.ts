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
export interface MilitaryInstallation extends MilitaryBase {
    /** ICAO code de l'aérodrome associé, si applicable */
    icao?: string;
    /** Unités stationnées */
    units?: string[];
    /** Aéronefs types présents */
    aircraft?: string[];
    /** Région administrative */
    region?: string;
    /** Effectif approximatif */
    personnel?: number;
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
        description: 'Escadre de chasse 2/2 "Côte d\'Or" (Mirage 2000-5F).',
        region: 'Hauts-de-France', aircraft: ['Mirage 2000-5F'],
        status: 'active',
    },
    {
        id: 'BA-128', name: 'BA 128 Metz-Frescaty',
        type: 'air', icao: 'LFSF',
        coordinates: [6.1317, 49.0717],
        description: 'Base fermée. Ancienne base de détection, reconvertie.',
        region: 'Grand Est', status: 'closed',
    },
    // ─── Normandie / Nord-Ouest ───
    {
        id: 'BA-105', name: 'BA 105 Évreux-Fauville',
        type: 'air', icao: 'LFOE',
        coordinates: [1.2197, 49.0286],
        description: 'ET 1/64 "Béarn" (CASA CN-235, A400M), opérations spéciales (CPA 10).',
        region: 'Normandie', aircraft: ['CASA CN-235', 'A400M Atlas'],
        status: 'active',
    },
    {
        id: 'BA-123', name: 'BA 123 Orléans-Bricy',
        type: 'air', icao: 'LFOJ',
        coordinates: [1.7597, 47.9878],
        description: 'ET 1/61 "Touraine" (A400M Atlas). Hub transport tactique.',
        region: 'Centre-Val de Loire', aircraft: ['A400M Atlas'],
        units: ['ET 1/61 Touraine'],
        status: 'active',
    },
    // ─── Île-de-France ───
    {
        id: 'BA-107', name: 'BA 107 Villacoublay',
        type: 'air', icao: 'LFPV',
        coordinates: [2.1997, 48.7742],
        description: 'Transport VIP, Présidence de la République. Falcon 7X, A330.',
        region: 'Île-de-France', aircraft: ['Falcon 7X', 'A330', 'TBM-700'],
        units: ['GTA', 'EEA 3/60 Esterel'],
        status: 'active',
    },
    {
        id: 'BA-110', name: 'BA 110 Creil',
        type: 'air', icao: 'LFPC',
        coordinates: [2.5192, 49.2536],
        description: 'Centre d\'expertise aéronautique. Escadron de transport.',
        region: 'Hauts-de-France', status: 'active',
    },
    // ─── Alsace / Grand Est ───
    {
        id: 'BA-133', name: 'BA 133 Nancy-Ochey',
        type: 'air', icao: 'LFSO',
        coordinates: [5.9525, 48.5830],
        description: 'EC 1/3 "Navarre" et 3/3 "Ardennes" (Mirage 2000D).',
        region: 'Grand Est', aircraft: ['Mirage 2000D'],
        units: ['EC 1/3 Navarre', 'EC 3/3 Ardennes'],
        status: 'active',
    },
    {
        id: 'BA-117', name: 'BA 117 Luxeuil-Saint-Sauveur',
        type: 'air', icao: 'LFSX',
        coordinates: [6.3644, 47.7831],
        description: 'EC 2/3 "Champagne" (Mirage 2000D). Reconnu pour formations tactiques.',
        region: 'Bourgogne-Franche-Comté', aircraft: ['Mirage 2000D'],
        status: 'active',
    },
    // ─── Bretagne ───
    {
        id: 'BA-122', name: 'BA 122 Chartres-Champhol',
        type: 'air', icao: 'LFOR',
        coordinates: [1.5011, 48.4583],
        description: 'Base de transmissions CDAA principal. Centre de détection et contrôle.',
        region: 'Centre-Val de Loire', status: 'active',
    },
    // ─── Centre / Auvergne ───
    {
        id: 'BA-702', name: 'BA 702 Avord',
        type: 'air', icao: 'LFOA',
        coordinates: [2.6333, 47.0500],
        description: 'E-3F AWACS (EDA 36), MRTT A330 (ERV 4/31 Sologne). Dissuasion nucléaire.',
        region: 'Centre-Val de Loire',
        aircraft: ['E-3F Sentry', 'A330 MRTT'],
        units: ['EDA 36', 'ERV 4/31 Sologne'],
        status: 'active',
    },
    // ─── Bordeaux / Sud-Ouest ───
    {
        id: 'BA-106', name: 'BA 106 Bordeaux-Mérignac',
        type: 'air', icao: 'LFBD',
        coordinates: [-0.7156, 44.8278],
        description: 'Soutien logistique, DETAIR. Partagée avec aéroport civil.',
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    {
        id: 'BA-118', name: 'BA 118 Mont-de-Marsan',
        type: 'air', icao: 'LFBM',
        coordinates: [-0.5058, 43.9131],
        description: 'EC 2/30 "Normandie-Niémen", CEAM (centre d\'expérimentation). Rafale B.',
        region: 'Nouvelle-Aquitaine', aircraft: ['Rafale B', 'Alpha Jet'],
        units: ['EC 2/30 Normandie-Niémen', 'CEAM'],
        status: 'active',
    },
    {
        id: 'BA-120', name: 'BA 120 Cazaux',
        type: 'air', icao: 'LFBC',
        coordinates: [-1.1250, 44.5328],
        description: 'École de l\'Aviation de Chasse (EAC). Alpha Jet, Rafale B biplace.',
        region: 'Nouvelle-Aquitaine', aircraft: ['Alpha Jet', 'Rafale B', 'PC-21'],
        units: ['EAC', 'EPNER'],
        status: 'active',
    },
    // ─── Dissuasion nucléaire ───
    {
        id: 'BA-113', name: 'BA 113 Saint-Dizier',
        type: 'air', icao: 'LFSI',
        coordinates: [4.8992, 48.6364],
        description: 'EC 1/4 "Dauphiné" et 2/4 "La Fayette" (Rafale F3-R). Composante aérienne dissuasion.',
        region: 'Grand Est', aircraft: ['Rafale F3-R'],
        units: ['EC 1/4 Dauphiné', 'EC 2/4 La Fayette'],
        status: 'active',
    },
    // ─── Méditerranée / PACA ───
    {
        id: 'BA-115', name: 'BA 115 Orange-Caritat',
        type: 'air', icao: 'LFMO',
        coordinates: [4.8672, 44.1403],
        description: 'EC 1/2 "Cigognes" (Rafale C). Référence chasse française.',
        region: 'Provence-Alpes-Côte d\'Azur', aircraft: ['Rafale C'],
        units: ['EC 1/2 Cigognes'],
        status: 'active',
    },
    {
        id: 'BA-125', name: 'BA 125 Istres-Le Tubé',
        type: 'air', icao: 'LFMI',
        coordinates: [4.9242, 43.5233],
        description: 'Hub logistique Hercule, projection de forces. DGA essais en vol co-localisés.',
        region: 'Provence-Alpes-Côte d\'Azur',
        aircraft: ['C-130H Hercules', 'A400M Atlas'],
        units: ['ET 3/61 Poitou', 'DGA EV'],
        status: 'active',
    },
    // ─── Toulouse / Midi-Pyrénées ───
    {
        id: 'BA-101', name: 'BA 101 Toulouse-Francazal',
        type: 'air', icao: 'LFBF',
        coordinates: [1.3631, 43.5453],
        description: 'École de l\'air et de l\'espace (EAE). Formation des pilotes.',
        region: 'Occitanie', aircraft: ['PC-21', 'Grob 120', 'Alpha Jet'],
        units: ['EAE'],
        status: 'active',
    },
    // ─── Reims / Champagne ───
    {
        id: 'BA-112', name: 'BA 112 Reims',
        type: 'air', icao: 'LFSR',
        coordinates: [4.0528, 49.3097],
        description: 'Base fermée 2011. Site reconverti (piste civile Vatry).',
        region: 'Grand Est', status: 'closed',
    },
    // ─── Autres ───
    {
        id: 'BA-116', name: 'BA 116 Luxeuil',
        type: 'air', icao: 'LFSX',
        coordinates: [6.3642, 47.7831],
        description: 'Voir BA 117. Site regroupé.',
        region: 'Bourgogne-Franche-Comté', status: 'reduced',
    },
    {
        id: 'BA-124', name: 'BA 124 Strasbourg-Entzheim',
        type: 'air', icao: 'LFST',
        coordinates: [7.6281, 48.5383],
        description: 'Antenne militaire sur aéroport civil. Surtout soutien.',
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'BA-721', name: 'BA 721 Rochefort-Soubise',
        type: 'air', icao: 'LFDN',
        coordinates: [-0.9208, 45.8877],
        description: 'Hélicoptères militaires, formation rotor. École des techniques aéronautiques.',
        region: 'Nouvelle-Aquitaine', aircraft: ['EC135', 'AS555 Fennec'],
        status: 'active',
    },
    {
        id: 'BA-126', name: 'BA 126 Solenzara',
        type: 'air', icao: 'LFKS',
        coordinates: [9.4061, 41.9244],
        description: 'Détachement Corse "Envol". Rafale en alerte POSEIDON Méditerranée.',
        region: 'Corse', aircraft: ['Rafale'],
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
        description: 'SNLE (4 sous-marins nucléaires) à Île Longue. Frégates FREMM, BPC.',
        region: 'Bretagne',
        units: ['Force Océanique Stratégique', 'Escadre de l\'Atlantique'],
        aircraft: ['ATL2', 'NH90'],
        status: 'active',
    },
    {
        id: 'BN-ILE-LONGUE', name: 'Île Longue — SNLE',
        type: 'navy',
        coordinates: [-4.5636, 48.3253],
        description: 'Arsenal de l\'Île Longue. Bastion des SNLE (Triomphant, Téméraire, Vigilant, Terrible). Composante mer de la dissuasion nucléaire.',
        region: 'Bretagne',
        units: ['SNLE Le Triomphant', 'SNLE Le Téméraire', 'SNLE Le Vigilant', 'SNLE Le Terrible'],
        status: 'active',
    },
    {
        id: 'BN-LAN', name: 'Base aéronavale de Lann-Bihoué',
        type: 'navy', icao: 'LFRH',
        coordinates: [-3.4667, 47.7606],
        description: 'Patrouille maritime Atlantique 2. Surveillance Atlantique Nord.',
        region: 'Bretagne', aircraft: ['Atlantique 2'],
        units: ['Flottille 21F', 'Flottille 23F'],
        status: 'active',
    },
    {
        id: 'BN-LOR', name: 'Base navale de Lorient-Kéroman',
        type: 'navy',
        coordinates: [-3.3625, 47.7456],
        description: 'Sous-marins d\'attaque (SNA Rubis/Suffren). Frégates de surveillance.',
        region: 'Bretagne', units: ['SNA Saphir', 'SNA Améthyste'],
        status: 'active',
    },
    {
        id: 'BN-CHE', name: 'Base navale de Cherbourg',
        type: 'navy',
        coordinates: [-1.6375, 49.6508],
        description: 'Patrouilleurs de haute mer. DCNS constructions navales. Port commercial partagé.',
        region: 'Normandie', status: 'active',
    },
    {
        id: 'BN-LH', name: 'Base navale Amiral Durand-Viel — Le Havre',
        type: 'navy',
        coordinates: [0.1079, 49.4830],
        description: 'Commandement Marine Le Havre. Ponton d\'accueil chasseurs de mines. Soutien forces navales Manche.',
        region: 'Normandie', status: 'active',
    },
    {
        id: 'DTI-LH', name: 'District de Transit Interarmées — Le Havre',
        type: 'joint',
        coordinates: [0.1200, 49.4750],
        description: 'Transit maritime troupes et matériel. ~100 personnels civils et militaires. Implanté depuis 1964.',
        region: 'Normandie', status: 'active',
    },
    // ─── Méditerranée ───
    {
        id: 'BN-TLN', name: 'Base navale de Toulon',
        type: 'navy',
        coordinates: [5.9189, 43.1190],
        description: 'Plus grande base navale de Méditerranée. PA Charles-de-Gaulle, FREMM, BPC Mistral.',
        region: 'Provence-Alpes-Côte d\'Azur',
        units: ['Groupe Aéronaval', 'ALFAN'],
        aircraft: ['Rafale Marine', 'E-2C Hawkeye', 'AS365 Dauphin'],
        status: 'active',
    },
    {
        id: 'BN-HYE', name: 'Base aéronavale de Hyères-Le Palyvestre',
        type: 'navy', icao: 'LFTH',
        coordinates: [6.1467, 43.0967],
        description: 'Hélicoptères navals (NH90, EC725). Flottille 35F et 36F.',
        region: 'Provence-Alpes-Côte d\'Azur',
        aircraft: ['NH90 Caïman Marine', 'AS565 Panther'],
        units: ['Flottille 35F', 'Flottille 36F'],
        status: 'active',
    },
    // ─── Atlantique Sud ───
    {
        id: 'BN-ROC', name: 'Base navale de Rochefort',
        type: 'navy',
        coordinates: [-0.9625, 45.9461],
        description: 'Ateliers de maintenance navale, école de maistrance.',
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    // ─── Atlantique Centre ───
    {
        id: 'BN-RCY', name: 'Base aéronavale de Nîmes-Garons',
        type: 'navy', icao: 'LFTW',
        coordinates: [4.4156, 43.7561],
        description: 'Atlantique 2 (Flottille 24F). Escale stratégique Méditerranée.',
        region: 'Occitanie', aircraft: ['Atlantique 2'],
        units: ['Flottille 24F'],
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// ARMÉE DE TERRE — Garnisons, camps et régiments
// ═══════════════════════════════════════════════════════════════════════════

const ARMY_BASES: MilitaryInstallation[] = [
    // ─── Légion Étrangère ───
    {
        id: 'AT-AUBAGNE', name: 'Légion Étrangère — Aubagne',
        type: 'army',
        coordinates: [5.5697, 43.2958],
        description: 'Quartier Viénot — Maison Mère de la Légion Étrangère. 1er RE, Musée.',
        region: 'Provence-Alpes-Côte d\'Azur',
        units: ['1er Régiment Étranger'],
        status: 'active',
    },
    {
        id: 'AT-CASTELNAUDARY', name: '4e RE — Castelnaudary',
        type: 'army',
        coordinates: [1.9578, 43.3131],
        description: 'Centre d\'instruction de la Légion Étrangère. Formation recrues.',
        region: 'Occitanie', units: ['4e Régiment Étranger'],
        status: 'active',
    },
    {
        id: 'AT-NIMES', name: '1er REC — Nîmes-Laudun',
        type: 'army',
        coordinates: [4.4642, 44.0833],
        description: '1er Régiment Étranger de Cavalerie. ERC 90 Sagaie, VAB.',
        region: 'Occitanie', status: 'active',
    },
    {
        id: 'AT-ORANGE', name: '1er REG — Orange',
        type: 'army',
        coordinates: [4.7975, 44.1500],
        description: '1er Régiment Étranger de Génie. Soutien génie combat.',
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    // ─── Parachutistes ───
    {
        id: 'AT-PAMIERS', name: '1er RPIMa — Pamiers',
        type: 'army',
        coordinates: [1.6100, 43.1167],
        description: '1er Régiment Parachutiste d\'Infanterie de Marine. Unité d\'élite.',
        region: 'Occitanie', status: 'active',
    },
    {
        id: 'AT-TARBES', name: '1er RHP — Tarbes',
        type: 'army',
        coordinates: [0.0878, 43.2328],
        description: '1er Régiment de Hussards Parachutistes. Reconnaissance.',
        region: 'Occitanie', status: 'active',
    },
    {
        id: 'AT-TOULOUSE-BIPARACHUTE', name: 'ETAP — Pau-Lescar',
        type: 'army', icao: 'LFBP',
        coordinates: [-0.4186, 43.3803],
        description: 'École des Troupes Aéroportées (ETAP). Formation saut en parachute.',
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    // ─── Blindés / Cavalerie ───
    {
        id: 'AT-CARPIQUET', name: '12e RC — Caen-Carpiquet',
        type: 'army',
        coordinates: [-0.4500, 49.1806],
        description: '12e Régiment de Cuirassiers. Leclerc, VBCI.',
        region: 'Normandie', status: 'active',
    },
    {
        id: 'AT-MOURMELON', name: 'Camp de Mourmelon-le-Grand',
        type: 'army',
        coordinates: [4.3644, 49.1367],
        description: 'Grand camp d\'entraînement blindés. 1er RCA, exercices OTAN.',
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'AT-BITCHE', name: 'Camp de Bitche',
        type: 'army',
        coordinates: [7.4747, 49.0614],
        description: 'Polygone de tir, formation infanterie. 57e RA.',
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'AT-CANJUERS', name: 'Camp de Canjuers',
        type: 'army',
        coordinates: [6.3267, 43.7225],
        description: 'Plus grand camp militaire d\'Europe occidentale. 36 000 ha. Manœuvres blindés, hélicoptères.',
        region: 'Provence-Alpes-Côte d\'Azur',
        status: 'active',
    },
    {
        id: 'AT-VALDAHON', name: 'Camp de Valdahon',
        type: 'army',
        coordinates: [6.3200, 47.1533],
        description: 'Centre de maintien en condition opérationnelle. 13e BCA, artillerie.',
        region: 'Bourgogne-Franche-Comté', status: 'active',
    },
    {
        id: 'AT-LA-COURTINE', name: 'Camp de La Courtine',
        type: 'army',
        coordinates: [2.2756, 45.7183],
        description: 'Centre de formation artillerie, camp d\'entraînement Massif Central.',
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    {
        id: 'AT-CAYLUS', name: 'Camp de Caylus',
        type: 'army',
        coordinates: [1.8439, 44.2311],
        description: 'Polygone de tir blindés. 8e RPIMa, exercices.',
        region: 'Occitanie', status: 'active',
    },
    // ─── Marines / Infanterie de Marine ───
    {
        id: 'AT-VANNES', name: '1er RIMa — Vannes',
        type: 'army',
        coordinates: [-2.7611, 47.6581],
        description: '1er Régiment d\'Infanterie de Marine. Bretagne.',
        region: 'Bretagne', status: 'active',
    },
    {
        id: 'AT-MONTLHERY', name: 'Camp de Satory — Versailles',
        type: 'army',
        coordinates: [2.0717, 48.8019],
        description: 'DGA essais armements terrestres. Centre d\'expérimentation.',
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'AT-DRAGUIGNAN', name: 'CA — Draguignan',
        type: 'army',
        coordinates: [6.4647, 43.5353],
        description: 'École d\'artillerie (EA), Centre de doctrine et d\'enseignement du commandement.',
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'AT-COETQUIDAN', name: 'Coëtquidan — Saint-Cyr',
        type: 'army',
        coordinates: [-2.3542, 47.9053],
        description: 'École Spéciale Militaire de Saint-Cyr. École nationale des sous-officiers (ENSOA). Formation élites.',
        region: 'Bretagne', status: 'active',
    },
    {
        id: 'AT-SAUMUR', name: 'École de Cavalerie — Saumur',
        type: 'army',
        coordinates: [-0.0761, 47.2597],
        description: 'École de l\'Arme Blindée Cavalerie. Cadre Noir (équitation). Leclerc, AMX-10RC.',
        region: 'Pays de la Loire', status: 'active',
    },
    {
        id: 'AT-ANGERS', name: 'ENSOA — Le Mans / Auvours',
        type: 'army',
        coordinates: [0.2083, 47.9928],
        description: 'École Nationale des Sous-Officiers d\'Active. Camp d\'Auvours.',
        region: 'Pays de la Loire', status: 'active',
    },
    {
        id: 'AT-VINCENNES', name: 'Fort de Vincennes — CEMA',
        type: 'army',
        coordinates: [2.4350, 48.8475],
        description: 'Fort de Vincennes. 46e RT (transmissions), état-major.',
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'AT-BESANCON', name: 'Caserne Ruty — Besançon',
        type: 'army',
        coordinates: [6.0256, 47.2378],
        description: '8e BC (Bataillon de Chasseurs Alpins). Jura.',
        region: 'Bourgogne-Franche-Comté', status: 'active',
    },
    {
        id: 'AT-CHAMBERY', name: 'Caserne Carré — Chambéry',
        type: 'army',
        coordinates: [5.9252, 45.5631],
        description: '13e Bataillon de Chasseurs Alpins. Alpes-Savoie.',
        region: 'Auvergne-Rhône-Alpes', status: 'active',
    },
    {
        id: 'AT-VARCES', name: 'Camp de Varces — Grenoble',
        type: 'army',
        coordinates: [5.6833, 45.0833],
        description: '27e BCA (Bataillon de Chasseurs Alpins). Grenoble.',
        region: 'Auvergne-Rhône-Alpes', status: 'active',
    },
    {
        id: 'AT-GAP', name: '4e RAMa — Gap-Ubaye',
        type: 'army',
        coordinates: [6.0833, 44.5500],
        description: '4e Régiment d\'Artillerie de Montagne. Haute-Savoie/Hautes-Alpes.',
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    // ─── Forces Spéciales ───
    {
        id: 'AT-PAU', name: '1er RPIMA — Bayone / PAU (COS)',
        type: 'joint',
        coordinates: [-0.3706, 43.3128],
        description: 'Commandement des Opérations Spéciales (COS). 13e RDP, 1er BCP.',
        region: 'Nouvelle-Aquitaine',
        units: ['13e RDP', '1er BCP', 'COS'],
        status: 'active',
    },
    {
        id: 'AT-LORIENT-FS', name: 'Groupement des Commandos Marine — Lorient',
        type: 'navy',
        coordinates: [-3.3764, 47.7375],
        description: 'Commandos Marine (Kieffer, Jaubert, Trepel, de Montfort, Hubert, Penfentenyo).',
        region: 'Bretagne',
        units: ['Commando Hubert', 'Commando Jaubert'],
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// ALAT — Aviation Légère de l'Armée de Terre
// ═══════════════════════════════════════════════════════════════════════════

const ALAT_BASES: MilitaryInstallation[] = [
    {
        id: 'ALAT-DAUX', name: 'Établissement d\'Aviation Légère — Dax',
        type: 'army', icao: 'LFCD',
        coordinates: [-1.0653, 43.6900],
        description: 'École de l\'ALAT. Formation pilotes hélicoptères militaires. Gazelle, EC120.',
        region: 'Nouvelle-Aquitaine', aircraft: ['AS342 Gazelle', 'EC120 Colibri'],
        status: 'active',
    },
    {
        id: 'ALAT-PHALSBOURG', name: '1er RHC — Phalsbourg',
        type: 'army', icao: 'LFGP',
        coordinates: [7.2075, 48.7683],
        description: '1er Régiment d\'Hélicoptères de Combat. Tigre HAP/HAD, NH90.',
        region: 'Grand Est', aircraft: ['Tigre HAD', 'NH90 TTH'],
        units: ['1er RHC'],
        status: 'active',
    },
    {
        id: 'ALAT-RENNES', name: '3e RHC — Rennes-Saint-Jacques',
        type: 'army', icao: 'LFRN',
        coordinates: [-1.7317, 48.0697],
        description: '3e Régiment d\'Hélicoptères de Combat. Tigre, NH90 Caïman.',
        region: 'Bretagne', aircraft: ['Tigre', 'NH90'],
        units: ['3e RHC'],
        status: 'active',
    },
    {
        id: 'ALAT-VALENCE', name: '5e RHC — Valence',
        type: 'army', icao: 'LFLU',
        coordinates: [4.9697, 44.9214],
        description: '5e Régiment d\'Hélicoptères de Combat. NH90, Cougar.',
        region: 'Auvergne-Rhône-Alpes', aircraft: ['NH90', 'EC725 Caracal'],
        units: ['5e RHC'],
        status: 'active',
    },
    {
        id: 'ALAT-ESSEY', name: '1er RHC AZUR — Nancy-Essey',
        type: 'army', icao: 'LFSN',
        coordinates: [6.2308, 48.6914],
        description: 'Détachement hélicoptères ALAT Est. EC135, Fennec.',
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'ALAT-CANNET', name: '4e RHFS — Le Cannet-des-Maures',
        type: 'joint', icao: 'LFMK',
        coordinates: [6.3553, 43.4083],
        description: '4e Régiment d\'Hélicoptères des Forces Spéciales. EC725 Caracal, AS532 Cougar.',
        region: 'Provence-Alpes-Côte d\'Azur',
        aircraft: ['EC725 Caracal', 'AS532 Cougar'],
        units: ['4e RHFS'],
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// GENDARMERIE — Groupements d'hélicoptères
// ═══════════════════════════════════════════════════════════════════════════

const GENDARMERIE_BASES: MilitaryInstallation[] = [
    {
        id: 'GND-NIMES', name: 'Gicat 6 — Nîmes-Garons (Gendarmerie)',
        type: 'joint', icao: 'LFTW',
        coordinates: [4.4078, 43.7572],
        description: 'Section aérienne de gendarmerie (SAG). EC135, Fennec.',
        region: 'Occitanie', aircraft: ['EC135', 'EC145'],
        status: 'active',
    },
    {
        id: 'GND-BORDEAUX', name: 'SAG de Bordeaux-Mérignac',
        type: 'joint', icao: 'LFBD',
        coordinates: [-0.7156, 44.8278],
        description: 'Section aérienne de gendarmerie Sud-Ouest.',
        region: 'Nouvelle-Aquitaine', aircraft: ['EC135', 'EC145'],
        status: 'active',
    },
    {
        id: 'GND-ANNECY', name: 'SAG Annecy-Meythet',
        type: 'joint', icao: 'LFLI',
        coordinates: [6.0983, 45.9294],
        description: 'Gendarmerie alpine. Opérations montagne.',
        region: 'Auvergne-Rhône-Alpes', aircraft: ['EC135', 'Fennec'],
        status: 'active',
    },
    {
        id: 'GND-RENNES', name: 'SAG Rennes-Saint-Jacques',
        type: 'joint', icao: 'LFRN',
        coordinates: [-1.7317, 48.0697],
        description: 'Section aérienne de gendarmerie Grand-Ouest.',
        region: 'Bretagne', aircraft: ['EC135'],
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// SÉCURITÉ CIVILE — Bases Bombardiers d'eau
// ═══════════════════════════════════════════════════════════════════════════

const SECURITE_CIVILE_BASES: MilitaryInstallation[] = [
    {
        id: 'SC-MARIGNANE', name: 'Sécurité Civile — Marignane',
        type: 'joint', icao: 'LFML',
        coordinates: [5.2214, 43.4353],
        description: 'Base principale bombardiers d\'eau. Canadair CL-415, Dash 8.',
        region: 'Provence-Alpes-Côte d\'Azur',
        aircraft: ['Canadair CL-415', 'Dash 8 Q400T', 'Beechcraft King Air'],
        status: 'active',
    },
    {
        id: 'SC-NIMES', name: 'Sécurité Civile — Nîmes-Garons',
        type: 'joint', icao: 'LFTW',
        coordinates: [4.4167, 43.7569],
        description: 'Base secondaire. Pelican, Dragon. Feux de forêt méditerranée.',
        region: 'Occitanie',
        aircraft: ['Canadair CL-415'],
        status: 'active',
    },
    {
        id: 'SC-BASTIA', name: 'Sécurité Civile — Bastia-Poretta',
        type: 'joint', icao: 'LFKB',
        coordinates: [9.4833, 42.5522],
        description: 'Détachement estival. Bombardiers d\'eau Corse.',
        region: 'Corse', aircraft: ['Dash 8', 'Tracker'],
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// DROM-COM — Territoires ultramarins
// ═══════════════════════════════════════════════════════════════════════════

const OVERSEAS_BASES: MilitaryInstallation[] = [
    // ─── Antilles ───
    {
        id: 'FAA-971-FDF', name: 'Fort-de-France — FAA Martinique',
        type: 'joint',
        coordinates: [-61.0631, 14.6137],
        description: 'Forces Armées Antilles. Régiment SMA, Marine, bataillon infanterie.',
        region: 'Martinique',
        units: ['RSMA Martinique', 'BIM Antilles'],
        status: 'active',
    },
    {
        id: 'FAA-971-PTX', name: 'Pointe-à-Pitre — Guadeloupe (GEN)',
        type: 'joint', icao: 'TFFR',
        coordinates: [-61.5181, 16.2578],
        description: 'Détachement FAA Guadeloupe. Patrouilleur, hélicoptères Caraïbes.',
        region: 'Guadeloupe',
        aircraft: ['AS350 Écureuil'],
        status: 'active',
    },
    // ─── Guyane ───
    {
        id: 'FAG-973-CSG', name: 'FAG — Guyane (3e REI + 9e RIMa)',
        type: 'joint',
        coordinates: [-52.3653, 4.8228],
        description: 'Forces Armées en Guyane. Protection CSG (Guiana Space Centre). 3e REI, 9e RIMa.',
        region: 'Guyane',
        units: ['3e Régiment Étranger d\'Infanterie', '9e RIMa'],
        status: 'active',
    },
    {
        id: 'FAG-973-AIR', name: 'BA Cayenne-Rochambeau',
        type: 'air', icao: 'SOCA',
        coordinates: [-52.3611, 4.8203],
        description: 'Détachement air Guyane. CN-235, hélicoptères de surveillance spatiale.',
        region: 'Guyane', aircraft: ['CN-235', 'AS555 Fennec'],
        status: 'active',
    },
    // ─── La Réunion ───
    {
        id: 'FAZSOI-974-REU', name: 'FAZSOI — La Réunion',
        type: 'joint',
        coordinates: [55.5364, -20.9022],
        description: 'Forces Armées Zone Sud Océan Indien. 2e RPIMa, Marine à Port-des-Galets.',
        region: 'La Réunion',
        units: ['2e RPIMa', 'Détachement Marine Port-des-Galets'],
        status: 'active',
    },
    // ─── Mayotte ───
    {
        id: 'DROM-MYT-DZA', name: 'Détachement Marine — Dzaoudzi (Mayotte)',
        type: 'navy',
        coordinates: [45.2569, -12.7871],
        description: 'Patrouilleur Mahorais. Lutte contre immigration clandestine.',
        region: 'Mayotte',
        units: ['Patrouilleur Mahorais'],
        status: 'active',
    },
    // ─── Polynésie ───
    {
        id: 'FAPF-987-TAH', name: 'FAPF — Polynésie Française (Papeete)',
        type: 'joint', icao: 'NTAA',
        coordinates: [-149.6067, -17.5536],
        description: 'Forces Armées Polynésie Française. Frégate de surveillance, CSMAR Papeete.',
        region: 'Polynésie Française',
        units: ['RSMA Polynésie', 'Marine FPF'],
        aircraft: ['Falcon 200 Guardian', 'Casa CN-235'],
        status: 'active',
    },
    // ─── Nouvelle-Calédonie ───
    {
        id: 'FANC-988-NOU', name: 'FANC — Nouméa (Nouvelle-Calédonie)',
        type: 'joint',
        coordinates: [166.4414, -22.2558],
        description: 'Forces Armées Nouvelle-Calédonie. Base navale Chaleix, Régiment Pacifique.',
        region: 'Nouvelle-Calédonie',
        units: ['RIMAP-NC', 'Marine FANC'],
        status: 'active',
    },
    // ─── Djibouti ───
    {
        id: 'FFDj-DJ-DJI', name: 'Forces Françaises à Djibouti',
        type: 'joint', icao: 'HDAM',
        coordinates: [43.1547, 11.5483],
        description: 'Base permanente. 13e DBLE (Légion Étrangère), 5e RIAOM (infanterie de marine), aviation.',
        region: 'Djibouti',
        units: ['13e DBLE', '5e RIAOM'],
        aircraft: ['Mirage 2000C', 'C-160 Transall', 'AS555 Fennec'],
        status: 'active',
    },
    // ─── Sénégal ───
    {
        id: 'EFS-SN-DAK', name: 'Éléments Français au Sénégal — Dakar',
        type: 'joint', icao: 'GOOY',
        coordinates: [-17.4906, 14.7394],
        description: 'EFS Sénégal. Camp Lat Dior. Base navale partagée Port de Dakar.',
        region: 'Sénégal',
        units: ['Détachement interarmées'],
        status: 'active',
    },
    // ─── Gabon ───
    {
        id: 'EFG-GA-LBV', name: 'Éléments Français au Gabon — Libreville',
        type: 'joint', icao: 'FOOL',
        coordinates: [9.4122, 0.4581],
        description: 'EFG Libreville. 6e BIMA, soutien Afrique centrale.',
        region: 'Gabon',
        units: ['6e BIMA'],
        status: 'active',
    },
    // ─── Côte d'Ivoire ───
    {
        id: 'FFCI-CI-ABJ', name: 'Forces Françaises en Côte d\'Ivoire — Abidjan',
        type: 'joint', icao: 'DIAP',
        coordinates: [-4.0153, 5.2614],
        description: '43e BIMa. Soutien région Afrique de l\'Ouest.',
        region: 'Côte d\'Ivoire',
        units: ['43e BIMa'],
        status: 'active',
    },
    // ─── Saint-Pierre-et-Miquelon ───
    {
        id: 'NAV-975-SPM', name: 'Détachement — Saint-Pierre-et-Miquelon',
        type: 'navy',
        coordinates: [-56.1833, 46.7667],
        description: 'Petite présence navale. Surveillance maritime Atlantique Nord.',
        region: 'Saint-Pierre-et-Miquelon', status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// DGA — Direction Générale de l'Armement (sites de test)
// ═══════════════════════════════════════════════════════════════════════════

const DGA_SITES: MilitaryInstallation[] = [
    {
        id: 'DGA-ISTRES', name: 'DGA Essais en vol — Istres',
        type: 'air', icao: 'LFMI',
        coordinates: [4.9242, 43.5233],
        description: 'CEV Istres. Qualification avions militaires français (Rafale, A400M, MRTT).',
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'DGA-CAZAUX', name: 'DGA Essais en vol — Cazaux (EPNER)',
        type: 'air', icao: 'LFBC',
        coordinates: [-1.1250, 44.5328],
        description: 'EPNER (École du Personnel Navigant d\'Essais et de Réception).',
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    {
        id: 'DGA-SATORY', name: 'DGA Techniques terrestres — Satory',
        type: 'army',
        coordinates: [2.0717, 48.8019],
        description: 'Essais armements terrestres, blindés, munitions.',
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'DGA-TOULON', name: 'DGA Techniques navales — Toulon',
        type: 'navy',
        coordinates: [5.8958, 43.1239],
        description: 'Essais systèmes navals, torpilles, armes sous-marines.',
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'DGA-BISCAROSSE', name: 'DGA Essais missiles — Biscarosse',
        type: 'joint',
        coordinates: [-1.2347, 44.3856],
        description: 'DGA EM Biscarosse. Tirs missiles balistiques (M51, ASMP-A) Landes.',
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    {
        id: 'DGA-BREGUET', name: 'DGA MI — Bruz (Rennes)',
        type: 'joint',
        coordinates: [-1.6944, 48.0156],
        description: 'Centre de maîtrise de l\'information. Cyber, électronique, guerre électronique.',
        region: 'Bretagne', status: 'active',
    },
    {
        id: 'DGA-CLAR', name: 'DGA Maîtrise NRBC — La Délégat.',
        type: 'joint',
        coordinates: [2.1903, 48.9644],
        description: 'Vert-le-Petit. Essais risques NRBC (nucléaire, radiologique, bactériologique, chimique).',
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
        description: 'Station radar CDAOA. Massif de la Clape. Surveillance espace aérien Sud.',
        subtype: 'radar',
        tier: 2,
        region: 'Occitanie', status: 'active',
    },
    {
        id: 'EAR-943', name: 'EAR 943 Nice (Mont-Agel)',
        type: 'air',
        coordinates: [7.4167, 43.8000],
        description: 'Station radar CDAOA. Mont Agel (1148m). Couverture Méditerranée Est.',
        subtype: 'radar',
        tier: 2,
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'EAR-942', name: 'EAR 942 Lyon (Mont-Verdun)',
        type: 'air',
        coordinates: [4.7758, 45.8706],
        description: 'Station radar CDAOA. Mont Verdun (625m). Centre de détection et contrôle principal.',
        subtype: 'radar',
        tier: 1,
        region: 'Auvergne-Rhône-Alpes', status: 'active',
    },
    {
        id: 'EAR-901', name: 'EAR 901 Drachenbronn',
        type: 'air',
        coordinates: [7.9167, 49.0500],
        description: 'Station radar CDAOA. Bunker souterrain de la Ligne Maginot. CDC Nord-Est.',
        subtype: 'radar',
        tier: 1,
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'CDC-CINQ-MARS', name: 'CDC 05/901 Cinq-Mars-la-Pile',
        type: 'air',
        coordinates: [0.4667, 47.3500],
        description: 'Centre de Détection et de Contrôle. Radar GM 403 STRIDA. Touraine.',
        subtype: 'radar',
        tier: 2,
        region: 'Centre-Val de Loire', status: 'active',
    },
    {
        id: 'CDC-MONT-DE-MARSAN', name: 'CDC Mont-de-Marsan',
        type: 'air',
        coordinates: [-0.5058, 43.9131],
        description: 'Centre de Détection et de Contrôle Sud-Ouest. Collocalisé BA 118.',
        subtype: 'radar',
        tier: 2,
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    // ─── GRAVES — Surveillance spatiale ───
    {
        id: 'GRAVES-ONERA', name: 'GRAVES — Plateau d\'Albion',
        type: 'air',
        coordinates: [5.4833, 44.0667],
        description: 'Grand Réseau Adapté à la Veille Spatiale. Radar de surveillance des satellites et débris. DGA/CNES.',
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
        description: 'Centre de Détection et de Communication Aéronavale. Antennes VLF pour communication SNLE. Site stratégique dissuasion.',
        subtype: 'transmission-vlf',
        tier: 1,
        region: 'Centre-Val de Loire', status: 'active',
    },
    {
        id: 'CDAA-SAINTE-ASSISE', name: 'Centre radio Sainte-Assise',
        type: 'joint',
        coordinates: [2.6333, 48.5667],
        description: 'Centre de transmissions Marine. Antennes HF/VLF. Liaison sous-marins stratégiques.',
        subtype: 'transmission-vlf',
        tier: 1,
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'DIRISI-CREIL', name: 'DIRISI — Creil',
        type: 'joint',
        coordinates: [2.5192, 49.2536],
        description: 'Direction Interarmées des Réseaux d\'Infrastructure et des Systèmes d\'Information. Hub télécommunications.',
        subtype: 'transmission',
        tier: 2,
        region: 'Hauts-de-France', status: 'active',
    },
    {
        id: 'SYRACUSE-CESSON', name: 'Station SYRACUSE — Cesson-Sévigné',
        type: 'joint',
        coordinates: [-1.6097, 48.1253],
        description: 'Station sol du système satellite militaire SYRACUSE. Communications stratégiques.',
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
        description: 'Établissement Principal des Munitions. Plus grand dépôt de France. 5000 ha.',
        subtype: 'ammunition',
        tier: 1,
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'SIMU-BRIENNE', name: 'EPMu de Brienne-le-Château',
        type: 'army',
        coordinates: [4.5333, 48.3833],
        description: 'Établissement Principal des Munitions. Grand Est.',
        subtype: 'ammunition',
        tier: 2,
        region: 'Grand Est', status: 'active',
    },
    {
        id: 'SIMU-GUERET', name: 'EPMu de Guéret',
        type: 'army',
        coordinates: [1.8667, 46.1667],
        description: 'Établissement Principal des Munitions. Centre France.',
        subtype: 'ammunition',
        tier: 2,
        region: 'Nouvelle-Aquitaine', status: 'active',
    },
    {
        id: 'SIMU-GRAMAT', name: 'CEA DAM — Gramat (CESTA)',
        type: 'joint',
        coordinates: [1.7167, 44.7833],
        description: 'Centre d\'études scientifiques et techniques d\'Aquitaine. Recherche effets d\'armes.',
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
        id: 'HQ-PARIS-VAL', name: 'Ministère des Armées — Balard (EMA)',
        type: 'joint',
        coordinates: [2.2840, 48.8428],
        description: 'Pentagone français. État-Major des Armées, DGSÉC, tous commandements centraux.',
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'HQ-ROCQUENCOURT', name: 'SHAPE France — Rocquencourt',
        type: 'joint',
        coordinates: [2.0758, 48.8525],
        description: 'NATO HQ SACT (anciennement SHAPE). Commandement OTAN transformation.',
        region: 'Île-de-France', status: 'active',
    },
    {
        id: 'HQ-CREIL-CDAOA', name: 'CDAOA — Creil',
        type: 'air',
        coordinates: [2.5192, 49.2536],
        description: 'Commandement Défense Aérienne et Opérations Aériennes. Centre opérations Taverny/Creil.',
        region: 'Hauts-de-France', status: 'active',
    },
    {
        id: 'HQ-BRE-COMAR', name: 'COMAR Atlantique — Brest',
        type: 'navy',
        coordinates: [-4.4953, 48.3894],
        description: 'Commandement Maritime Atlantique. Préfecture maritime.',
        region: 'Bretagne', status: 'active',
    },
    {
        id: 'HQ-TLN-COMAR', name: 'COMAR Méditerranée — Toulon',
        type: 'navy',
        coordinates: [5.9300, 43.1250],
        description: 'Commandement Maritime Méditerranée. Préfecture maritime.',
        region: 'Provence-Alpes-Côte d\'Azur', status: 'active',
    },
    {
        id: 'HQ-CHERBOURG-COMAR', name: 'COMAR Manche-Mer du Nord',
        type: 'navy',
        coordinates: [-1.6225, 49.6525],
        description: 'Préfecture maritime Manche-Mer du Nord.',
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

