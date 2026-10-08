# API publique

France Monitor expose une petite API de **lecture** permettant à des tiers (administrations, chercheurs, journalistes) de consommer les signaux agrégés sans lire le code du projet.

- **URL de base** : `https://www.francemonitor.com`
  (le domaine racine `https://francemonitor.com` redirige en 308 vers le sous‑domaine `www` ; les clients qui ne suivent pas les redirections doivent viser directement `www`.)
- **Spécification machine** : [OpenAPI 3.1](https://www.francemonitor.com/openapi.json) → `https://www.francemonitor.com/openapi.json`
- **Format** : JSON (UTF‑8), méthode `GET`, sans authentification.
- **CORS** : ouvert en lecture (`Access-Control-Allow-Origin: *`) — consommable directement depuis un navigateur.

## Avertissement sur la nature des données

Les données proviennent de **sources ouvertes** (RTE/ODRE, NASA FIRMS, ENTSOG, CERT‑FR, HaveIBeenPwned, RansomwareLive, flux RSS de presse, etc.). Un élément remonté par l'API est un **signal, pas un fait confirmé** : il peut être approximatif, retardé, dédoublonné imparfaitement ou géolocalisé grossièrement. Ne l'utilisez pas comme source unique pour une décision critique, et recoupez toujours avec la source amont citée.

L'API est au stade **0.1.0 (expérimental)**. Aucune garantie de stabilité formelle du contrat n'est offerte à ce stade : les schémas de réponse peuvent évoluer. Le code et la spécification sont sous licence **MIT** ; les données restent soumises aux licences de leurs sources amont.

## Endpoints couverts

| Endpoint | Description |
|----------|-------------|
| `GET /api/news` | Fil d'actualités ingéré (presse nationale + régionale), le plus récent d'abord. |
| `GET /api/news/history` | Compteurs d'articles agrégés par tranche temporelle, catégorie et sévérité. |
| `GET /api/health-check` | Santé opérationnelle de la plateforme (cible de sondes de monitoring). |
| `GET /api/situation-history` | Historique de l'indice de situation nationale (créneaux de 6 h). |
| `GET /api/energy/ecowatt` | Mix électrique régional temps réel + échanges aux frontières (source ODRE). |
| `GET /api/energy/gas-pir` | Flux gaziers nets aux points d'interconnexion frontaliers (source ENTSOG). |
| `GET /api/environment/fires` | Détections satellite en France (NASA FIRMS : VIIRS et MODIS) regroupées en foyers, récurrentes à part, et météo des forêts par département. |
| `GET /api/environment/vigilance` | Vigilance Météo-France par département et par phénomène, créneaux, bulletins, historique sur 30 jours. |
| `GET /api/environment/floods` | Tronçons Vigicrues en vigilance et hauteurs des stations (Hub'Eau). |
| `GET /api/environment/drought` | Restrictions d'eau en vigueur par département (VigiEau), comptes par niveau, série quotidienne. |
| `GET /api/environment/air` | Qualité de l'air (Atmo France) : épisodes de pollution de J à J+2 et indice ATMO de J par département. |
| `GET /api/environment/earthquakes` | Séismes des 7 derniers jours en France et à 20 km autour (BCSF-RéNaSS, EMSC en repli). |
| `GET /api/environment/sea-levels` | Hauteurs d'eau des marégraphes du SHOM (19 ports), variation sur 1 h et courbe de 24 h. |
| `GET /api/sovereignty/military` | Aéronefs militaires au-dessus de la France (Données adsb.lol, ODbL 1.0), appareils français en compte par département, urgences confirmées, comptes horaires. |
| `GET /api/sovereignty/cables-watch` | Navires lents près d'un câble télécom sous-marin (AIS du relais, câbles du Shom et d'OpenStreetMap), « à vérifier ». |
| `GET /api/sovereignty/cyber` | Alertes et avis du CERT-FR, vulnérabilités exploitées (CISA), revendications agrégées (Ransomware.live), fuites en .fr (HIBP), Cybermalveillance.gouv.fr. |
| `GET /api/sovereignty/vigipirate` | Relecture quotidienne de la page Vigipirate du SGDSN : date de lecture, empreinte du texte, date du dernier changement ; jamais le texte de la page. |
| `GET /api/sovereignty/gnss` | Précision de position GNSS dégradée (Données adsb.lol, ODbL 1.0) : comptes sans lieu sur 24 h glissantes et sur les deux derniers jours UTC complets, mailles de 0,5° du jour UTC précédent seulement ; météo spatiale de la NOAA (échelles, indice Kp, dernière alerte). Seules la DGAC et l'ANFR qualifient un brouillage. |
| `GET /api/sovereignty/connectivity` | Six grands réseaux français vus ou non par au moins 99 % des routeurs témoins RIPE (RIPEstat), séries sur 30 jours, points d'échange publiés par PeeringDB. |
| `GET /api/sovereignty/sanctions` | Registre national des gels (DG Trésor) : date de publication, comptes par nature, nouveaux gels et radiations ; aucun nom (consulter la dernière version du registre). |

Voir [`/openapi.json`](https://www.francemonitor.com/openapi.json) pour les schémas de réponse complets, champ par champ.

## Exemples

```bash
# 1) Les 5 dernières actualités classées "energy" en sévérité haute ou critique.
#    since/until acceptent l'ISO 8601 ou des millisecondes epoch ; limit est borné à 1000.
curl -s "https://www.francemonitor.com/api/news?category=energy&severity=high,critical&limit=5"

# 2) Le mix électrique régional temps réel (puissances en MW, une ligne par région).
#    La charge utile reprend telle quelle l'enveloppe ODRE : { regional, national }.
curl -s "https://www.francemonitor.com/api/energy/ecowatt"

# 3) La santé opérationnelle de la plateforme (statut ok | degraded | down).
#    Jamais mis en cache : idéal comme cible de sonde de monitoring.
curl -s "https://www.francemonitor.com/api/health-check"
```

## Cache et fraîcheur

Chaque fonction positionne une directive de cache CDN (`s-maxage`) qui reflète sa cadence de rafraîchissement en amont :

| Endpoint | Cadence indicative |
|----------|--------------------|
| `/api/news` | ~1 min |
| `/api/news/history` | ~5 min |
| `/api/sovereignty/military` | 1 min (collecte du serveur toutes les 2 min) |
| `/api/sovereignty/cables-watch` | 2 min (relevé du relais toutes les 5 min) |
| `/api/sovereignty/cyber` | 10 min (CERT-FR relu chaque heure) |
| `/api/sovereignty/vigipirate` | 1 h (page relue chaque jour) |
| `/api/sovereignty/gnss` | 5 min (30 s pendant une collecte en cours ; collecte toutes les 10 min) |
| `/api/sovereignty/connectivity`, `/api/sovereignty/sanctions` | 30 min (1 min pendant une lecture en cours) |
| `/api/energy/ecowatt` | ~15 min |
| `/api/energy/gas-pir` | ~30 min |
| `/api/environment/fires`, `/api/environment/vigilance`, `/api/environment/floods` | 5 min (30 s pendant une collecte ou une lecture en cours) |
| `/api/environment/earthquakes`, `/api/environment/sea-levels` | 5 min |
| `/api/environment/air` | 30 min |
| `/api/environment/drought` | 1 h |
| `/api/health-check`, `/api/situation-history` | jamais mis en cache (`no-store`) |

> **Note :** en sortie de CDN, l'en‑tête `Cache-Control` renvoyé au client peut être normalisé par l'hébergeur (par ex. `public` ou `public, max-age=0, must-revalidate`). Fiez‑vous à la cadence documentée ci‑dessus plutôt qu'à la valeur brute de l'en‑tête. Merci de ne pas interroger un endpoint plus fréquemment que sa cadence : les valeurs n'évoluent pas entre‑temps.

## Codes de statut

- `200` — succès. Certains endpoints (`/api/energy/gas-pir`, `/api/health-check`) renvoient `200` même en cas de dégradation, avec un champ `status` à inspecter.
- `400` — paramètre invalide (`/api/news`, `/api/news/history`, `/api/situation-history`).
- `405` — méthode non autorisée (seul `GET` est accepté sur les endpoints de lecture).
- `500` / `502` — erreur d'un service amont proxifié.
- `503` — dépendance interne (base d'ingestion) non configurée ou indisponible.
