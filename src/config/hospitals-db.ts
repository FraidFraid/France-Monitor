export interface Hospital {
    finess: string;
    name: string;
    type: string;
    lat: number;
    lon: number;
    beds?: number;
    emergency: boolean;
}

// Base enrichie d'établissements hospitaliers majeurs (CHU + CH/CHR + gros hôpitaux publics).
// Objectif: couverture nationale métropole + DROM pour le layer "Hôpitaux".
export const MAIN_HOSPITALS_DB: Hospital[] = [
    { finess: '750100042', name: 'AP-HP Hôpital Pitié-Salpêtrière', type: 'CHU', lat: 48.8385, lon: 2.3653, beds: 1675, emergency: true },
    { finess: '750100067', name: 'AP-HP Hôpital Européen Georges-Pompidou', type: 'CHU', lat: 48.8398, lon: 2.2721, beds: 825, emergency: true },
    { finess: '750100091', name: 'AP-HP Hôpital Bichat - Claude-Bernard', type: 'CHU', lat: 48.8992, lon: 2.3323, beds: 933, emergency: true },
    { finess: '750100141', name: 'AP-HP Hôpital Necker-Enfants Malades', type: 'CHU', lat: 48.8450, lon: 2.3160, beds: 660, emergency: true },
    { finess: '750100208', name: 'AP-HP Hôpital Cochin', type: 'CHU', lat: 48.8400, lon: 2.3382, beds: 911, emergency: true },
    { finess: '920100016', name: 'AP-HP Hôpital Antoine-Béclère (Clamart)', type: 'CHU', lat: 48.7951, lon: 2.2610, beds: 600, emergency: true },
    { finess: '940100028', name: 'AP-HP Hôpital Henri-Mondor (Créteil)', type: 'CHU', lat: 48.7902, lon: 2.4498, beds: 1040, emergency: true },
    { finess: '930100091', name: 'AP-HP Hôpital Avicenne (Bobigny)', type: 'CHU', lat: 48.9102, lon: 2.4256, beds: 500, emergency: true },

    { finess: '130786049', name: 'AP-HM Hôpital de la Timone', type: 'CHU', lat: 43.2888, lon: 5.4024, beds: 1046, emergency: true },
    { finess: '130786056', name: 'AP-HM Hôpital Nord', type: 'CHU', lat: 43.3768, lon: 5.3621, beds: 699, emergency: true },
    { finess: '130784001', name: 'Hôpital de la Conception (Marseille)', type: 'CH', lat: 43.2938, lon: 5.3958, beds: 550, emergency: true },
    { finess: '130789331', name: 'Hôpital d’Aix-en-Provence', type: 'CH', lat: 43.5295, lon: 5.4474, beds: 480, emergency: true },

    { finess: '690781810', name: 'HCL Hôpital Edouard Herriot', type: 'CHU', lat: 45.7436, lon: 4.8814, beds: 978, emergency: true },
    { finess: '690781828', name: 'HCL Hôpital Lyon Sud', type: 'CHU', lat: 45.6963, lon: 4.8087, beds: 844, emergency: true },
    { finess: '690782214', name: 'Hôpital de la Croix-Rousse (Lyon)', type: 'CHU', lat: 45.7807, lon: 4.8323, beds: 680, emergency: true },
    { finess: '690783410', name: 'Médipôle Lyon-Villeurbanne', type: 'CH', lat: 45.7682, lon: 4.9027, beds: 700, emergency: true },

    { finess: '330781196', name: 'CHU de Bordeaux - Groupe Hospitalier Pellegrin', type: 'CHU', lat: 44.8291, lon: -0.6068, beds: 1391, emergency: true },
    { finess: '330780511', name: 'CH de Bordeaux - Saint-André', type: 'CHU', lat: 44.8345, lon: -0.5825, beds: 700, emergency: true },
    { finess: '330781519', name: 'CH de Bayonne', type: 'CH', lat: 43.4963, lon: -1.4764, beds: 500, emergency: true },
    { finess: '640780093', name: 'CH de Pau', type: 'CH', lat: 43.3055, lon: -0.3788, beds: 780, emergency: true },

    { finess: '310781406', name: 'CHU de Toulouse - Hôpital Purpan', type: 'CHU', lat: 43.6121, lon: 1.4013, beds: 972, emergency: true },
    { finess: '310780119', name: 'CHU de Toulouse - Rangueil', type: 'CHU', lat: 43.5606, lon: 1.4560, beds: 950, emergency: true },
    { finess: '310781687', name: 'CH de Montauban', type: 'CH', lat: 44.0196, lon: 1.3567, beds: 530, emergency: true },
    { finess: '320780028', name: 'CH d’Auch', type: 'CH', lat: 43.6480, lon: 0.5850, beds: 380, emergency: true },

    { finess: '590780193', name: 'CHU de Lille - Hôpital Roger Salengro', type: 'CHU', lat: 50.6136, lon: 3.0336, beds: 1400, emergency: true },
    { finess: '590781810', name: 'CH de Valenciennes', type: 'CH', lat: 50.3414, lon: 3.5171, beds: 2000, emergency: true },
    { finess: '620780085', name: 'CH de Lens', type: 'CH', lat: 50.4306, lon: 2.8269, beds: 900, emergency: true },
    { finess: '800780010', name: 'CHU Amiens-Picardie', type: 'CHU', lat: 49.8661, lon: 2.2783, beds: 1675, emergency: true },

    { finess: '670780055', name: 'CHU de Strasbourg - Hôpital de Hautepierre', type: 'CHU', lat: 48.5912, lon: 7.7083, beds: 1125, emergency: true },
    { finess: '670781301', name: 'CHU Strasbourg - Nouvel Hôpital Civil', type: 'CHU', lat: 48.5736, lon: 7.7521, beds: 850, emergency: true },
    { finess: '680780040', name: 'Hôpital Emile Muller (Mulhouse)', type: 'CH', lat: 47.7498, lon: 7.3352, beds: 780, emergency: true },
    { finess: '540780279', name: 'CHRU de Nancy - Brabois', type: 'CHU', lat: 48.6699, lon: 6.1544, beds: 900, emergency: true },

    { finess: '440780020', name: 'CHU de Nantes - Hôtel-Dieu', type: 'CHU', lat: 47.2104, lon: -1.5543, beds: 911, emergency: true },
    { finess: '440781010', name: 'CHU de Nantes - Hôpital Nord Laennec', type: 'CHU', lat: 47.2509, lon: -1.6245, beds: 680, emergency: true },
    { finess: '490780074', name: 'CHU d’Angers', type: 'CHU', lat: 47.4785, lon: -0.5632, beds: 1500, emergency: true },
    { finess: '530780012', name: 'CH de Laval', type: 'CH', lat: 48.0709, lon: -0.7700, beds: 420, emergency: true },

    { finess: '350781173', name: 'CHU de Rennes - Hôpital Pontchaillou', type: 'CHU', lat: 48.1189, lon: -1.6961, beds: 1040, emergency: true },
    { finess: '290780053', name: 'CHU de Brest - La Cavale Blanche', type: 'CHU', lat: 48.4092, lon: -4.4967, beds: 1200, emergency: true },
    { finess: '220780010', name: 'CH de Saint-Brieuc', type: 'CH', lat: 48.5068, lon: -2.7600, beds: 650, emergency: true },
    { finess: '560780036', name: 'CH Bretagne Atlantique (Vannes)', type: 'CH', lat: 47.6589, lon: -2.7600, beds: 1000, emergency: true },

    { finess: '340780477', name: 'CHU de Montpellier - Hôpital Lapeyronie', type: 'CHU', lat: 43.6339, lon: 3.8641, beds: 852, emergency: true },
    { finess: '300780085', name: 'CHU de Nîmes - Carémeau', type: 'CHU', lat: 43.8336, lon: 4.3385, beds: 740, emergency: true },
    { finess: '660780032', name: 'CH de Perpignan', type: 'CH', lat: 42.7036, lon: 2.8866, beds: 900, emergency: true },
    { finess: '110780028', name: 'CH de Narbonne', type: 'CH', lat: 43.1783, lon: 3.0056, beds: 500, emergency: true },

    { finess: '060780287', name: 'CHU de Nice - Hôpital Pasteur', type: 'CHU', lat: 43.7226, lon: 7.2838, beds: 800, emergency: true },
    { finess: '130780209', name: 'Hôpital de Toulon Sainte-Musse', type: 'CH', lat: 43.1245, lon: 5.9548, beds: 680, emergency: true },
    { finess: '840780012', name: 'CH d’Avignon - Henri Duffaut', type: 'CH', lat: 43.9493, lon: 4.8088, beds: 900, emergency: true },
    { finess: '830780010', name: 'CH de Fréjus Saint-Raphaël', type: 'CH', lat: 43.4337, lon: 6.7355, beds: 500, emergency: true },

    { finess: '380780080', name: 'CHU Grenoble Alpes - Hôpital Michallon', type: 'CHU', lat: 45.1989, lon: 5.7533, beds: 1845, emergency: true },
    { finess: '740780018', name: 'CH Annecy Genevois', type: 'CH', lat: 45.9030, lon: 6.1291, beds: 1400, emergency: true },
    { finess: '730780028', name: 'CH Métropole Savoie (Chambéry)', type: 'CH', lat: 45.5624, lon: 5.9178, beds: 1100, emergency: true },
    { finess: '260780012', name: 'CH de Valence', type: 'CH', lat: 44.9324, lon: 4.8924, beds: 750, emergency: true },

    { finess: '210780214', name: 'CHU Dijon Bourgogne - Hôpital François Mitterrand', type: 'CHU', lat: 47.3197, lon: 5.0683, beds: 1680, emergency: true },
    { finess: '710780044', name: 'CH de Chalon-sur-Saône', type: 'CH', lat: 46.7780, lon: 4.8535, beds: 700, emergency: true },
    { finess: '580780010', name: 'CH de Nevers', type: 'CH', lat: 46.9954, lon: 3.1572, beds: 500, emergency: true },
    { finess: '890780010', name: 'CH d’Auxerre', type: 'CH', lat: 47.7920, lon: 3.5800, beds: 470, emergency: true },

    { finess: '860000018', name: 'CHU de Poitiers - Site de la Milétrie', type: 'CHU', lat: 46.5613, lon: 0.3800, beds: 1475, emergency: true },
    { finess: '870780016', name: 'CHU de Limoges - Dupuytren', type: 'CHU', lat: 45.8310, lon: 1.2572, beds: 1200, emergency: true },
    { finess: '170780051', name: 'CH de La Rochelle', type: 'CH', lat: 46.1542, lon: -1.1439, beds: 1000, emergency: true },
    { finess: '790780028', name: 'CH de Niort', type: 'CH', lat: 46.3253, lon: -0.4571, beds: 620, emergency: true },

    { finess: '450780080', name: 'CHR d’Orléans', type: 'CH', lat: 47.9122, lon: 1.9095, beds: 1400, emergency: true },
    { finess: '370780051', name: 'CHRU de Tours - Bretonneau', type: 'CHU', lat: 47.3886, lon: 0.6889, beds: 1600, emergency: true },
    { finess: '410780036', name: 'CH de Blois', type: 'CH', lat: 47.5955, lon: 1.3335, beds: 580, emergency: true },
    { finess: '280780036', name: 'CH de Chartres', type: 'CH', lat: 48.4450, lon: 1.4940, beds: 700, emergency: true },

    { finess: '140780019', name: 'CHU de Caen Normandie', type: 'CHU', lat: 49.2031, lon: -0.3604, beds: 1100, emergency: true },
    { finess: '760780064', name: 'CHU de Rouen - Charles Nicolle', type: 'CHU', lat: 49.4431, lon: 1.0940, beds: 1300, emergency: true },
    { finess: '500780028', name: 'CH Public du Cotentin (Cherbourg)', type: 'CH', lat: 49.6506, lon: -1.6267, beds: 550, emergency: true },
    { finess: '610780028', name: 'CH d’Alençon', type: 'CH', lat: 48.4340, lon: 0.0924, beds: 420, emergency: true },

    { finess: '510780055', name: 'CHU de Reims - Robert Debré', type: 'CHU', lat: 49.2332, lon: 4.0135, beds: 1100, emergency: true },
    { finess: '100780010', name: 'CH de Troyes', type: 'CH', lat: 48.2974, lon: 4.0754, beds: 650, emergency: true },
    { finess: '520780028', name: 'CH de Chaumont', type: 'CH', lat: 48.1113, lon: 5.1396, beds: 450, emergency: true },
    { finess: '080780020', name: 'CH de Charleville-Mézières', type: 'CH', lat: 49.7731, lon: 4.7200, beds: 650, emergency: true },

    { finess: '630780041', name: 'CHU de Clermont-Ferrand - Gabriel Montpied', type: 'CHU', lat: 45.7599, lon: 3.1110, beds: 1900, emergency: true },
    { finess: '030780036', name: 'CH de Moulins-Yzeure', type: 'CH', lat: 46.5674, lon: 3.3320, beds: 500, emergency: true },
    { finess: '150780010', name: 'CH d’Aurillac', type: 'CH', lat: 44.9311, lon: 2.4459, beds: 430, emergency: true },
    { finess: '430780010', name: 'CH du Puy-en-Velay', type: 'CH', lat: 45.0434, lon: 3.8860, beds: 450, emergency: true },

    { finess: '971100028', name: 'CHU de la Guadeloupe', type: 'CHU', lat: 16.2360, lon: -61.5320, beds: 1200, emergency: true },
    { finess: '972100010', name: 'CHU de Martinique - Pierre Zobda-Quitman', type: 'CHU', lat: 14.6415, lon: -61.0087, beds: 1400, emergency: true },
    { finess: '973100010', name: 'CH de Cayenne - Andrée Rosemon', type: 'CH', lat: 4.9388, lon: -52.3135, beds: 700, emergency: true },
    { finess: '974100012', name: 'CHU de La Réunion - Site Nord (Saint-Denis)', type: 'CHU', lat: -20.9013, lon: 55.5204, beds: 1000, emergency: true },
    { finess: '974100020', name: 'CHU de La Réunion - Site Sud (Saint-Pierre)', type: 'CHU', lat: -21.3380, lon: 55.4769, beds: 1000, emergency: true },
    { finess: '976100015', name: 'CH de Mayotte', type: 'CH', lat: -12.7808, lon: 45.2288, beds: 450, emergency: true },
];
