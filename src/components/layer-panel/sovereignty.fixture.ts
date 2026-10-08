// src/components/layer-panel/sovereignty.fixture.ts : jeux d'essai des vues, des coquilles, de la carte et du score Souveraineté (spec
// 2026-10-04 souveraineté ; contrats § 3.3 ; amendement 7). Réponses construites par le code du serveur (tâches A3, A5, A8) à partir des
// réponses réelles du dimanche 4 octobre 2026 : relevé adsb.lol /v2/mil de 16 h 48 (9 aéronefs au-dessus de la France : 4 français
// aux adresses, indicatifs et immatriculations fictifs, 5 autres ; 3 hors de France) ; fichier des câbles assemblé par scripts/fetch-subsea-cables.mjs sur
// les relevés du Shom (câbles, zones de câbles et de mouillage des approches de Marseille) et d'OpenStreetMap (tracés éclaircis à
// 12 points au plus par ligne et coordonnées à 4 décimales pour le jeu d'essai, atterrages inchangés et nommés par geo.api.gouv.fr,
// date de génération fixée à 16 h 48) ; relevés du relais AIS construits (navires et MMSI fictifs) ; flux CERT-FR, page liste des
// alertes, flux CTI, pages d'ALE-011, d'ALE-008 et d'AVI-1257, catalogue KEV réduit, victims.json anonymisé (aucun nom de victime),
// fuites HIBP (un compte) et flux Cybermalveillance réels, pages CERT-FR non enregistrées construites à partir du flux (dernière
// version = première version, CVE du résumé) ; page Vigipirate du SGDSN. Chaque export de réponse est une fonction qui rend une copie
// neuve : un test peut la modifier sans toucher les autres. tests/sovereignty-contract.test.ts vérifie que le serveur rend exactement
// ces réponses.
import type {
  CablesWatchResponse, ConnectivityResponse, CyberResponse, DroneZonesFile, GnssResponse, MilitaryResponse, SanctionsResponse,
  SubseaCablesFile, VigipirateEntry, VigipiratePageCheck,
} from '../../types/index.ts';
import type { GnssState } from '../../services/sovereignty-gnss.ts';
import type { ConnectivityState } from '../../services/sovereignty-connectivity.ts';
import type { SanctionsState } from '../../services/sovereignty-sanctions.ts';

/** 4 octobre 2026, 16 h 48 min 30 s à Paris (14:48:30Z) : heure des relevés de la spec. */
export const SOV_FIXTURE_NOW = Date.parse('2026-10-04T16:48:30+02:00');

const copy = <T>(v: T): T => structuredClone(v);

/** Relevé adsb.lol de 16 h 48 : 4 français (Bouches-du-Rhône 3, Rhône 1, adresses et indicatifs fictifs), 5 autres, 3 hors de France, aucune urgence. */
const MILITARY: MilitaryResponse = {
  "readAt": "2026-10-04T14:48:30.000Z",
  "sourceNow": "2026-10-04T14:48:24.501Z",
  "frenchByDept": [
    {"dept":"13","count":3},
    {"dept":"69","count":1}
  ],
  "aircraft": [
    {"hex":"3bf001","callsign":"FICTIF01","registration":null,"type":"DH8D","country":"France","family":"francais","lat":43.55,"lon":5.05,"dept":"13","altitudeFt":2050,"speedKt":227.7,"track":115.21,"seenAt":"2026-10-04T14:48:23.693Z"},
    {"hex":"3bf002","callsign":"FICTIF02","registration":null,"type":"BE20","country":"France","family":"francais","lat":43.5,"lon":5.15,"dept":"13","altitudeFt":1200,"speedKt":196.7,"track":94.67,"seenAt":"2026-10-04T14:48:23.472Z"},
    {"hex":"3bf003","callsign":"FICTIF03","registration":null,"type":"A332","country":"France","family":"francais","lat":43.6,"lon":5.25,"dept":"13","altitudeFt":1275,"speedKt":211.9,"track":342.42,"seenAt":"2026-10-04T14:48:24.283Z"},
    {"hex":"3bf004","callsign":"FICTIF04","registration":"F-ZFIC","type":"EC45","country":"France","family":"francais","lat":45.87,"lon":4.64,"dept":"69","altitudeFt":525,"speedKt":51.5,"track":352.18,"seenAt":"2026-10-04T14:48:24.290Z"},
    {"hex":"894081","callsign":"BAH11","registration":null,"type":"B738","country":"Bahreïn","family":"autres","lat":47.017273,"lon":4.422546,"dept":"71","altitudeFt":38000,"speedKt":424,"track":332.47,"seenAt":"2026-10-04T14:48:24.241Z"},
    {"hex":"c2b5b7","callsign":"CFC2902","registration":null,"type":"C30J","country":"Canada","family":"autres","lat":43.484306,"lon":4.675729,"dept":"13","altitudeFt":2725,"speedKt":226,"track":359.24,"seenAt":"2026-10-04T14:48:24.394Z"},
    {"hex":"44f684","callsign":"GRZLY21","registration":null,"type":"A400","country":"Belgique","family":"autres","lat":43.381472,"lon":-0.468554,"dept":"64","altitudeFt":1400,"speedKt":142,"track":270,"seenAt":"2026-10-04T14:48:24.136Z"},
    {"hex":"43c6f6","callsign":"RRR2243","registration":"ZZ999","type":"A332","country":"Royaume-Uni","family":"autres","lat":50.693059,"lon":1.625671,"dept":"62","altitudeFt":38000,"speedKt":422.3,"track":321.83,"seenAt":"2026-10-04T14:48:24.307Z"},
    {"hex":"43c700","callsign":"RRR2301","registration":null,"type":"A332","country":"Royaume-Uni","family":"autres","lat":45.947059,"lon":3.590057,"dept":"63","altitudeFt":39000,"speedKt":460.2,"track":143.93,"seenAt":"2026-10-04T14:48:24.420Z"}
  ],
  "abroadCount": 3,
  "abroad": [
    {"hex":"c05325","callsign":"SPR106","registration":null,"type":"DH8A","country":"Canada","family":"autres","lat":50.866716,"lon":-1.051583},
    {"hex":"ae1436","callsign":"FAZE37","registration":null,"type":"GLF5","country":"États-Unis","family":"autres","lat":51.372908,"lon":-0.572662},
    {"hex":"ae5719","callsign":"CNV6981","registration":null,"type":"B737","country":"États-Unis","family":"autres","lat":51.620147,"lon":5.706863}
  ],
  "emergencies": [],
  "emergencyLog": [],
  "hourly": {
    "hours": [
      {"hour":"2026-10-04T14","francais":4,"autres":5}
    ],
    "since": "2026-10-04T14"
  },
  "errors": []
};

/**
 * Même relevé, deux lectures (16 h 46 puis 16 h 48) : RCH161 (C-17 américain) en 7700 au-dessus du Finistère, confirmé ; un appareil
 * suisse fictif en 7500 au-dessus de Genève, vu une fois (hors de France, dans les approches de 40 km).
 */
const MILITARY_EMERGENCY: MilitaryResponse = {
  "readAt": "2026-10-04T14:48:30.000Z",
  "sourceNow": "2026-10-04T14:48:24.501Z",
  "frenchByDept": [
    {"dept":"13","count":3},
    {"dept":"69","count":1}
  ],
  "aircraft": [
    {"hex":"3bf001","callsign":"FICTIF01","registration":null,"type":"DH8D","country":"France","family":"francais","lat":43.55,"lon":5.05,"dept":"13","altitudeFt":2050,"speedKt":227.7,"track":115.21,"seenAt":"2026-10-04T14:48:23.693Z"},
    {"hex":"3bf002","callsign":"FICTIF02","registration":null,"type":"BE20","country":"France","family":"francais","lat":43.5,"lon":5.15,"dept":"13","altitudeFt":1200,"speedKt":196.7,"track":94.67,"seenAt":"2026-10-04T14:48:23.472Z"},
    {"hex":"3bf003","callsign":"FICTIF03","registration":null,"type":"A332","country":"France","family":"francais","lat":43.6,"lon":5.25,"dept":"13","altitudeFt":1275,"speedKt":211.9,"track":342.42,"seenAt":"2026-10-04T14:48:24.283Z"},
    {"hex":"3bf004","callsign":"FICTIF04","registration":"F-ZFIC","type":"EC45","country":"France","family":"francais","lat":45.87,"lon":4.64,"dept":"69","altitudeFt":525,"speedKt":51.5,"track":352.18,"seenAt":"2026-10-04T14:48:24.290Z"},
    {"hex":"894081","callsign":"BAH11","registration":null,"type":"B738","country":"Bahreïn","family":"autres","lat":47.017273,"lon":4.422546,"dept":"71","altitudeFt":38000,"speedKt":424,"track":332.47,"seenAt":"2026-10-04T14:48:24.241Z"},
    {"hex":"c2b5b7","callsign":"CFC2902","registration":null,"type":"C30J","country":"Canada","family":"autres","lat":43.484306,"lon":4.675729,"dept":"13","altitudeFt":2725,"speedKt":226,"track":359.24,"seenAt":"2026-10-04T14:48:24.394Z"},
    {"hex":"44f684","callsign":"GRZLY21","registration":null,"type":"A400","country":"Belgique","family":"autres","lat":43.381472,"lon":-0.468554,"dept":"64","altitudeFt":1400,"speedKt":142,"track":270,"seenAt":"2026-10-04T14:48:24.136Z"},
    {"hex":"ae0805","callsign":"RCH161","registration":null,"type":"C17","country":"États-Unis","family":"autres","lat":48.2,"lon":-4.1,"dept":"29","altitudeFt":39000,"speedKt":437.6,"track":150.27,"seenAt":"2026-10-04T14:48:24.161Z"},
    {"hex":"43c6f6","callsign":"RRR2243","registration":"ZZ999","type":"A332","country":"Royaume-Uni","family":"autres","lat":50.693059,"lon":1.625671,"dept":"62","altitudeFt":38000,"speedKt":422.3,"track":321.83,"seenAt":"2026-10-04T14:48:24.307Z"},
    {"hex":"43c700","callsign":"RRR2301","registration":null,"type":"A332","country":"Royaume-Uni","family":"autres","lat":45.947059,"lon":3.590057,"dept":"63","altitudeFt":39000,"speedKt":460.2,"track":143.93,"seenAt":"2026-10-04T14:48:24.420Z"}
  ],
  "abroadCount": 4,
  "abroad": [
    {"hex":"c05325","callsign":"SPR106","registration":null,"type":"DH8A","country":"Canada","family":"autres","lat":50.866716,"lon":-1.051583},
    {"hex":"ae1436","callsign":"FAZE37","registration":null,"type":"GLF5","country":"États-Unis","family":"autres","lat":51.372908,"lon":-0.572662},
    {"hex":"ae5719","callsign":"CNV6981","registration":null,"type":"B737","country":"États-Unis","family":"autres","lat":51.620147,"lon":5.706863},
    {"hex":"4b1a2c","callsign":"SUI7500","registration":null,"type":"PC21","country":"Suisse","family":"autres","lat":46.204,"lon":6.143}
  ],
  "emergencies": [
    {"icao24":"ae0805","callsign":"RCH161","registration":null,"squawk":"7700","lat":48.2,"lon":-4.1,"altitudeM":11887,"firstSeen":"2026-10-04T14:46:24.501Z","lastSeen":"2026-10-04T14:48:24.501Z","overFrance":true,"family":"autres","type":"C17","country":"États-Unis","emergency":"general","inFrance":true,"dept":"29"},
    {"icao24":"4b1a2c","callsign":"SUI7500","registration":null,"squawk":"7500","lat":46.204,"lon":6.143,"altitudeM":2743,"firstSeen":"2026-10-04T14:48:24.501Z","lastSeen":"2026-10-04T14:48:24.501Z","overFrance":true,"family":"autres","type":"PC21","country":"Suisse","emergency":"unlawful","inFrance":false,"dept":null}
  ],
  "emergencyLog": [
    {"icao24":"ae0805","callsign":"RCH161","registration":null,"squawk":"7700","lat":48.2,"lon":-4.1,"altitudeM":11887,"firstSeen":"2026-10-04T14:46:24.501Z","lastSeen":"2026-10-04T14:48:24.501Z","overFrance":true,"family":"autres","type":"C17","country":"États-Unis","emergency":"general","inFrance":true,"dept":"29"},
    {"icao24":"4b1a2c","callsign":"SUI7500","registration":null,"squawk":"7500","lat":46.204,"lon":6.143,"altitudeM":2743,"firstSeen":"2026-10-04T14:48:24.501Z","lastSeen":"2026-10-04T14:48:24.501Z","overFrance":true,"family":"autres","type":"PC21","country":"Suisse","emergency":"unlawful","inFrance":false,"dept":null}
  ],
  "hourly": {
    "hours": [
      {"hour":"2026-10-04T14","francais":4,"autres":6}
    ],
    "since": "2026-10-04T14"
  },
  "errors": []
};

/**
 * Urgences d'appareils autrefois masqués (O10, remplacée le 08/10/2026), deux lectures (16 h 46 puis 16 h 48) : un appareil d'État
 * français fictif (FICTIF04, F-ZFIC) en 7700 au-dessus du Rhône, confirmé ; un appareil d'une autre nation marqué PIA en 7500 au-dessus
 * des Pyrénées-Atlantiques, vu une fois. Tous deux montrés avec adresse, indicatif, position, type et pays.
 */
const MILITARY_FRENCH_EMERGENCY: MilitaryResponse = {
  "readAt": "2026-10-04T14:48:30.000Z",
  "sourceNow": "2026-10-04T14:48:24.501Z",
  "frenchByDept": [
    {"dept":"13","count":3},
    {"dept":"69","count":1}
  ],
  "aircraft": [
    {"hex":"3bf001","callsign":"FICTIF01","registration":null,"type":"DH8D","country":"France","family":"francais","lat":43.55,"lon":5.05,"dept":"13","altitudeFt":2050,"speedKt":227.7,"track":115.21,"seenAt":"2026-10-04T14:48:23.693Z"},
    {"hex":"3bf002","callsign":"FICTIF02","registration":null,"type":"BE20","country":"France","family":"francais","lat":43.5,"lon":5.15,"dept":"13","altitudeFt":1200,"speedKt":196.7,"track":94.67,"seenAt":"2026-10-04T14:48:23.472Z"},
    {"hex":"3bf003","callsign":"FICTIF03","registration":null,"type":"A332","country":"France","family":"francais","lat":43.6,"lon":5.25,"dept":"13","altitudeFt":1275,"speedKt":211.9,"track":342.42,"seenAt":"2026-10-04T14:48:24.283Z"},
    {"hex":"3bf004","callsign":"FICTIF04","registration":"F-ZFIC","type":"EC45","country":"France","family":"francais","lat":45.87,"lon":4.64,"dept":"69","altitudeFt":525,"speedKt":51.5,"track":352.18,"seenAt":"2026-10-04T14:48:24.290Z"},
    {"hex":"894081","callsign":"BAH11","registration":null,"type":"B738","country":"Bahreïn","family":"autres","lat":47.017273,"lon":4.422546,"dept":"71","altitudeFt":38000,"speedKt":424,"track":332.47,"seenAt":"2026-10-04T14:48:24.241Z"},
    {"hex":"c2b5b7","callsign":"CFC2902","registration":null,"type":"C30J","country":"Canada","family":"autres","lat":43.484306,"lon":4.675729,"dept":"13","altitudeFt":2725,"speedKt":226,"track":359.24,"seenAt":"2026-10-04T14:48:24.394Z"},
    {"hex":"44f684","callsign":"GRZLY21","registration":null,"type":"A400","country":"Belgique","family":"autres","lat":43.381472,"lon":-0.468554,"dept":"64","altitudeFt":1400,"speedKt":142,"track":270,"seenAt":"2026-10-04T14:48:24.136Z"},
    {"hex":"43c6f6","callsign":"RRR2243","registration":"ZZ999","type":"A332","country":"Royaume-Uni","family":"autres","lat":50.693059,"lon":1.625671,"dept":"62","altitudeFt":38000,"speedKt":422.3,"track":321.83,"seenAt":"2026-10-04T14:48:24.307Z"},
    {"hex":"43c700","callsign":"RRR2301","registration":null,"type":"A332","country":"Royaume-Uni","family":"autres","lat":45.947059,"lon":3.590057,"dept":"63","altitudeFt":39000,"speedKt":460.2,"track":143.93,"seenAt":"2026-10-04T14:48:24.420Z"}
  ],
  "abroadCount": 3,
  "abroad": [
    {"hex":"c05325","callsign":"SPR106","registration":null,"type":"DH8A","country":"Canada","family":"autres","lat":50.866716,"lon":-1.051583},
    {"hex":"ae1436","callsign":"FAZE37","registration":null,"type":"GLF5","country":"États-Unis","family":"autres","lat":51.372908,"lon":-0.572662},
    {"hex":"ae5719","callsign":"CNV6981","registration":null,"type":"B737","country":"États-Unis","family":"autres","lat":51.620147,"lon":5.706863}
  ],
  "emergencies": [
    {"icao24":"44f684","callsign":"GRZLY21","registration":null,"squawk":"7500","lat":43.381472,"lon":-0.468554,"altitudeM":427,"firstSeen":"2026-10-04T14:48:24.501Z","lastSeen":"2026-10-04T14:48:24.501Z","overFrance":true,"family":"autres","type":"A400","country":"Belgique","emergency":"unlawful","inFrance":true,"dept":"64"},
    {"icao24":"3bf004","callsign":"FICTIF04","registration":"F-ZFIC","squawk":"7700","lat":45.87,"lon":4.64,"altitudeM":160,"firstSeen":"2026-10-04T14:46:24.501Z","lastSeen":"2026-10-04T14:48:24.501Z","overFrance":true,"family":"francais","type":"EC45","country":"France","emergency":"general","inFrance":true,"dept":"69"}
  ],
  "emergencyLog": [
    {"icao24":"3bf004","callsign":"FICTIF04","registration":"F-ZFIC","squawk":"7700","lat":45.87,"lon":4.64,"altitudeM":160,"firstSeen":"2026-10-04T14:46:24.501Z","lastSeen":"2026-10-04T14:48:24.501Z","overFrance":true,"family":"francais","type":"EC45","country":"France","emergency":"general","inFrance":true,"dept":"69"},
    {"icao24":"44f684","callsign":"GRZLY21","registration":null,"squawk":"7500","lat":43.381472,"lon":-0.468554,"altitudeM":427,"firstSeen":"2026-10-04T14:48:24.501Z","lastSeen":"2026-10-04T14:48:24.501Z","overFrance":true,"family":"autres","type":"A400","country":"Belgique","emergency":"unlawful","inFrance":true,"dept":"64"}
  ],
  "hourly": {
    "hours": [
      {"hour":"2026-10-04T14","francais":4,"autres":5}
    ],
    "since": "2026-10-04T14"
  },
  "errors": []
};

/**
 * 53 câbles télécom (19 du Shom, dont un hors service et un tronçon au large sans atterrage ; 34 compléments OpenStreetMap),
 * 67 atterrages, 2 zones de câbles et 10 zones de mouillage du Shom ; tracés éclaircis pour le jeu d'essai. Liaisons électriques
 * Normandie 1 et 2 retirées comme dans la sortie du script (revue finale M5).
 */
const CABLES_FILE: SubseaCablesFile = {
  "generatedAt": "2026-10-04T14:48:00.000Z",
  "osmBase": "2026-10-04T14:47:16Z",
  "sources": [
    {"source":"Shom","dataset":"Conduites et câbles sous-marins répertoriés par le Shom","layer":"CABLES_BDD_WFS:cblsub_lv","licence":"CC BY-SA","attribution":"Shom","edition":"2019-01-07","url":"https://www.data.gouv.fr/datasets/conduites-et-cables-sous-marins-repertories-par-le-shom/","count":19},
    {"source":"Shom","dataset":"Réglementation - Navigation","layer":"REGLEMENTATION_NAVIGATION_BDD_WFS:cblare_polygon","licence":"Licence ouverte 2.0","attribution":"Shom","edition":"2021-07","url":"https://www.data.gouv.fr/datasets/reglementation-navigation-1/","count":2},
    {"source":"Shom","dataset":"Réglementation - Navigation","layer":"REGLEMENTATION_NAVIGATION_BDD_WFS:achare_polygon","licence":"Licence ouverte 2.0","attribution":"Shom","edition":"2021-07","url":"https://www.data.gouv.fr/datasets/reglementation-navigation-1/","count":10},
    {"source":"OpenStreetMap","dataset":"OpenStreetMap","layer":"Overpass","licence":"ODbL 1.0","attribution":"© les contributeurs d'OpenStreetMap","edition":"2026-10-04T14:47:16Z","url":"https://www.openstreetmap.org/copyright","count":34}
  ],
  "cables": [
    {"id":"shom/FR000013709500001","name":null,"operator":null,"path":[[[4.4806,41.2395],[4.9774,41.4194],[6.1,41.825],[6.4667,41.95],[6.5792,41.975],[6.8333,42.0667],[6.9533,42.1608],[7.0833,42.2458],[7.45,42.55],[7.936,42.6333],[8.4833,43.1],[8.4915,43.2462]]],"landings":[],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000008435600001","name":null,"operator":null,"path":[[[5.3706,43.2606],[5.2822,43.2123],[5.2622,43.119],[5.2489,43.0473],[5.4639,42.614],[5.5773,42.1873],[5.6789,41.9456],[5.7189,41.6856],[5.7606,41.1573],[5.7123,40.6456],[5.669,40.4189],[5.5224,40.0833]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.26064,"lon":5.37057}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000014411700001","name":null,"operator":null,"path":[[[5.3723,43.2614],[5.3632,43.2599],[5.3527,43.2607],[5.3394,43.257],[5.2817,43.2228],[5.266,43.0981],[5.2803,42.8711],[5.3658,42.6848],[5.438,42.3546],[5.6295,41.719],[5.6203,41.2604],[5.641,40.0833]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.26138,"lon":5.3723}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000008435000001","name":null,"operator":null,"path":[[[5.3682,43.263],[5.3656,43.2631],[5.2872,43.179],[5.2989,43.1156],[5.3022,43.049],[5.3159,42.939],[5.5422,42.789],[5.6339,42.5506],[5.7689,42.244],[5.9089,41.9356],[6.1239,41.5156],[6.1622,41.4276]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.26296,"lon":5.36822}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000014401600001","name":null,"operator":null,"path":[[[5.3721,43.2617],[5.3672,43.2592],[5.3612,43.2574],[5.3534,43.2556],[5.3029,43.2308],[5.2844,43.0981],[5.2741,42.9335],[5.357,42.8257],[5.5008,42.5197],[5.6668,42.1648],[5.9982,41.6586],[6.1676,41.4309]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.26168,"lon":5.37205}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000019835900003","name":null,"operator":null,"path":[[[5.373,43.2534],[5.358,43.2512],[5.3415,43.2392],[5.3701,43.0861],[5.4822,43.0163],[5.6241,42.9161],[5.6726,42.8851],[5.711,42.8603],[5.8008,42.8262],[6.7678,42.9074],[7.1338,43.1626],[7.44,43.6702]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.25339,"lon":5.37303}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000008435100001","name":null,"operator":null,"path":[[[5.3712,43.2533],[5.3189,43.219],[5.3289,43.154],[5.3422,43.1273],[5.3839,43.0523],[5.4322,42.9573],[5.5922,42.8706],[5.6656,42.8256],[5.8406,42.6223],[6.0589,42.3473],[6.5123,41.789],[6.5838,41.6828]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.25331,"lon":5.37123}],"source":"Shom","licence":"CC BY-SA","outOfService":true},
    {"id":"shom/FR000020735200003","name":null,"operator":null,"path":[[[5.3746,43.2534],[5.3662,43.253],[5.3488,43.2486],[5.2983,43.2002],[5.3309,43.1342],[5.3914,43.0386],[5.4678,42.9514],[5.5329,42.8812],[5.6677,42.8502],[5.9588,42.6607],[6.3144,42.2878],[6.7531,41.785]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.25342,"lon":5.37463}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000015347700001","name":null,"operator":null,"path":[[[5.0271,40.522],[5.2049,41.7602],[5.2539,42.6374],[5.3112,42.7412],[5.3519,42.8314],[5.3578,42.8866],[5.3105,42.9547],[5.3021,43.0222],[5.294,43.1239],[5.2741,43.183],[5.3469,43.2546],[5.372,43.2618]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.26175,"lon":5.37195}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000008434700001","name":null,"operator":null,"path":[[[5.3656,43.2631],[5.3194,43.2598],[5.1656,43.069],[5.1789,42.6356],[5.1656,42.354],[5.1773,42.0373],[5.1606,41.8173],[5.1489,41.6889],[5.1773,41.3123],[5.1756,40.8889],[5.1656,40.6056],[5.1431,40.3687]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.26314,"lon":5.36557}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000008474600001","name":null,"operator":null,"path":[[[5.3476,43.2826],[5.3475,43.2835],[5.3472,43.2841],[5.3462,43.2843],[5.3449,43.2835],[5.3246,43.277],[5.3172,43.2783],[5.3136,43.2805]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.28264,"lon":5.34756},{"commune":"Marseille","dept":"13","lat":43.28048,"lon":5.31356}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000008474700001","name":null,"operator":null,"path":[[[5.3472,43.2843],[5.3472,43.285],[5.3454,43.2851],[5.3444,43.2853],[5.3422,43.2835],[5.3372,43.2818],[5.3326,43.2808],[5.3306,43.2776],[5.3222,43.2761],[5.3181,43.2758],[5.3172,43.2763],[5.3139,43.2808]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.28431,"lon":5.34723},{"commune":"Marseille","dept":"13","lat":43.28081,"lon":5.3139}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000008474500001","name":null,"operator":null,"path":[[[5.3541,43.2938],[5.3526,43.2935],[5.3482,43.2941],[5.3446,43.294],[5.3404,43.2933],[5.3359,43.2915],[5.3299,43.2878],[5.3237,43.2833],[5.3216,43.2821],[5.3192,43.2816],[5.3182,43.2815],[5.3156,43.2816]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.29381,"lon":5.35406},{"commune":"Marseille","dept":"13","lat":43.28164,"lon":5.31556}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000009834500001","name":null,"operator":null,"path":[[[5.3379,43.214],[5.3379,43.2136],[5.3391,43.2123]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.21398,"lon":5.3379},{"commune":"Marseille","dept":"13","lat":43.21231,"lon":5.33907}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000019845800003","name":null,"operator":null,"path":[[[5.3727,43.2631],[5.3716,43.2608],[5.3583,43.2544],[5.3174,43.2539],[5.3161,43.2384],[5.3144,43.2347],[5.3098,43.2308],[5.3052,43.2292],[5.2885,43.2293],[5.2861,43.2275],[5.2759,43.1221],[5.2769,43.0827]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.26305,"lon":5.37266}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000019845900003","name":null,"operator":null,"path":[[[5.3725,43.2631],[5.3714,43.2617],[5.3585,43.2552],[5.357,43.2551],[5.3226,43.237],[5.2898,43.2134],[5.2677,43.187],[5.2677,43.1737],[5.2725,43.1635],[5.2738,43.1505],[5.2606,43.1056],[5.2574,43.0807]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.26314,"lon":5.37245}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000019846000003","name":null,"operator":null,"path":[[[5.3758,43.2586],[5.3698,43.257],[5.3591,43.2533],[5.3209,43.2332],[5.3102,43.2258],[5.2909,43.2096],[5.2872,43.2029],[5.2856,43.1895],[5.285,43.1591],[5.2873,43.1],[5.292,43.0813],[5.2923,43.0606]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.25857,"lon":5.37584}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000019846100003","name":null,"operator":null,"path":[[[5.3758,43.2583],[5.3611,43.2535],[5.3545,43.245],[5.3481,43.2417],[5.3392,43.24],[5.329,43.2358],[5.3162,43.2272],[5.3066,43.217],[5.3074,43.1995],[5.349,43.0881],[5.3648,43.0681]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.25834,"lon":5.3758}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"shom/FR000019846200003","name":null,"operator":null,"path":[[[5.3677,43.2449],[5.3658,43.2488],[5.3619,43.2489],[5.359,43.2483],[5.3567,43.247],[5.3546,43.2447],[5.3214,43.2155],[5.3209,43.206],[5.3605,43.0917]]],"landings":[{"commune":"Marseille","dept":"13","lat":43.24489,"lon":5.36774}],"source":"Shom","licence":"CC BY-SA","outOfService":false},
    {"id":"way/78424042","name":"Apollo South","operator":"Apollo","path":[[[-3.5472,48.7463],[-3.6906,48.7567],[-3.8015,48.8535],[-3.9473,48.9516],[-4.6833,48.9617],[-4.9332,49],[-5.3931,49.0833],[-5.8833,49.0843],[-6.1813,49.08],[-7.0318,49.0619],[-7.5521,48.8239],[-7.8814,48.6218]]],"landings":[{"commune":"Trébeurden","dept":"22","lat":48.7463,"lon":-3.54723}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/78434985","name":"SEA-ME-WE3 SEG 10.1","operator":"BT","path":[[[-4.3444,47.8395],[-5.2393,47.9294],[-5.8106,48.3288],[-5.7044,48.5781],[-5.6185,48.7069],[-5.5575,48.7665],[-5.38,49.1243],[-5.3548,49.1906],[-5.311,49.3236],[-5.1734,49.7276],[-5.1181,49.9334],[-5.1635,50.0057]]],"landings":[{"commune":"Penmarch","dept":"29","lat":47.8395,"lon":-4.34437}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/78444037","name":"Ulysses 1","operator":"Verizon Business","path":[[[1.3836,51.1501],[1.4677,51.1015],[1.5003,51.101],[1.7836,51.1012],[1.7843,51.1005],[1.8512,51.0838],[1.8675,51.0835],[1.8678,51.0677],[1.8681,51.0678],[1.8848,51.0341],[1.8848,51.0183],[1.8846,50.9674]]],"landings":[{"commune":"Calais","dept":"62","lat":50.96742,"lon":1.8846}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/78444059","name":"UK-France 4 - Seg 3","operator":"BT","path":[[[1.7323,51.103],[1.811,51.1077],[1.8265,51.1115],[1.911,51.1182],[1.9267,51.1058],[1.9568,51.0858],[1.9637,51.0793],[1.9872,51.0592],[1.9907,51.0518],[2.0148,51.0288],[2.0175,51.0258],[2.0327,51.0043]]],"landings":[{"commune":"Oye-Plage","dept":"62","lat":51.00433,"lon":2.03265}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/78444063","name":"UK-France 3","operator":"Cable & Wireless","path":[[[-0.1382,50.8192],[-0.008,50.6666],[0.0031,50.6564],[0.075,50.6247],[0.1594,50.5734],[0.1658,50.5629],[0.3915,50.3853],[0.586,50.2601],[0.7437,50.1658],[1.0311,49.971],[1.0486,49.9507],[1.0687,49.9263]]],"landings":[{"commune":"Dieppe","dept":"76","lat":49.92628,"lon":1.06865}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/78444799","name":"TAT13","operator":"BT","path":[[[-4.3466,47.8323],[-4.5848,47.7846],[-4.8361,47.6602],[-5.0333,47.621],[-5.5464,47.5297],[-5.8166,47.4788],[-5.955,47.367],[-6.0993,47.2486],[-6.2368,47.0705],[-6.5003,46.6997],[-7.4977,46.3443],[-9.5435,46.0782]]],"landings":[{"commune":"Penmarch","dept":"29","lat":47.83228,"lon":-4.34665}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/78444800","name":"TAT12 Interlink","operator":"BT","path":[[[-4.3459,47.8409],[-5.0666,47.8742],[-5.9458,48.1668],[-6.209,48.3373],[-6.0512,48.7391],[-5.9399,48.9246],[-5.8783,49.0967],[-5.8362,49.2395],[-5.8166,49.472],[-5.807,49.507],[-5.6851,49.8701],[-5.6517,50.0437]]],"landings":[{"commune":"Penmarch","dept":"29","lat":47.8409,"lon":-4.34588}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/78444815","name":"TAT 11 France","operator":"Cable & Wireless","path":[[[-1.9921,46.7281],[-2.1083,46.6684],[-2.3269,46.5797],[-4.0512,46.7642],[-4.8672,46.7632],[-5.1762,46.6528],[-5.3715,46.5692],[-5.8234,46.6018],[-6.4402,46.7668],[-6.8654,46.831],[-7.8392,47.1467],[-8.35,47.3325]]],"landings":[{"commune":"Saint-Hilaire-de-Riez","dept":"85","lat":46.72807,"lon":-1.99212}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/150388021","name":"Flag Atlantic South","operator":"Flag Ltd.","path":[[[-2.8834,48.6756],[-2.8411,48.9726],[-3.4502,48.9965],[-4.0498,48.9975],[-5.1651,49],[-5.929,48.9645],[-6.5062,48.5375],[-7.3286,47.8581],[-7.6096,47.5399],[-8.3504,46.9417],[-15.4619,47.079],[-20.0332,46.8263]]],"landings":[{"commune":"Tréveneuc","dept":"22","lat":48.67563,"lon":-2.88342}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/150388022","name":"Hugo Seg 2","operator":"C&W","path":[[[-2.558,49.4236],[-2.6387,49.3721],[-2.8682,49.3167],[-3.1327,49.2357],[-3.2083,49.196],[-3.5077,49.1278],[-3.7649,49.0682],[-3.8591,49.0488],[-3.9661,48.989],[-3.8335,48.8549],[-3.689,48.7565],[-3.5472,48.7463]]],"landings":[{"commune":"Trébeurden","dept":"22","lat":48.74632,"lon":-3.54725}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/151719999","name":"Flag Atlantic Interlink","operator":"Flag Ltd.","path":[[[-5.6516,50.044],[-5.4858,49.8864],[-5.3893,49.6757],[-4.8868,49.5388],[-4.4767,49.4208],[-3.8667,49.2713],[-3.3,49.2205],[-2.95,49.1852],[-2.7159,49.0976],[-2.5923,48.8228],[-2.5847,48.749],[-2.7572,48.5641]]],"landings":[{"commune":"Plérin","dept":"22","lat":48.56408,"lon":-2.75718}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201701","name":"ARTEMIS","operator":null,"path":[[[5.8942,43.0783],[5.8566,42.9464],[6.9155,41.5089],[7.5539,39.5722],[8.6439,38.4222],[10.6656,38.3039],[12.1998,37.5819],[13.8674,36.8322],[15.4544,36.2526],[17.4275,36.4239],[20.2617,37.348],[21.195,37.935]]],"landings":[{"commune":"La Seyne-sur-Mer","dept":"83","lat":43.07833,"lon":5.89417}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201702","name":"BARMAR","operator":null,"path":[[[5.0552,43.3281],[5.06,43.3217],[5.0664,43.3166],[5.026,43.2177],[4.9386,42.8717],[4.9091,42.6232],[4.26,42.0333],[3.7335,41.6932],[3.0004,41.4075],[2.7887,41.4346],[2.5412,41.472],[2.4056,41.5063]]],"landings":[{"commune":"Sausset-les-Pins","dept":"13","lat":43.32808,"lon":5.05517}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201703","name":"CC4","operator":null,"path":[[[7.0436,43.5433],[7.0447,43.5432],[7.0566,43.5417],[7.0898,43.5238],[7.1261,43.4822],[7.1894,43.4332],[7.3511,43.3427],[7.6891,43.1757],[8.598,42.7728],[8.6583,42.7413],[8.7493,42.6747],[8.9283,42.6383]]],"landings":[{"commune":"Cannes","dept":"06","lat":43.54333,"lon":7.04364},{"commune":"L'Île-Rousse","dept":"2B","lat":42.63833,"lon":8.92833}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201704","name":"CC5","operator":null,"path":[[[5.895,43.075],[5.9066,43.0333],[5.9159,42.9984],[5.9316,42.9438],[5.9746,42.8967],[6.8826,42.4826],[7.2779,42.2931],[8.1181,41.8725],[8.3408,41.7637],[8.5835,41.8206],[8.7307,41.8951],[8.7333,41.915]]],"landings":[{"commune":"La Seyne-sur-Mer","dept":"83","lat":43.075,"lon":5.895},{"commune":"Ajaccio","dept":"2A","lat":41.915,"lon":8.73333}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201705","name":"CORSAR","operator":null,"path":[[[8.7367,41.915],[8.7365,41.9041],[8.667,41.8175],[8.6232,41.6625],[8.682,41.5446],[8.7527,41.471],[8.832,41.4386],[9.1367,41.3241],[9.2867,41.3015],[9.3609,41.3299],[9.6356,41.099],[9.6167,41.0117]]],"landings":[{"commune":"Ajaccio","dept":"2A","lat":41.915,"lon":8.73667}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201706","name":"CORSE","operator":null,"path":[[[8.7587,42.5692],[8.7593,42.5728],[8.7605,42.5725],[8.7752,42.5925],[8.778,42.6106],[8.8165,42.644],[8.9222,42.6423],[8.9253,42.6406],[8.93,42.6383]]],"landings":[{"commune":"Calvi","dept":"2B","lat":42.56917,"lon":8.75867},{"commune":"L'Île-Rousse","dept":"2B","lat":42.63833,"lon":8.93}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201707","name":"DIDON2","operator":null,"path":[[[5.055,43.3283],[5.1032,43.1924],[5.2054,42.5023],[5.3655,41.4839],[5.7522,40.4322],[6.434,39.5875],[6.7355,38.7856],[7.8039,38.1122],[9.0389,37.9222],[9.6189,37.5539],[9.9261,37.3321],[9.8783,37.2892]]],"landings":[{"commune":"Sausset-les-Pins","dept":"13","lat":43.32833,"lon":5.055}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201714","name":"EURAFRICA E1","operator":null,"path":[[[-2,46.7167],[-2.1883,46.582],[-3.1184,46.1387],[-3.9,45.7],[-5.5568,45.1398],[-9.1178,44.4666],[-10.6354,43.2201],[-10.917,41.2498],[-10.8861,39.5863],[-10.1673,38.3043],[-9.3183,38.3218],[-9.0935,38.4411]]],"landings":[{"commune":"Saint-Hilaire-de-Riez","dept":"85","lat":46.71667,"lon":-2}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201715","name":"F-ALGER 4","operator":null,"path":[[[5.0548,43.3284],[5.0723,43.3147],[5.0171,43.1306],[4.9904,42.7956],[4.9421,41.8356],[4.9155,41.0189],[4.9871,40.1706],[4.8288,39.4005],[4.4622,38.6022],[3.7255,37.8922],[2.9955,37.1388],[2.8922,36.7796]]],"landings":[{"commune":"Sausset-les-Pins","dept":"13","lat":43.32842,"lon":5.05475}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201716","name":"RUPPIONE - PROPRIANO","operator":null,"path":[[[8.785,41.83],[8.7506,41.8257],[8.7334,41.8287],[8.7153,41.8303],[8.6421,41.8095],[8.5886,41.7104],[8.5961,41.7031],[8.6872,41.6624],[8.8025,41.6705],[8.8562,41.6834],[8.8806,41.6827],[8.9096,41.6778]]],"landings":[{"commune":"Pietrosella","dept":"2A","lat":41.83,"lon":8.785},{"commune":"Viggianello","dept":"2A","lat":41.6778,"lon":8.90955}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201717","name":"F-LYBIE","operator":null,"path":[[[5.8948,43.079],[5.8839,43.0548],[5.8821,43.0173],[5.8722,41.7459],[6.7239,39.3122],[8.8323,37.9822],[10.5785,37.4186],[11.3198,37.1642],[12.489,35.9789],[13.3391,34.9155],[13.0807,33.5355],[13.1601,32.8845]]],"landings":[{"commune":"La Seyne-sur-Mer","dept":"83","lat":43.07897,"lon":5.89477}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201718","name":"OLERON","operator":null,"path":[[[-1.2001,45.7907],[-1.2,45.7909],[-1.1998,45.7911],[-1.1986,45.7929],[-1.2049,45.7957],[-1.2114,45.7988],[-1.2146,45.8055],[-1.2139,45.8101],[-1.2174,45.8118],[-1.2196,45.8131],[-1.2203,45.8132],[-1.2203,45.8133]]],"landings":[{"commune":"Saint-Trojan-les-Bains","dept":"17","lat":45.79072,"lon":-1.20007},{"commune":"Saint-Trojan-les-Bains","dept":"17","lat":45.8133,"lon":-1.22033}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201730","name":"SEA ME WE3-S9","operator":null,"path":[[[-4.3466,47.8323],[-4.4781,47.831],[-4.6542,47.7971],[-4.9171,47.7543],[-5.4666,47.3883],[-6.2044,46.8744],[-9.5718,44.9042],[-11.4733,41.9985],[-11.5421,38.8667],[-9.7497,37.9831],[-9.1206,38.361],[-9.0935,38.4411]]],"landings":[{"commune":"Penmarch","dept":"29","lat":47.83228,"lon":-4.34665}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201731","name":"TAGIDE","operator":null,"path":[[[-4.3479,47.8322],[-4.9499,47.5556],[-5.583,47.1888],[-6.3249,46.7056],[-7.7965,45.6655],[-9.3482,44.6188],[-10.4448,43.5521],[-11.1582,42.3337],[-11.2031,40.8671],[-11.2214,39.4037],[-10.1514,38.4437],[-9.185,38.4858]]],"landings":[{"commune":"Penmarch","dept":"29","lat":47.8322,"lon":-4.34793}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201736","name":"UK-FR4","operator":null,"path":[[[2.0417,51],[2.0325,51.0058],[1.9907,51.0518],[1.9568,51.0858],[1.87,51.1148],[1.7438,51.1047],[1.7207,51.103],[1.693,51.1005],[1.6203,51.0962],[1.5025,51.0981],[1.4123,51.1296],[1.3846,51.1505]]],"landings":[{"commune":"Oye-Plage","dept":"62","lat":51,"lon":2.04167}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201743","name":"CALVI-ST-FLORENT","operator":null,"path":[[[8.7561,42.5703],[8.7595,42.5761],[8.7747,42.6096],[8.866,42.6875],[8.9456,42.7166],[8.994,42.7349],[9.0551,42.7568],[9.1816,42.8028],[9.2674,42.7705],[9.2864,42.7309],[9.2961,42.7037],[9.302,42.6835]]],"landings":[{"commune":"Calvi","dept":"2B","lat":42.5703,"lon":8.75612},{"commune":"Saint-Florent","dept":"2B","lat":42.6835,"lon":9.302}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201745","name":"HYERES FESTOON 1","operator":null,"path":[[[6.1576,43.0296],[6.1611,43.0264],[6.1817,43.0273],[6.1943,43.0112],[6.1995,43.0051],[6.2008,43.0053],[6.2021,43.0052],[6.2036,43.0048],[6.2043,43.0044]]],"landings":[{"commune":"Carqueiranne","dept":"83","lat":43.02958,"lon":6.15758},{"commune":"Hyères","dept":"83","lat":43.00438,"lon":6.20432}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201746","name":"HYERES FESTOON 2","operator":null,"path":[[[6.2047,43.0027],[6.195,43.0102],[6.1892,43.0151],[6.1901,43.0175],[6.1914,43.0227],[6.2315,43.0342],[6.3774,43.0199],[6.3797,43.0095],[6.3809,43.0093],[6.3809,43.0093],[6.3811,43.0095],[6.381,43.0101]]],"landings":[{"commune":"Hyères","dept":"83","lat":43.0027,"lon":6.2047},{"commune":"Bormes-les-Mimosas","dept":"83","lat":43.01013,"lon":6.38103}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201747","name":"HYERES FESTOON 3","operator":null,"path":[[[6.434,43.0202],[6.4341,43.0207],[6.434,43.0209],[6.4338,43.021],[6.4336,43.0214],[6.4333,43.0221],[6.4073,43.0286],[6.3778,43.0103],[6.3805,43.0093],[6.3809,43.0092],[6.3811,43.0095],[6.381,43.0101]]],"landings":[{"commune":"Bormes-les-Mimosas","dept":"83","lat":43.02021,"lon":6.43402},{"commune":"Bormes-les-Mimosas","dept":"83","lat":43.01013,"lon":6.38103}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201748","name":"HYERES FESTOON 4","operator":null,"path":[[[6.4353,43.0214],[6.4357,43.0222],[6.436,43.0236],[6.4355,43.0258],[6.3998,43.0671],[6.3934,43.1085],[6.3733,43.1254],[6.3722,43.1281],[6.3701,43.1284],[6.3691,43.1288],[6.3674,43.1293],[6.3649,43.1297]]],"landings":[{"commune":"Bormes-les-Mimosas","dept":"83","lat":43.02137,"lon":6.4353},{"commune":"Bormes-les-Mimosas","dept":"83","lat":43.12972,"lon":6.36493}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201749","name":"CORSICA HD","operator":null,"path":[[[8.9098,41.6779],[8.9088,41.6794],[8.906,41.6808],[8.9002,41.682],[8.8317,41.6789],[8.7048,41.6798],[8.6167,41.6752],[8.5566,41.7258],[8.5917,41.8024],[8.7084,41.8231],[8.7468,41.8289],[8.785,41.8314]]],"landings":[{"commune":"Viggianello","dept":"2A","lat":41.67786,"lon":8.90975},{"commune":"Pietrosella","dept":"2A","lat":41.83145,"lon":8.78498}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201752","name":"ACE S1.1","operator":null,"path":[[[-4.3538,47.8263],[-4.356,47.8279],[-4.3611,47.8309],[-4.3621,47.8318],[-4.368,47.8337],[-4.3804,47.8356],[-4.6247,47.7515],[-4.6557,47.7312],[-4.6767,47.7167],[-4.736,47.6987],[-4.8349,47.6772],[-4.9968,47.6436]]],"landings":[{"commune":"Penmarch","dept":"29","lat":47.8263,"lon":-4.35378}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false},
    {"id":"way/761201757","name":"AMITIE","operator":null,"path":[[[5.0548,43.3285],[5.0175,43.2208],[4.8521,42.2989],[4.7155,40.9356],[4.7288,39.4572],[3.5238,38.5072],[2.2126,37.726],[0.6271,37.0421],[-0.8979,36.5088],[-2.5644,36.1078],[-4.1913,35.8737],[-5.373,35.62]]],"landings":[{"commune":"Sausset-les-Pins","dept":"13","lat":43.32847,"lon":5.05475}],"source":"OpenStreetMap","licence":"ODbL 1.0","outOfService":false}
  ],
  "cableZones": [
    {"id":"shom/FR000050859100003","name":null,"info":null,"cableCategory":null,"source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.2629,43.2039],[5.3267,43.2138],[5.5567,42.9167],[5.0167,42.9167],[5.2413,43.2005],[5.2629,43.2039]]]]},
    {"id":"shom/FR000009979300003","name":null,"info":null,"cableCategory":"telecom","source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.3683,43.2677],[5.3706,43.2636],[5.3083,43.311],[5.2937,43.2644],[5.301,43.2694],[5.3013,43.2716],[5.3092,43.2736],[5.3158,43.2832],[5.3239,43.2859],[5.3496,43.2857],[5.3678,43.2669],[5.3683,43.2677]]]]}
  ],
  "anchorageZones": [
    {"id":"shom/FR000051219600003","name":null,"info":null,"anchoringProhibited":false,"crossesCableZone":false,"source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.3618,43.242],[5.3627,43.2411],[5.3621,43.2401],[5.3622,43.2396],[5.3618,43.2384],[5.3605,43.2376],[5.3599,43.236],[5.3589,43.2348],[5.3562,43.2331],[5.3547,43.2332],[5.3531,43.2331],[5.3618,43.242]]]]},
    {"id":"shom/FR000051251200003","name":null,"info":null,"anchoringProhibited":false,"crossesCableZone":true,"source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.3053,43.2723],[5.305,43.2727],[5.3054,43.2731],[5.306,43.273],[5.3062,43.2728],[5.3066,43.2732],[5.3073,43.2734],[5.3079,43.2733],[5.3082,43.2729],[5.3053,43.2723]]]]},
    {"id":"shom/FR000051250100003","name":null,"info":null,"anchoringProhibited":false,"crossesCableZone":false,"source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.2892,43.2684],[5.2897,43.2681],[5.2896,43.2679],[5.2899,43.2676],[5.2903,43.2672],[5.2893,43.2673],[5.2892,43.2671],[5.2889,43.267],[5.2884,43.2667],[5.2877,43.2664],[5.2876,43.2667],[5.2892,43.2684]]]]},
    {"id":"shom/FR000051219500003","name":null,"info":null,"anchoringProhibited":false,"crossesCableZone":false,"source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.3727,43.2477],[5.3688,43.246],[5.3683,43.2457],[5.368,43.245],[5.3658,43.2455],[5.367,43.248],[5.3736,43.2495],[5.3732,43.2482],[5.373,43.2478],[5.3727,43.2478],[5.3727,43.2477]]]]},
    {"id":"shom/FR000051209200003","name":null,"info":null,"anchoringProhibited":false,"crossesCableZone":true,"source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.324,43.2859],[5.3113,43.2755],[5.3104,43.2742],[5.3097,43.2738],[5.309,43.2735],[5.2863,43.2603],[5.2821,43.266],[5.2923,43.2786],[5.2799,43.2794],[5.3005,43.2864],[5.3309,43.2918],[5.324,43.2859]],[[5.3029,43.2759],[5.2962,43.2715],[5.2893,43.2681],[5.2878,43.263],[5.2908,43.2619],[5.2968,43.267],[5.302,43.2694],[5.2997,43.2699],[5.3027,43.2723],[5.3078,43.273],[5.3077,43.2765],[5.3029,43.2759]],[[5.321,43.286],[5.3151,43.2866],[5.3108,43.2845],[5.2997,43.2839],[5.3012,43.2808],[5.2911,43.2801],[5.299,43.2789],[5.3059,43.2798],[5.3139,43.2805],[5.3194,43.2824],[5.3221,43.2861],[5.321,43.286]]]]},
    {"id":"shom/FR000051209300003","name":null,"info":null,"anchoringProhibited":false,"crossesCableZone":true,"source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.3675,43.2672],[5.3488,43.28],[5.3498,43.2802],[5.3513,43.2799],[5.3532,43.2788],[5.356,43.2774],[5.3583,43.2762],[5.3622,43.2735],[5.3621,43.2727],[5.363,43.2703],[5.368,43.268],[5.3675,43.2672]]]]},
    {"id":"shom/FR000051259200003","name":null,"info":null,"anchoringProhibited":false,"crossesCableZone":false,"source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.509,43.1994],[5.5105,43.1954],[5.4926,43.198],[5.495,43.2004],[5.4961,43.2],[5.4969,43.1995],[5.4968,43.1992],[5.4972,43.1988],[5.501,43.1976],[5.5036,43.1981],[5.5045,43.1987],[5.509,43.1994]]]]},
    {"id":"shom/FR000051209600003","name":null,"info":null,"anchoringProhibited":false,"crossesCableZone":true,"source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.635,43.174],[5.3327,43.209],[5.3665,43.243],[5.3488,43.2115],[5.4258,43.2059],[5.4728,43.2057],[5.5197,43.2045],[5.5795,43.1711],[5.6068,43.1741],[5.6677,43.1813],[5.6365,43.1748],[5.635,43.174]],[[5.4006,43.1764],[5.3993,43.1759],[5.3997,43.1751],[5.4002,43.175],[5.4012,43.1751],[5.4018,43.1755],[5.402,43.1759],[5.4018,43.1762],[5.4006,43.1764]],[[5.3542,43.2006],[5.3561,43.199],[5.3572,43.1988],[5.3577,43.1996],[5.3566,43.2006],[5.3542,43.2006]],[[5.6153,43.1617],[5.6152,43.1607],[5.6166,43.1589],[5.6173,43.159],[5.6182,43.1578],[5.6196,43.1578],[5.6206,43.1591],[5.6184,43.1613],[5.6176,43.1613],[5.6168,43.1621],[5.6155,43.1621],[5.6153,43.1617]],[[5.3815,43.1901],[5.381,43.1897],[5.3809,43.1893],[5.3811,43.1887],[5.3827,43.1882],[5.3889,43.1849],[5.3902,43.1862],[5.3876,43.187],[5.3866,43.1879],[5.3844,43.1879],[5.3845,43.1892],[5.3815,43.1901]],[[5.3587,43.1991],[5.3609,43.1979],[5.3609,43.1968],[5.3623,43.1963],[5.3646,43.196],[5.3662,43.1947],[5.3673,43.1947],[5.3692,43.1933],[5.3702,43.1934],[5.3686,43.1951],[5.3618,43.1993],[5.3587,43.1991]],[[5.3721,43.1777],[5.3748,43.1765],[5.3811,43.1744],[5.3858,43.1722],[5.3947,43.1727],[5.397,43.1747],[5.3893,43.1772],[5.3849,43.1783],[5.3809,43.1801],[5.3749,43.1792],[5.3713,43.1788],[5.3721,43.1777]]]]},
    {"id":"shom/FR000017261400001","name":"Sainte-Marie","info":null,"anchoringProhibited":false,"crossesCableZone":true,"source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.3483,43.3242],[5.361,43.3088],[5.3574,43.299],[5.3529,43.2971],[5.3325,43.3209],[5.3436,43.3254],[5.3436,43.3248],[5.3446,43.3235],[5.3453,43.3232],[5.347,43.3233],[5.3478,43.3237],[5.3483,43.3242]]]]},
    {"id":"shom/FR000016606400003","name":null,"info":null,"anchoringProhibited":false,"crossesCableZone":false,"source":"Shom","licence":"Licence ouverte 2.0","polygons":[[[[5.175,43.33],[5.1767,43.33],[5.1767,43.3283],[5.175,43.3283],[5.175,43.33]]]]}
  ]
};

/** Relevé du relais de 16 h 47 : AIS à jour, deux navires lents loin des tracés ou amarrés, aucune alerte. */
const CABLES_WATCH: CablesWatchResponse = {"readAt":"2026-10-04T14:47:00.000Z","aisLastMessageAt":"2026-10-04T14:46:58.000Z","evaluated":true,"cablesFile":{"generatedAt":"2026-10-04T14:48:00.000Z","osmBase":"2026-10-04T14:47:16Z","cables":53,"landings":67},"slowVessels":2,"alerts":[],"errors":[]};

/** Relevés de 16 h 41 et 16 h 47 : cargo au mouillage à 304 m d'AMITIE revu 6 min plus tard (confirmé), bâtiment étranger à 117 m vu une fois. */
const CABLES_WATCH_ALERTS: CablesWatchResponse = {
  "readAt": "2026-10-04T14:47:00.000Z",
  "aisLastMessageAt": "2026-10-04T14:46:58.000Z",
  "evaluated": true,
  "cablesFile": {"generatedAt":"2026-10-04T14:48:00.000Z","osmBase":"2026-10-04T14:47:16Z","cables":53,"landings":67},
  "slowVessels": 4,
  "alerts": [
    {"id":"229000001:way/761201757","mmsi":"229000001","name":"CARGO ESSAI","vesselType":"Cargo","cableId":"way/761201757","cableName":"AMITIE","lat":42.85,"lon":4.8558,"distanceM":304,"speedKn":1,"navStatus":1,"firstSeen":"2026-10-04T14:40:50.000Z","lastSeen":"2026-10-04T14:46:50.000Z","confirmed":true,"zoneMuted":false},
    {"id":"235000004:way/761201757","mmsi":"235000004","name":"WARSHIP TEST","vesselType":"Militaire","cableId":"way/761201757","cableName":"AMITIE","lat":42.85,"lon":4.8535,"distanceM":117,"speedKn":0.4,"navStatus":0,"firstSeen":"2026-10-04T14:46:55.000Z","lastSeen":"2026-10-04T14:46:55.000Z","confirmed":false,"zoneMuted":false}
  ],
  "errors": []
};

/** Relevé de 16 h 47 : AIS muet depuis 16 h 41 (6 min), l'alerte confirmée à 16 h 41 est gardée telle quelle, non évaluée, aucun compte de navires. */
const CABLES_WATCH_FROZEN: CablesWatchResponse = {
  "readAt": "2026-10-04T14:47:00.000Z",
  "aisLastMessageAt": "2026-10-04T14:41:00.000Z",
  "evaluated": false,
  "cablesFile": {"generatedAt":"2026-10-04T14:48:00.000Z","osmBase":"2026-10-04T14:47:16Z","cables":53,"landings":67},
  "slowVessels": null,
  "alerts": [
    {"id":"229000001:way/761201757","mmsi":"229000001","name":"CARGO ESSAI","vesselType":"Cargo","cableId":"way/761201757","cableName":"AMITIE","lat":42.85,"lon":4.8558,"distanceM":304,"speedKn":1,"navStatus":1,"firstSeen":"2026-10-04T14:34:50.000Z","lastSeen":"2026-10-04T14:40:50.000Z","confirmed":true,"zoneMuted":false}
  ],
  "errors": ["flux AIS interrompu : lot 1 sur 3 muet depuis 6 min (Manche, Atlantique, golfe du Lion, Corse, Dunkerque-Calais)"]
};

/**
 * Relevé de 16 h 47 : lot amont du golfe du Lion muet, les autres parlent ; le cargo vu une fois à 16 h 41 près d'AMITIE n'est plus dans
 * le relevé, son alerte est gardée « non évaluée (flux de la zone muet) ».
 */
const CABLES_WATCH_ZONE_MUTED: CablesWatchResponse = {
  "readAt": "2026-10-04T14:47:00.000Z",
  "aisLastMessageAt": "2026-10-04T14:46:58.000Z",
  "evaluated": true,
  "cablesFile": {"generatedAt":"2026-10-04T14:48:00.000Z","osmBase":"2026-10-04T14:47:16Z","cables":53,"landings":67},
  "slowVessels": 0,
  "alerts": [
    {"id":"229000001:way/761201757","mmsi":"229000001","name":"CARGO ESSAI","vesselType":"Cargo","cableId":"way/761201757","cableName":"AMITIE","lat":42.85,"lon":4.8558,"distanceM":304,"speedKn":1,"navStatus":1,"firstSeen":"2026-10-04T14:40:50.000Z","lastSeen":"2026-10-04T14:40:50.000Z","confirmed":false,"zoneMuted":true}
  ],
  "errors": ["flux AIS partiel : lot 1 sur 3 muet depuis 6 min (Manche, Atlantique, golfe du Lion, Corse, Dunkerque-Calais)"]
};

/**
 * Vigilance cyber de 16 h 48, après trois cycles CERT-FR : alertes ALE-006 à ALE-011 avec leur statut officiel (ALE-011, 010 et 009
 * en cours ; ALE-008 close le 22/09 ; ALE-011 : exploitation signalée, dernière version le 30/09, CVE-2026-88771 et 88772 au catalogue
 * KEV ; ALE-009 et ALE-010 : exploitation signalée, phrases des pages lues le 04/10 citées telles quelles), 38 avis de moins de
 * 30 jours (AVI-1257 : CVE-2026-104286), 40 rapports Menaces et incidents, 38 vulnérabilités KEV de 30 jours dont 7 citées,
 * 7 revendications cette semaine (rapport 1,29), aucune fuite .fr récente, 21 entrées Cybermalveillance.
 */
const CYBER: CyberResponse = {
  "readAt": "2026-10-04T14:48:30.000Z",
  "certfr": {
    "readAt": "2026-10-04T14:48:30.000Z",
    "alerts": [
      {"ref":"CERTFR-2026-ALE-011","kind":"alerte","title":"Multiples vulnérabilités dans Citrix NetScaler ADC et Gateway","product":"Citrix NetScaler ADC et Gateway","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-011/","firstVersion":"2026-09-28","lastVersion":"2026-09-30","cves":["CVE-2026-88771","CVE-2026-88772"],"kevCves":["CVE-2026-88771","CVE-2026-88772"],"pageReadAt":"2026-10-04T12:48:30.000Z","status":"en-cours","closedAt":null,"exploited":true,"exploitedQuote":"Ces vulnérabilités sont activement exploitées et les exploitations ont commencé avant la disponibilité des correctifs."},
      {"ref":"CERTFR-2026-ALE-008","kind":"alerte","title":"Multiples vulnérabilités dans Microsoft Sharepoint","product":"Microsoft Sharepoint","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-008/","firstVersion":"2026-07-22","lastVersion":"2026-09-22","cves":["CVE-2026-50522","CVE-2026-58644"],"kevCves":["CVE-2026-50522","CVE-2026-58644"],"pageReadAt":"2026-10-04T12:48:30.000Z","status":"cloturee","closedAt":"2026-09-22","exploited":true,"exploitedQuote":"Dans son avis du 14 juillet 2026, Microsoft a indiqué que la vulnérabilité CVE-2026-58644 est activement exploitée."},
      {"ref":"CERTFR-2026-ALE-010","kind":"alerte","title":"Vulnérabilité dans Metabase","product":"Metabase","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-010/","firstVersion":"2026-09-10","lastVersion":"2026-09-10","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":"en-cours","closedAt":null,"exploited":true,"exploitedQuote":"Le CERT-FR a connaissance de nombreuses compromissions de Metabase vulnérables."},
      {"ref":"CERTFR-2026-ALE-009","kind":"alerte","title":"Multiples vulnérabilités dans SonicWall Secure Mobile Access","product":"SonicWall Secure Mobile Access","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-009/","firstVersion":"2026-09-02","lastVersion":"2026-09-02","cves":["CVE-2026-83548"],"kevCves":["CVE-2026-83548"],"pageReadAt":"2026-10-04T12:48:30.000Z","status":"en-cours","closedAt":null,"exploited":true,"exploitedQuote":"L'éditeur indique que ces deux vulnérabilités sont activement exploitées, sans préciser s'il est possible pour un attaquant non authentifié de chaîner l'exploitation de ces deux vulnérabilités pour prendre la main sur l'équipement."},
      {"ref":"CERTFR-2026-ALE-007","kind":"alerte","title":"Multiples vulnérabilités dans WordPress","product":"WordPress","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-007/","firstVersion":"2026-07-20","lastVersion":"2026-07-20","cves":["CVE-2026-60137","CVE-2026-63030"],"kevCves":["CVE-2026-60137","CVE-2026-63030"],"pageReadAt":"2026-10-04T12:48:30.000Z","status":"cloturee","closedAt":"2026-08-24","exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-ALE-006","kind":"alerte","title":"Multiples vulnérabilités dans Sonicwall Secure Mobile Access","product":"Sonicwall Secure Mobile Access","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-006/","firstVersion":"2026-07-15","lastVersion":"2026-07-15","cves":["CVE-2026-15409"],"kevCves":["CVE-2026-15409"],"pageReadAt":"2026-10-04T12:48:30.000Z","status":"cloturee","closedAt":"2026-08-24","exploited":false,"exploitedQuote":null}
    ],
    "avis": [
      {"ref":"CERTFR-2026-AVI-1257","kind":"avis","title":"Vulnérabilité dans Fortinet FortiMail","product":"Fortinet FortiMail","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1257/","firstVersion":"2026-10-02","lastVersion":"2026-10-02","cves":["CVE-2026-104286"],"kevCves":["CVE-2026-104286"],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1256","kind":"avis","title":"Multiples vulnérabilités dans les produits IBM","product":"les produits IBM","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1256/","firstVersion":"2026-10-02","lastVersion":"2026-10-02","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1255","kind":"avis","title":"Multiples vulnérabilités dans le noyau Linux de SUSE","product":"le noyau Linux de SUSE","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1255/","firstVersion":"2026-10-02","lastVersion":"2026-10-02","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1254","kind":"avis","title":"Multiples vulnérabilités dans le noyau Linux de Red Hat","product":"le noyau Linux de Red Hat","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1254/","firstVersion":"2026-10-02","lastVersion":"2026-10-02","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1253","kind":"avis","title":"Multiples vulnérabilités dans le noyau Linux de Debian","product":"le noyau Linux de Debian","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1253/","firstVersion":"2026-10-02","lastVersion":"2026-10-02","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1252","kind":"avis","title":"Multiples vulnérabilités dans le noyau Linux d'Ubuntu","product":"le noyau Linux d'Ubuntu","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1252/","firstVersion":"2026-10-02","lastVersion":"2026-10-02","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1251","kind":"avis","title":"Multiples vulnérabilités dans Microsoft Edge","product":"Microsoft Edge","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1251/","firstVersion":"2026-10-02","lastVersion":"2026-10-02","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1250","kind":"avis","title":"Multiples vulnérabilités dans les produits Moxa","product":"les produits Moxa","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1250/","firstVersion":"2026-10-02","lastVersion":"2026-10-02","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1249","kind":"avis","title":"Multiples vulnérabilités dans les produits VMware","product":"les produits VMware","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1249/","firstVersion":"2026-10-02","lastVersion":"2026-10-02","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1248","kind":"avis","title":"Multiples vulnérabilités dans Apache HTTP Server","product":"Apache HTTP Server","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1248/","firstVersion":"2026-10-02","lastVersion":"2026-10-02","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1247","kind":"avis","title":"Multiples vulnérabilités dans Tenable Nessus","product":"Tenable Nessus","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1247/","firstVersion":"2026-10-02","lastVersion":"2026-10-02","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1246","kind":"avis","title":"Vulnérabilité dans Cisco Catalyst SD-WAN","product":"Cisco Catalyst SD-WAN","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1246/","firstVersion":"2026-10-01","lastVersion":"2026-10-01","cves":["CVE-2026-76504"],"kevCves":["CVE-2026-76504"],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1245","kind":"avis","title":"Multiples vulnérabilités dans Redmine","product":"Redmine","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1245/","firstVersion":"2026-10-01","lastVersion":"2026-10-01","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1244","kind":"avis","title":"Multiples vulnérabilités dans Mozilla Thunderbird","product":"Mozilla Thunderbird","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1244/","firstVersion":"2026-10-01","lastVersion":"2026-10-01","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T12:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1243","kind":"avis","title":"Multiples vulnérabilités dans CPython","product":"CPython","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1243/","firstVersion":"2026-10-01","lastVersion":"2026-10-01","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1242","kind":"avis","title":"Multiples vulnérabilités dans GitLab","product":"GitLab","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1242/","firstVersion":"2026-09-30","lastVersion":"2026-09-30","cves":["CVE-2026-85706"],"kevCves":["CVE-2026-85706"],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1241","kind":"avis","title":"Multiples vulnérabilités dans OpenSSL","product":"OpenSSL","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1241/","firstVersion":"2026-09-30","lastVersion":"2026-09-30","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1240","kind":"avis","title":"Multiples vulnérabilités dans les produits Mozilla","product":"les produits Mozilla","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1240/","firstVersion":"2026-09-30","lastVersion":"2026-09-30","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1239","kind":"avis","title":"Vulnérabilité dans CPython","product":"CPython","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1239/","firstVersion":"2026-09-30","lastVersion":"2026-09-30","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1238","kind":"avis","title":"Multiples vulnérabilités dans HPE Aruba Networking Instant On","product":"HPE Aruba Networking Instant On","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1238/","firstVersion":"2026-09-30","lastVersion":"2026-09-30","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1237","kind":"avis","title":"Multiples vulnérabilités dans Google Chrome","product":"Google Chrome","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1237/","firstVersion":"2026-09-30","lastVersion":"2026-09-30","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1236","kind":"avis","title":"Vulnérabilité dans les produits Apple","product":"les produits Apple","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1236/","firstVersion":"2026-09-29","lastVersion":"2026-09-29","cves":["CVE-2026-86950"],"kevCves":["CVE-2026-86950"],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1235","kind":"avis","title":"Multiples vulnérabilités dans Citrix NetScaler ADC et Gateway","product":"Citrix NetScaler ADC et Gateway","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1235/","firstVersion":"2026-09-28","lastVersion":"2026-09-28","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1234","kind":"avis","title":"Multiples vulnérabilités dans MongoDB","product":"MongoDB","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1234/","firstVersion":"2026-09-28","lastVersion":"2026-09-28","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1233","kind":"avis","title":"Multiples vulnérabilités dans les produits IBM","product":"les produits IBM","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1233/","firstVersion":"2026-09-25","lastVersion":"2026-09-25","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1232","kind":"avis","title":"Multiples vulnérabilités dans le noyau Linux de Debian LTS","product":"le noyau Linux de Debian LTS","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1232/","firstVersion":"2026-09-25","lastVersion":"2026-09-25","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1231","kind":"avis","title":"Multiples vulnérabilités dans le noyau Linux de SUSE","product":"le noyau Linux de SUSE","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1231/","firstVersion":"2026-09-25","lastVersion":"2026-09-25","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1230","kind":"avis","title":"Multiples vulnérabilités dans le noyau Linux de Red Hat","product":"le noyau Linux de Red Hat","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1230/","firstVersion":"2026-09-25","lastVersion":"2026-09-25","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1229","kind":"avis","title":"Multiples vulnérabilités dans le noyau Linux d'Ubuntu","product":"le noyau Linux d'Ubuntu","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1229/","firstVersion":"2026-09-25","lastVersion":"2026-09-25","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1228","kind":"avis","title":"Multiples vulnérabilités dans les produits Elastic","product":"les produits Elastic","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1228/","firstVersion":"2026-09-25","lastVersion":"2026-09-25","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1227","kind":"avis","title":"Multiples vulnérabilités dans PHP","product":"PHP","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1227/","firstVersion":"2026-09-24","lastVersion":"2026-09-24","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1226","kind":"avis","title":"Multiples vulnérabilités dans Zabbix Agent","product":"Zabbix Agent","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1226/","firstVersion":"2026-09-24","lastVersion":"2026-09-24","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1225","kind":"avis","title":"Multiples vulnérabilités dans GitLab","product":"GitLab","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1225/","firstVersion":"2026-09-24","lastVersion":"2026-09-24","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1224","kind":"avis","title":"Vulnérabilité dans Microsoft Office","product":"Microsoft Office","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1224/","firstVersion":"2026-09-24","lastVersion":"2026-09-24","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T13:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1223","kind":"avis","title":"Multiples vulnérabilités dans Papercut","product":"Papercut","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1223/","firstVersion":"2026-09-24","lastVersion":"2026-09-24","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T14:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1222","kind":"avis","title":"Multiples vulnérabilités dans LibreNMS","product":"LibreNMS","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1222/","firstVersion":"2026-09-24","lastVersion":"2026-09-24","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T14:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1221","kind":"avis","title":"Multiples vulnérabilités dans Wireshark","product":"Wireshark","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1221/","firstVersion":"2026-09-24","lastVersion":"2026-09-24","cves":[],"kevCves":[],"pageReadAt":"2026-10-04T14:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null},
      {"ref":"CERTFR-2026-AVI-1220","kind":"avis","title":"Vulnérabilité dans F5 BIG-IP","product":"F5 BIG-IP","updatedMark":false,"url":"https://www.cert.ssi.gouv.fr/avis/CERTFR-2026-AVI-1220/","firstVersion":"2026-09-23","lastVersion":"2026-09-23","cves":["CVE-2026-94127"],"kevCves":["CVE-2026-94127"],"pageReadAt":"2026-10-04T14:48:30.000Z","status":null,"closedAt":null,"exploited":false,"exploitedQuote":null}
    ],
    "reports": [
      {"ref":"CERTFR-2026-CTI-007","title":"Vulnérabilités de produits du secteur santé : Retour d'expérience du CERT Santé et du CERT-FR","lang":"fr","date":"2026-10-02","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-007/"},
      {"ref":"CERTFR-2026-CTI-006","title":"Point de situation de l’opération REACTIV – septembre 2026","lang":"fr","date":"2026-09-30","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-006/"},
      {"ref":"CERTFR-2026-CTI-005","title":"Targeting and Compromise of French Entities Using the Turla Intrusion Set","lang":"fr","date":"2026-07-13","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-005/"},
      {"ref":"CERTFR-2026-CTI-004","title":"Ciblage et compromission d’entités françaises au moyen du mode opératoire d’attaque Turla","lang":"fr","date":"2026-07-13","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-004/"},
      {"ref":"CERTFR-2026-CTI-003","title":"Cyber Threat Overview 2025","lang":"en","date":"2026-05-13","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-003/"},
      {"ref":"CERTFR-2026-CTI-002","title":"Panorama de la cybermenace 2025","lang":"fr","date":"2026-03-11","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-002/"},
      {"ref":"CERTFR-2026-CTI-001","title":"L’intelligence artificielle générative face aux attaques informatiques","lang":"fr","date":"2026-02-04","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2026-CTI-001/"},
      {"ref":"CERTFR-2025-CTI-013","title":"Mobile phones : Threat landscape since 2015","lang":"en","date":"2025-11-26","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-013/"},
      {"ref":"CERTFR-2025-CTI-012","title":"Téléphones mobiles : État de la menace depuis 2015","lang":"fr","date":"2025-11-26","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-012/"},
      {"ref":"CERTFR-2025-CTI-011","title":"Opération ENDGAME de novembre 2025","lang":"fr","date":"2025-11-13","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-011/"},
      {"ref":"CERTFR-2025-CTI-010","title":"Campagne de notifications de menace envoyée par Apple","lang":"fr","date":"2025-09-11","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-010/"},
      {"ref":"CERTFR-2025-CTI-009","title":"Houken seeking a path by living on the edge with zero-days","lang":"en","date":"2025-07-01","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-009/"},
      {"ref":"CERTFR-2025-CTI-008","title":"Opération ENDGAME 2025","lang":"fr","date":"2025-05-23","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-008/"},
      {"ref":"CERTFR-2025-CTI-007","title":"Targeting and compromise of french entities using the APT28 intrusion set","lang":"en","date":"2025-04-29","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-007/"},
      {"ref":"CERTFR-2025-CTI-006","title":"Ciblage et compromission d'entités françaises au moyen du mode opératoire d'attaque APT28","lang":"fr","date":"2025-04-29","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-006/"},
      {"ref":"CERTFR-2025-CTI-005","title":"Transports urbains - État de la menace informatique","lang":"fr","date":"2025-04-17","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-005/"},
      {"ref":"CERTFR-2025-CTI-004","title":"Cyber Threat Overview 2024","lang":"en","date":"2025-03-11","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-004/"},
      {"ref":"CERTFR-2025-CTI-003","title":"Panorama de la cybermenace 2024","lang":"fr","date":"2025-03-11","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-003/"},
      {"ref":"CERTFR-2025-CTI-002","title":"Collectivités territoriales - Synthèse de la menace","lang":"fr","date":"2025-02-24","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-002/"},
      {"ref":"CERTFR-2025-CTI-001","title":"Secteur du cloud - État de la menace informatique","lang":"fr","date":"2025-02-20","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2025-CTI-001/"},
      {"ref":"CERTFR-2024-CTI-011","title":"Secteur de l'eau : état de la menace informatique","lang":"fr","date":"2024-11-28","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2024-CTI-011/"},
      {"ref":"CERTFR-2024-CTI-010","title":"Secteur de la santé - État de la menace informatique","lang":"fr","date":"2024-11-07","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2024-CTI-010/"},
      {"ref":"CERTFR-2024-CTI-009","title":"Exfiltration de données du secteur social - Retour d’expérience du CERT-FR","lang":"fr","date":"2024-09-24","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2024-CTI-009/"},
      {"ref":"CERTFR-2024-CTI-008","title":"Organismes de recherche et think tanks - État de la menace informatique","lang":"fr","date":"2024-09-02","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2024-CTI-008/"},
      {"ref":"CERTFR-2024-CTI-007","title":"Codes malveillants utilisés à des fins destructrices","lang":"fr","date":"2024-07-11","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2024-CTI-007/"},
      {"ref":"CERTFR-2024-CTI-006","title":"Malicious activities linked to the Nobelium intrusion set","lang":"en","date":"2024-06-19","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2024-CTI-006/"},
      {"ref":"CERTFR-2024-CTI-005","title":"Failles sur les équipements de sécurité - Retour d'expérience du CERT-FR","lang":"fr","date":"2024-06-12","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2024-CTI-005/"},
      {"ref":"CERTFR-2024-CTI-004","title":"Opération ENDGAME","lang":"fr","date":"2024-05-30","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2024-CTI-004/"},
      {"ref":"CERTFR-2024-CTI-003","title":"Grands évènements sportifs en France – Évaluation de la menace 2024","lang":"fr","date":"2024-04-17","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2024-CTI-003/"},
      {"ref":"CERTFR-2024-CTI-002","title":"Cyber Threat Overview 2023","lang":"en","date":"2024-02-27","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2024-CTI-002/"},
      {"ref":"CERTFR-2024-CTI-001","title":"Panorama de la cybermenace 2023","lang":"fr","date":"2024-02-27","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2024-CTI-001/"},
      {"ref":"CERTFR-2023-CTI-010","title":"État de la menace ciblant le secteur des télécommunications","lang":"fr","date":"2023-12-18","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2023-CTI-010/"},
      {"ref":"CERTFR-2023-CTI-009","title":"Campagnes d'attaques du mode opératoire APT28 depuis 2021","lang":"fr","date":"2023-10-26","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2023-CTI-009/"},
      {"ref":"CERTFR-2023-CTI-008","title":"Synthèse de la menace ciblant les collectivités territoriales","lang":"fr","date":"2023-10-23","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2023-CTI-008/"},
      {"ref":"CERTFR-2023-CTI-007","title":"FIN 12 : Un groupe cybercriminel aux multiples rançongiciels","lang":"fr","date":"2023-09-18","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2023-CTI-007/"},
      {"ref":"CERTFR-2023-CTI-006","title":"Démantèlement du botnet Qakbot","lang":"fr","date":"2023-09-15","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2023-CTI-006/"},
      {"ref":"CERTFR-2023-CTI-005","title":"Grands évènements sportifs - Évaluation de la menace 2023","lang":"fr","date":"2023-08-30","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2023-CTI-005/"},
      {"ref":"CERTFR-2023-CTI-004","title":"État de la menace informatique contre les cabinets d'avocats","lang":"fr","date":"2023-06-27","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2023-CTI-004/"},
      {"ref":"CERTFR-2023-CTI-003","title":"Le Ransomware-as-a-Service LockBit","lang":"fr","date":"2023-06-14","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2023-CTI-003/"},
      {"ref":"CERTFR-2023-CTI-002","title":"Cyber Threat Overview 2022","lang":"en","date":"2023-02-10","url":"https://www.cert.ssi.gouv.fr/cti/CERTFR-2023-CTI-002/"}
    ]
  },
  "kev": {
    "readAt": "2026-10-04T14:48:30.000Z",
    "catalogVersion": "2026.10.02",
    "dateReleased": "2026-10-02T15:19:38.2945Z",
    "count": 1733,
    "recent": [
      {"cve":"CVE-2026-104286","vendor":"Fortinet","product":"FortiMail","name":"Fortinet FortiMail Path Traversal Vulnerability","dateAdded":"2026-10-01","dueDate":"2026-10-04","ransomware":false,"certfrRefs":["CERTFR-2026-AVI-1257"]},
      {"cve":"CVE-2026-76504","vendor":"Cisco","product":"Catalyst SD-WAN Manager","name":"Cisco Catalyst SD-WAN Manager Hex Encoding Vulnerability","dateAdded":"2026-09-30","dueDate":"2026-10-03","ransomware":false,"certfrRefs":["CERTFR-2026-AVI-1246"]},
      {"cve":"CVE-2026-86950","vendor":"Apple","product":"Multiple Products","name":"Apple Multiple Products Out-of-Bounds Write Vulnerability","dateAdded":"2026-09-29","dueDate":"2026-10-02","ransomware":false,"certfrRefs":["CERTFR-2026-AVI-1236"]},
      {"cve":"CVE-2026-88771","vendor":"Citrix","product":"NetScaler","name":"Citrix NetScaler Improper Input Validation Vulnerability","dateAdded":"2026-09-27","dueDate":"2026-09-30","ransomware":false,"certfrRefs":["CERTFR-2026-ALE-011"]},
      {"cve":"CVE-2026-88772","vendor":"Citrix","product":"NetScaler","name":"Citrix NetScaler Improper Restriction of Operations within the Bounds of a Memory Buffer Vulnerability","dateAdded":"2026-09-27","dueDate":"2026-09-30","ransomware":false,"certfrRefs":["CERTFR-2026-ALE-011"]},
      {"cve":"CVE-2026-94127","vendor":"F5","product":"BIG-IP APM","name":"F5 BIG-IP APM Heap-based Buffer Overflow Vulnerability","dateAdded":"2026-09-22","dueDate":"2026-09-25","ransomware":false,"certfrRefs":["CERTFR-2026-AVI-1220"]},
      {"cve":"CVE-2026-85706","vendor":"GitLab","product":"Community Edition and Enterprise Edition","name":"GitLab Community Edition and Enterprise Edition Path Traversal Vulnerability","dateAdded":"2026-09-11","dueDate":"2026-09-14","ransomware":false,"certfrRefs":["CERTFR-2026-AVI-1242"]},
      {"cve":"CVE-2026-102489","vendor":"Zammad GmbH","product":"Zammad","name":"Zammad GmbH Zammad Session Fixation Vulnerability","dateAdded":"2026-10-02","dueDate":"2026-10-05","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-102490","vendor":"Zammad GmbH","product":"Zammad","name":"Zammad GmbH Zammad Improper Privilege Management Vulnerability","dateAdded":"2026-10-02","dueDate":"2026-10-05","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-65660","vendor":"Microsoft","product":"SharePoint","name":"Microsoft SharePoint Code Injection Vulnerability","dateAdded":"2026-09-25","dueDate":"2026-09-28","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-67279","vendor":"MikroTik","product":"RouterOS","name":"Mikrotik RouterOS Improper Enforcement of Behavioral Workflow Vulnerability","dateAdded":"2026-09-25","dueDate":"2026-09-28","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-87902","vendor":"WordPress","product":"Core","name":"WordPress Core Remote File Inclusion Vulnerability","dateAdded":"2026-09-25","dueDate":"2026-09-28","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-5430","vendor":"WSO2","product":"Multiple Products","name":"WSO2 Multiple Products Path Traversal Vulnerability","dateAdded":"2026-09-24","dueDate":"2026-09-27","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-71362","vendor":"Adobe","product":"Commerce and Magento","name":"Adobe Commerce and Magento Incorrect Authorization Vulnerability","dateAdded":"2026-09-24","dueDate":"2026-09-27","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-85102","vendor":"Check Point","product":"Multiple Products","name":"Check Point Multiple Products Improper Certificate Validation Vulnerability","dateAdded":"2026-09-22","dueDate":"2026-09-25","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-93616","vendor":"Check Point","product":"Multiple Products","name":"Check Point Multiple Products Path Traversal Vulnerability","dateAdded":"2026-09-22","dueDate":"2026-09-25","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-93952","vendor":"Arista","product":"VeloCloud Orchestrator","name":"Arista VeloCloud Orchestrator Improper Input Validation Vulnerability","dateAdded":"2026-09-22","dueDate":"2026-09-25","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-7273","vendor":"Zyxel","product":"GS1900 Series Switches","name":"Zyxel GS1900 Series Switches Stack-Based Buffer Overflow Vulnerability","dateAdded":"2026-09-21","dueDate":"2026-09-24","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2025-39682","vendor":"Linux","product":"Kernel","name":"Linux Kernel Improper Check for Unusual or Exceptional Conditions Vulnerability","dateAdded":"2026-09-18","dueDate":"2026-09-21","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2025-39964","vendor":"Linux","product":"Kernel","name":"Linux Kernel Race Condition Vulnerability","dateAdded":"2026-09-18","dueDate":"2026-09-21","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-53266","vendor":"Linux","product":"Kernel","name":"Linux Kernel Out-of-Bounds Write Vulnerability","dateAdded":"2026-09-18","dueDate":"2026-09-21","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-58704","vendor":"Google","product":"Pixel","name":"Google Pixel Improper Authorization Vulnerability","dateAdded":"2026-09-16","dueDate":"2026-09-19","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-76460","vendor":"Cisco","product":"Identity Services Engine","name":"Cisco Identity Services Engine Incorrect Use of Privileged APIs Vulnerability","dateAdded":"2026-09-16","dueDate":"2026-09-19","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-87886","vendor":"Acronis","product":"Backup","name":"Acronis Backup Incorrect Default Permissions Vulnerability","dateAdded":"2026-09-16","dueDate":"2026-09-19","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-76461","vendor":"Cisco","product":"Secure Email Gateway","name":"Cisco Secure Email Gateway SQL Injection Vulnerability","dateAdded":"2026-09-14","dueDate":"2026-09-17","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-42016","vendor":"JFrog","product":"Artifactory","name":"JFrog Artifactory Incorrect Authorization Vulnerability","dateAdded":"2026-09-11","dueDate":"2026-09-25","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-42018","vendor":"JFrog","product":"Artifactory","name":"JFrog Artifactory Improper Authentication Vulnerability","dateAdded":"2026-09-11","dueDate":"2026-09-25","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-84869","vendor":"ConnectWise","product":"ScreenConnect","name":"ConnectWise ScreenConnect Improper Privilege Management and Missing Authorization Vulnerability","dateAdded":"2026-09-11","dueDate":"2026-09-14","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-67277","vendor":"MikroTik","product":"RouterOS","name":"MikroTik RouterOS Missing Authentication for Critical Function Vulnerability","dateAdded":"2026-09-10","dueDate":"2026-09-13","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-86060","vendor":"MikroTik","product":"RouterOS","name":"MikroTik RouterOS Improper Neutralization of Argument Delimiters in a Command Vulnerability","dateAdded":"2026-09-10","dueDate":"2026-09-13","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2025-25249","vendor":"Fortinet","product":"Multiple Products","name":"Fortinet Multiple Products Heap-based Buffer Overflow Vulnerability","dateAdded":"2026-09-09","dueDate":"2026-09-12","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-19490","vendor":"Citrix","product":"NetScaler","name":"Citrix NetScaler Authentication Bypass Using an Alternate Path or Channel Vulnerability","dateAdded":"2026-09-09","dueDate":"2026-09-12","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-20079","vendor":"Cisco","product":"Secure Firewall Management Center (FMC) and Security Cloud Control (SCC) Firewall Management","name":"Cisco Firewall Management Center Authentication Bypass Using an Alternate Path or Channel Vulnerability","dateAdded":"2026-09-09","dueDate":"2026-09-12","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-87491","vendor":"Google","product":"Chromium V8","name":"Google Chromium V8 Out of Bounds Write Vulnerability","dateAdded":"2026-09-09","dueDate":"2026-09-23","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-75650","vendor":"Adobe","product":"Commerce and Magento","name":"Adobe Commerce and Magento Improper Neutralization of Special Elements Used in a Template Engine Vulnerability","dateAdded":"2026-09-08","dueDate":"2026-09-11","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-81963","vendor":"Microsoft","product":"Windows","name":"Microsoft Windows Link Following Vulnerability","dateAdded":"2026-09-08","dueDate":"2026-09-22","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-85880","vendor":"Microsoft","product":"Windows","name":"Microsoft Windows Heap-Based Buffer Overflow Vulnerability","dateAdded":"2026-09-08","dueDate":"2026-09-22","ransomware":false,"certfrRefs":[]},
      {"cve":"CVE-2026-86218","vendor":"N-able","product":"N-central","name":"N-able N-central Static Code Injection Vulnerability","dateAdded":"2026-09-08","dueDate":"2026-09-11","ransomware":false,"certfrRefs":[]}
    ],
    "weeks": [
      {"weekStart":"2026-07-12T14:48:30.000Z","added":10,"cited":2},
      {"weekStart":"2026-07-19T14:48:30.000Z","added":6,"cited":3},
      {"weekStart":"2026-07-26T14:48:30.000Z","added":3,"cited":0},
      {"weekStart":"2026-08-02T14:48:30.000Z","added":6,"cited":0},
      {"weekStart":"2026-08-09T14:48:30.000Z","added":3,"cited":0},
      {"weekStart":"2026-08-16T14:48:30.000Z","added":9,"cited":0},
      {"weekStart":"2026-08-23T14:48:30.000Z","added":11,"cited":0},
      {"weekStart":"2026-08-30T14:48:30.000Z","added":10,"cited":1},
      {"weekStart":"2026-09-06T14:48:30.000Z","added":14,"cited":1},
      {"weekStart":"2026-09-13T14:48:30.000Z","added":7,"cited":0},
      {"weekStart":"2026-09-20T14:48:30.000Z","added":12,"cited":3},
      {"weekStart":"2026-09-27T14:48:30.000Z","added":5,"cited":3}
    ]
  },
  "ransomware": {
    "lastModified": "2026-10-04T14:30:09.000Z",
    "checkedAt": "2026-10-04T14:48:30.000Z",
    "weeks": [
      {"weekStart":"2026-07-12T14:48:30.000Z","count":5},
      {"weekStart":"2026-07-19T14:48:30.000Z","count":4},
      {"weekStart":"2026-07-26T14:48:30.000Z","count":6},
      {"weekStart":"2026-08-02T14:48:30.000Z","count":10},
      {"weekStart":"2026-08-09T14:48:30.000Z","count":2},
      {"weekStart":"2026-08-16T14:48:30.000Z","count":9},
      {"weekStart":"2026-08-23T14:48:30.000Z","count":1},
      {"weekStart":"2026-08-30T14:48:30.000Z","count":2},
      {"weekStart":"2026-09-06T14:48:30.000Z","count":4},
      {"weekStart":"2026-09-13T14:48:30.000Z","count":7},
      {"weekStart":"2026-09-20T14:48:30.000Z","count":6},
      {"weekStart":"2026-09-27T14:48:30.000Z","count":7}
    ],
    "weekCount": 7,
    "baselineWeekly": 5.44,
    "ratio": 1.29,
    "last30": 25,
    "baseline30": 20.67,
    "sectors30": [
      {"label":"Other","count":5},
      {"label":"Agriculture and Food Production","count":3},
      {"label":"Healthcare","count":3},
      {"label":"Manufacturing","count":3},
      {"label":"Professional Services","count":3},
      {"label":"Technology","count":3},
      {"label":"Financial Services","count":2},
      {"label":"Not Found","count":2},
      {"label":"Energy & Utilities","count":1}
    ],
    "groups30": [
      {"label":"ZaWoo","count":6},
      {"label":"krybit","count":4},
      {"label":"qilin","count":4},
      {"label":"Panzer","count":3},
      {"label":"thegentlemen","count":2},
      {"label":"dragonforce","count":1},
      {"label":"Eclipse","count":1},
      {"label":"kairos","count":1},
      {"label":"lamashtu","count":1},
      {"label":"medusalocker","count":1},
      {"label":"rhysida","count":1}
    ]
  },
  "hibp": {
    "readAt": "2026-10-04T14:48:30.000Z",
    "count": 0,
    "newestAddedDate": null,
    "url": "https://haveibeenpwned.com/PwnedWebsites"
  },
  "cybermalveillance": {
    "readAt": "2026-10-04T14:48:30.000Z",
    "entries": [
      {"feed":"alertes","title":"Cybermois 2026","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/alertes/le-cybermois-arrive-preparez-vous","published":"2026-09-15T08:54:02.000Z","updated":"2026-09-30T20:39:53.000Z"},
      {"feed":"actualites","title":"Lettres d’information","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/lettres-d-information","published":"2026-10-01T14:11:46.000Z","updated":"2026-10-01T14:11:47.000Z"},
      {"feed":"actualites","title":"Cybermois 2026 : « Se Cyber Protéger, ce n’est pas si bête »","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/cybermois-2026-campagne","published":"2026-09-29T21:10:55.000Z","updated":"2026-10-01T12:26:14.000Z"},
      {"feed":"actualites","title":"CyberTour de France 2026 : le cybermois au plus près des territoires","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/cybertour-france-2026","published":"2026-09-15T08:52:39.000Z","updated":"2026-09-29T13:39:37.000Z"},
      {"feed":"actualites","title":"Cybermois 2026 : près d’un Français sur deux désormais notifié suite à une violation de ses données","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/cp-cybermois-2026","published":"2026-09-15T08:50:28.000Z","updated":"2026-09-18T13:49:18.000Z"},
      {"feed":"actualites","title":"Cybermalveillance.gouv.fr lance une enquête auprès des collectivités de moins de 25 000 habitants","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/enquete-collectivites-cybersecurite-2026","published":"2026-09-01T12:23:34.000Z","updated":"2026-10-02T09:00:26.000Z"},
      {"feed":"actualites","title":"Cybermalveillance.gouv.fr lance une AlerteCyber concernant une faille de sécurité critique dans SPIP","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/alertecyber-faille-securite-critique-spip","published":"2026-08-27T13:16:34.000Z","updated":"2026-08-27T13:16:35.000Z"},
      {"feed":"actualites","title":"AlerteCyber : Faille de sécurité critique dans SPIP","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/alertecyber-faille-de-securite-critique-dans-spip-202608","published":"2026-08-27T12:24:06.000Z","updated":"2026-09-16T07:55:02.000Z"},
      {"feed":"actualites","title":"Cybermalveillance.gouv.fr lance une AlerteCyber concernant deux failles de sécurité critiques dans Microsoft SharePoint","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/alertecyber-microsoftsharepoint-0726","published":"2026-07-28T11:22:05.000Z","updated":"2026-08-10T12:49:07.000Z"},
      {"feed":"actualites","title":"AlerteCyber : Failles de sécurité critiques dans Microsoft SharePoint","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/alertecyber-failles-de-securite-critiques-dans-sharepoint-202607","published":"2026-07-28T06:53:06.000Z","updated":"2026-09-15T11:11:48.000Z"},
      {"feed":"actualites","title":"Cybermalveillance.gouv.fr lance une AlerteCyber concernant des failles de sécurité critiques dans WordPress","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/alertecyber-wordpress","published":"2026-07-23T09:48:48.000Z","updated":"2026-07-23T15:12:14.000Z"},
      {"feed":"actualites","title":"AlerteCyber : Failles de sécurité critiques dans WordPress","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/alertecyber-failles-de-securite-critiques-dans-wordpress-202607","published":"2026-07-23T07:25:40.000Z","updated":"2026-09-15T11:20:28.000Z"},
      {"feed":"actualites","title":"Remboursement d’impôt : attention aux tentatives d’hameçonnage","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/remboursement-impot-hameconnage","published":"2026-07-15T08:26:15.000Z","updated":"2026-09-08T13:55:25.000Z"},
      {"feed":"actualites","title":"Faire ses démarches administratives en ligne en évitant les pièges","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/faire-ses-demarches-administratives-en-ligne-en-evitant-les-pieges","published":"2026-07-09T08:58:00.000Z","updated":"2026-09-07T14:23:55.000Z"},
      {"feed":"actualites","title":"Lancement de la MalletteCyber Pro pour sensibiliser les TPE-PME","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/mallettecyber-pro","published":"2026-06-25T09:50:13.000Z","updated":"2026-07-09T14:49:03.000Z"},
      {"feed":"actualites","title":"Cybermois 2026","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/cybermois-2026","published":"2026-06-04T10:00:48.000Z","updated":"2026-10-01T12:10:41.000Z"},
      {"feed":"actualites","title":"Soldes d’été : 7 conseils pour éviter les cyber-arnaques","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/7-conseils-pour-eviter-les-cyberescroqueries","published":"2026-06-03T13:45:00.000Z","updated":"2026-08-11T12:38:10.000Z"},
      {"feed":"actualites","title":"Cybermois 2026 : kit de communication","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/cybermois-2026-kit-communication","published":"2026-06-02T07:56:39.000Z","updated":"2026-10-01T15:25:04.000Z"},
      {"feed":"actualites","title":"L’UGAP et Cybermalveillance.gouv.fr nouent un partenariat structurant pour accompagner les acteurs publics face au risque cyber","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/ugap-cybermalveillancegouvfr","published":"2026-06-01T15:36:35.000Z","updated":"2026-06-02T07:37:55.000Z"},
      {"feed":"actualites","title":"Les violations de données en 2025 : une accélération avec des conséquences très diverses","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/violations-donnees-ra25","published":"2026-06-01T13:06:37.000Z","updated":"2026-08-18T15:05:04.000Z"},
      {"feed":"actualites","title":"Le piratage de comptes en ligne en 2025","url":"https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/donnees-perso-piratage-compte-ra25","published":"2026-06-01T13:02:56.000Z","updated":"2026-06-01T13:03:53.000Z"}
    ]
  },
  "errors": []
};

/** Page Vigipirate du SGDSN relue à 16 h 48 : empreinte du texte utile, aucun changement vu. */
const VIGIPIRATE_CHECK: VigipiratePageCheck = {"readAt":"2026-10-04T14:48:30.000Z","fingerprint":"9b814a66d150eef009b5e226fb7d050ba6383b49c67f35afb812e166a0b6ce1d","pageChangedAt":null,"errors":[]};

/** Relue le lendemain (05/10, 16 h 48) : texte passé au stade « alerte attentat », empreinte changée, page modifiée le 05/10. */
const VIGIPIRATE_CHECK_CHANGED: VigipiratePageCheck = {"readAt":"2026-10-05T14:48:30.000Z","fingerprint":"f17ac974f6e3db784e7ad7991c37b3e3154d31132d48a2b871ad7f2a047961a6","pageChangedAt":"2026-10-05T14:48:30.000Z","errors":[]};

export function MILITARY_FIXTURE(): MilitaryResponse { return copy(MILITARY); }
export function MILITARY_EMERGENCY_FIXTURE(): MilitaryResponse { return copy(MILITARY_EMERGENCY); }
export function MILITARY_FRENCH_EMERGENCY_FIXTURE(): MilitaryResponse { return copy(MILITARY_FRENCH_EMERGENCY); }
export function CABLES_FILE_FIXTURE(): SubseaCablesFile { return copy(CABLES_FILE); }
export function CABLES_WATCH_FIXTURE(): CablesWatchResponse { return copy(CABLES_WATCH); }
export function CABLES_WATCH_ALERTS_FIXTURE(): CablesWatchResponse { return copy(CABLES_WATCH_ALERTS); }
export function CABLES_WATCH_FROZEN_FIXTURE(): CablesWatchResponse { return copy(CABLES_WATCH_FROZEN); }
export function CABLES_WATCH_ZONE_MUTED_FIXTURE(): CablesWatchResponse { return copy(CABLES_WATCH_ZONE_MUTED); }
export function CYBER_FIXTURE(): CyberResponse { return copy(CYBER); }
export function VIGIPIRATE_CHECK_FIXTURE(): VigipiratePageCheck { return copy(VIGIPIRATE_CHECK); }
export function VIGIPIRATE_CHECK_CHANGED_FIXTURE(): VigipiratePageCheck { return copy(VIGIPIRATE_CHECK_CHANGED); }

/** Saisie Vigipirate du 04/10/2026 (mêmes valeurs que src/config/vigipirate.ts) ; constante, comme l'écrit le contrat. */
export const VIGIPIRATE_FIXTURE: VigipirateEntry = {
  stade: 'vigilance-renforcee',
  depuis: '2026-06-22',
  posture: 'été-automne 2026',
  accents: [
    'lutte contre la menace drones',
    'sécurité des sites touristiques et des zones d’affluence',
    'sécurité des bâtiments publics et institutionnels',
  ],
  saisiLe: '2026-10-04',
  lien: 'https://www.sgdsn.gouv.fr/vigipirate',
};

// ─── Phase B (tâche B24) : grille GNSS et météo spatiale, grands réseaux, registre des gels, zones drones ───
// Réponses construites par le code du serveur (api/_handlers/sovereignty/gnss.js, connectivity.js, sanctions.js) au 04/10/2026 à
// 16 h 48 min 30 s à Paris : Kp, échelles et alerte NOAA réels ; six routing-status RIPEstat et annuaire PeeringDB réels (27 points
// d'échange : identifiant, nom, ville, date, aucune coordonnée de contact) ; grille GNSS sur lectures adsb.lol construites (adresses
// fictives, cycles de 10 min depuis le 03/10 00 h 05 UTC : la veille 03/10 est couverte, ses mailles sont servies, le jour en cours
// ne l'est jamais) ; registre des gels sur le fichier DG Trésor réduit et anonymisé (identifiants et noms fictifs, aucun nom dans la
// réponse), publications précédentes construites pour la courbe. tests/sovereignty-contract-b.test.ts vérifie que les formes et les
// statuts des lignes du panneau des sources sont ceux du serveur.

/** Grille du 04/10 : 14 mailles françaises mesurées, deux orange en Bretagne (12,5 % et 10,5 %), une jaune ; Kp 5 à 09 h UTC sans dégradation générale (21 %). */
const GNSS: GnssResponse = {
  "readAt": "2026-10-04T14:45:24.000Z",
  "windowStart": "2026-10-03T14:45:24.000Z",
  "reads": 720,
  "aircraft": 723,
  "cells": [
    {"lat": 50.5, "lon": -1.5, "good": 3, "degraded": 3, "unknown": 2, "pct": 33.3, "level": "orange", "inFrance": false},
    {"lat": 48.5, "lon": 2, "good": 120, "degraded": 1, "unknown": 4, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 48.5, "lon": 2.5, "good": 96, "degraded": 0, "unknown": 2, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 48, "lon": -4, "good": 16, "degraded": 3, "unknown": 0, "pct": 10.5, "level": "orange", "inFrance": true},
    {"lat": 48, "lon": -3.5, "good": 20, "degraded": 4, "unknown": 1, "pct": 12.5, "level": "orange", "inFrance": true},
    {"lat": 48, "lon": -3, "good": 30, "degraded": 2, "unknown": 2, "pct": 3.1, "level": "jaune", "inFrance": true},
    {"lat": 48, "lon": 2, "good": 64, "degraded": 0, "unknown": 1, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 48, "lon": 2.5, "good": 58, "degraded": 1, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 47.5, "lon": 1.5, "good": 41, "degraded": 0, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 47, "lon": 2, "good": 37, "degraded": 0, "unknown": 1, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 46.5, "lon": 2.5, "good": 29, "degraded": 0, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 46, "lon": 3, "good": 40, "degraded": 0, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 46, "lon": 6, "good": 22, "degraded": 0, "unknown": 0, "pct": 0, "level": "vert", "inFrance": false},
    {"lat": 45.5, "lon": 4.5, "good": 55, "degraded": 1, "unknown": 2, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 45, "lon": 5, "good": 33, "degraded": 0, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 44.5, "lon": 4.5, "good": 25, "degraded": 0, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 44, "lon": 4, "good": 3, "degraded": 0, "unknown": 1, "pct": null, "level": "peu", "inFrance": true}
  ],
  "cellsDay": "2026-10-03",
  "frenchCells": 14,
  "generalDegradation": false,
  "degraded": {
    "rolling24h": 2,
    "previousUtcDays": [2, null]
  },
  "days": {
    "days": [
      {"date": "2026-10-03", "jaune": 1, "orange": 2, "general": false},
      {"date": "2026-10-04", "jaune": 1, "orange": 2, "general": false}
    ],
    "since": "2026-10-03"
  },
  "errors": [],
  "spaceWeather": {
    "readAt": "2026-10-04T14:45:00.000Z",
    "scalesAt": "2026-10-04T14:46:00.000Z",
    "today": {"date": "2026-10-04", "observed": true, "r": 0, "s": 0, "g": 0, "rMinorProb": null, "rMajorProb": null, "sProb": null},
    "forecast": [
      {"date": "2026-10-04", "observed": false, "r": null, "s": null, "g": 1, "rMinorProb": 5, "rMajorProb": 1, "sProb": 1},
      {"date": "2026-10-05", "observed": false, "r": null, "s": null, "g": 0, "rMinorProb": 5, "rMajorProb": 1, "sProb": 1},
      {"date": "2026-10-06", "observed": false, "r": null, "s": null, "g": 0, "rMinorProb": 5, "rMajorProb": 1, "sProb": 1}
    ],
    "kp": [
      {"at": "2026-09-27T12:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-27T15:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-27T18:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-27T21:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-28T00:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-28T03:00:00.000Z", "kp": 1.67},
      {"at": "2026-09-28T06:00:00.000Z", "kp": 1},
      {"at": "2026-09-28T09:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-28T12:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-28T15:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-28T18:00:00.000Z", "kp": 1},
      {"at": "2026-09-28T21:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-29T00:00:00.000Z", "kp": 2},
      {"at": "2026-09-29T03:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-29T06:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-29T09:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-29T12:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-29T15:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-29T18:00:00.000Z", "kp": 1},
      {"at": "2026-09-29T21:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-30T00:00:00.000Z", "kp": 1},
      {"at": "2026-09-30T03:00:00.000Z", "kp": 1},
      {"at": "2026-09-30T06:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-30T09:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-30T12:00:00.000Z", "kp": 1},
      {"at": "2026-09-30T15:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-30T18:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-30T21:00:00.000Z", "kp": 0.67},
      {"at": "2026-10-01T00:00:00.000Z", "kp": 0.33},
      {"at": "2026-10-01T03:00:00.000Z", "kp": 0.33},
      {"at": "2026-10-01T06:00:00.000Z", "kp": 0.67},
      {"at": "2026-10-01T09:00:00.000Z", "kp": 1},
      {"at": "2026-10-01T12:00:00.000Z", "kp": 1},
      {"at": "2026-10-01T15:00:00.000Z", "kp": 1.33},
      {"at": "2026-10-01T18:00:00.000Z", "kp": 1.33},
      {"at": "2026-10-01T21:00:00.000Z", "kp": 2},
      {"at": "2026-10-02T00:00:00.000Z", "kp": 1},
      {"at": "2026-10-02T03:00:00.000Z", "kp": 1},
      {"at": "2026-10-02T06:00:00.000Z", "kp": 0.33},
      {"at": "2026-10-02T09:00:00.000Z", "kp": 0.67},
      {"at": "2026-10-02T12:00:00.000Z", "kp": 0.67},
      {"at": "2026-10-02T15:00:00.000Z", "kp": 0.33},
      {"at": "2026-10-02T18:00:00.000Z", "kp": 0.67},
      {"at": "2026-10-02T21:00:00.000Z", "kp": 1.33},
      {"at": "2026-10-03T00:00:00.000Z", "kp": 2.33},
      {"at": "2026-10-03T03:00:00.000Z", "kp": 2.67},
      {"at": "2026-10-03T06:00:00.000Z", "kp": 2.67},
      {"at": "2026-10-03T09:00:00.000Z", "kp": 2},
      {"at": "2026-10-03T12:00:00.000Z", "kp": 1.67},
      {"at": "2026-10-03T15:00:00.000Z", "kp": 0.67},
      {"at": "2026-10-03T18:00:00.000Z", "kp": 0.33},
      {"at": "2026-10-03T21:00:00.000Z", "kp": 1},
      {"at": "2026-10-04T00:00:00.000Z", "kp": 3},
      {"at": "2026-10-04T03:00:00.000Z", "kp": 3.33},
      {"at": "2026-10-04T06:00:00.000Z", "kp": 4.33},
      {"at": "2026-10-04T09:00:00.000Z", "kp": 5}
    ],
    "lastAlert": {"productId": "K05A", "issuedAt": "2026-10-04T14:03:28.167Z", "title": "ALERT: Geomagnetic K-index of 5", "gScale": 1}
  }
};

/** Orage construit : 10 mailles françaises dont 4 dégradées (40 %), Kp 5,33 depuis le 03/10 : dégradation générale, aucune maille comptée. */
const GNSS_STORM: GnssResponse = {
  "readAt": "2026-10-04T14:45:24.000Z",
  "windowStart": "2026-10-03T14:45:24.000Z",
  "reads": 720,
  "aircraft": 344,
  "cells": [
    {"lat": 48.5, "lon": 2, "good": 18, "degraded": 4, "unknown": 0, "pct": 13.6, "level": "orange", "inFrance": true},
    {"lat": 48.5, "lon": 2.5, "good": 24, "degraded": 4, "unknown": 1, "pct": 10.7, "level": "orange", "inFrance": true},
    {"lat": 48, "lon": 2, "good": 30, "degraded": 2, "unknown": 0, "pct": 3.1, "level": "jaune", "inFrance": true},
    {"lat": 48, "lon": 2.5, "good": 23, "degraded": 2, "unknown": 0, "pct": 4, "level": "jaune", "inFrance": true},
    {"lat": 47.5, "lon": 1.5, "good": 41, "degraded": 0, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 47, "lon": 2, "good": 37, "degraded": 0, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 46.5, "lon": 2.5, "good": 29, "degraded": 0, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 46, "lon": 3, "good": 40, "degraded": 1, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 45.5, "lon": 4.5, "good": 55, "degraded": 0, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true},
    {"lat": 45, "lon": 5, "good": 33, "degraded": 0, "unknown": 0, "pct": 0, "level": "vert", "inFrance": true}
  ],
  "cellsDay": "2026-10-03",
  "frenchCells": 10,
  "generalDegradation": true,
  "degraded": {
    "rolling24h": 0,
    "previousUtcDays": [0, null]
  },
  "days": {
    "days": [
      {"date": "2026-10-03", "jaune": 2, "orange": 2, "general": true},
      {"date": "2026-10-04", "jaune": 2, "orange": 2, "general": true}
    ],
    "since": "2026-10-03"
  },
  "errors": [],
  "spaceWeather": {
    "readAt": "2026-10-04T14:45:00.000Z",
    "scalesAt": "2026-10-04T14:46:00.000Z",
    "today": {"date": "2026-10-04", "observed": true, "r": 0, "s": 0, "g": 0, "rMinorProb": null, "rMajorProb": null, "sProb": null},
    "forecast": [
      {"date": "2026-10-04", "observed": false, "r": null, "s": null, "g": 1, "rMinorProb": 5, "rMajorProb": 1, "sProb": 1},
      {"date": "2026-10-05", "observed": false, "r": null, "s": null, "g": 0, "rMinorProb": 5, "rMajorProb": 1, "sProb": 1},
      {"date": "2026-10-06", "observed": false, "r": null, "s": null, "g": 0, "rMinorProb": 5, "rMajorProb": 1, "sProb": 1}
    ],
    "kp": [
      {"at": "2026-09-27T12:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-27T15:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-27T18:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-27T21:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-28T00:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-28T03:00:00.000Z", "kp": 1.67},
      {"at": "2026-09-28T06:00:00.000Z", "kp": 1},
      {"at": "2026-09-28T09:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-28T12:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-28T15:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-28T18:00:00.000Z", "kp": 1},
      {"at": "2026-09-28T21:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-29T00:00:00.000Z", "kp": 2},
      {"at": "2026-09-29T03:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-29T06:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-29T09:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-29T12:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-29T15:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-29T18:00:00.000Z", "kp": 1},
      {"at": "2026-09-29T21:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-30T00:00:00.000Z", "kp": 1},
      {"at": "2026-09-30T03:00:00.000Z", "kp": 1},
      {"at": "2026-09-30T06:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-30T09:00:00.000Z", "kp": 1.33},
      {"at": "2026-09-30T12:00:00.000Z", "kp": 1},
      {"at": "2026-09-30T15:00:00.000Z", "kp": 0.33},
      {"at": "2026-09-30T18:00:00.000Z", "kp": 0.67},
      {"at": "2026-09-30T21:00:00.000Z", "kp": 0.67},
      {"at": "2026-10-01T00:00:00.000Z", "kp": 0.33},
      {"at": "2026-10-01T03:00:00.000Z", "kp": 0.33},
      {"at": "2026-10-01T06:00:00.000Z", "kp": 0.67},
      {"at": "2026-10-01T09:00:00.000Z", "kp": 1},
      {"at": "2026-10-01T12:00:00.000Z", "kp": 1},
      {"at": "2026-10-01T15:00:00.000Z", "kp": 1.33},
      {"at": "2026-10-01T18:00:00.000Z", "kp": 1.33},
      {"at": "2026-10-01T21:00:00.000Z", "kp": 2},
      {"at": "2026-10-02T00:00:00.000Z", "kp": 1},
      {"at": "2026-10-02T03:00:00.000Z", "kp": 1},
      {"at": "2026-10-02T06:00:00.000Z", "kp": 0.33},
      {"at": "2026-10-02T09:00:00.000Z", "kp": 0.67},
      {"at": "2026-10-02T12:00:00.000Z", "kp": 0.67},
      {"at": "2026-10-02T15:00:00.000Z", "kp": 0.33},
      {"at": "2026-10-02T18:00:00.000Z", "kp": 0.67},
      {"at": "2026-10-02T21:00:00.000Z", "kp": 1.33},
      {"at": "2026-10-03T00:00:00.000Z", "kp": 5.33},
      {"at": "2026-10-03T03:00:00.000Z", "kp": 5.33},
      {"at": "2026-10-03T06:00:00.000Z", "kp": 5.33},
      {"at": "2026-10-03T09:00:00.000Z", "kp": 5.33},
      {"at": "2026-10-03T12:00:00.000Z", "kp": 5.33},
      {"at": "2026-10-03T15:00:00.000Z", "kp": 5.33},
      {"at": "2026-10-03T18:00:00.000Z", "kp": 5.33},
      {"at": "2026-10-03T21:00:00.000Z", "kp": 5.33},
      {"at": "2026-10-04T00:00:00.000Z", "kp": 5.33},
      {"at": "2026-10-04T03:00:00.000Z", "kp": 5.33},
      {"at": "2026-10-04T06:00:00.000Z", "kp": 5.33},
      {"at": "2026-10-04T09:00:00.000Z", "kp": 5.33}
    ],
    "lastAlert": {"productId": "K05A", "issuedAt": "2026-10-04T14:03:28.167Z", "title": "ALERT: Geomagnetic K-index of 5", "gScale": 1}
  }
};

/** Les six routing-status du 04/10 (instantané de 08 h UTC : quatre réseaux à 100 %, Free 99,38 %, RENATER 99,69 %), série construite de 23 instantanés depuis le 27/09, 27 points d'échange. */
const CONNECTIVITY: ConnectivityResponse = {
  "readAt": "2026-10-04T14:48:30.000Z",
  "snapshotAt": "2026-10-04T08:00:00.000Z",
  "networks": [
    {"asn": 3215, "name": "Orange", "v4Seeing": 325, "v4Total": 325, "v6Seeing": 314, "v6Total": 314, "v4Prefixes": 923, "v6Prefixes": 45, "visibilityPct": 100},
    {"asn": 15557, "name": "SFR", "v4Seeing": 325, "v4Total": 325, "v6Seeing": 314, "v6Total": 314, "v4Prefixes": 147, "v6Prefixes": 12, "visibilityPct": 100},
    {"asn": 5410, "name": "Bouygues Telecom", "v4Seeing": 325, "v4Total": 325, "v6Seeing": 314, "v6Total": 314, "v4Prefixes": 20, "v6Prefixes": 2, "visibilityPct": 100},
    {"asn": 12322, "name": "Free", "v4Seeing": 323, "v4Total": 325, "v6Seeing": 314, "v6Total": 314, "v4Prefixes": 538, "v6Prefixes": 527, "visibilityPct": 99.38},
    {"asn": 2200, "name": "RENATER", "v4Seeing": 324, "v4Total": 325, "v6Seeing": 314, "v6Total": 314, "v4Prefixes": 77, "v6Prefixes": 2, "visibilityPct": 99.69},
    {"asn": 16276, "name": "OVHcloud", "v4Seeing": 325, "v4Total": 325, "v6Seeing": 314, "v6Total": 314, "v4Prefixes": 709, "v6Prefixes": 43, "visibilityPct": 100}
  ],
  "unread": [],
  "history": {
    "samples": [
      {"at": "2026-09-27T00:00:00.000Z", "minPct": 99.38},
      {"at": "2026-09-27T08:00:00.000Z", "minPct": 99.38},
      {"at": "2026-09-27T16:00:00.000Z", "minPct": 99.38},
      {"at": "2026-09-28T00:00:00.000Z", "minPct": 99.38},
      {"at": "2026-09-28T08:00:00.000Z", "minPct": 99.38},
      {"at": "2026-09-28T16:00:00.000Z", "minPct": 99.38},
      {"at": "2026-09-29T00:00:00.000Z", "minPct": 99.38},
      {"at": "2026-09-29T08:00:00.000Z", "minPct": 99.38},
      {"at": "2026-09-29T16:00:00.000Z", "minPct": 99.38},
      {"at": "2026-09-30T00:00:00.000Z", "minPct": 99.38},
      {"at": "2026-09-30T08:00:00.000Z", "minPct": 99.38},
      {"at": "2026-09-30T16:00:00.000Z", "minPct": 99.08},
      {"at": "2026-10-01T00:00:00.000Z", "minPct": 99.38},
      {"at": "2026-10-01T08:00:00.000Z", "minPct": 99.38},
      {"at": "2026-10-01T16:00:00.000Z", "minPct": 99.38},
      {"at": "2026-10-02T00:00:00.000Z", "minPct": 99.38},
      {"at": "2026-10-02T08:00:00.000Z", "minPct": 99.38},
      {"at": "2026-10-02T16:00:00.000Z", "minPct": 99.38},
      {"at": "2026-10-03T00:00:00.000Z", "minPct": 99.38},
      {"at": "2026-10-03T08:00:00.000Z", "minPct": 99.38},
      {"at": "2026-10-03T16:00:00.000Z", "minPct": 99.38},
      {"at": "2026-10-04T00:00:00.000Z", "minPct": 99.38},
      {"at": "2026-10-04T08:00:00.000Z", "minPct": 99.38}
    ],
    "since": "2026-09-27T00:00:00.000Z",
    "prefixSamples": [
      {
        "at": "2026-10-04T08:00:00.000Z",
        "prefixes": {"2200": 79, "3215": 968, "5410": 22, "12322": 1065, "15557": 159, "16276": 752}
      }
    ]
  },
  "exchanges": {
    "readAt": "2026-10-04T14:48:30.000Z",
    "items": [
      {"id": 4994, "name": "1-FR FREE", "city": "Paris", "updated": "2026-04-30T13:40:26Z", "url": "https://www.peeringdb.com/ix/4994"},
      {"id": 4461, "name": "Association HwHost", "city": "Paris", "updated": "2024-05-11T23:37:47Z", "url": "https://www.peeringdb.com/ix/4461"},
      {"id": 1019, "name": "AuvernIX", "city": "Clermont-Ferrand", "updated": "2020-08-09T17:34:13Z", "url": "https://www.peeringdb.com/ix/1019"},
      {"id": 3384, "name": "BéarnIX", "city": "Pau", "updated": "2024-02-26T11:51:32Z", "url": "https://www.peeringdb.com/ix/3384"},
      {"id": 1670, "name": "BreizhIX", "city": "Rennes", "updated": "2017-03-19T14:08:08Z", "url": "https://www.peeringdb.com/ix/1670"},
      {"id": 2726, "name": "BrestIX", "city": "Brest", "updated": "2019-11-06T17:49:10Z", "url": "https://www.peeringdb.com/ix/2726"},
      {"id": 1149, "name": "DE-CIX Marseille", "city": "Marseille", "updated": "2021-11-17T11:46:45Z", "url": "https://www.peeringdb.com/ix/1149"},
      {"id": 255, "name": "Equinix Paris", "city": "Paris", "updated": "2024-07-26T15:38:16Z", "url": "https://www.peeringdb.com/ix/255"},
      {"id": 4985, "name": "ERA-IX Paris", "city": "Paris", "updated": "2026-03-20T12:12:34Z", "url": "https://www.peeringdb.com/ix/4985"},
      {"id": 4968, "name": "EuroRhine-IX", "city": "Strasbourg", "updated": "2026-05-11T08:29:08Z", "url": "https://www.peeringdb.com/ix/4968"},
      {"id": 69, "name": "France-IX AURA", "city": "Lyon and Grenoble", "updated": "2025-07-08T12:08:34Z", "url": "https://www.peeringdb.com/ix/69"},
      {"id": 4693, "name": "France-IX Bordeaux", "city": "Bordeaux", "updated": "2025-07-08T12:12:02Z", "url": "https://www.peeringdb.com/ix/4693"},
      {"id": 4005, "name": "France-IX Lille", "city": "Lille", "updated": "2025-07-08T12:08:58Z", "url": "https://www.peeringdb.com/ix/4005"},
      {"id": 880, "name": "France-IX Marseille", "city": "Marseille", "updated": "2026-03-05T13:23:50Z", "url": "https://www.peeringdb.com/ix/880"},
      {"id": 359, "name": "France-IX Paris", "city": "Paris", "updated": "2026-03-05T13:23:02Z", "url": "https://www.peeringdb.com/ix/359"},
      {"id": 5040, "name": "France-IX Paris Essentiel", "city": "Paris", "updated": "2026-07-06T16:29:13Z", "url": "https://www.peeringdb.com/ix/5040"},
      {"id": 4162, "name": "France-IX Toulouse", "city": "Toulouse", "updated": "2025-07-08T12:09:41Z", "url": "https://www.peeringdb.com/ix/4162"},
      {"id": 1320, "name": "Hopus", "city": "Paris, Lyon, Marseille, Geneva, Zurich, Amsterdam, Frankfurt", "updated": "2025-06-24T10:07:54Z", "url": "https://www.peeringdb.com/ix/1320"},
      {"id": 4245, "name": "ixFabric - Lyon", "city": "Lyon", "updated": "2026-09-27T22:53:35Z", "url": "https://www.peeringdb.com/ix/4245"},
      {"id": 3913, "name": "ixFabric - Paris", "city": "Paris", "updated": "2026-09-27T22:53:19Z", "url": "https://www.peeringdb.com/ix/3913"},
      {"id": 881, "name": "Lillix", "city": "Lille", "updated": "2024-07-18T07:45:51Z", "url": "https://www.peeringdb.com/ix/881"},
      {"id": 4652, "name": "MPLIX", "city": "Montpellier", "updated": "2025-02-16T00:25:45Z", "url": "https://www.peeringdb.com/ix/4652"},
      {"id": 4705, "name": "nine", "city": "Amsterdam, Bordeaux, Frankfurt, Genève, Lille, London, Lyon, Marseille, Milano, Montpellier, Paris, Zurich", "updated": "2026-07-11T04:14:52Z", "url": "https://www.peeringdb.com/ix/4705"},
      {"id": 5011, "name": "nine - six in Paris", "city": "Paris", "updated": "2026-06-03T15:42:21Z", "url": "https://www.peeringdb.com/ix/5011"},
      {"id": 1040, "name": "NormandIX", "city": "Normandy", "updated": "2020-08-01T06:18:28Z", "url": "https://www.peeringdb.com/ix/1040"},
      {"id": 3436, "name": "Ouest.Network", "city": "Nantes", "updated": "2023-11-06T08:42:20Z", "url": "https://www.peeringdb.com/ix/3436"},
      {"id": 34, "name": "SFINX", "city": "Paris", "updated": "2021-07-23T12:16:46Z", "url": "https://www.peeringdb.com/ix/34"}
    ]
  },
  "errors": []
};

/** Publication du 02/10 10 h 36 : comptes du fichier réduit (40 entrées), différence construite (1 nouveau gel, 2 radiations), deux publications précédentes pour la courbe. */
const SANCTIONS: SanctionsResponse = {
  "readAt": "2026-10-04T14:48:30.000Z",
  "dateCheckedAt": "2026-10-04T14:48:30.000Z",
  "current": {"publishedAt": "2026-10-02T10:36:17.126+02:00", "total": 40, "physiques": 27, "morales": 10, "navires": 3, "added": 1, "removed": 2},
  "history": {
    "publications": [
      {"publishedAt": "2026-09-19T10:31:05.000+02:00", "total": 37, "physiques": 25, "morales": 9, "navires": 3, "added": null, "removed": null},
      {"publishedAt": "2026-09-26T10:30:00.000+02:00", "total": 39, "physiques": 26, "morales": 10, "navires": 3, "added": 3, "removed": 1},
      {"publishedAt": "2026-10-02T10:36:17.126+02:00", "total": 40, "physiques": 27, "morales": 10, "navires": 3, "added": 1, "removed": 2}
    ],
    "since": "2026-09-19T10:31:05.000+02:00"
  },
  "errors": []
};

/** En-tête du fichier des zones drones (sans les zones) tel que le script l'a écrit : édition 2025-07-01, 5 541 zones gardées. */
const DRONE_ZONES_META: Omit<DroneZonesFile, 'zones'> = {
  generatedAt: '2026-10-04T15:40:00.000Z', edition: '2025-07-01', source: 'DGAC / IGN, Géoplateforme', licence: 'CGU cartes.gouv.fr',
  counts: { volInterdit: 73_000, agglomerations: 67_457, kept: 5541 },
};

export function GNSS_FIXTURE(): GnssResponse { return copy(GNSS); }
export function GNSS_STORM_FIXTURE(): GnssResponse { return copy(GNSS_STORM); }
export function CONNECTIVITY_FIXTURE(): ConnectivityResponse { return copy(CONNECTIVITY); }
export function SANCTIONS_FIXTURE(): SanctionsResponse { return copy(SANCTIONS); }
export function DRONE_ZONES_META_FIXTURE(): Omit<DroneZonesFile, 'zones'> { return copy(DRONE_ZONES_META); }

/** États des coquilles (lecture réussie à SOV_FIXTURE_NOW). */
export function gnssStateFixture(data: GnssResponse = GNSS_FIXTURE()): GnssState {
  return { gnss: { data, error: null, fetchedAt: SOV_FIXTURE_NOW } };
}
export function connectivityStateFixture(data: ConnectivityResponse = CONNECTIVITY_FIXTURE()): ConnectivityState {
  return { connectivity: { data, error: null, fetchedAt: SOV_FIXTURE_NOW } };
}
export function sanctionsStateFixture(data: SanctionsResponse = SANCTIONS_FIXTURE()): SanctionsState {
  return { sanctions: { data, error: null, fetchedAt: SOV_FIXTURE_NOW } };
}
