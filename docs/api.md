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
| `GET /api/fires` | Feux actifs détectés par satellite (NASA FIRMS VIIRS), emprise France. |
| `GET /api/threats` | Fuites de données et incidents cyber cartographiés en France. |

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
| `/api/threats` | ~10 min |
| `/api/energy/ecowatt` | ~15 min |
| `/api/energy/gas-pir` | ~30 min |
| `/api/fires` | ~1 h (FIRMS se met à jour toutes les ~3 h) |
| `/api/health-check`, `/api/situation-history` | jamais mis en cache (`no-store`) |

> **Note :** en sortie de CDN, l'en‑tête `Cache-Control` renvoyé au client peut être normalisé par l'hébergeur (par ex. `public` ou `public, max-age=0, must-revalidate`). Fiez‑vous à la cadence documentée ci‑dessus plutôt qu'à la valeur brute de l'en‑tête. Merci de ne pas interroger un endpoint plus fréquemment que sa cadence : les valeurs n'évoluent pas entre‑temps.

## Codes de statut

- `200` — succès. Certains endpoints (`/api/energy/gas-pir`, `/api/health-check`) renvoient `200` même en cas de dégradation, avec un champ `status` à inspecter.
- `400` — paramètre invalide (`/api/news`, `/api/news/history`, `/api/situation-history`).
- `405` — méthode non autorisée (seul `GET` est accepté sur les endpoints de lecture).
- `500` / `502` — erreur d'un service amont proxifié.
- `503` — dépendance interne (base d'ingestion) non configurée ou indisponible.
