// src/config/anticipation-rejeu-corse.ts : données du rejeu public de l'épisode méditerranéen du 4 au 6 novembre 2026 (page /anticipation/rejeu).
// GÉNÉRÉ le 13/11/2026 à partir de deux sources réelles, ne pas éditer à la main : (1) la règle crue-inondation évaluée sur les 49 instantanés de
// l'archive des signaux de la VM (vigilance Météo-France telle que relevée à l'époque) ; (2) les articles de /api/news étiquetés « inondation »
// (api/_lib/anticipation/press-tags.js) qui nomment la Corse, le Gard ou l'Hérault. La règle n'existait pas pendant l'épisode.

export interface RejeuEpisode { dept: string; name: string; publishedAt: string; firstSnapshotAt: string; word: string; windowFrom: string; windowTo: string; lastSeenAt: string;
  exposure: { urgences: number; passages: number; mainHospitals: string[]; ehpad: number; ehpadPlaces: number; sevesoHaut: number; sevesoBas: number } }
export interface RejeuPressItem { at: string; title: string; source: string; link: string }

export const REJEU_SNAPSHOTS = 49;
export const REJEU_EPISODES: readonly RejeuEpisode[] = [
  {
    "dept": "2A",
    "name": "Corse-du-Sud",
    "publishedAt": "2026-11-04T15:00:12Z",
    "firstSnapshotAt": "2026-11-04T16:35:16.229Z",
    "word": "probable",
    "windowFrom": "2026-11-05T05:00:00.000Z",
    "windowTo": "2026-11-06T15:00:00.000Z",
    "lastSeenAt": "2026-11-06T12:44:32.526Z",
    "exposure": {
      "urgences": 2,
      "passages": 57673,
      "mainHospitals": [
        "CH Nd La Misericorde",
        "Clinique Du Sud De La Corse"
      ],
      "ehpad": 15,
      "ehpadPlaces": 928,
      "sevesoHaut": 2,
      "sevesoBas": 2
    }
  },
  {
    "dept": "2B",
    "name": "Haute-Corse",
    "publishedAt": "2026-11-04T15:00:12Z",
    "firstSnapshotAt": "2026-11-04T16:35:16.229Z",
    "word": "probable",
    "windowFrom": "2026-11-05T05:00:00.000Z",
    "windowTo": "2026-11-06T11:00:00.000Z",
    "lastSeenAt": "2026-11-06T05:03:00.312Z",
    "exposure": {
      "urgences": 2,
      "passages": 44374,
      "mainHospitals": [
        "Centre Hospitalier De Bastia",
        "CH Calvi"
      ],
      "ehpad": 15,
      "ehpadPlaces": 1099,
      "sevesoHaut": 3,
      "sevesoBas": 4
    }
  },
  {
    "dept": "30",
    "name": "Gard",
    "publishedAt": "2026-11-05T05:02:58Z",
    "firstSnapshotAt": "2026-11-05T08:02:56.498Z",
    "word": "probable",
    "windowFrom": "2026-11-05T09:00:00.000Z",
    "windowTo": "2026-11-05T23:00:00.000Z",
    "lastSeenAt": "2026-11-05T22:06:44.598Z",
    "exposure": {
      "urgences": 5,
      "passages": 230428,
      "mainHospitals": [
        "CHU Nimes Caremeau",
        "CH Ales Cevennes"
      ],
      "ehpad": 89,
      "ehpadPlaces": 6651,
      "sevesoHaut": 7,
      "sevesoBas": 9
    }
  },
  {
    "dept": "34",
    "name": "Hérault",
    "publishedAt": "2026-11-05T05:02:58Z",
    "firstSnapshotAt": "2026-11-05T08:02:56.498Z",
    "word": "probable",
    "windowFrom": "2026-11-05T09:00:00.000Z",
    "windowTo": "2026-11-05T23:00:00.000Z",
    "lastSeenAt": "2026-11-05T22:06:44.598Z",
    "exposure": {
      "urgences": 13,
      "passages": 461643,
      "mainHospitals": [
        "Hopital Lapeyronie CHU Montpellier",
        "CH Beziers"
      ],
      "ehpad": 148,
      "ehpadPlaces": 10294,
      "sevesoHaut": 5,
      "sevesoBas": 4
    }
  }
];

export const REJEU_PRESS: readonly RejeuPressItem[] = [
  {
    "at": "2026-11-05T08:01:17.000Z",
    "title": "L’Hérault, le Gard et la Corse placés en vigilance orange pluie-inondation, plusieurs évacuations au sud de l’île",
    "source": "Le Monde",
    "link": "https://www.lemonde.fr/planete/article/2026/11/05/l-herault-et-le-gard-rejoignent-la-corse-dans-une-vigilance-orange-pluie-inondation-etendue-durant-la-journee-de-jeudi_6806834_3244.html"
  },
  {
    "at": "2026-11-05T14:14:17.000Z",
    "title": "EN DIRECT Épisode méditerranéen : des inondations et de la grêle à Montpellier, des routes fermées dans le Gard... suivez l'évolution de la situation",
    "source": "Midi Libre",
    "link": "https://www.midilibre.fr/2026/11/05/en-direct-episode-mediterraneen-suivez-levolution-des-intemperies-dans-la-region-13636471.php"
  },
  {
    "at": "2026-11-05T17:10:25.000Z",
    "title": "EN DIRECT Épisode méditerranéen : images des inondations à Palavas, routes barrées dans le Gard... Suivez l'évolution de la situation",
    "source": "Midi Libre",
    "link": "https://www.midilibre.fr/2026/11/05/en-direct-episode-mediterraneen-suivez-levolution-des-intemperies-dans-la-region-13636471.php"
  },
  {
    "at": "2026-11-06T05:07:23.000Z",
    "title": "Maisons inondées, routes coupées...un épisode de pluies intenses à Porto-Vecchio",
    "source": "BFM TV",
    "link": "https://www.bfmtv.com/meteo/intemperies/video-maisons-inondees-routes-coupees-un-episode-de-pluies-intenses-a-porto-vecchio_VN-202611060111.html"
  },
  {
    "at": "2026-11-06T07:09:23.000Z",
    "title": "Routes inondées, écoles fermées, circulation perturbée : Sommières particulièrement touchée par les intempéries ce vendredi matin",
    "source": "Midi Libre",
    "link": "https://www.midilibre.fr/2026/11/06/intemperies-routes-coupees-et-ecoles-fermees-a-sommieres-ce-vendredi-suite-aux-inondations-13639151.php"
  },
  {
    "at": "2026-11-06T08:09:21.000Z",
    "title": "Deux morts dans des inondations en Corse : \"La ville est comme bombardée\", réagit le maire de Porto-Vecchio",
    "source": "France Info",
    "link": "https://www.franceinfo.fr/environnement/evenements-meteorologiques-extremes/deux-morts-dans-des-inondations-en-corse-la-ville-est-comme-bombardee-reagit-le-maire-de-porto-vecchio_8270453.html#xtor=RSS-3-[lestitres]"
  },
  {
    "at": "2026-11-06T10:12:11.000Z",
    "title": "EN IMAGES. Inondations dans le Sud-Est : deux morts en Corse, des routes coupées… retour sur l’épisode méditerranéen",
    "source": "Sud Ouest",
    "link": "https://www.sudouest.fr/corse/en-images-inondations-dans-le-sud-est-deux-morts-en-corse-des-routes-coupees-retour-sur-l-episode-mediterraneen-31410690.php"
  }
];
