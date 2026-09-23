# Audit d'infrastructure France Monitor — qui fait quoi (Vercel, Railway, Render, GitHub, Upstash, Neon, navigateur)

Date : 22 septembre 2026. Aucun code ni configuration modifié.

**Méthode.** Lecture du dépôt (`vercel.json`, `api/**`, `services/**`, `.github/workflows`, `ais-relay.js`, `vite.config.ts`, `.env.example`, noms des variables locales sans leurs valeurs), CLI `railway` et `gh` (tous deux connectés sur ce poste), sondes HTTP en production (`/api/health-check`, manifeste radar, `/health` du worker Railway, `/health` et `/opensky` du relais Render, historique de situation, séries carburants, dernier bundle de production pour vérifier l'absence de clés).

**Ce qui n'a pas pu être vérifié d'ici** (et comment le faire, §5) : le dashboard Vercel (plan, variables réelles, usage, journaux des crons), les consoles Render, Upstash et Neon (plans, quotas consommés), la facturation Railway. Le dépôt GitHub est **public** : aucune valeur de secret ne figure dans ce document.

---

## 0. Vue d'ensemble

```
                         ┌──────────────────────── NAVIGATEUR de chaque visiteur ────────────────────────┐
                         │ bundle Vite + service worker · classification mots-clés · worker ML · géocodage│
                         │ écrit l'historique de situation (POST par créneau de 6 h) · WebSocket AIS      │
                         └──────┬──────────────────┬──────────────────────┬──────────────────────┬────────┘
                                │ HTTPS            │ WSS                  │ HTTPS (rasters)      │ HTTPS direct
                                ▼                  ▼                      ▼                      ▼
   ┌────────────────────────────────┐  ┌────────────────────┐  ┌───────────────────────┐   Hub'Eau · ODRE · EDF opendata
   │ VERCEL — projet france-monitor │  │ RENDER             │  │ RAILWAY               │   Enedis · geo.api.gouv.fr
   │ CDN (cdg1) + fonctions (fra1)  │  │ france-monitor     │  │ projet radar-worker   │   api-adresse (BAN) · data.gouv
   │ statique + 55 fonctions        │  │ = ais-relay.js     │  │ FastAPI + volume 5 Go │   Carto (tuiles) · NOAA · RainViewer
   │ cron news 30 min · cron        │  │ WS ← aisstream.io  │  │ boucle interne 5 min  │
   │ carburants 3 h                 │  │ GET /opensky (10 s)│  │ ← Météo-France DPRadar│
   └──┬───────┬───────┬───────┬─────┘  └─────────▲──────────┘  └──────────▲────────────┘
      │       │       │       │                  │ si AIR_RELAY_URL         │ POST /refresh (filet)
      ▼       ▼       ▼       ▼                  │                          │
   Upstash   Neon    Groq   ≈ 40 API publiques ──┘              GitHub Actions : cron « */5 » (réel : 3–6 h)
   Redis     Postgres LLM   (RTE, ODRE, Météo-France,           + CI lint/typecheck/test/build
   cache ·   news 90 j ·    FIRMS, SNCF, TomTom, CERT-FR…)      + déploiement Vercel à chaque push sur main
   verrous · snapshots      résumés, brief, synthèse
   historique
```

Résumé en une phrase : **Vercel héberge le site et fait office de proxy/cache vers une quarantaine d'API publiques ; Railway fait le seul vrai calcul lourd (radar Météo-France) ; Render tient le relais AIS temps réel ; GitHub déploie et sert de filet au radar ; Upstash et Neon stockent ; le navigateur de chaque visiteur fait le reste (classification, géocodage, historique).**

---

## 1. Qui fait quoi, plateforme par plateforme

### 1.1 Vercel — projet `france-monitor` (espace `fraidfraid`), fonctions en `fra1`, CDN observé en `cdg1`

| Rôle | Détail | Où est la configuration |
|---|---|---|
| Hébergement statique | `dist/` de Vite : `index.html` + assets hashés + service worker (précache de 78 entrées) + pages `about/methodology/legal/contact/docs` ; rewrites SPA ; CSP et en-têtes de sécurité | `vercel.json` (rewrites, headers), `vite.config.ts` (PWA) |
| API `/api/*` | **55 fonctions** : 10 en runtime Edge (`rss`, `rss-proxy`, `json-proxy`, `oil-proxy`, `fuel-prices-proxy`, `exposure`, `threats`, `intelligence/v1/*` ×3) et 45 en Node. Rôle : proxy vers ≈ 40 API publiques, normalisation, cache CDN (`s-maxage`) et Redis, isolation des clés | `api/**` ; `vercel.json` → `functions.maxDuration` (300 s ingest, 30 s finance/transport/threats/exposure) |
| Cron n° 1 | `POST /api/ingest/news` **toutes les 30 min** : 38 flux RSS → Neon `news_items`, classification mots-clés + Groq (≤ 15 articles/tick), géocodage (≤ 30/tick), purge > 90 j, verrou Redis 280 s, statistiques dans Redis `ingest:last-tick` | `vercel.json` (`crons`), secret `CRON_SECRET` |
| Cron n° 2 | `/api/fuel-price-series-refresh` **toutes les 3 h** : agrège data.economie.gouv.fr → Redis `francemonitor:fuel-price-series:v1`, servi par `/api/fuel-price-series` | idem |
| Déploiement | Intégration Git : chaque push sur `main` produit un déploiement « Production » (dernier : 27/07/2026, commit `1ef47a0`, identique au `version.json` servi en prod). Le CLI `vercel` mentionné dans `docs/deployment.md` n'est pas installé sur ce poste | dashboard Vercel |
| Variables attendues par le code | `UPSTASH_REDIS_REST_URL/TOKEN`, `DATABASE_URL`, `CRON_SECRET`, `RTE_CLIENT_ID/SECRET`, `METEO_FRANCE_API_KEY`, `METEO_FRANCE_RADAR_MANIFEST_URL`, `TOMTOM_API_KEY`, `OPENSKY_CLIENT_ID/SECRET`, `SNCF_API_KEY`, `NASA_FIRMS_API_KEY`, `CDSE_*`/`COPERNICUS_*`, `SHODAN_API_KEY`, `CENSYS_*`, `CLOUDFLARE_RADAR_TOKEN`, `GROQ_API_KEY`, `VITE_AIS_RELAY_URL` (inlinée au build : `wss://france-monitor.onrender.com`), `AIR_RELAY_URL` ou `WS_RELAY_URL` (optionnel), `SENTINEL_*` | dashboard Vercel — **non vérifiable d'ici** |

Observé le 22/09 : site et API en service ; dernier tick d'ingestion à 10:30:48 (38 flux, 109 articles insérés, 3,9 s, 1 flux en erreur 403 : `le-figaro`) ; **≈ 2 600 articles/jour** insérés (de 1 659 à 3 175 sur les sept derniers jours).

Anomalies propres à Vercel :

- **`/api/health-check` répond `status: "down"` en fonctionnement normal.** Son seuil est de 15 min (`OK_TICK_MAX_MS`, `api/health-check.js:18`) alors que le cron est passé à 30 min le 27/07 (commit `84a2c81`). Toute sonde branchée dessus est en alerte la moitié du temps ; le signal de santé est donc inutilisable aujourd'hui.
- **Deux routes appelées par le client n'ont aucun handler en production** et renvoient le HTML de `index.html` (repli SPA) : `/api/ministers/*` (9 appels, panneau Gouvernement mort) et `/api/gie/agsi` + `/api/gie/alsi` (`src/services/gas.ts:181,303`, stockages gaz GIE, panneau Gaz actif par défaut). Dans les deux cas la logique n'existe que dans un plugin Vite de développement (`src/plugins/ministers-proxy.ts`, `src/plugins/gie-proxy.ts`) : **ça marche sur le poste du développeur et pas en prod**, sans erreur visible.
- `/api/energy/biogas-sites` répond 502 ; `/api/arcep` 404 quatre fois par chargement (date non encore publiée).
- Les assets hashés sont servis avec `cache-control: public, max-age=0, must-revalidate` (aucune règle de cache statique dans `vercel.json`).
- **Plan** : d'après la documentation Vercel, un plan Hobby limite les crons à 2 par projet et à une exécution par jour ; la cadence 30 min observée implique un plan payant (Pro, 20 $/utilisateur/mois) ou une exception. À confirmer sur le dashboard.

### 1.2 Railway — projet `radar-worker`, environnement `production`

| Rôle | Détail |
|---|---|
| Service `radar-worker` | Conteneur Docker (`python:3.12-slim` + `libeccodes`, FastAPI/uvicorn sur le port 8091, entrypoint root → `setpriv` 65532) ; statut **Online** ; domaine public `radar-worker-production-0c93.up.railway.app` (également dans le workflow GitHub public, donc non secret) |
| Volume | `radar-worker-volume` monté sur `/data` : **428 Mo utilisés / 5 Go** (BUFR validés + rasters WebP, rétention 24 fichiers chacun par défaut) |
| Travail | Boucle interne toutes les 300 s (`RADAR_REFRESH_INTERVAL_SECONDS` non défini → défaut) : découverte du dernier produit IMFR27 sur DPRadar (Météo-France, clé `METEO_FRANCE_RADAR_API_KEY`), téléchargement (≈ 350 Mo), décodage `bufr_bitstream` (0,2 s), rendu réflectivité + sommets d'écho → `manifest.json` + `rasters/*.webp` ; refresh complet ≈ 5 s |
| Endpoints | publics : `GET /health`, `GET /manifest.json`, `GET /rasters/<fichier>.webp`, `GET /volume/column?lat&lon` (profil vertical 3D, démonstration) ; authentifiés (`Authorization: Bearer RADAR_WORKER_TOKEN`) : `POST /refresh`, `POST /publish` |
| Variables | applicatives : `METEO_FRANCE_RADAR_API_KEY`, `RADAR_WORKER_TOKEN`, `RADAR_STORAGE_DIR`, `RADAR_PUBLIC_BASE_URL` (+ 14 variables système Railway) ; `RADAR_RAW_RETENTION` / `RADAR_RASTER_RETENTION` non définies (défaut 24) |
| Consommateurs | Vercel `api/fire-observations/radar-2d.js` et `radar-column.js` (via `METEO_FRANCE_RADAR_MANIFEST_URL`, cache CDN 120 s) → client ; **le navigateur télécharge les rasters directement sur Railway** (`imageUrl` et `echoTopImageUrl` du manifeste pointent sur le domaine Railway) |
| Déploiement | `railway up` depuis `services/radar-worker` ; **aucun fichier `railway.json`/`railway.toml` dans le dépôt** : port du domaine, volume et variables ont été configurés à la main (cf. mémoire projet : `railway domain update --port 8091`, `chown` du volume) ; tests Python en CI GitHub |
| Observé | `/health` → `status ok`, `lastSuccessfulObservation` 10:45Z pour une sonde à 10:49 ; manifeste `observedAt` 10:40Z, `generatedAt` 10:45:19Z. Chaîne saine |
| Non vérifié | plan et coût (le CLI n'expose pas la facturation) ; un **second projet Railway `proactive-enjoyment`** existe dans l'espace de travail, contenu inconnu |

### 1.3 Render — service `france-monitor` (`https://france-monitor.onrender.com`)

| Rôle | Détail |
|---|---|
| Programme | `ais-relay.js` à la racine du dépôt (Node, dépendances `ws` et `vite` — ce dernier seulement pour `loadEnv` — et `api/_shared/air-traffic.js`) |
| Fonction 1 : relais AIS | Une connexion amont vers `wss://stream.aisstream.io/v0/stream` (clé `AISSTREAM_API_KEY`), 12 zones (Manche, Atlantique, Méditerranée, Corse, Antilles, Guyane, Réunion, Mayotte, Saint-Pierre-et-Miquelon, Wallis, Polynésie, Nouvelle-Calédonie) réparties en 3 abonnements, rediffusée à tous les navigateurs connectés (389 navires observés) ; disjoncteur après 5 échecs, 5 min |
| Fonction 2 : `GET /opensky` | Instantané du trafic aérien civil (airplanes.live, 5 zones ; repli OpenSky si identifiants) recalculé **à chaque appel, sans cache** : 10,3 à 11 s mesurés. Utilisé par Vercel `/api/traffic/air` si `AIR_RELAY_URL` ou `WS_RELAY_URL` est défini ; sinon Vercel appelle airplanes.live lui-même, pour la même durée. C'est l'origine des 10,5 s vus par les visiteurs |
| Fonction 3 : `GET /health` | `{ ok: true, ais: true, opensky: false }` → identifiants OpenSky absents sur Render |
| Configuration | **hors dépôt** (pas de `render.yaml`) : commande de démarrage, `AISSTREAM_API_KEY`, port ; non vérifiable d'ici |
| Consommateurs | navigateur (`VITE_AIS_RELAY_URL` inlinée dans le bundle Vercel), Vercel (optionnel, voir ci-dessus) |
| Observé | en ligne, `/health` en 0,12 s |
| Risques | si le service est sur le palier gratuit : mise en veille après 15 min sans requête HTTP et 750 h/mois, ce qui est le pire cas pour un relais temps réel (démarrage à froid de 30 à 60 s à la première connexion) ; une seule instance = point unique de panne du layer maritime et, éventuellement, du trafic aérien |

### 1.4 GitHub — dépôt public `FraidFraid/France-Monitor`

| Rôle | Détail |
|---|---|
| CI (`ci.yml`) | sur push/PR `main` : lint, typecheck, `vitest`, build ; job Python : tests du worker radar. Derniers runs : 27/07 (succès) |
| Cron « Radar refresh » (`radar-refresh.yml`) | planifié `*/5 * * * *`, **exécuté en réalité toutes les 3 à 6 h** (8 runs entre le 20/09 23:36 et le 22/09 06:06 — dérive connue du planificateur GitHub sur les dépôts peu actifs). Fait un `POST /refresh` sur Railway avec le secret `RADAR_WORKER_TOKEN`, puis vérifie `lastSuccessfulObservation` < 20 min. **Filet de sécurité uniquement** : la boucle interne du worker fait le vrai travail |
| Déploiements | l'intégration Vercel crée un déploiement GitHub « Production » à chaque push (5 derniers : 27/07) |
| Secrets | `RADAR_WORKER_TOKEN` |
| Attention | dépôt **public** : tout fichier commité est visible ; les audits n'y mettent aucune valeur de secret |

### 1.5 Upstash Redis

Rôle : cache de réponses (13 fichiers `api/` : finance ×2, séries carburants, `intelligence/v1/*` ×3, limitation de débit des 4 proxys génériques…), verrou anti-chevauchement du cron d'ingestion, `ingest:last-tick`, **historique de situation** (`SET NX` par créneau de 6 h, TTL 31 j, index `RPUSH`/`LTRIM`). Configuration : `UPSTASH_REDIS_REST_URL/TOKEN` sur Vercel uniquement — absentes en local, donc **en développement tous ces caches sont inactifs** (`api/utils/redis.js` renvoie `null` sans erreur). Non vérifié : plan, commandes par jour. Ordre de grandeur : plusieurs dizaines de commandes par chargement de dashboard (une lecture/écriture par MISS CDN) — à comparer au quota du palier gratuit sur la console.

### 1.6 Neon Postgres (projet `neon-teal-pocket`, eu-central-1)

Tables `feeds`, `news_items`, `situation_snapshots` (schéma dans `scripts/init-db.mjs`). Écriture : cron d'ingestion Vercel (≈ 2 600 articles/jour, purge > 90 j → **≈ 230 000 lignes en régime permanent**). Lecture : `/api/news` (chaque visiteur, le cache CDN étant contourné aujourd'hui par `since=`), `/api/news/history`, `/api/health-check`. Configuration : `DATABASE_URL` sur Vercel uniquement (absente en local : `/api/news` répond 503 en dev sans le plugin). Non vérifié : plan, stockage utilisé, heures de calcul. Estimation : 150 à 350 Mo pour `news_items` et ses trois index, à rapprocher de la limite du palier gratuit (0,5 Go) ; la mise en veille automatique du calcul explique une partie des 4,7 s observées sur `/api/news` à froid.

### 1.7 Groq (LLM cloud, clé serveur)

Appelé uniquement depuis Vercel : cron d'ingestion (reclassification, ≤ 15 articles par tick, appels séquentiels, arrêt de la passe au premier 429), `intelligence/v1/summarize` (un appel par article **et par visiteur**, cache Redis 24 h par texte), `synthesis` (cache 15 min, appel sans timeout), `france-intel-brief` (cache 6 h). Un seul quota gratuit partagé entre ces quatre usages. Aucune clé côté client : le bundle de production a été vérifié (aucune clé Groq, TomTom ou Météo-France inlinée ; seule l'URL publique du relais AIS l'est).

### 1.8 Le navigateur fait aussi partie de l'infrastructure

- **Calcul** : classification mots-clés de tout ce qui n'est pas classé serveur, classificateur ML dans un Web Worker (Transformers.js, modèle ≈ 100 Mo téléchargé à la demande), résumés T5 de secours, moteur de situations, score de stabilité, ISNR, clustering des news et des feux.
- **Réseau direct (hors Vercel)** : Hub'Eau, ODRE, Enedis, EDF opendata (DROM), geo.api.gouv.fr, api-adresse (BAN), data.gouv.fr, NOAA SWPC, RainViewer, tuiles Carto, rasters Railway, WebSocket Render.
- **Écriture** : l'historique de situation (`POST /api/situation-history`) est envoyé par le navigateur du premier visiteur de chaque créneau de 6 h (`src/services/situation-history.ts:82-98`). Résultat observé sur 7 jours : **7 créneaux capturés sur 28, 21 manquants**. Aucun cron serveur ne s'en charge.

### 1.9 En local, manuel, ou vestige

- Développement : `npm run dev` (Vite + 45 plugins proxy qui miment les fonctions), `npm run dev:full` (+ `scrapling-proxy` Python sur le port 8080, **dev uniquement — non déployé en production** malgré les options Cloud Run/Lambda de son README), relais AIS local par plugin Vite, worker radar local (`radar:dev`, 8091), Ollama (`VITE_USE_OLLAMA`).
- Scripts manuels produisant des fichiers statiques commités dans `public/data` : `build:maires`, `build:fuel-price-series`, `ingest:drom-energy`, `generate:apl-snapshot` ; `db:init` (schéma Neon) ; `generate:server-libs` et `sync:feeds` (copies serveur du classifieur, du géocodeur et de la liste des flux — **aucune vérification CI de leur fraîcheur**).
- Vestige : `netlify.toml` (fonctions Netlify sur `api/`) — aucun indice d'un déploiement Netlify actif ; à supprimer ou à documenter.

---

## 2. Flux de données de bout en bout

| Domaine | Source amont | Qui collecte / calcule | Stockage / cache | Servi par | Consommé par |
|---|---|---|---|---|---|
| Actualités | 38 flux RSS | Vercel cron 30 min (`ingest/news.ts`) ; complété dans le navigateur (classification, géocodage, résumés) | Neon 90 j ; CDN 60 s ; `localStorage` 30 min | `/api/news`, `/api/news/history` (+ `/api/rss`, `/api/rss-proxy` en repli) | flux sous la carte, clusters, alertes, score, brief |
| Radar météo 2D / 3D | Météo-France DPRadar (IMFR27, PAM) | **Railway**, boucle 5 min (+ cron GitHub best-effort) | volume Railway | Railway (manifeste, rasters, colonne) via proxy Vercel 120 s | FiresPanel, couche radar |
| AIS maritime | aisstream.io | **Render** `ais-relay.js` (un abonnement amont partagé) | aucun (temps réel) | WebSocket Render | couche maritime, MaritimePanel, anomalies AIS (calcul navigateur) |
| Trafic aérien civil | airplanes.live / OpenSky | Render `/opensky` ou Vercel en direct, 10 s, sans cache serveur | CDN 20 s (contourné par `?t=`) | `/api/traffic/air` | couche trafic aérien (polling 12 s) |
| Vols militaires | adsb.fi / OpenSky filtré | Vercel `traffic/military.js` | CDN 30 s | `/api/traffic/military` | polling 5 s navigateur, DefensePanel |
| Carburants | data.economie.gouv.fr | Vercel cron 3 h | Redis ; CDN 15 min | `/api/fuel-price-series`, `/api/fuel-prices-proxy` | OilPanel, tension carburants |
| Historique de situation | calcul navigateur (score, situations) | **le navigateur** (POST par créneau de 6 h) | Redis 31 j | `/api/situation-history` | SituationHistoryPanel, brief |
| Résumés / brief / synthèse IA | Groq | Vercel Edge `intelligence/v1/*` | Redis 24 h / 6 h / 15 min | `POST /api/intelligence/v1/*` | flux news, FranceIntelPanel, ISNR |
| Énergie (Écowatt, éco2mix, IIP, nucléaire, gaz, éolien, biogaz, DROM) | RTE, ODRE, ENTSOG, GRDF, EDF, BRGM, GIE | Vercel à la demande (+ appels directs du navigateur vers ODRE/EDF) ; **GIE : aucun handler en prod** | CDN 5 à 60 min (pas de Redis) | `/api/energy/*`, `/api/rte-iip`, `/api/nuclear/*`, `/api/gie/*` (mort) | EnergyPanel, GasPanel, EolienPanel… |
| Météo / crues / hydrométrie | Météo-France vigilance, Vigicrues, Hub'Eau | Vercel `weather/vigilance.js` ; Vigicrues via `json-proxy` ; **Hub'Eau appelé directement par le navigateur** (25 appels) | CDN 5 min | `/api/weather/vigilance`, `/api/json-proxy` | EnvironmentPanel, HydraulicPanel |
| Santé (10 endpoints) | DREES, SPF, ANSM, Sentiweb, ODISSE, data.gouv | Vercel `health/*` (helper commun, timeout 12 s) | CDN 15 min à 6 h | `/api/health/*` | NationalHealthPanel, HealthBarometer |
| Cyber / exposition / infra réseau | CERT-FR, ransomware.live, NVD, HIBP, Shodan, Censys, IODA, BGPView, PeeringDB, statuspages | Vercel `threats.js` (Edge), `exposure.js`, `internet-outages.js`, `infra-network.js`, `arcep.js`, `json-proxy.js` | CDN 5 à 30 min | idem | CyberPanel, carte des menaces, OutagesPanel |
| Feux | NASA FIRMS, IPMA (MTG FRP) | Vercel `fires.js`, `mtg-frp.js` ; **géo-résolution des incidents dans le navigateur** (88 appels geo.api.gouv.fr) | CDN 1 h / 2 à 10 min | `/api/fires`, `/api/fire-observations/*` | FiresPanel, alertes grands feux, dossier (enrichi par Ollama en local seulement) |
| Finance | TradingView, Yahoo | Vercel `finance/*` | Redis 15 min + CDN 15 min | `/api/finance/*` | MarketStrip, CommodityStrip |
| Satellite | Copernicus CDSE, AWS Earth Search, NASA GIBS | Vercel `copernicus.js`, `sentinel-ndwi.ts` (cache mémoire 15 min, non partagé entre instances) ; GIBS appelé par le navigateur | CDN 10 min | idem | SentinelModal, couche imagerie |
| Gouvernement / ministres | Wikidata, Assemblée nationale, Élysée | **aucun handler en prod** (logique câblée au dev seulement) | — | `/api/ministers/*` → `index.html` | MinistresPanel (mort en prod) |

---

## 3. Où vit la configuration

| Variable | Vercel | Railway | Render | GitHub | Poste local (`.env`, `.env.local`) |
|---|---|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | requis | | | | absent (caches désactivés en dev) |
| `DATABASE_URL` (Neon) | requis | | | | absent (`/api/news` 503 en dev) |
| `CRON_SECRET` | requis | | | | absent |
| `RTE_CLIENT_ID` / `_SECRET` | requis | | | | présent |
| `METEO_FRANCE_API_KEY` | requis | | | | absent (`VITE_METEOFRANCE_API_KEY` dépréciée présente) |
| `METEO_FRANCE_RADAR_MANIFEST_URL` | requis | | | | `.env.local` |
| `METEO_FRANCE_RADAR_API_KEY` | | requis | | | présent |
| `RADAR_WORKER_TOKEN` | | requis | | secret | `.env.local` |
| `RADAR_STORAGE_DIR`, `RADAR_PUBLIC_BASE_URL` | | requis | | | `.env.local` |
| `RADAR_REFRESH_INTERVAL_SECONDS`, `RADAR_*_RETENTION` | | non définis (défauts 300 s / 24) | | | |
| `AISSTREAM_API_KEY` | | | requis | | `VITE_AISSTREAM_KEY` (dev) |
| `VITE_AIS_RELAY_URL` | requis au build (inlinée) | | | | absent (dev = `ws://localhost:8090`) |
| `AIR_RELAY_URL` / `WS_RELAY_URL` | optionnel (inconnu) | | | | absent |
| `OPENSKY_CLIENT_ID` / `_SECRET` | optionnel | | absent (`opensky:false`) | | présent |
| `TOMTOM_API_KEY` | requis (trafic routier) | | | | absent (`VITE_TOMTOM_API_KEY` dépréciée présente) |
| `SNCF_API_KEY`, `NASA_FIRMS_API_KEY`, `CDSE_*`, `SHODAN_API_KEY`, `CENSYS_*`, `CLOUDFLARE_RADAR_TOKEN`, `SENTINEL_*` | optionnels | | | | présents |
| `GROQ_API_KEY` | optionnel | | | | présent (+ `VITE_GROQ_API_KEY` dépréciée présente : ne jamais la définir sur Vercel) |
| `VITE_ENABLE_CYBER_PANEL` / `_GAS_PANEL` / `_OIL_LAYER` | non définis → **actifs** | | | | non définis |

Trois variables `VITE_*` dépréciées traînent dans le `.env` local ; le bundle de production ne contient aucune clé, elles ne sont donc pas définies sur Vercel, mais elles seraient inlinées si quelqu'un les y copiait.

---

## 4. Constats, par ordre d'importance

1. **Monitoring aveugle.** `/api/health-check` est en « down » une partie de chaque demi-heure à cause d'un seuil (15 min) non mis à jour après le passage du cron à 30 min. Rien d'autre ne surveille Railway ni Render.
2. **L'historique de situation dépend des visiteurs.** 21 créneaux sur 28 manquent sur les 7 derniers jours : le seul « cron » est le navigateur du premier visiteur du créneau.
3. **Deux fonctionnalités mortes en production sans erreur visible** : ministres (`/api/ministers/*`) et stockages gaz GIE (`/api/gie/*`), toutes deux implémentées seulement en plugin Vite de développement. Plus `biogas-sites` en 502. Aucun test de fumée sur la prod ne les aurait attrapées.
4. **Trafic aérien à 10 s** pour tout le monde : le relais Render recalcule à chaque appel, sans cache ; le client contourne le cache CDN avec `?t=`.
5. **Render héberge un service temps réel** sur un palier probablement gratuit (mise en veille), avec une configuration entièrement hors dépôt.
6. **Le cron GitHub « */5 » tourne toutes les 3 à 6 h.** Acceptable tant qu'il n'est qu'un filet ; ne jamais lui confier une tâche primaire.
7. **Configuration hors dépôt et non documentée** : Railway (port, volume, variables), Render (commande, variables), Vercel (variables, plan). `docs/deployment.md` ne mentionne ni Railway, ni Render, ni Neon, ni GitHub Actions, ni les crons ; le README dit encore « cron 5 min » à trois endroits, `api/ingest/news.ts:2` aussi, `docs/design-alertes-grands-feux-2026-07.md` dit 15 min.
8. **Coûts et quotas invisibles d'ici** : Vercel (plan Pro probable), Railway (service permanent + volume), Render, Upstash (commandes), Neon (0,5 Go, calcul). Un dépassement de palier gratuit serait silencieux.
9. **Le navigateur appelle des tiers directement** (Hub'Eau, ODRE, EDF, geo.api, BAN, NOAA…) : pas de cache partagé, quotas tiers consommés par visiteur, règle du dépôt non respectée.
10. **Copies générées non contrôlées** (`api/_lib/server-classifier.js`, `feeds-snapshot.js`, `server-geocoder.js`) : le serveur et le client peuvent classer différemment sans que la CI le voie.
11. Vestige `netlify.toml` ; second projet Railway `proactive-enjoyment` non identifié.
12. Secrets : rien d'inliné dans le bundle de production (vérifié) ; trois `VITE_*` dépréciées dans `.env` local à supprimer.

---

## 5. Ce qui reste à vérifier, et comment

| Point | Où / comment | Pourquoi |
|---|---|---|
| Plan Vercel, variables réelles, usage (invocations, GB-h, bande passante), journaux des crons | `npm i -g vercel && vercel login && vercel link` puis `vercel env ls` (noms seulement) ; dashboard → Usage, Logs → Cron ; ou authentifier le connecteur Vercel de cette session | confirmer le plan (cron 30 min), vérifier l'absence de `VITE_GROQ_API_KEY` & co, mesurer le coût des 30 invocations par visiteur |
| Facturation et plan Railway | dashboard Railway → Billing (le CLI ne l'expose pas) ; `railway logs` pour les journaux du worker | connaître le coût réel du service permanent et du volume |
| Contenu du projet Railway `proactive-enjoyment` | dashboard Railway | vestige à supprimer ou service à documenter |
| Plan et configuration Render | dashboard Render → service `france-monitor` → Settings, Environment, Events | savoir si le relais se met en veille ; récupérer la commande de démarrage et la liste des variables |
| Quota Upstash | console Upstash → Commands/day, storage | vérifier la marge du palier gratuit |
| Stockage et calcul Neon | console Neon ou `neonctl` | volume de `news_items` face aux 0,5 Go ; heures de calcul |
| Configuration effective de `/api/traffic/air` (relais ou direct) | `vercel env ls` → présence de `AIR_RELAY_URL` / `WS_RELAY_URL` | savoir où mettre le cache |

---

## 6. Recommandations d'infrastructure (avant les chantiers de performance)

1. **Rendre le monitoring vrai** : seuil du health-check à 45 min (ou lu depuis la cadence du cron) ; une sonde externe gratuite (UptimeRobot ou équivalent) sur trois URL : `/api/health-check`, Railway `/health`, Render `/health` ; un workflow GitHub quotidien de fumée qui vérifie que `/api/ministers/composition`, `/api/gie/agsi`, `/api/energy/biogas-sites` et une dizaine d'endpoints clés renvoient du JSON (aurait détecté les trois routes mortes).
2. **Historique de situation côté serveur** : un cron Vercel toutes les 6 h qui calcule et stocke le snapshot (le score v3 est une fonction pure, déjà dupliquée en partie dans `api/intelligence/v1/france-intel-brief.js`), le navigateur ne faisant plus que lire.
3. **Créer les handlers manquants** (`api/ministers/[...path].js`, `api/gie/agsi.js`, `api/gie/alsi.js`) avec cache, sur le modèle des plugins de dev, ou retirer les appels ; réparer `biogas-sites`.
4. **Trafic aérien** : cache Redis 20 à 30 s côté relais et côté Vercel ; retirer `?t=` du client (voir audit précédent).
5. **Mettre la configuration dans le dépôt** : `render.yaml` (Blueprint : commande, health check, variables attendues), `railway.toml` (port, health check, volume), et une section « topologie » dans `docs/deployment.md` reprenant ce document ; corriger README et commentaires (« 30 min »).
6. **Décider du sort de Render** : soit assumer le palier gratuit (documenter la mise en veille), soit déplacer le relais AIS comme second service du projet Railway existant (une seule plateforme, pas de mise en veille, coût à comparer) — décision à prendre au regard de la règle « paliers gratuits uniquement ».
7. **Nettoyage** : supprimer `netlify.toml`, les `VITE_*` dépréciées du `.env` local, et clarifier le projet Railway inconnu.
8. **Vérifier les paliers** (§5) avant les chantiers de performance : la réduction des invocations Vercel proposée dans l'audit précédent (cache CDN respecté, snapshot) est aussi une mesure de coût.

---

## 7. Réduire la facture (≈ 25 €/mois → ≈ 5 €/mois, puis 0 € si souhaité)

Hypothèse de facture actuelle (à confirmer sur vos relevés) : **Vercel Pro 20 $/mois (≈ 18,5 €) + Railway Hobby 5 $/mois (≈ 4,6 €)** ≈ 23 € hors taxes. Render, Upstash, Neon, GitHub et Groq sont sur des paliers gratuits.

### 7.1 Ce qui oblige à payer Vercel Pro aujourd'hui

Une seule chose : **la cadence des crons**. Documentation Vercel (vérifiée le 22/09) : sur Hobby, 100 crons par projet mais **une exécution par jour au maximum**, précision à l'heure (±59 min), et « les expressions cron plus fréquentes font échouer le déploiement ». Le cron d'ingestion (30 min) et celui des carburants (3 h) sont donc incompatibles avec Hobby tels quels.

Deux choses, en réalité. La seconde est le **plafond de fonctions par déploiement** : la page « Limits » de Vercel indique pour Hobby « Functions created per deployment : framework-dependent » ; pour un projet Vite avec un dossier `api/` (une fonction par fichier), c'est la règle historique « No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan », toujours en vigueur en 2026 (forum Vercel, discussions GitHub). France Monitor déploie **55 fonctions** (59 en comptant `api/utils/*.js`, que Vercel transforme aussi en fonctions) : un déploiement Hobby est donc refusé tel quel. C'est ce qui a imposé Pro.

Rien d'autre n'exige Pro : une seule personne, usage non commercial (le fair use Hobby interdit l'usage commercial — à revoir le jour où France Monitor serait vendu), région `fra1` autorisée, `maxDuration` 300 s et 2 Go de mémoire disponibles avec Fluid Compute (actif par défaut sur ce projet), runtime Edge disponible.

**Levier pour le plafond de fonctions : une seule fonction « attrape-tout ».** Déplacer les 55 handlers dans `api/_handlers/**` (les dossiers préfixés `_` ne créent pas de fonction) et créer `api/[...path].ts`, un routeur qui importe dynamiquement le handler demandé (`{ 'news': () => import('./_handlers/news.js'), … }`) et lui passe `req`/`res` tels quels ; un adaptateur de 40 lignes convertit `req` en `Request` pour les 10 handlers écrits en style Edge (`Request → Response`) afin de ne pas les réécrire. Une seule entrée `functions` dans `vercel.json` (`maxDuration: 300`), les rewrites identité `/api/x → /api/x` disparaissent, le repli SPA reste (le système de fichiers, donc la fonction, est consulté avant les rewrites). Les plugins Vite de dev ne changent pas. Effet secondaire bienvenu : un seul bundle, démarrages à froid moins nombreux, imports paresseux par route. Effort ≈ 1 jour, vérification par un déploiement de prévisualisation (branche) puis test des 55 routes.

Usage inclus sur Hobby : 1 M d'invocations, 4 h de CPU actif, 360 Go-h de mémoire, 100 Go de transfert, 1 M de requêtes edge par mois. Pour votre trafic, seuls deux postes méritent attention : le transfert (la page d'accueil pèse 28 Mo → 100 Go = 3 500 visites de l'accueil par mois) et les invocations (≈ 30 par chargement de dashboard tant que `since=`/`?t=` contournent le cache CDN). Les deux correctifs sont déjà en P0 de l'audit de performance.

### 7.2 Solution recommandée : Vercel Hobby + Railway conservé (≈ 4,6 €/mois, −80 %)

| Étape | Quoi | Effort |
|---|---|---|
| 0 | **Regrouper les 55 fonctions en une seule** (`api/[...path].ts` + `api/_handlers/`, voir 7.1) et vérifier sur un déploiement de prévisualisation que les 55 routes répondent | 1 jour |
| 1 | **Sortir le cron d'ingestion de Vercel.** Planificateur externe gratuit : **Upstash QStash** (même compte que Redis ; palier gratuit 1 000 messages/jour, 10 planifications ; ici 48 messages/jour). Une planification `*/30 * * * *` qui fait `POST https://www.francemonitor.com/api/ingest/news` avec l'en-tête `Authorization: Bearer <CRON_SECRET>`. Le handler exige déjà ce Bearer : **aucun changement de code**. Alternative sans nouveau service : le worker Railway, déjà permanent, fait ce POST toutes les 30 min (une tâche asyncio d'une dizaine de lignes, variables `FM_INGEST_URL` + `FM_CRON_SECRET`). À éviter : le cron GitHub (observé : une exécution toutes les 3 à 6 h au lieu de 5 min) | 15 min (dashboard) |
| 2 | **Passer les carburants à une fois par jour** : la donnée amont est quotidienne (`updatedAt` 23:59). Soit un cron Vercel `0 5 * * *` (autorisé sur Hobby), soit une seconde planification QStash | 5 min |
| 3 | **Modifier `vercel.json`** : retirer l'entrée cron 30 min (sinon le déploiement Hobby échoue), garder ou retirer le cron quotidien | 5 min + déploiement |
| 4 | **Appliquer les deux P0 de l'audit perf** avant la bascule (images d'accueil, respect du cache CDN) pour rester loin des quotas Hobby | 1 jour (déjà planifié) |
| 5 | **Rétrograder** : dashboard Vercel → Settings → Billing → Downgrade to Hobby (l'équipe doit n'avoir qu'un membre développeur), puis vérifier le premier déploiement Hobby | 10 min |
| 6 | **Corriger le seuil du health-check** (45 min) et brancher une sonde gratuite (UptimeRobot) dessus : c'est elle qui détectera un planificateur externe en panne | 15 min |

Coût après bascule : Railway 5 $/mois (vérifier sur la facture que l'usage reste sous les 5 $ inclus ; sinon réduire le volume de 5 Go à 1 Go — 428 Mo utilisés — et la rétention `RADAR_RAW_RETENTION`).

### 7.3 Option 0 € (plus tard, si les 4,6 € restants gênent)

Remplacer Railway par une VM **Oracle Cloud « Always Free »** (ARM Ampere jusqu'à 4 cœurs / 24 Go, 200 Go de disque, gratuite sans limite de durée) qui hébergerait le worker radar, le relais AIS et, au besoin, le proxy Scrapling, derrière Caddy pour le TLS. Contreparties : carte bancaire exigée à l'inscription, capacité ARM parfois indisponible dans la région choisie (Paris/Marseille), instance récupérable après 7 jours d'inactivité CPU (le worker tourne en continu, ce n'est pas un problème), et une VM à administrer soi-même (mises à jour, redémarrages). Render gratuit n'est pas une bonne cible pour le worker : 512 Mo de RAM (à comparer à la consommation réelle visible dans Railway → Metrics), mise en veille après 15 min et pas de disque persistant.

Je ne recommande pas cette option dans un premier temps : Railway à 5 $ est le seul service permanent et il fait un vrai travail (radar toutes les 5 min).

### 7.4 Si la facture n'est pas celle supposée

- Si les 25 € comprennent **Render Starter (7 $)** plutôt que Vercel Pro : repasser Render en gratuit (le premier visiteur du layer maritime attend 30 à 60 s au réveil) ou, mieux, déplacer `ais-relay.js` comme **second service du projet Railway existant** (≈ 100 Mo de RAM, quelques centimes d'usage, pas de mise en veille) — consolidation de toute façon souhaitable.
- **Jev** (1 à 4 $/mois si activé) reste hors de question tant que la facture n'est pas réglée ; Groq gratuit demeure le repli.

---

## 8. Suivi de mise en œuvre (23/09/2026, branche `feat/audit-2026-09-hobby-perf`)

**État au 23/09/2026 au soir** : branche commitée (`9d83531f`) et poussée, build de prévisualisation Vercel réussi (routes non testées : prévisualisation protégée par l'authentification Vercel), pas encore fusionnée. `main` déployé en production en `0d44c1eb`, CI verte ; fusion à blanc de la branche sans conflit. Railway n'est pas relié à GitHub : la correction du décodeur radar présente dans `main` ne tourne qu'après `railway up`.

- **Regroupement des fonctions** : 57 handlers sous `api/_handlers/**`, une seule fonction `api/index.js` (réécriture `/api/(.*)` → `/api?__fmroute=$1`), table générée `api/_routes.js`. Fonctions restantes : `api/index.js`, `api/ingest/news.ts`, `api/fuel-price-series-refresh.js`, `api/sentinel-ndwi.ts` (4, limite Hobby 12). Les handlers « edge » tournent désormais en Node via un adaptateur. Test de non-régression : `tests/api-router.test.ts`.
- **`vercel.json` compatible Hobby** : `fluid: true`, crons quotidiens seulement (ingestion 04:15 en filet de sécurité, carburants 05:00), cache immuable des assets hachés.
- **À faire par vous, dans cet ordre** (détail et commandes dans `docs/runbook-passage-hobby.md`) : 1) créer la planification QStash toutes les 30 min ; 2) pousser la branche et vérifier la prévisualisation avec le script du runbook ; 3) fusionner ; 4) rétrograder Vercel en Hobby ; 5) brancher UptimeRobot sur les trois URL `/health`.
- **Corrigé** : seuil du health-check (45 / 90 min), routes ministres et GIE, ARCEP (nouveau bucket), `biogas-sites`, cache du relais Render `/opensky` (10 s) et de `/api/traffic/air` (Redis 20 s), `netlify.toml` supprimé, `railway.toml` ajouté, test de fumée quotidien (`.github/workflows/smoke.yml`, qui détecte aussi les résumés Groq dégradés), contrôle CI des fichiers générés.
- **Reste ouvert** : décision Render (garder le palier gratuit ou déplacer le relais sur Railway), vérification des quotas Upstash/Neon et de la facture réelle, historique de situation écrit par un cron plutôt que par les navigateurs.
