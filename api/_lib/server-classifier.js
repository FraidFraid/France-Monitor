/**
 * GENERATED FILE — DO NOT EDIT.
 * Généré par scripts/generate-server-classifier.mjs depuis src/services/classifier.ts.
 * Régénération : npm run generate:server-libs
 */

// src/config/geo.ts
var REGIONS = {
  "11": { name: "Ile-de-France", center: [2.5, 48.8] },
  "24": { name: "Centre-Val de Loire", center: [1.5, 47.5] },
  "27": { name: "Bourgogne-Franche-Comte", center: [5, 47] },
  "28": { name: "Normandie", center: [-0.4, 49.1] },
  "32": { name: "Hauts-de-France", center: [2.8, 49.9] },
  "44": { name: "Grand Est", center: [6.2, 48.6] },
  "52": { name: "Pays de la Loire", center: [-1, 47.4] },
  "53": { name: "Bretagne", center: [-3, 48.2] },
  "75": { name: "Nouvelle-Aquitaine", center: [0.5, 44.8] },
  "76": { name: "Occitanie", center: [2, 43.6] },
  "84": { name: "Auvergne-Rhone-Alpes", center: [4.8, 45.7] },
  "93": { name: "Provence-Alpes-Cote d'Azur", center: [5.9, 43.9] },
  "94": { name: "Corse", center: [9.1, 42.1] },
  "01": { name: "Guadeloupe", center: [-61.5, 16.2] },
  "02": { name: "Martinique", center: [-61, 14.6] },
  "03": { name: "Guyane", center: [-53.1, 3.9] },
  "04": { name: "La R\xE9union", center: [55.5, -21.1] },
  "06": { name: "Mayotte", center: [45.1, -12.8] }
};
var CITIES = {
  // Top 50
  "Paris": [2.3522, 48.8566],
  "Marseille": [5.3698, 43.2965],
  "Lyon": [4.8357, 45.764],
  "Toulouse": [1.4442, 43.6047],
  "Nice": [7.262, 43.7102],
  "Nantes": [-1.5536, 47.2184],
  "Montpellier": [3.8767, 43.6119],
  "Strasbourg": [7.7521, 48.5734],
  "Bordeaux": [-0.5792, 44.8378],
  "Lille": [3.0573, 50.6292],
  "Rennes": [-1.6778, 48.1173],
  "Reims": [3.8767, 49.2583],
  "Saint-Etienne": [4.3872, 45.4397],
  "Toulon": [5.928, 43.1242],
  "Le Havre": [0.1079, 49.4944],
  "Grenoble": [5.7245, 45.1885],
  "Dijon": [5.0415, 47.322],
  "Angers": [-0.5632, 47.4784],
  "Nimes": [4.3601, 43.8367],
  "Clermont-Ferrand": [3.087, 45.7772],
  "Le Mans": [0.1996, 47.996],
  "Aix-en-Provence": [5.4474, 43.5297],
  "Brest": [-4.486, 48.3904],
  "Tours": [0.6848, 47.3941],
  "Amiens": [2.2957, 49.8941],
  "Limoges": [1.2578, 45.8315],
  "Perpignan": [2.8954, 42.6887],
  "Metz": [6.1757, 49.1193],
  "Besan\xE7on": [6.024, 47.2378],
  "Orl\xE9ans": [1.9093, 47.9029],
  "Rouen": [1.0993, 49.4432],
  "Mulhouse": [7.3389, 47.7508],
  "Caen": [-0.3708, 49.1829],
  "Nancy": [6.1834, 48.6921],
  "Avignon": [4.8055, 43.9493],
  "Poitiers": [0.3404, 46.5802],
  "La Rochelle": [-1.1508, 46.1603],
  "Pau": [-0.3707, 43.2951],
  "Calais": [1.8585, 50.9513],
  "Ajaccio": [8.7369, 41.9192],
  "Saint-Denis": [2.3553, 48.9362],
  "Argenteuil": [2.2469, 48.9472],
  "Montreuil": [2.4406, 48.8638],
  "Roubaix": [3.1746, 50.6942],
  "Tourcoing": [3.1619, 50.7239],
  "Dunkerque": [2.3767, 51.0343],
  "Villeurbanne": [4.8799, 45.7716],
  "Vitry-sur-Seine": [2.401, 48.7875],
  "Cr\xE9teil": [2.4628, 48.7904],
  "Nanterre": [2.2069, 48.8924],
  // 51-100
  "Courbevoie": [2.2567, 48.8967],
  "Asni\xE8res-sur-Seine": [2.2883, 48.9172],
  "Versailles": [2.1301, 48.8014],
  "Colombes": [2.2524, 48.9224],
  "Aulnay-sous-Bois": [2.4946, 48.9386],
  "Aubervilliers": [2.3831, 48.9147],
  "Rueil-Malmaison": [2.1808, 48.8769],
  "Champigny-sur-Marne": [2.5156, 48.8178],
  "Saint-Maur-des-Foss\xE9s": [2.4978, 48.8003],
  "Antibes": [7.1256, 43.5808],
  "B\xE9ziers": [3.2156, 43.3448],
  "Cannes": [7.0128, 43.5513],
  "Saint-Nazaire": [-2.2067, 47.2733],
  "Colmar": [7.357, 48.0794],
  "Valence": [4.893, 44.9334],
  "Quimper": [-4.1, 47.9956],
  "Bourges": [2.3988, 47.081],
  "Troyes": [4.0744, 48.2973],
  "Saint-Quentin": [3.2876, 49.8464],
  "Lorient": [-3.37, 47.75],
  "Vannes": [-2.76, 47.6558],
  "Chamb\xE9ry": [5.912, 45.5646],
  "Charleville-M\xE9zi\xE8res": [4.72, 49.77],
  "Niort": [-0.4593, 46.3238],
  "Beauvais": [2.08, 49.43],
  "Sarcelles": [2.3797, 48.9956],
  "Maisons-Alfort": [2.4381, 48.8058],
  "La Seyne-sur-Mer": [5.8833, 43.1],
  "Meaux": [2.8786, 48.9603],
  "Pessac": [-0.6306, 44.8067],
  "M\xE9rignac": [-0.6439, 44.8386],
  "Cholet": [-0.8792, 47.0592],
  "Hy\xE8res": [6.1286, 43.12],
  "\xC9vry": [2.45, 48.6333],
  "Ivry-sur-Seine": [2.3847, 48.8119],
  "Saint-Brieuc": [-2.76, 48.5139],
  "Drancy": [2.4503, 48.9303],
  "Cergy": [2.0361, 49.0361],
  "Noisy-le-Grand": [2.5522, 48.8489],
  "Issy-les-Moulineaux": [2.275, 48.8244],
  "V\xE9nissieux": [4.8861, 45.6972],
  "Clichy": [2.3069, 48.9039],
  "Levallois-Perret": [2.2883, 48.8933],
  "Antony": [2.2978, 48.7539],
  "Sartrouville": [2.1581, 48.9372],
  "Boulogne-Billancourt": [2.24, 48.8347],
  "Pantin": [2.4028, 48.8961],
  "Fontenay-sous-Bois": [2.4778, 48.8517],
  "\xC9pinay-sur-Seine": [2.3089, 48.9531],
  "Saint-Ouen": [2.3333, 48.9119],
  // 101-150
  "Bondy": [2.4828, 48.9033],
  "Clamart": [2.2656, 48.8011],
  "Bobigny": [2.4406, 48.9067],
  "Sevran": [2.5247, 48.9417],
  "Vincennes": [2.4386, 48.8478],
  "Montrouge": [2.32, 48.8167],
  "Suresnes": [2.2294, 48.8711],
  "Corbeil-Essonnes": [2.4833, 48.6167],
  "Massy": [2.2714, 48.7306],
  "Al\xE8s": [4.0833, 44.1333],
  "Brive-la-Gaillarde": [1.5333, 45.15],
  "Castres": [2.25, 43.6],
  "Cherbourg": [-1.6167, 49.6333],
  "Martigues": [5.05, 43.4],
  "Arles": [4.63, 43.6767],
  "Angoul\xEAme": [0.16, 45.65],
  "Bastia": [9.45, 42.7],
  "\xC9vreux": [1.15, 49.0167],
  "Blois": [1.3333, 47.5833],
  "Chalon-sur-Sa\xF4ne": [4.85, 46.7833],
  "Saint-Rapha\xEBl": [6.7667, 43.4167],
  "Fr\xE9jus": [6.7333, 43.4333],
  "Nevers": [3.1667, 46.9833],
  "Carcassonne": [2.35, 43.2167],
  "S\xE8te": [3.7, 43.4],
  "Tarbes": [0.0667, 43.2333],
  "Albi": [2.15, 43.9333],
  "Saint-Malo": [-2, 48.65],
  "Laval": [-0.7667, 48.0667],
  "Ch\xE2teauroux": [1.6833, 46.8167],
  "Bourg-en-Bresse": [5.2333, 46.2],
  "Montauban": [1.35, 44.0167],
  "Bayonne": [-1.4833, 43.4833],
  "Biarritz": [-1.55, 43.4833],
  "Anglet": [-1.5167, 43.4833],
  "Gap": [6.0833, 44.5667],
  "M\xE2con": [4.8333, 46.3],
  "P\xE9rigueux": [0.7167, 45.1833],
  "Agen": [0.6167, 44.2],
  "Compi\xE8gne": [2.8333, 49.4167],
  "Auxerre": [3.5667, 47.8],
  "Thionville": [6.1667, 49.35],
  "Roanne": [4.0667, 46.0333],
  "Villeneuve-d'Ascq": [3.1333, 50.6167],
  "Lens": [2.8167, 50.4333],
  "Valenciennes": [3.5333, 50.35],
  "Douai": [3.0833, 50.3667],
  "B\xE9thune": [2.6333, 50.5333],
  "Cambrai": [3.2333, 50.1833],
  // 151-200
  "Arras": [2.7833, 50.2833],
  "Soissons": [3.3167, 49.3833],
  "Laon": [3.6167, 49.5667],
  "Saint-Omer": [2.25, 50.75],
  "Sedan": [4.9333, 49.7],
  "Vierzon": [2.0667, 47.2167],
  "Montlu\xE7on": [2.6, 46.3333],
  "Vichy": [3.4167, 46.1167],
  "Aurillac": [2.4333, 44.9333],
  "Le Puy-en-Velay": [3.8833, 45.05],
  "Moulins": [3.3333, 46.5667],
  "Rodez": [2.5667, 44.35],
  "Cahors": [1.4333, 44.45],
  "Auch": [0.5833, 43.65],
  "Mont-de-Marsan": [-0.5, 43.9],
  "Dax": [-1.05, 43.7],
  "\xC9pinal": [6.45, 48.1833],
  "Bar-le-Duc": [5.1667, 48.7667],
  "Verdun": [5.3833, 49.1667],
  "Saint-Di\xE9-des-Vosges": [6.95, 48.2833],
  "Lun\xE9ville": [6.5, 48.5833],
  "Chaumont": [5.1333, 48.1167],
  "Vesoul": [6.15, 47.6167],
  "Belfort": [6.8667, 47.6333],
  "Montb\xE9liard": [6.8, 47.51],
  "Pontarlier": [6.35, 46.9],
  "Dole": [5.5, 47.0833],
  "Lons-le-Saunier": [5.55, 46.6667],
  "Oyonnax": [5.65, 46.25],
  "Annecy": [6.1167, 45.9],
  "Annemasse": [6.2333, 46.2],
  "Thonon-les-Bains": [6.4667, 46.3667],
  "Albertville": [6.3833, 45.675],
  "Saint-Jean-de-Maurienne": [6.35, 45.2833],
  "Mo\xFBtiers": [6.5333, 45.4833],
  "Aix-les-Bains": [5.9167, 45.6833],
  "Voiron": [5.5833, 45.3667],
  "Vienne": [4.875, 45.5167],
  "Bourgoin-Jallieu": [5.2833, 45.5833],
  "Villefranche-sur-Sa\xF4ne": [4.7167, 45.9833],
  "Tarare": [4.4333, 45.8967],
  "Bron": [4.9139, 45.7389],
  "Saint-Priest": [4.9333, 45.6833],
  "Oullins": [4.8083, 45.7153],
  "Caluire-et-Cuire": [4.8472, 45.795],
  "Rillieux-la-Pape": [4.8972, 45.8167],
  "Meyzieu": [5.0036, 45.7669],
  "D\xE9cines-Charpieu": [4.9592, 45.7681],
  "Saint-Genis-Laval": [4.7917, 45.6944],
  "Tassin-la-Demi-Lune": [4.7594, 45.7639],
  // Villes supplémentaires fréquentes dans les actualités
  "Draguignan": [6.4667, 43.5333],
  "Grasse": [6.9167, 43.6667],
  "Salon-de-Provence": [5.1, 43.6333],
  "Istres": [4.9833, 43.5167],
  "Vitrolles": [5.25, 43.4667],
  "Aubagne": [5.5667, 43.2833],
  "La Ciotat": [5.6, 43.1667],
  "Six-Fours-les-Plages": [5.8333, 43.1],
  "Sanary-sur-Mer": [5.8, 43.1167],
  "Bandol": [5.75, 43.1333],
  "Ollioules": [5.85, 43.1333],
  "Saint-Cyr-sur-Mer": [5.7, 43.1833],
  "Orange": [4.81, 44.1383],
  "Carpentras": [5.05, 44.05],
  "Cavaillon": [5.0333, 43.8333],
  "Apt": [5.4, 43.8833],
  "Pertuis": [5.5, 43.6833],
  "Manosque": [5.7833, 43.8333],
  "Digne-les-Bains": [6.2333, 44.0833],
  "Sisteron": [5.9333, 44.2],
  "Brian\xE7on": [6.6333, 44.9],
  "Embrun": [6.5, 44.5667],
  "Saint-Tropez": [6.6333, 43.2667],
  "Sainte-Maxime": [6.6333, 43.3],
  "Cogolin": [6.5333, 43.25],
  "Saint-Laurent-du-Var": [7.1833, 43.6667],
  "Cagnes-sur-Mer": [7.15, 43.6667],
  "Vence": [7.1167, 43.7167],
  "Menton": [7.5, 43.7833],
  "Monaco": [7.4167, 43.7333],
  "Roquebrune-Cap-Martin": [7.4667, 43.75],
  "Beausoleil": [7.4333, 43.75],
  "Villeneuve-Loubet": [7.1167, 43.65],
  "Mougins": [6.9833, 43.6],
  "Le Cannet": [7.0167, 43.5667],
  "Mandelieu-la-Napoule": [6.9333, 43.5333],
  "Th\xE9oule-sur-Mer": [6.9333, 43.5],
  "Agde": [3.4667, 43.3167],
  "Frontignan": [3.75, 43.45],
  "Lunel": [4.1333, 43.6833],
  "Mauguio": [4.0167, 43.6167],
  "Palavas-les-Flots": [3.9333, 43.5333],
  "Carnon": [4, 43.55],
  "La Grande-Motte": [4.0833, 43.5667],
  "Le Grau-du-Roi": [4.1333, 43.5333],
  "Aigues-Mortes": [4.1833, 43.5667],
  "Narbonne": [3, 43.1833],
  "Gruissan": [3.0833, 43.1],
  "Port-la-Nouvelle": [3.05, 43.0167],
  "Leucate": [3.0333, 42.9167],
  "Port-Vendres": [3.1167, 42.5167],
  "Collioure": [3.0833, 42.5333],
  "Argel\xE8s-sur-Mer": [3.0333, 42.55],
  "Canet-en-Roussillon": [3.0333, 42.7],
  "Saint-Cyprien": [3, 42.6167],
  "Le Barcar\xE8s": [3.0333, 42.7833],
  "C\xE9ret": [2.75, 42.4833],
  "Prades": [2.4167, 42.6167],
  "Font-Romeu": [2.0333, 42.5],
  "Foix": [1.6, 42.9667],
  "Pamiers": [1.6167, 43.1167],
  "Saint-Girons": [1.15, 42.9833],
  "Lourdes": [-0.05, 43.1],
  "Lannemezan": [0.3833, 43.1167],
  "Bagn\xE8res-de-Bigorre": [0.15, 43.0667],
  "Saint-Gaudens": [0.7167, 43.1],
  "Saint-Jean-de-Luz": [-1.6667, 43.3833],
  "Hendaye": [-1.7833, 43.3667],
  "Ciboure": [-1.6667, 43.3833],
  "Gu\xE9thary": [-1.6167, 43.4167],
  "Bidart": [-1.5833, 43.4333],
  "Saint-P\xE9e-sur-Nivelle": [-1.55, 43.35],
  "Espelette": [-1.4333, 43.35],
  "Cambo-les-Bains": [-1.4, 43.3667],
  "Oloron-Sainte-Marie": [-0.6167, 43.1833],
  "Orthez": [-0.7667, 43.4833],
  "Salies-de-B\xE9arn": [-0.9167, 43.4667],
  "Sauveterre-de-B\xE9arn": [-0.9333, 43.4],
  "Maul\xE9on-Licharre": [-0.8833, 43.2167],
  // DROM-COM (Réunion - noms qualifiés pour éviter les doublons)
  "Fort-de-France": [-61.0833, 14.6],
  "Pointe-\xE0-Pitre": [-61.5333, 16.2333],
  "Cayenne": [-52.3333, 4.9333],
  "Saint-Denis de la R\xE9union": [55.45, -20.8833],
  "Saint-Pierre de la R\xE9union": [55.4833, -21.3333],
  "Le Port": [55.2833, -20.9333],
  "Saint-Paul de la R\xE9union": [55.2833, -21],
  "Le Tampon": [55.5167, -21.2667],
  "Saint-Louis de la R\xE9union": [55.4167, -21.2833],
  "Saint-Andr\xE9 de la R\xE9union": [55.65, -20.9667],
  "Saint-Beno\xEEt de la R\xE9union": [55.7167, -21.0333],
  "Sainte-Marie de la R\xE9union": [55.5333, -20.9],
  "Sainte-Suzanne": [55.6, -20.9],
  "Mamoudzou": [45.2333, -12.7833],
  "Dzaoudzi": [45.2833, -12.7833],
  "Noum\xE9a": [166.4417, -22.2758],
  "Papeete": [-149.5667, -17.5333]
};

// src/config/departements.ts
var DEPARTEMENT_NAMES = [
  "Ain",
  "Aisne",
  "Allier",
  "Alpes-de-Haute-Provence",
  "Hautes-Alpes",
  "Alpes-Maritimes",
  "Ard\xE8che",
  "Ardennes",
  "Ari\xE8ge",
  "Aube",
  "Aude",
  "Aveyron",
  "Bouches-du-Rh\xF4ne",
  "Calvados",
  "Cantal",
  "Charente",
  "Charente-Maritime",
  "Cher",
  "Corr\xE8ze",
  "Corse-du-Sud",
  "Haute-Corse",
  "C\xF4te-d\u2019Or",
  "C\xF4tes-d\u2019Armor",
  "Creuse",
  "Dordogne",
  "Doubs",
  "Dr\xF4me",
  "Eure",
  "Eure-et-Loir",
  "Finist\xE8re",
  "Gard",
  "Haute-Garonne",
  "Gers",
  "Gironde",
  "H\xE9rault",
  "Ille-et-Vilaine",
  "Indre",
  "Indre-et-Loire",
  "Is\xE8re",
  "Jura",
  "Landes",
  "Loir-et-Cher",
  "Loire",
  "Haute-Loire",
  "Loire-Atlantique",
  "Loiret",
  "Lot",
  "Lot-et-Garonne",
  "Loz\xE8re",
  "Maine-et-Loire",
  "Manche",
  "Marne",
  "Haute-Marne",
  "Mayenne",
  "Meurthe-et-Moselle",
  "Meuse",
  "Morbihan",
  "Moselle",
  "Ni\xE8vre",
  "Nord",
  "Oise",
  "Orne",
  "Pas-de-Calais",
  "Puy-de-D\xF4me",
  "Pyr\xE9n\xE9es-Atlantiques",
  "Hautes-Pyr\xE9n\xE9es",
  "Pyr\xE9n\xE9es-Orientales",
  "Bas-Rhin",
  "Haut-Rhin",
  "Rh\xF4ne",
  "Haute-Sa\xF4ne",
  "Sa\xF4ne-et-Loire",
  "Sarthe",
  "Savoie",
  "Haute-Savoie",
  "Paris",
  "Seine-Maritime",
  "Seine-et-Marne",
  "Yvelines",
  "Deux-S\xE8vres",
  "Somme",
  "Tarn",
  "Tarn-et-Garonne",
  "Var",
  "Vaucluse",
  "Vend\xE9e",
  "Vienne",
  "Haute-Vienne",
  "Vosges",
  "Yonne",
  "Territoire de Belfort",
  "Essonne",
  "Hauts-de-Seine",
  "Seine-Saint-Denis",
  "Val-de-Marne",
  "Val-d\u2019Oise",
  "Guadeloupe",
  "Martinique",
  "Guyane",
  "La R\xE9union",
  "Mayotte"
];

// src/config/foreign-places.ts
var FOREIGN_COUNTRIES = [
  "Afghanistan",
  "Afrique du Sud",
  "Albanie",
  "Alg\xE9rie",
  "Allemagne",
  "Andorre",
  "Angleterre",
  "Angola",
  "Arabie saoudite",
  "Argentine",
  "Arm\xE9nie",
  "Australie",
  "Autriche",
  "Azerba\xEFdjan",
  "Bahre\xEFn",
  "Bangladesh",
  "Belgique",
  "B\xE9nin",
  "Bi\xE9lorussie",
  "Birmanie",
  "Bolivie",
  "Bosnie",
  "Br\xE9sil",
  "Bulgarie",
  "Burkina Faso",
  "Burundi",
  "Cambodge",
  "Cameroun",
  "Canada",
  "Chili",
  "Chine",
  "Chypre",
  "Cisjordanie",
  "Colombie",
  "Congo",
  "Cor\xE9e du Nord",
  "Cor\xE9e du Sud",
  "C\xF4te d\u2019Ivoire",
  "Crim\xE9e",
  "Croatie",
  "Cuba",
  "Danemark",
  "Donbass",
  "\xC9cosse",
  "\xC9gypte",
  "\xC9mirats arabes unis",
  "\xC9quateur",
  "\xC9rythr\xE9e",
  "Espagne",
  "Estonie",
  "\xC9tats-Unis",
  "\xC9thiopie",
  "Finlande",
  "Gabon",
  "Gaza",
  "G\xE9orgie",
  "Ghana",
  "Grande-Bretagne",
  "Gr\xE8ce",
  "Groenland",
  "Guatemala",
  "Guin\xE9e",
  "Ha\xEFti",
  "Honduras",
  "Hongrie",
  "Inde",
  "Indon\xE9sie",
  "Irak",
  "Iran",
  "Irlande",
  "Irlande du Nord",
  "Islande",
  "Isra\xEBl",
  "Italie",
  "Jama\xEFque",
  "Japon",
  "Jordanie",
  "Kazakhstan",
  "Kenya",
  "Kosovo",
  "Kowe\xEFt",
  "Kurdistan",
  "Laos",
  "Lettonie",
  "Liban",
  "Libye",
  "Lituanie",
  "Mac\xE9doine",
  "Madagascar",
  "Malaisie",
  "Mali",
  "Malte",
  "Maroc",
  "Mauritanie",
  "Mexique",
  "Moldavie",
  "Mongolie",
  "Mont\xE9n\xE9gro",
  "Mozambique",
  "Myanmar",
  "Namibie",
  "N\xE9pal",
  "Nicaragua",
  "Niger",
  "Nigeria",
  "Norv\xE8ge",
  "Nouvelle-Z\xE9lande",
  "Oman",
  "Ouganda",
  "Ouzb\xE9kistan",
  "Pakistan",
  "Palestine",
  "Panama",
  "Paraguay",
  "Pays-Bas",
  "Pays de Galles",
  "P\xE9rou",
  "Philippines",
  "Pologne",
  "Portugal",
  "Qatar",
  "R\xE9publique tch\xE8que",
  "Roumanie",
  "Royaume-Uni",
  "Russie",
  "Rwanda",
  "Salvador",
  "S\xE9n\xE9gal",
  "Serbie",
  "Sierra Leone",
  "Singapour",
  "Slovaquie",
  "Slov\xE9nie",
  "Somalie",
  "Soudan",
  "Sri Lanka",
  "Su\xE8de",
  "Suisse",
  "Syrie",
  "Ta\xEFwan",
  "Tanzanie",
  "Tchad",
  "Tch\xE9quie",
  "Tha\xEFlande",
  "Togo",
  "Tunisie",
  "Turquie",
  "Ukraine",
  "Uruguay",
  "Venezuela",
  "Vietnam",
  "Y\xE9men",
  "Zambie",
  "Zimbabwe"
];
var FOREIGN_CITIES = [
  "Londres",
  "Manchester",
  "Liverpool",
  "Birmingham",
  "\xC9dimbourg",
  "Dublin",
  "Berlin",
  "Munich",
  "Hambourg",
  "Francfort",
  "Cologne",
  "Madrid",
  "Barcelone",
  "S\xE9ville",
  "Rome",
  "Milan",
  "Naples",
  "Turin",
  "Venise",
  "Lisbonne",
  "Amsterdam",
  "Rotterdam",
  "Anvers",
  "Gen\xE8ve",
  "Lausanne",
  "Zurich",
  "B\xE2le",
  "Berne",
  "Varsovie",
  "Prague",
  "Budapest",
  "Ath\xE8nes",
  "Istanbul",
  "Ankara",
  "Moscou",
  "Saint-P\xE9tersbourg",
  "Kiev",
  "Kyiv",
  "Kharkiv",
  "Odessa",
  "Marioupol",
  "Minsk",
  "Belgrade",
  "Bucarest",
  "Sofia",
  "Copenhague",
  "Stockholm",
  "Oslo",
  "Helsinki",
  "New York",
  "Washington",
  "Los Angeles",
  "San Francisco",
  "Chicago",
  "Miami",
  "Houston",
  "La Nouvelle-Orl\xE9ans",
  "Montr\xE9al",
  "Qu\xE9bec",
  "Toronto",
  "Mexico",
  "Bogota",
  "Caracas",
  "Buenos Aires",
  "Rio de Janeiro",
  "S\xE3o Paulo",
  "Lima",
  "Santiago",
  "La Havane",
  "Port-au-Prince",
  "Tokyo",
  "P\xE9kin",
  "Shanghai",
  "Hong Kong",
  "S\xE9oul",
  "Pyongyang",
  "Taipei",
  "Bangkok",
  "Manille",
  "Jakarta",
  "Hano\xEF",
  "New Delhi",
  "Bombay",
  "Karachi",
  "Islamabad",
  "Kaboul",
  "T\xE9h\xE9ran",
  "Bagdad",
  "Damas",
  "Beyrouth",
  "J\xE9rusalem",
  "Tel-Aviv",
  "Ramallah",
  "Amman",
  "Riyad",
  "Ryad",
  "Doha",
  "Duba\xEF",
  "Abou Dhabi",
  "Le Caire",
  "Alger",
  "Tunis",
  "Rabat",
  "Casablanca",
  "Tripoli",
  "Dakar",
  "Bamako",
  "Niamey",
  "Ouagadougou",
  "Abidjan",
  "Lagos",
  "Kinshasa",
  "Nairobi",
  "Addis-Abeba",
  "Johannesburg",
  "Pretoria",
  "Khartoum",
  "Mogadiscio",
  "Sydney",
  "Melbourne"
];
var FOREIGN_DEMONYM_PATTERNS = [
  "russes?",
  "ukrainien(?:ne)?s?",
  "israelien(?:ne)?s?",
  "palestinien(?:ne)?s?",
  "iranien(?:ne)?s?",
  "irakien(?:ne)?s?",
  "syrien(?:ne)?s?",
  "libanaise?s?",
  "americaine?s?",
  "chinoise?s?",
  "britanniques?",
  "ecossaise?s?",
  "irlandaise?s?",
  "allemande?s?",
  "italien(?:ne)?s?",
  "espagnole?s?",
  "portugaise?s?",
  "belges?",
  "suisses?",
  "neerlandaise?s?",
  "polonaise?s?",
  "hongroise?s?",
  "roumaine?s?",
  "grecs?",
  "grecques?",
  "turcs?",
  "turques?",
  "pakistanaise?s?",
  "afghane?s?",
  "japonaise?s?",
  "coreen(?:ne)?s?",
  "thailandaise?s?",
  "vietnamien(?:ne)?s?",
  "sud africaine?s?",
  "nigeriane?s?",
  "malien(?:ne)?s?",
  "algerien(?:ne)?s?",
  "marocaine?s?",
  "tunisien(?:ne)?s?",
  "egyptien(?:ne)?s?",
  "saoudien(?:ne)?s?",
  "yemenites?",
  "bresilien(?:ne)?s?",
  "mexicaine?s?",
  "venezuelien(?:ne)?s?",
  "colombien(?:ne)?s?",
  "canadien(?:ne)?s?",
  "quebecoise?s?",
  "australien(?:ne)?s?",
  "serbes?",
  "bielorusses?",
  "georgien(?:ne)?s?",
  "armenien(?:ne)?s?",
  "houthis?",
  "hamas",
  "hezbollah",
  "kremlin(?! bicetre)",
  "maison blanche",
  "pentagone",
  // Complément après le rejeu du 28/09 (« guerre civile éthiopienne ») : gentilés des pays de la liste.
  "ethiopien(?:ne)?s?",
  "soudanaise?s?",
  "somalien(?:ne)?s?",
  "congolaise?s?",
  "nigerien(?:ne)?s?",
  "birmane?s?",
  "kenyane?s?",
  "haitien(?:ne)?s?",
  "cubaine?s?",
  "argentine?s?",
  "chilien(?:ne)?s?",
  "peruvien(?:ne)?s?",
  "bolivien(?:ne)?s?",
  "equatorien(?:ne)?s?",
  "danoise?s?",
  "suedoise?s?",
  "norvegien(?:ne)?s?",
  "finlandaise?s?",
  "autrichien(?:ne)?s?",
  "tcheques?",
  "slovaques?",
  "croates?",
  "bulgares?",
  "lituanien(?:ne)?s?",
  "estonien(?:ne)?s?",
  "letton(?:ne)?s?",
  "moldaves?",
  "kosovare?s?",
  "albanaise?s?",
  "bosnien(?:ne)?s?",
  "libyen(?:ne)?s?",
  "mauritanien(?:ne)?s?",
  "senegalaise?s?",
  "ivoirien(?:ne)?s?",
  "burkinabes?",
  "tchadien(?:ne)?s?",
  "camerounaise?s?",
  "gabonaise?s?",
  "rwandaise?s?",
  "ougandaise?s?",
  "tanzanien(?:ne)?s?",
  "jordanien(?:ne)?s?",
  "koweitien(?:ne)?s?",
  "qatarie?s?",
  "emiratie?s?",
  "kurdes?",
  "azerbaidjanaise?s?",
  "kazakhe?s?",
  "ouzbeke?s?",
  "nepalaise?s?",
  "bangladaise?s?",
  "cambodgien(?:ne)?s?",
  "malaisien(?:ne)?s?",
  "indonesien(?:ne)?s?",
  "philippins?",
  "taiwanaise?s?",
  "neo zelandaise?s?",
  "islandaise?s?",
  "jamaicaine?s?"
];

// src/services/classification-guards.ts
function normalizeForMatch(value) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’`]/g, " ").replace(/[^a-z0-9]+/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
var LEVELS = ["info", "low", "medium", "high", "critical"];
function levelRank(level) {
  return LEVELS.indexOf(level);
}
function minLevel(a, b) {
  return levelRank(a) <= levelRank(b) ? a : b;
}
var FIGURATIVE_TERMS = [
  "seisme",
  "seismes",
  "tsunami",
  "tsunamis",
  "tremblement de terre",
  "tempete",
  "tempetes",
  "ouragan",
  "ouragans",
  "bombe",
  "bombes",
  "explosion",
  "explosions",
  "deflagration"
];
var NON_PHYSICAL_MARKERS = [
  "politique",
  "politiques",
  "mediatique",
  "mediatiques",
  "electoral",
  "electorale",
  "senat",
  "assemblee",
  "gouvernement",
  "parti",
  "bourse",
  "boursier",
  "boursiere",
  "wall street",
  "cac 40",
  "mercato",
  "box office",
  "audiences",
  "reseaux sociaux"
];
var WINDOW_BEFORE = 2;
var WINDOW_AFTER = 3;
function neutralizeMetaphors(normalizedText) {
  const words = normalizedText.split(" ").filter((w) => w.length > 0);
  for (const term of FIGURATIVE_TERMS) {
    const termWords = term.split(" ");
    for (let i = 0; i + termWords.length <= words.length; i++) {
      if (!termWords.every((w, k) => words[i + k] === w)) continue;
      const end = i + termWords.length;
      const context = ` ${[...words.slice(Math.max(0, i - WINDOW_BEFORE), i), ...words.slice(end, end + WINDOW_AFTER)].join(" ")} `;
      if (NON_PHYSICAL_MARKERS.some((m) => context.includes(` ${m} `))) {
        for (let k = i; k < end; k++) words[k] = "_";
      }
    }
  }
  return words.join(" ");
}
var JUDICIAL_RETROSPECTIVE_RE = new RegExp(
  [
    "proces",
    "(?:sera|seront) jugee?s?",
    "jugee?s? pour",
    "condamnee?s?",
    "condamnation",
    "mise?s? en examen",
    "requiert",
    "requisitions?",
    "requis contre",
    "verdict",
    "en appel",
    "cour d appel",
    "fait appel",
    "hommage",
    "commemorations?",
    "anniversaire",
    "il y a \\d+ ans",
    "\\d+ ans apres"
  ].map((p) => `\\b${p}\\b`).join("|")
);
var HYPOTHETICAL_RE = /\bpas a l abri\b|\bet si\b|\b(?:faut il|doit on|peut on) (?:craindre|s inquieter|avoir peur)\b|\bscenarios?\b/;
function isJudicialOrRetrospective(title) {
  return JUDICIAL_RETROSPECTIVE_RE.test(normalizeForMatch(title));
}
function isHypothetical(title) {
  return HYPOTHETICAL_RE.test(normalizeForMatch(title));
}
var TERROR_RE = /\b(?:attentats?|terrorisme|terroristes?|antiterroristes?|antiterrorisme)\b/;
var VICTIM_RE = /\b(?:morts?|mortes?|tuee?s?|victimes?|blessee?s?|otages?|deces|decedee?s?)\b/;
function isTerrorWithoutVictims(title) {
  const text = normalizeForMatch(title);
  return TERROR_RE.test(text) && !VICTIM_RE.test(text);
}
var AMBIGUOUS_ANCHORS = /* @__PURE__ */ new Set([
  "nord",
  "cher",
  "somme",
  "lot",
  "ain",
  "aube",
  "orne",
  "allier",
  "creuse",
  "tours",
  "sens",
  "orange",
  "nice",
  "lens",
  "vienne",
  "gap"
]);
var FRENCH_ANCHOR_WORDS = [
  "France",
  "fran\xE7ais",
  "fran\xE7aise",
  "fran\xE7aises",
  "Hexagone",
  "outre-mer",
  "\xC9lys\xE9e",
  "Matignon",
  "Assembl\xE9e nationale",
  "Beauvau",
  "Quai d\u2019Orsay",
  "Bercy",
  "pr\xE9fecture",
  "pr\xE9fet",
  "pr\xE9f\xE8te",
  "pr\xE9fets",
  "gendarmerie",
  "gendarmes",
  "SNCF",
  "EDF",
  "RTE",
  "Enedis",
  "GRDF",
  "RATP",
  "Corse",
  "Nouvelle-Cal\xE9donie",
  "Polyn\xE9sie",
  "Saint-Pierre-et-Miquelon",
  "Wallis",
  "Futuna",
  "Saint-Martin",
  "Saint-Barth\xE9lemy"
];
var byLengthDesc = (forms) => [...new Set(forms)].sort((a, b) => b.length - a.length);
var FOREIGN_FORMS = byLengthDesc(
  [...FOREIGN_COUNTRIES, ...FOREIGN_CITIES].map(normalizeForMatch)
);
var FRENCH_ANCHOR_FORMS = byLengthDesc(
  [...FRENCH_ANCHOR_WORDS, ...Object.keys(CITIES), ...Object.values(REGIONS).map((r) => r.name), ...DEPARTEMENT_NAMES].map(normalizeForMatch).filter((f) => f.length > 0 && !AMBIGUOUS_ANCHORS.has(f))
);
var FOREIGN_RE = new RegExp(`\\b(?:${[...FOREIGN_FORMS, ...FOREIGN_DEMONYM_PATTERNS].join("|")})\\b`, "g");
var FRENCH_ANCHOR_RE = new RegExp(`\\b(?:${FRENCH_ANCHOR_FORMS.join("|")})\\b`);
function titleZone(title) {
  const text = normalizeForMatch(title);
  const masked = text.replace(FOREIGN_RE, "_");
  if (FRENCH_ANCHOR_RE.test(masked)) return "france";
  return masked === text ? "indeterminee" : "etranger";
}
var TITLE_REASON_CAP = { passe: "low", hypothetique: "low", etranger: "medium" };
function titleQualification(title) {
  const reasons = [];
  let temporality = "en_cours";
  if (isJudicialOrRetrospective(title)) {
    reasons.push("passe");
    temporality = "passe";
  }
  if (isHypothetical(title)) {
    reasons.push("hypothetique");
    if (temporality === "en_cours") temporality = "a_venir";
  }
  const zone = titleZone(title);
  if (zone === "etranger") reasons.push("etranger");
  const maxSeverity = reasons.reduce((cap, r) => minLevel(cap, TITLE_REASON_CAP[r]), "critical");
  return { maxSeverity, temporality, zone, reasons };
}

// src/services/classifier.ts
var INSTITUTIONS = [
  // Gouvernement & État
  "\xE9lys\xE9e",
  "matignon",
  "assembl\xE9e nationale",
  "s\xE9nat",
  "conseil d'\xE9tat",
  "pr\xE9fecture",
  "sous-pr\xE9fecture",
  "mairie",
  "conseil r\xE9gional",
  "conseil d\xE9partemental",
  "minist\xE8re",
  "ministre",
  "gouvernement",
  "pr\xE9sident",
  "premier ministre",
  // Justice & Sécurité
  "police",
  "gendarmerie",
  "tribunal",
  "cour d'appel",
  "parquet",
  "procureur",
  "douane",
  "dgsi",
  "dgse",
  "raid",
  "gign",
  "bri",
  // Infrastructure critique
  "centrale nucl\xE9aire",
  "edf",
  "rte",
  "enedis",
  "grdf",
  "sncf",
  "ratp",
  "a\xE9roport",
  "port",
  "autoroute",
  "h\xF4pital",
  "chu",
  "aphp",
  "samu",
  "\xE9cole",
  "lyc\xE9e",
  "coll\xE8ge",
  "universit\xE9",
  "fac",
  // Grandes entreprises & industrie
  "total",
  "totalenergies",
  "airbus",
  "safran",
  "thales",
  "dassault",
  "naval group",
  "renault",
  "stellantis",
  "peugeot",
  "citro\xEBn",
  "michelin",
  "arcelormittal",
  "carrefour",
  "auchan",
  "leclerc",
  "amazon",
  "la poste",
  "orange",
  // Syndicats & mouvements
  "cgt",
  "cfdt",
  "fo",
  "sud",
  "unsa",
  "gilets jaunes",
  "black bloc",
  // Médias nationaux
  "france t\xE9l\xE9visions",
  "tf1",
  "bfm",
  "cnews",
  "france inter",
  "rtl",
  "europe 1"
];
var LOCATION_TYPES = [
  // Voies majeures
  "autoroute",
  "nationale",
  "d\xE9partementale",
  "p\xE9riph\xE9rique",
  "rocade",
  "boulevard",
  "gare",
  "a\xE9roport",
  "port",
  "quai",
  // Lieux publics
  "place",
  "centre-ville",
  "quartier",
  "cit\xE9",
  "banlieue",
  "zone industrielle",
  "zi",
  "centre commercial",
  "stade",
  "parc",
  "jardin",
  // Régions / Territoires (génériques)
  "ile-de-france",
  "paca",
  "grand est",
  "hauts-de-france",
  "occitanie",
  "bretagne",
  "normandie",
  "nouvelle-aquitaine",
  "auvergne-rh\xF4ne-alpes",
  "bourgogne-franche-comt\xE9",
  "pays de la loire",
  "centre-val de loire",
  "corse",
  // DOM-TOM
  "guadeloupe",
  "martinique",
  "guyane",
  "r\xE9union",
  "mayotte",
  "nouvelle-cal\xE9donie",
  "polyn\xE9sie",
  "wallis",
  "futuna",
  "saint-martin",
  "saint-barth\xE9lemy"
];
var FAITS_DIVERS_KEYWORDS = [
  "cambriolage",
  "vol",
  "interpellation",
  "garde \xE0 vue",
  "d\xE9linquance",
  "trafic de drogue",
  "stup\xE9fiants",
  "fait divers",
  "d\xE9gradation",
  "vandalisme",
  "bagarre",
  "rixe",
  "agression",
  "vol \xE0 l'arrach\xE9",
  "vol \xE0 la tire",
  "rod\xE9o",
  "incivilit\xE9",
  "tapage",
  "ivresse",
  "outrage"
];
function detectEntities(text) {
  const normalizedText = normalizeForMatch(text);
  const institutionsFound = [];
  const locationsFound = [];
  for (const inst of INSTITUTIONS) {
    const regex = new RegExp(`\\b${normalizeForMatch(inst)}\\b`, "i");
    if (regex.test(normalizedText)) {
      institutionsFound.push(inst);
    }
  }
  for (const loc of LOCATION_TYPES) {
    const regex = new RegExp(`\\b${normalizeForMatch(loc)}\\b`, "i");
    if (regex.test(normalizedText)) {
      locationsFound.push(loc);
    }
  }
  return {
    hasInstitution: institutionsFound.length > 0,
    hasLocation: locationsFound.length > 0,
    institutionsFound,
    locationsFound,
    entityCount: institutionsFound.length + locationsFound.length
  };
}
function isFaitDiversNoise(text) {
  const normalizedText = normalizeForMatch(text);
  let hasFaitDiversKeyword = false;
  for (const kw of FAITS_DIVERS_KEYWORDS) {
    if (normalizedText.includes(normalizeForMatch(kw))) {
      hasFaitDiversKeyword = true;
      break;
    }
  }
  if (!hasFaitDiversKeyword) {
    return false;
  }
  const entities = detectEntities(normalizedText);
  if (entities.hasInstitution) {
    return false;
  }
  return true;
}
var KEYWORDS = {
  social: {
    high: ["\xE9meute", "\xE9meutes", "affrontement", "violences urbaines", "barricade", "insurrection", "pillage"],
    medium: ["manifestation", "gr\xE8ve g\xE9n\xE9rale", "blocage", "occupation", "sit-in", "cort\xE8ge", "mobilisation massive"],
    low: ["rassemblement", "p\xE9tition", "gr\xE8ve", "pr\xE9avis", "mouvement social", "syndicat", "d\xE9brayage"]
  },
  security: {
    // Intentionnel + grande échelle uniquement en high — "explosion" seul retiré (trop large : accidents domestiques)
    high: ["attentat", "fusillade", "prise d'otage", "terrorisme", "bombe", "assaut", "engin explosif", "voiture pi\xE9g\xE9e", "colis pi\xE9g\xE9"],
    // "meurtre" déplacé en medium (fait divers ≠ menace systémique), "explosion" en medium (contexte ambivalent)
    medium: ["meurtre", "homicide", "agression", "braquage", "incendie criminel", "\xE9vasion", "alerte \xE0 la bombe", "coups de feu", "violence arm\xE9e", "rixe", "explosion"],
    low: ["cambriolage", "vol", "interpellation", "garde \xE0 vue", "d\xE9linquance", "trafic", "stup\xE9fiants", "fait divers", "d\xE9gradation", "vandalisme"]
  },
  energy: {
    high: ["coupure d'\xE9lectricit\xE9", "blackout", "d\xE9lestage", "ecowatt rouge", "p\xE9nurie"],
    medium: ["tension r\xE9seau", "ecowatt orange", "maintenance nucl\xE9aire", "arr\xEAt r\xE9acteur", "baisse production"],
    low: ["consommation \xE9lev\xE9e", "pic de demande", "prix \xE9lectricit\xE9", "\xE9olien", "solaire", "mix \xE9nerg\xE9tique"]
  },
  weather: {
    high: ["vigilance rouge", "temp\xEAte", "ouragan", "tornade", "canicule extr\xEAme", "inondation majeure", "submersion"],
    medium: ["vigilance orange", "orages violents", "neige verglas", "crues", "vagues-submersion", "avalanche"],
    low: ["vigilance jaune", "pluie", "vent fort", "brouillard", "chaleur", "froid", "gel"]
  },
  transport: {
    high: ["accident mortel", "d\xE9raillement", "crash", "effondrement pont", "fermeture autoroute", "accident grave"],
    medium: ["perturbation", "retard important", "suppression train", "trafic interrompu", "bouchon g\xE9ant", "carambolage"],
    low: ["ralentissement", "travaux", "retard", "d\xE9viation", "circulation dense", "accident", "accrochage"]
  },
  infrastructure: {
    high: ["rupture barrage", "effondrement", "fuite nucl\xE9aire", "contamination", "explosion usine"],
    medium: ["fuite gaz", "incendie industriel", "pollution", "coupure eau", "incident seveso"],
    low: ["maintenance", "travaux", "r\xE9novation", "mise aux normes"]
  },
  health: {
    high: ["\xE9pid\xE9mie", "pand\xE9mie", "contamination", "alerte sanitaire", "urgence sanitaire"],
    medium: ["cluster", "foyer", "cas suspects", "rappel produit", "intoxication"],
    low: ["vaccination", "grippe", "gastro", "canicule sant\xE9", "h\xF4pital satur\xE9"]
  },
  general: {
    high: [],
    medium: [],
    low: []
  },
  finance: {
    high: ["krach", "faillite banque", "bank run", "effondrement bourse", "crise financi\xE8re"],
    medium: ["chute cac40", "correction bourse", "dette souveraine", "spread", "r\xE9cession"],
    low: ["cac40", "bourse", "march\xE9", "euro", "taux directeur", "inflation"]
  },
  floods: {
    high: ["crue majeure", "inondation catastrophique", "submersion", "vigicrues rouge", "rupture digue"],
    medium: ["vigicrues orange", "d\xE9bordement", "inondation", "mont\xE9e des eaux", "crue"],
    low: ["vigicrues jaune", "vigilance crues", "niveau rivi\xE8re", "nappes phr\xE9atiques"]
  },
  fires: {
    high: ["feu de for\xEAt majeur", "incendie catastrophique", "m\xE9ga feu", "evacuation incendie"],
    medium: ["feux de for\xEAt", "incendie for\xEAt", "d\xE9part de feu", "incendie v\xE9g\xE9tation"],
    low: ["risque incendie", "vigilance feux", "br\xFBlage", "s\xE9cheresse for\xEAt"]
  },
  cyber: {
    high: ["cyberattaque majeure", "ransomware h\xF4pital", "sabotage num\xE9rique", "attaque \xE9tat"],
    medium: [
      "cyberattaque",
      "cyber attaque",
      "piratage",
      "ransomware",
      "fuite donn\xE9es",
      "fuite de donn\xE9es",
      "vol de donn\xE9es",
      "exfiltration de donn\xE9es",
      "violation de donn\xE9es",
      "ddos",
      "cert-fr alerte"
    ],
    low: ["vuln\xE9rabilit\xE9", "patch s\xE9curit\xE9", "phishing", "arnaque", "incident cyber", "compte compromis"]
  }
};
var CRITICAL_KEYWORDS = [
  "attentat",
  "terrorisme",
  "prise d'otage",
  "vigilance rouge",
  "blackout",
  "rupture barrage",
  "\xE9pid\xE9mie",
  "pand\xE9mie",
  "crash a\xE9rien",
  "s\xE9isme",
  "tsunami"
];
var CRITICAL_COMPOUND_PHRASES = [
  "fusillade de masse",
  "fusillade meurtri\xE8re",
  "tirs de masse",
  "explosion bombe",
  "attentat \xE0 la bombe",
  "explosion attentat",
  "explosion criminelle",
  "effondrement immeuble",
  "effondrement b\xE2timent",
  "effondrement pont",
  "effondrement de pont",
  "fuite radioactive",
  "accident nucl\xE9aire grave",
  "nuage toxique",
  "coup d'\xE9tat",
  "guerre civile",
  "assaut terroriste",
  "alerte enl\xE8vement"
];
var DOMESTIC_ACCIDENT_KEYWORDS = [
  "barbecue",
  "accident domestique",
  "accident m\xE9nager",
  "fuite de gaz domestique",
  "chaudi\xE8re",
  "tente d'allumer",
  "tentative d'allumer",
  "accidentellement",
  "par m\xE9garde",
  "br\xFBlure accidentelle"
];
function isDomesticAccident(text) {
  const normalized = normalizeForMatch(text);
  return DOMESTIC_ACCIDENT_KEYWORDS.some((kw) => normalized.includes(normalizeForMatch(kw)));
}
function classifyNormalized(text) {
  let bestCategory = "general";
  let bestLevel = "info";
  let bestConfidence = 0;
  let matchCount = 0;
  for (const phrase of CRITICAL_COMPOUND_PHRASES) {
    if (text.includes(normalizeForMatch(phrase))) {
      for (const [cat, levels] of Object.entries(KEYWORDS)) {
        if (levels.high.some((kw) => normalizeForMatch(phrase).includes(normalizeForMatch(kw)))) {
          return { level: "critical", category: cat, confidence: 0.92, source: "keyword" };
        }
      }
      return { level: "critical", category: "security", confidence: 0.88, source: "keyword" };
    }
  }
  for (const kw of CRITICAL_KEYWORDS) {
    if (text.includes(normalizeForMatch(kw))) {
      for (const [cat, levels] of Object.entries(KEYWORDS)) {
        if (levels.high.some((candidate) => normalizeForMatch(candidate) === normalizeForMatch(kw))) {
          return { level: "critical", category: cat, confidence: 0.9, source: "keyword" };
        }
      }
      return { level: "critical", category: "security", confidence: 0.85, source: "keyword" };
    }
  }
  if (text.includes("accident mortel")) {
    const isInfra = text.includes("centrale") || text.includes("nucl\xE9aire") || text.includes("usine");
    const isMajorTransport = text.includes("autoroute") || text.includes("tgv") || text.includes("train");
    if (isInfra || isMajorTransport) {
      return {
        level: "critical",
        category: isInfra ? "infrastructure" : "transport",
        confidence: 0.85,
        source: "keyword"
      };
    }
  }
  if (text.includes("accident") && !text.includes("accident mortel")) {
    const isInfra = text.includes("centrale") || text.includes("nucl\xE9aire") || text.includes("usine");
    const isMajorTransport = text.includes("autoroute") || text.includes("tgv") || text.includes("train");
    if (isInfra || isMajorTransport) {
      return {
        level: "high",
        // Était 'critical' — downgrade car sans confirmation de gravité
        category: isInfra ? "infrastructure" : "transport",
        confidence: 0.72,
        source: "keyword"
      };
    }
  }
  for (const [cat, levels] of Object.entries(KEYWORDS)) {
    const category = cat;
    if (category === "general") continue;
    for (const kw of levels.high) {
      const regex = new RegExp(`\\b${normalizeForMatch(kw)}\\b`, "i");
      if (regex.test(text)) {
        matchCount++;
        const conf = 0.8;
        if (conf > bestConfidence || conf === bestConfidence && levelRank("high") > levelRank(bestLevel)) {
          bestCategory = category;
          bestLevel = "high";
          bestConfidence = conf;
        }
      }
    }
    for (const kw of levels.medium) {
      const regex = new RegExp(`\\b${normalizeForMatch(kw)}\\b`, "i");
      if (regex.test(text)) {
        matchCount++;
        const conf = 0.65;
        if (conf > bestConfidence) {
          bestCategory = category;
          bestLevel = "medium";
          bestConfidence = conf;
        }
      }
    }
    for (const kw of levels.low) {
      const regex = new RegExp(`\\b${normalizeForMatch(kw)}\\b`, "i");
      if (regex.test(text)) {
        matchCount++;
        const conf = 0.5;
        if (conf > bestConfidence) {
          bestCategory = category;
          bestLevel = "low";
          bestConfidence = conf;
        }
      }
    }
  }
  if (matchCount === 0) return void 0;
  if (matchCount >= 3) bestConfidence = Math.min(bestConfidence + 0.1, 0.95);
  if (isDomesticAccident(text) && (bestCategory === "security" || bestCategory === "infrastructure")) {
    return { level: "info", category: "general", confidence: 0.2, source: "keyword" };
  }
  if (bestCategory === "security" && bestLevel === "low") {
    if (isFaitDiversNoise(text)) {
      return { level: "info", category: "general", confidence: 0.2, source: "keyword" };
    }
  }
  if (bestCategory === "security" && bestLevel === "medium") {
    if (isFaitDiversNoise(text)) {
      return { level: "low", category: "security", confidence: 0.3, source: "keyword" };
    }
  }
  return {
    level: bestLevel,
    category: bestCategory,
    confidence: bestConfidence,
    source: "keyword"
  };
}
function qualifyByKeywords(title, summary) {
  const normalized = normalizeForMatch(`${title} ${summary ?? ""}`);
  const neutralized = neutralizeMetaphors(normalized);
  const reasons = neutralized === normalized ? [] : ["metaphore"];
  const titleQ = titleQualification(title);
  const full = classifyNormalized(neutralized);
  if (!full) {
    return { classification: void 0, reportedLevel: "info", temporality: titleQ.temporality, zone: titleQ.zone, reasons };
  }
  let reportedLevel = full.level;
  let confidence = full.confidence;
  if (levelRank(reportedLevel) >= levelRank("high")) {
    const titleLevel = classifyNormalized(neutralizeMetaphors(normalizeForMatch(title)))?.level ?? "info";
    if (levelRank(titleLevel) >= levelRank("high")) {
      reportedLevel = minLevel(reportedLevel, titleLevel);
    } else {
      reportedLevel = "medium";
      confidence = Math.min(confidence, 0.5);
      reasons.push("declencheur_hors_titre");
    }
  }
  if (reportedLevel === "critical" && isTerrorWithoutVictims(title)) reportedLevel = "high";
  for (const reason of titleQ.reasons) {
    if (levelRank(reportedLevel) > levelRank(TITLE_REASON_CAP[reason])) reasons.push(reason);
  }
  const level = minLevel(reportedLevel, titleQ.maxSeverity);
  const classification = level === full.level && confidence === full.confidence ? full : { ...full, level, confidence };
  return { classification, reportedLevel, temporality: titleQ.temporality, zone: titleQ.zone, reasons };
}
function classifyByKeywords(title, summary) {
  return qualifyByKeywords(title, summary).classification;
}

// generated-entry-server-classifier.js.ts
var CLASSIFIER_VERSION = "kw-2";
function classify(title, description) {
  const q = qualifyByKeywords(title, description);
  const c = q.classification;
  return {
    category: c ? c.category : "general",
    severity: c ? c.level : "info",
    confidence: c ? c.confidence : 0.2,
    reportedSeverity: q.reportedLevel,
    temporality: q.temporality,
    zone: q.zone,
    reasons: q.reasons
  };
}
export {
  CLASSIFIER_VERSION,
  TITLE_REASON_CAP,
  classify,
  classifyByKeywords,
  detectEntities,
  isDomesticAccident,
  isFaitDiversNoise,
  qualifyByKeywords,
  titleQualification
};
