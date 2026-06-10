/**
 * GENERATED FILE — DO NOT EDIT.
 * Généré par scripts/generate-server-classifier.mjs depuis src/services/geocoder.ts + src/config/geo.ts.
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

// src/services/geocoder.ts
var STOP_WORDS = /* @__PURE__ */ new Set([
  "france",
  "europe",
  "monde",
  "selon",
  "apr\xE8s",
  "avant",
  "pour",
  "dans",
  "avec",
  "sans",
  "plus",
  "moins",
  "tout",
  "tous",
  "tr\xE8s",
  "aussi",
  "encore",
  "quand",
  "comment",
  "pourquoi",
  "pr\xE9sident",
  "ministre",
  "gouvernement",
  "assembl\xE9e",
  "s\xE9nat",
  "ligue",
  "championnat",
  "coupe",
  "jeux",
  "olympique",
  "\xE9tat",
  "police",
  "justice",
  "guerre",
  "loi",
  "projet",
  "place",
  "rue",
  "avenue",
  "boulevard",
  "gare",
  "nord",
  "sud",
  "est",
  "ouest",
  "direct",
  "vid\xE9o",
  "photo",
  "image",
  "alerte",
  "urgence",
  "nouveau",
  "nouvelle",
  "grand",
  "grande",
  "premier",
  "premi\xE8re",
  "proc\xE8s",
  "tribunal",
  "appel",
  "affaire",
  "actu",
  "info",
  "actu"
]);
var PREPOSITION_PATTERN = /(?:à|de|en|sur|près de|dans(?:\s+le|\s+la|\s+les|\s+l[''])?\s+)([A-ZÀ-Ü][a-zà-ü]+(?:[\s-][A-ZÀ-Ü][a-zà-ü]+)*)/g;
var TITLE_START_PATTERN = /^([A-ZÀ-Ü][a-zà-ü]+(?:[\s-][A-ZÀ-Ü][a-zà-ü]+)*)\s*[.–:-]/gm;
var COMMA_PATTERN = /,\s+([A-ZÀ-Ü][a-zà-ü]+(?:[\s-][A-ZÀ-Ü][a-zà-ü]+)*)\s*[,:]/g;
var _normCitySet = null;
function normCitySet() {
  if (!_normCitySet) {
    _normCitySet = new Set(
      Object.keys(CITIES).map(
        (c) => c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      )
    );
  }
  return _normCitySet;
}
function isKnownCity(name) {
  return normCitySet().has(name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
}
function extractLocations(title) {
  const locations = [];
  let match;
  PREPOSITION_PATTERN.lastIndex = 0;
  while ((match = PREPOSITION_PATTERN.exec(title)) !== null) {
    const loc = match[1].trim();
    if (loc.length >= 3 && !STOP_WORDS.has(loc.toLowerCase())) locations.push(loc);
  }
  TITLE_START_PATTERN.lastIndex = 0;
  while ((match = TITLE_START_PATTERN.exec(title)) !== null) {
    const loc = match[1].trim();
    if (loc.length >= 3 && !STOP_WORDS.has(loc.toLowerCase()) && isKnownCity(loc)) {
      locations.push(loc);
    }
  }
  COMMA_PATTERN.lastIndex = 0;
  while ((match = COMMA_PATTERN.exec(title)) !== null) {
    const loc = match[1].trim();
    if (loc.length >= 3 && !STOP_WORDS.has(loc.toLowerCase())) locations.push(loc);
  }
  if (locations.length === 0) {
    const normTitle = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const cityName of Object.keys(CITIES)) {
      const normCity = cityName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const wordBoundary = new RegExp(`\\b${normCity.replace(/-/g, "[\\s-]")}\\b`);
      if (wordBoundary.test(normTitle)) locations.push(cityName);
    }
  }
  return [...new Set(locations)];
}

// generated-entry-server-geocoder.js.ts
var geoCache = /* @__PURE__ */ new Map();
var GEOCODE_TIMEOUT_MS = 3e3;
function norm(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}
async function fetchAdresse(query, municipalityOnly) {
  const typeFilter = municipalityOnly ? "&type=municipality" : "";
  const url = "https://api-adresse.data.gouv.fr/search/?q=" + encodeURIComponent(query) + "&limit=1" + typeFilter;
  const resp = await fetch(url, { signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS) });
  if (!resp.ok) return null;
  return await resp.json();
}
async function geocodeQuery(query) {
  const key = norm(query);
  if (geoCache.has(key)) return geoCache.get(key) ?? null;
  for (const [cityName, [lon, lat]] of Object.entries(CITIES)) {
    if (norm(cityName) === key) {
      const result = { lat, lon, locationName: cityName, confidence: 1, source: "cities" };
      geoCache.set(key, result);
      return result;
    }
  }
  for (const region of Object.values(REGIONS)) {
    if (norm(region.name) === key) {
      const result = {
        lat: region.center[1],
        lon: region.center[0],
        locationName: region.name,
        confidence: 0.9,
        source: "regions"
      };
      geoCache.set(key, result);
      return result;
    }
  }
  try {
    let data = await fetchAdresse(query, true);
    if (!data?.features?.length) {
      data = await fetchAdresse(query, false);
    }
    if (!data?.features?.length) {
      geoCache.set(key, null);
      return null;
    }
    const feat = data.features[0];
    const [lon, lat] = feat.geometry.coordinates;
    const result = {
      lat,
      lon,
      locationName: feat.properties.city ?? feat.properties.label,
      confidence: feat.properties.score,
      source: "api-adresse"
    };
    geoCache.set(key, result);
    return result;
  } catch {
    geoCache.set(key, null);
    return null;
  }
}
async function geocodeNewsItem(title, feedRegion) {
  const locations = extractLocations(title);
  for (const loc of locations) {
    const result = await geocodeQuery(loc);
    if (result && result.confidence > 0.4) return result;
  }
  if (feedRegion) {
    const result = await geocodeQuery(feedRegion);
    if (result) return { ...result, confidence: 0.3, source: "region-fallback" };
  }
  return null;
}
export {
  extractLocations,
  geocodeNewsItem,
  geocodeQuery
};
