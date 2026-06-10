/**
 * GENERATED FILE — DO NOT EDIT.
 * Généré par scripts/generate-server-classifier.mjs depuis src/services/classifier.ts.
 * Régénération : npm run generate:server-libs
 */

// src/services/classifier.ts
function normalizeForMatch(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’`]/g, " ").replace(/[^a-z0-9]+/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
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
function classifyByKeywords(title, summary) {
  const text = normalizeForMatch(`${title} ${summary ?? ""}`);
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
function levelRank(level) {
  switch (level) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

// generated-entry-server-classifier.js.ts
var CLASSIFIER_VERSION = "kw-1";
function classify(title, description) {
  const result = classifyByKeywords(title, description);
  if (!result) {
    return { category: "general", severity: "info", confidence: 0.2 };
  }
  return { category: result.category, severity: result.level, confidence: result.confidence };
}
export {
  CLASSIFIER_VERSION,
  classify,
  classifyByKeywords,
  detectEntities,
  isDomesticAccident,
  isFaitDiversNoise
};
