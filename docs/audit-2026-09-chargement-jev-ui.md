# Audit France Monitor — chargement des données, scoring des news avec Jev, simplification UI

Date : 22 septembre 2026. Périmètre : dépôt `FranceMonitor` (branche `main`, avec les modifications non commitées du jour) et le site de production https://www.francemonitor.com.

Annexes (même dossier `docs/audit-2026-09-annexes/`) : A client/chargement, B serveur/API/cache, C pipeline news & scoring, D inventaire UI, E mesures brutes en production, 3 captures d'écran. Chaque annexe cite le code en `fichier:ligne`.

Mesures faites depuis Paris avec Chrome headless piloté par le DevTools Protocol (rendu WebGL logiciel) et `curl`. Les valeurs absolues dépendent du réseau et de la machine ; les ordres de grandeur, les rapports entre scénarios et les causes sont stables. Quatre scénarios : bureau cache vidé, bureau à chaud (service worker + cache), mobile 390×844 cache vidé, bureau sous émulation 4G (9 Mbit/s, 150 ms) avec CPU ralenti ×4.

---

## 0. Résumé exécutif

**Le tableau de bord charge tout, pour tout le monde, à chaque visite, après la carte.** C'est la cause commune des lenteurs : les données de 25 modules sont demandées au démarrage quelle que soit la couche active, tout est sérialisé derrière l'initialisation de la carte (fond Carto tiers), le cache CDN est contourné par des paramètres d'URL uniques, et du travail « par article » (géocodage, résumé LLM, classification) est refait dans chaque navigateur au lieu d'être fait une fois côté serveur.

Chiffres clés (production, 22/09/2026) :

| Mesure | Accueil | Dashboard cache vidé | Dashboard à chaud | Dashboard 4G + CPU×4 |
|---|---|---|---|---|
| Requêtes en 45 s | 19 | 317 | 281 | 308 |
| dont `/api/*` | 0 | 97 (32 MISS CDN, 10 erreurs) | 92 | 98 |
| dont API externes appelées par le navigateur | 0 | 165 | 139 | 152 |
| Octets transférés | 28,7 Mo (images) | 1,5 Mo | 0,09 Mo | 1,5 Mo |
| First Contentful Paint | 5,8 s | 4,3 s | 0,55 s | 5,7 s |
| Temps de script (thread principal) | 0,04 s | 13,6 s (52 tâches longues) | 9,0 s | 16 s (152 tâches longues, 56 s de tâches) |
| Nœuds DOM / écouteurs | 177 / 10 | 14 549 / 8 033 | 14 553 / 7 063 | 14 570 / 9 027 |
| Mémoire JS | 8 Mo | 89 Mo | 103 Mo | 101 Mo |

Huit constats qui expliquent l'essentiel :

1. **Accueil : 28 Mo d'images PNG** (5 captures 5344×3104 et une 2560×1440, affichées à ≈ 720 px, chacune référencée par deux `<img>` sans `loading="lazy"`) et tout le bundle carto (maplibre + deck.gl ≈ 490 Ko brotli) préchargé alors que la landing n'a pas de carte.
2. **La carte bloque tout** : `init()` fait `await this.initMap()` (style Carto → sprites → glyphes → tuiles, plus ≈ 2,1 Mo de JS carto brut) avant de lancer le moindre fetch de données ; seul le widget baromètre réseau y échappe (annexe A §1, §6.1).
3. **Tout est chargé au démarrage** : 13 chunks de panneaux importés inconditionnellement dans `renderShell()` et 13 boucles de polling démarrées dans `init()` quel que soit l'état des couches (hydrométrie Hub'Eau 25 appels, santé 10 endpoints, éolien, nucléaire, pétrole, gaz, cyber, DROM…). `departements.geojson` (3,3 Mo) est sur le chemin critique pour tout le monde ; le rafraîchissement hydraulique tourne deux fois par chargement ; les vols militaires sont interrogés toutes les 5 s même couche éteinte.
4. **Cache CDN contourné** : `/api/news?since=<horodatage à la milliseconde>` et `/api/traffic/air?t=<Date.now()>` rendent chaque URL unique → chaque visiteur paie une invocation de fonction et la latence amont (4,7 s pour les news, 10,5 s pour le trafic aérien, appelé 4 fois en 45 s).
5. **Travail par article refait par chaque visiteur** : 88 appels `geo.api.gouv.fr/communes` + 26 `api-adresse` (géo-résolution des incidents et géocodage), 10 appels `/api/intelligence/v1/summarize` (résumés LLM), reclassification mots-clés.
6. **Le flux news est du bruit à 86 %** : sur 24 h, 863 articles sur 1 000 sont `general/info` mais sont téléchargés (186 Ko gz), mappés et injectés dans le DOM. Le classifieur mots-clés sur-alerte : « livre de Charles Spencer sur Lady Di » → `critical/security` 0,85 ; « McDonald's à l'assaut des campagnes » → `high/security` ; « Bougainville nouveau pays » → `critical` ; « AG de l'ONU » → `critical/health` 0,9. La confiance n'est pas une probabilité (valeurs fixes par palier de mots-clés ; la passe Groq écrit une constante 0,75).
7. **Doublons et erreurs systématiques** à chaque chargement : `vigilance` ×2, `ecowatt` ×2, `cert.ssi` ×2, `ransomware.live` ×2 (502), `arcep` ×4 (404 J et J-1), `situation-history` ×3, `traffic/air` ×4, `biogas-sites` 502, ODRE `eco2mix-regional-tr` appelé en direct → 400 après 9,1 s. Et une route entière morte en prod : `/api/ministers/*` n'a aucun handler (le panneau Gouvernement reçoit du HTML).
8. **UI** : 35 couches définies en 7 groupes (accordéon plat), 17 contrôles d'en-tête, 89 boutons dans le DOM dont 29 avec `aria-label`, aucun `h1`–`h6` dans les 26 panneaux, 2 panneaux + alertes + bandeau ouverts d'office sur la carte, 40 sources dans un menu déroulant, 5 échelles de couleur de gravité parallèles, 3 173 lignes de code mort. Sur mobile le panneau de droite recouvre la carte ; aucune mise en page tablette.

**Trois chantiers**, détaillés aux §3, §4 et §5 :

- **A. Chargement** — 4 « quick wins » d'une journée (cache CDN, doublons, images d'accueil, en-têtes immutables), puis deux changements structurels : *données en parallèle de la carte + chargement à la demande par couche*, et *snapshot serveur unique* au démarrage. Objectif réaliste : dashboard utilisable en < 2 s à froid sur fibre, < 5 s en 4G, ≈ 30 requêtes au lieu de 317.
- **B. Jev** — scorer chaque article **une fois, côté serveur, dans le cron d'ingestion**, en remplacement de la passe Groq de reclassification (15 articles/tick, séquentielle), avec 9 questions typées (pertinence, catégorie, gravité, France ?, en cours ?, institution ?, fait divers ?, portée, type d'infrastructure), stockage des réponses brutes en base, combinaison en code. Coût estimé 1 à 4 $/mois (pas de palier gratuit documenté : décision à prendre). Le classifieur mots-clés reste le repli déterministe ; Ollama/Groq gardent la génération de texte.
- **C. UI** — un « mode simple » par défaut : carte + synthèse + alertes + 5 vues prédéfinies au lieu de 35 cases, un seul tiroir de détail, légendes repliées, sources dans un tiroir de statut, bottom-sheet sur mobile ; et une dette à solder (code mort, z-index, échelles de couleur, titres sémantiques).

---

## 1. Méthode

- **Code** : lecture directe de `src/App.ts` (6 830 lignes), `src/main.ts`, `src/LandingPage.ts`, `vite.config.ts`, `vercel.json`, `src/services/rss.ts`, `air-traffic.ts`, `summarization.ts` ; quatre explorations systématiques (annexes A à D) ; build local (`npm run build`, 53 s, 1 497 modules).
- **Production** : `curl` sur la page, les bundles et 34 endpoints `/api/*` (2 appels chacun pour observer `x-vercel-cache`) ; Chrome headless avec journal réseau complet, métriques `Performance`, `PerformanceObserver` (FCP, LCP, CLS, tâches longues), captures d'écran, texte visible (annexe E).
- **Jev** : documentation TypeSafe lue le jour même (modèle `jev-1.13.0`, API `POST /v1/systemone`, primitives Choice/Score/Noul, page « jaggedness », tarification, SDK JavaScript `@typesafe-ai/sdk`). Aucune clé API dans le dépôt : **aucune mesure de qualité réelle sur des titres français n'a été faite** ; c'est la première étape du chantier B.
- **Limites** : le rendu WebGL logiciel du headless retarde le premier affichage de la carte (LCP mesuré à 19 s, non représentatif) ; les métriques réseau, DOM, nombre de requêtes et temps de script sont fiables. L'extension Chrome n'a pas pu être utilisée (trois navigateurs connectés au compte, sélection manuelle requise) ; le headless local l'a remplacée.

---

## 2. Mesures en production

### 2.1 Page d'accueil (`/`)

| Ressource | Poids | Remarque |
|---|---|---|
| 6 PNG `public/landing/*.png` | 27,9 Mo | 5344×3104 px pour 5 d'entre elles, affichées à ≈ 720 px ; chacune référencée deux fois (`src/LandingPage.ts:89-217`), aucune en `loading="lazy"`, ni `width`/`height`, ni WebP/AVIF |
| `index-*.js` + `maplibre-*.js` + `deck-gl-*.js` + `d3-*.js` | 762 Ko (brotli) | `modulepreload` de la carte alors que la landing n'en a pas besoin |
| CSS | 37 Ko (brotli) | `main.css` (133 Ko brut, 8 016 lignes) chargé pour la landing |
| Service worker | précache de 78 entrées ≈ 14,5 Mo (brotli) | inclut `data/drom-energy/raw/*.geojson`, `maires-politique.json` (2 Mo)… téléchargés en arrière-plan dès la landing |

Résultat : FCP 5,8 s à froid sur fibre, uniquement à cause des images (le HTML arrive en 130 ms, `x-vercel-cache: HIT`).

### 2.2 Tableau de bord (`/?view=app#live`)

Chronologie, bureau, cache vidé :

| t | Événement |
|---|---|
| 0,19 s | HTML reçu ; 4 bundles JS + 2 CSS en parallèle (HIT CDN) |
| 0,38 s | **13 chunks de panneaux** (DROM, Hydraulique, Éolien, Santé ×2, Feux, Trafic, Maritime, Cyber, Pétrole, Nucléaire, Pannes, Défense) + 1ʳᵉ salve `/api` depuis le widget baromètre (ecowatt, internet-outages, arcep 404, cert.ssi ×2, ransomware 502 ×2, NVD, infra-network, threats, exposure) |
| 2,24 s | seulement maintenant : chunk `DeckGLMap` (83 Ko), puis style Carto à 2,75 s, tuiles à 4,9–6,8 s |
| 2,7 → 8,0 s | thread principal occupé (exécution deck.gl + maplibre, construction de 14 500 nœuds) ; aucune requête de données |
| 8,5 s | 2ᵉ salve, une fois la carte prête : `/api/news?since…&limit=1000` (4,7 s, MISS), `traffic/air` (10,7 s), `vigilance` ×2 (4,7 s), vigicrues via `json-proxy` (5,4 s), `eolien?parks=1` (4,5 s), `outages/citizen` (5,3 s), `transport/disruptions` (2,6 s), ODRE régional en direct (9,1 s → 400), `departements.geojson` |
| 13–14 s | 10 appels `/api/intelligence/v1/summarize` ; 25 appels Hub'Eau (stations puis observations) |
| 18 s | 10 endpoints `/api/health/*`, 88 appels `geo.api.gouv.fr/communes`, 26 `api-adresse` (jusqu'à 24 s) |
| 32 s, 44 s | `traffic/air` à nouveau (10,5 s chacun) ; vols militaires toutes les 5 s |

À chaud (service worker actif) les bundles viennent du cache, mais **le nombre de requêtes de données est identique** (281) et le temps de script reste à 9 s : le problème n'est pas le poids du JS, c'est le volume de travail au démarrage. Seul le flux news bénéficie d'un cache persistant qui peint avant le réseau (`localStorage`, 30 min) ; les ≈ 20 autres services ne gardent qu'un cache mémoire perdu à chaque rechargement (annexe A §3).

### 2.3 Endpoints `/api/*` : latence et cache CDN

Deux appels successifs par endpoint ; « MISS→HIT » signifie que le CDN Vercel met bien en cache (seul le premier visiteur paie). Côté code, 51 des 55 handlers posent bien un `Cache-Control` (annexe B) : le problème n'est pas l'absence d'en-têtes mais leur contournement et la lenteur des amonts sur MISS.

| Endpoint | 1ᵉʳ appel | 2ᵉ appel | Cache | Remarque |
|---|---|---|---|---|
| `/api/news?limit=50` | 1,37 s | 0,15 s | MISS→HIT | mais le client appelle avec `since=<ms>` → toujours MISS |
| `/api/news?since=J-1&limit=1000` | 0,19 s | 0,11 s | MISS→HIT (avec `since` fixe) | 186 Ko gz, 1 000 items dont 863 `general/info` |
| `/api/traffic/air` | **10,5 s** | 0,11 s | `s-maxage=20` mais `?t=` côté client | appelé 4× en 45 s |
| `/api/energy/gas-pir` | **9,4 s** | 0,11 s | MISS→HIT | amont ENTSOG lent |
| `/api/weather/vigilance` | 0,11 s (curl) / 4,7 s (navigateur) | — | STALE | appelé 2× simultanément par le client |
| `/api/json-proxy?url=vigicrues` | 5,4 s | — | MISS | proxy générique, pas de cache Redis |
| `/api/outages/citizen` | 5,3 s | — | MISS | scraping cheerio + turf, handler le plus lourd en CPU |
| `/api/energy/eolien?parks=1` | 4,5 s | — | MISS | liste de 1 772 parcs quasi statique |
| `/api/transport/disruptions` | 2,6 s | — | MISS | seul endpoint en `max-age` (navigateur) au lieu de `s-maxage` |
| `/api/infra-network`, `/api/internet-outages`, `/api/threats` | 1,0–1,2 s | 0,11 s | MISS→HIT | corrects une fois chauds |
| `/api/energy/biogas-sites` | 0,47 s | 0,42 s | **502** ×2 | cassé en prod |
| `/api/arcep?date=J` et `J-1` | 0,15 s | — | **404** ×4 par chargement | date non encore publiée, aucune mémorisation négative |
| `/api/json-proxy?url=ransomware.live` | 0,15 s | — | **502** ×2 par chargement | |
| `/api/intelligence/v1/summarize` | 0,07–0,09 s ×10 | — | POST, Redis 24 h | par visiteur, par article |
| `/api/ministers/*` | — | — | — | **aucun handler en prod** : le rewrite retombe sur `index.html` (annexe B §0) |
| ecowatt, rte-iip, nuclear, market, commodities, fires, outages, gie, vigicrues, apl, sncf, fuel-price-series, exposure | 0,10–0,13 s | 0,10 s | HIT | corrects |

Les bundles statiques (`/assets/*-<hash>.js`) sont servis avec `cache-control: public, max-age=0, must-revalidate` au lieu de `max-age=31536000, immutable` : `vercel.json` ne définit aucune règle de cache pour les assets (seulement CORS sur `/api/(.*)` et la CSP), et le préréglage Vite de Vercel ne s'applique visiblement pas.

### 2.4 Ce que le navigateur appelle en direct (hors `/api`)

| Hôte | Appels / chargement | Origine dans le code |
|---|---|---|
| `geo.api.gouv.fr/communes` | 88 | `src/services/incident-geography.ts:58` (géo-résolution des incidents feux, par incident, par visiteur) |
| `api-adresse.data.gouv.fr/search` | 26 | `src/services/geocoder.ts`, `src/components/OutagesPanel.ts` |
| `hubeau.eaufrance.fr` | 25 | `src/services/hubeau-hydrometry.ts:402,477` (couche Hydro **désactivée** par défaut ; appelé deux fois, cf. §3.1) |
| `odre.opendatasoft.com` | 11 | `energy-regions.ts`, `metropoles.ts`, `ecowatt.ts`, `gas.ts` ; `DeckGLMap.ts:772-779` ajoute deux sources GRT/Teréga avec une URL ODRE en `data`, fetchée par MapLibre dès l'init quelle que soit la couche gaz ; l'appel `eco2mix-regional-tr` répond 400 après 9,1 s |
| `opendata.enedis.fr` | 3 | pannes électricité |
| `tiles.basemaps.cartocdn.com` | 9 | fond de carte (normal) |

Ces appels directs contredisent la règle du dépôt (« tout passe par `/api/*` »), échappent au cache Redis/CDN, et exposent l'utilisateur aux quotas et pannes des API tierces.

---

## 3. Chargement des données — causes et plan

### 3.1 Causes racines

| # | Cause | Preuve | Fichiers |
|---|---|---|---|
| C1 | **Sérialisation derrière la carte** : `init()` attend `initMap()` (fetch du style Carto, `map.on('load')`, atlas d'icônes séquentiel) avant de démarrer tous les polling et `loadCriticalLayers()` | aucune requête de données entre 0,4 s et 8,5 s | `src/App.ts:2107-2186`, `2124`, `components/DeckGLMap.ts:600-627`, `7961-7997` |
| C2 | **Tout au démarrage** : `renderShell()` importe 13 panneaux (`void import(...)`) ; `init()` démarre 13 boucles `start*Polling()` inconditionnelles ; les seules bien gardées sont Pétrole et Santé (test de couche active dans le tick) | 13 chunks à t+380 ms ; Hub'Eau, éolien, nucléaire, cyber chargés couches éteintes | `src/App.ts:2121`, `2153-2166`, `2631-3030` ; bon modèle : `4284-4293` (oil), `5735-5754` (health) |
| C3 | **`departements.geojson` (3,3 Mo) sur le chemin critique** via `loadWeather()` → `updateWeather()` → `getDepartmentsGeojson()`, inconditionnel, alors que `vite.config.ts:228` documente l'intention de le différer | fetch à 13,3 s dans la trace | `src/App.ts:4588-4624`, `6112-6155`, `DeckGLMap.ts:9643-9666` |
| C4 | **Rafraîchissement hydraulique en double** : `loadWeather()` appelle `refreshHydraulicLayer()` puis `loadSecondaryLayers()` le rappelle | 25 appels Hub'Eau (stations ×23 + observations ×2) | `src/App.ts:4622`, `4772-4774`, `6171-6177` |
| C5 | **Polling militaire/AIS toutes les 5 s** sans test de couche ; websocket AIS ouvert d'office | `traffic/military` à 8,5 s, 43,5 s… | `src/App.ts:3973-4065` |
| C6 | **Paramètres d'URL uniques** qui rendent le cache CDN inutile (`since=` à la ms ; `?t=${now}` ajouté « pour contourner le cache navigateur » alors que le serveur pose `s-maxage=20`) | 32 MISS par chargement | `src/services/rss.ts:376-377`, `src/services/air-traffic.ts:39`, `api/traffic/air.js:23` |
| C7 | **Travail par article côté client** : géocodage, géo-résolution des incidents, résumés LLM (3 par lot, `MAX_SUMMARIZE_ITEMS_PER_CYCLE`), classification ML dans un worker pour les items sans `threat` | 124 appels géo + 10 POST LLM par visiteur | `incident-geography.ts:58`, `geocoder.ts`, `App.ts:4392-4530` |
| C8 | **Flux news non filtré côté serveur** : 1 000 items/24 h dont 86 % de bruit, tous mappés (`mapIngestItem`), triés et rendus | 186 Ko gz, 14 500 nœuds DOM | `api/news.js:66-167`, `src/services/rss.ts:287-393`, `UnderMapNewsFeed.ts` |
| C9 | **Endpoints lents sans Redis** ni mémorisation négative : chaque MISS attend l'amont (2,6 à 10,7 s) ; `json-proxy` générique pour Vigicrues ; scraping citoyen à chaque MISS | tableau §2.3 | `api/traffic/air.js`, `api/json-proxy.js`, `api/_shared/citizen-outages-handler.js`, `api/energy/eolien.js`, `api/transport/disruptions.js` |
| C10 | **Doublons de fetch** entre services et panneaux : seul `cyber.ts` a une garde in-flight (bon modèle) | 10 doublons par chargement | `vigilance-meteo.ts`, `ecowatt.ts`, `situation-history.ts`, `outages.ts` ; modèle : `services/cyber.ts:29-30,346` |
| C11 | **Caches clients non persistants** : ≈ 20 services n'ont qu'une variable de module ; seul `newsCache.ts` peint avant le réseau | tout est en « chargement » à chaque rechargement | `utils/newsCache.ts` (modèle), `services/ecowatt.ts:43-44`, `nuclear-rte.ts:25`, `fires.ts:140`… |
| C12 | **Landing** : images non optimisées, bundle carte préchargé, précache SW de 14,5 Mo, `d3` (mobile) et `Map.ts` importés statiquement pour tout le monde | §2.1 | `src/LandingPage.ts`, `public/landing/`, `vite.config.ts` (PWA, `manualChunks`), `components/MapContainer.ts:7` |
| C13 | **En-têtes de cache statiques absents** de `vercel.json` | `max-age=0, must-revalidate` sur les assets hashés | `vercel.json` |
| C14 | **Sources cassées appelées à chaque chargement** (biogas-sites 502, ransomware 502, ARCEP 404 ×4, ODRE 400) sans mémorisation négative ; route `/api/ministers/*` sans handler | 10 erreurs par chargement | `api/energy/biogas-sites.js`, `api/json-proxy.js`, `api/arcep.js`, `src/services/energy-regions.ts`, `api/_shared/ministers.js` (jamais importé) |

### 3.2 Plan d'action priorisé

| Priorité | Action | Gain attendu | Effort | Où |
|---|---|---|---|---|
| P0 | **Arrondir `since` à 5 min** et **supprimer `?t=`** sur `traffic/air` ; garder `s-maxage=60, stale-while-revalidate=300` sur `/api/news` | news : 4,7 s → 0,15 s pour 99 % des visiteurs ; air : 10,5 s → 0,1 s ; −30 invocations par visiteur | S | `rss.ts:376`, `air-traffic.ts:39` |
| P0 | **Dédupliquer les fetchs in-flight** (Map `url → Promise` dans `resilientFetch`, sur le modèle de `cyber.ts`) et **supprimer le second `refreshHydraulicLayer()`** | −10 requêtes et −25 appels Hub'Eau par chargement | S | `src/utils/resilientFetch.ts`, `src/App.ts:4622` |
| P0 | **Images d'accueil** : redimensionner à 1440 px, AVIF/WebP + fallback, `loading="lazy"` + `width`/`height` sauf le héros, une seule référence par image | 28 Mo → ≈ 1 Mo ; FCP landing 5,8 s → < 1 s | S | `public/landing/`, `src/LandingPage.ts:89-217` |
| P0 | **En-têtes immutables** sur `/assets/(.*)` dans `vercel.json` ; **ne pas précharger** maplibre/deck.gl sur la landing (entrée HTML séparée ou `modulepreload` injecté seulement en mode app) | −30 revalidations par navigation ; −490 Ko sur la landing | S | `vercel.json`, `index.html`, `vite.config.ts` |
| P0 | **Mémorisation négative** 10 min (Redis) pour ARCEP J/J-1, ransomware.live, biogas-sites ; corriger la requête ODRE régionale (400) ; **créer le handler `/api/ministers/*`** (réexport de `handleMinistersRequest` + cache) | −10 erreurs par chargement ; panneau Gouvernement de nouveau fonctionnel | S | `api/arcep.js`, `api/json-proxy.js`, `energy-regions.ts`, nouveau `api/ministers/[...path].js` |
| P1 | **Données en parallèle de la carte** : lancer les fetchs critiques (ecowatt, vigilance, crues, nucléaire, news) avant `await initMap()` et ne conditionner à la carte que les `updateX()` (rejouer l'état une fois la carte prête) | temps-à-données = max(carte, données) au lieu de carte + données ; −2 à −4 s à froid | L | `src/App.ts:2107-2186`, `DeckGLMap.ts:600-627` |
| P1 | **Chargement à la demande par couche/panneau** : n'importer un panneau et ne démarrer son polling qu'au premier toggle de sa couche (modèle `startOilPolling`/`startHealthPolling`), l'arrêter au toggle inverse ; gaz GRT/Teréga et `departements.geojson` fetchés seulement si une couche consommatrice est active ; militaire/AIS gardés par la couche | −150 requêtes et −60 % de script au démarrage | M | `src/App.ts:2153-2166`, `2631-3030`, `3973-4065`, `DeckGLMap.ts:772-779`, `9643-9666` |
| P1 | **Déplacer le travail « par article » dans le cron d'ingestion** : géocodage complet (aujourd'hui 30/tick, 140/1 000 items ont des coordonnées), géo-résolution des incidents dans `/api/fires`, résumés LLM en colonne `summary_ai` générée une fois, classification (§4) | −124 appels géo et −10 POST LLM par visiteur ; quota Groq divisé par le nombre de visiteurs | M | `api/ingest/news.ts:300-323`, `api/fires.js`, `api/news.js` |
| P1 | **Filtrer et paginer côté serveur** : `/api/news?noise=0&limit=300` renvoyant les items pertinents d'abord (avec Jev, §4) ; le bruit derrière « tout afficher » | 186 Ko → < 40 Ko ; −10 000 nœuds DOM | S/M | `api/news.js`, `UnderMapNewsFeed.ts` |
| P1 | **Redis + stale-while-revalidate sur les endpoints lents** : `traffic/air` (snapshot rafraîchi par cron ou par le relais), `gas-pir`, `outages/citizen` (cron dédié), `transport/disruptions`, Vigicrues via un endpoint dédié, `eolien?parks=1` → fichier statique `public/data/` ; migrer les caches mémoire de `sentinel-ndwi.ts` et `osm-railways.js` vers Redis ; timeout manquant sur `synthesis.js:167` | tous ces appels < 0,2 s après le premier | M | annexe B §4, §6 |
| P2 | **Snapshot serveur unique** : un cron (5 min) assemble énergie + météo/crues + finance + cyber/infra + feux (résumé) + militaires dans 3 ou 4 objets Redis ; le client fait **un** `GET /api/snapshot` (`s-maxage=60`) au démarrage puis rafraîchit par domaine | ≈ 35 requêtes → 1 ; démarrage indépendant des amonts ; invocations divisées par 20 (palier gratuit Vercel) | M/L | nouveau `api/snapshot.js` + cron dans `vercel.json` + `src/services/snapshot.ts` ; candidats/exclusions en annexe B §5 |
| P2 | **Persister les réponses critiques en `localStorage`** (généraliser `newsCache.ts` à ecowatt, vigilance, crues, nucléaire) pour peindre le dernier état connu avant le réseau | affichage instantané au rechargement | M | `src/utils/newsCache.ts` (modèle), services concernés |
| P2 | **Rapatrier les appels externes directs** (Hub'Eau, ODRE, Enedis, geo.api, api-adresse) derrière `/api/*` avec Redis | cache partagé, conformité, plus de 400 après 9 s | M | services cités §2.4 |
| P2 | **Alléger le précache SW** : exclure `data/drom-energy/raw/*`, `maires-politique.json`, GeoJSON > 500 Ko (`globIgnores`) ; import dynamique de `Map.ts` (mobile) dans `MapContainer.ts` | −10 Mo en arrière-plan à la première visite ; −32 Ko de d3 pour le bureau | S | `vite.config.ts`, `components/MapContainer.ts:7` |
| P3 | **Rendu différé du DOM** : construire le contenu d'un panneau à son ouverture, virtualiser la liste news (fenêtre de 50), délégation d'événements | −8 000 écouteurs ; script 13 s → < 4 s | M | `Panel.ts`, `UnderMapNewsFeed.ts`, `LayerPanel.ts` |
| P3 | **Re-passer l'audit d'imports statiques** sur les services ajoutés depuis juillet (radar-2d/column, wildfire-dossier, mtg-frp, situation-brief/engine) : `index-*.js` est repassé de 842 à 922 Ko brut | −50 à −100 Ko sur le chunk critique | M | `src/App.ts` |

### 3.3 Architecture cible du démarrage

```
Navigateur                                     Vercel (fra1)                     Cron
──────────                                     ─────────────                     ────
GET /?view=app ──► HTML + bundle app                                              toutes les 5 min : snapshot.js
en parallèle :                                                                     assemble 12 sources → Redis
  GET /api/snapshot ─────────────► Redis (s-maxage=60, SWR=300)                   toutes les 30 min : ingest news
  GET /api/news?since=<5 min>&noise=0&limit=300 ─► Neon (s-maxage=60, SWR=300)     → Neon (Jev, géocodage, résumés)
  initMap() (style Carto, tuiles)  ← les updateX() rejouent l'état quand la carte est prête
[toggle couche X] ─► import(XPanel) + GET /api/x + start polling X   (à la demande)
```

Ordre conseillé : les cinq P0 (une journée, gains immédiats et mesurables : refaire la trace de l'annexe E avant/après), puis « à la demande » et « en parallèle de la carte » (le plus gros gain structurel), puis le snapshot.

### 3.4 Anomalies à corriger indépendamment de la performance

- `/api/ministers/*` : 9 sous-routes appelées par `src/services/ministers.ts`, rewrite présent dans `vercel.json`, **aucun fichier handler** ; la logique (827 lignes, `api/_shared/ministers.js`) n'est câblée qu'au plugin Vite de dev. Le panneau Gouvernement est mort en prod (annexe B §0).
- `api/intelligence/v1/synthesis.js:167` : appel Groq sans `AbortSignal` (ses deux voisins en ont un).
- `api/ingest/news.ts:2` dit « toutes les 5 min » (cron réel : 30 min) ; `:13` dit « max 5/tick » Groq (constante réelle : 15).
- `api/_lib/server-classifier.js` et `feeds-snapshot.js` sont des copies générées de `src/services/classifier.ts` et `src/config/feeds.ts` sans vérification en CI : une modification du classifieur peut partir côté client sans jamais atteindre l'ingestion (ou l'inverse). Ajouter un test qui régénère et compare.
- Trois flags `VITE_ENABLE_{GAS_PANEL,CYBER_PANEL,OIL_LAYER}` sont **actifs par défaut** faute de variable positionnée, contrairement à la note interne de juillet.

---

## 4. Jev (TypeSafe) pour scorer les news

### 4.1 Ce que Jev est, et n'est pas

Jev (`jev-1.13.0`, TypeSafe) est un modèle « System One » : on lui envoie un **état** (texte ou JSON) et une carte de **questions typées**, il renvoie des réponses structurées avec probabilités calibrées, sans générer de texte. Trois primitives :

- **Choice** : une option parmi N (distribution + `confidence`).
- **Score** : une position sur des niveaux ordonnés décrits en mots (probabilités par niveau + `confidence`).
- **Noul** : probabilité qu'une condition soit vraie (0–1).

Ce qui compte pour France Monitor :

- Toutes les questions d'une requête sont évaluées **en parallèle sur le même état** : 9 questions coûtent à peine plus qu'une seule (pattern « speculative fan-out »).
- Jev **ne résume pas et ne rédige pas** : synthèse, brief et résumés restent à Ollama/Groq. Rôle net : *Jev juge, le LLM rédige*.
- Il lit **littéralement** : critères concrets, sans double négation ; calculs, seuils et dates restent dans le code.
- **Français** : la doc indique que l'anglais est la langue principale, les autres langues « prises en charge mais moins précises ». À mesurer sur un jeu de titres français avant de s'y fier (§4.7). Piste : instructions/critères en anglais, état en français.
- Tarif : **0,042 $ par million de tokens d'entrée**, sortie gratuite ; limites 1 200 req/min et 250 000 tokens/s ; contexte 64 k. **Aucun palier gratuit documenté** (à vérifier à la création du compte sur `console.typesafe.ai`). Données : pas d'entraînement sur les requêtes clients, DPA disponible, ZDR réservé aux comptes entreprise.
- SDK : `npm install @typesafe-ai/sdk` (Node 20+), `client.systemOne({ state, questions })`, types de réponse inférés.

### 4.2 Où l'insérer : une fois par article, côté serveur

Le point d'insertion existe déjà : la **passe Groq de reclassification** du cron d'ingestion (`api/ingest/news.ts:395-439`) est exactement le gabarit « appeler un classifieur externe sur un sous-ensemble budgété de lignes fraîchement insérées, puis `UPDATE` ». Aujourd'hui elle ne traite que 15 articles par tick (`GROQ_BUDGET_PER_TICK`), séquentiellement, seulement ceux à confiance < 0,60, écrit une confiance **constante 0,75** et s'interrompt au premier 429. Jev la remplace :

```
RSS (38 flux) → dédup (sha256) → classification mots-clés (kw-1, déterministe, inchangée)
             → [NOUVEAU] Jev : 1 requête / article inséré, concurrence 8, budget 200/tick
             → UPDATE news_items : jev_answers (brut) + champs dérivés, classifier_version = 'jev-1'
/api/news → renvoie category/severity/confidence dérivés (Jev si confiant, sinon mots-clés)
           + relevance, noise, alertable, scope, scoredBy
```

Pourquoi là et pas dans le navigateur : un article est scoré **une fois** (pas par visiteur), la clé reste serveur (exigence TypeSafe, et convention `.env.example` « jamais de clé `VITE_` »), le résultat est cachable par le CDN, et le client s'allège (le worker `ai-worker` de 524 Ko et la chaîne Ollama→Groq→T5 côté client ne servent plus à classer). La classification ML côté client ne peut d'ailleurs jamais émettre `critical` par construction (`ai-classifier.ts:113-121`).

Contraintes déjà encodées à respecter : `maxDuration` 300 s et deadline interne 240 s (`api/ingest/news.ts:88,369`), budget par tick, « abandon de la passe sur erreur HTTP, poursuite sur timeout » (`api/_lib/groq-classifier.js:62-75`), et le filtre `classifier_version = 'kw-1'` pour ne scorer chaque ligne qu'une fois (`:401-407`).

### 4.3 État et questions proposées

État (petit et nommé : le modèle perd en précision quand l'état grossit) :

```json
{
  "source": { "name": "Le Progrès", "type": "presse quotidienne régionale", "region": "Auvergne-Rhône-Alpes", "tier": 3 },
  "article": {
    "title": "Lyon. « On était choqué » : stupéfaction au lycée Colbert après le projet d'attentat avorté",
    "summary": "…description RSS tronquée à 600 caractères…",
    "published_at": "2026-09-22T06:00:11Z"
  }
}
```

Questions (une requête, `model: "jev-1.13.0"` épinglé pour figer la calibration ; les identifiants ne sont pas transmis au modèle) :

```json
{
  "relevance": {
    "type": "score",
    "instructions": "How useful is `article` for a national situational-awareness dashboard that monitors France's critical infrastructure, public safety, public health and social stability?",
    "criteria": [
      "Not useful: entertainment, sport, culture, recipes, celebrity, lifestyle, consumer tips, local trivia, opinion pieces",
      "Minor local event with no wider consequences: isolated crime, small accident, minor road incident, court case about a past event",
      "Notable event affecting a public service, an infrastructure, an institution or many people in a territory",
      "Major event with national impact or a direct threat to critical infrastructure, public order, health or security"
    ]
  },
  "category": {
    "type": "choice",
    "instructions": "Which domain does `article` primarily belong to?",
    "criteria": {
      "security": "Crime, terrorism, policing, public order, riots, attacks",
      "social": "Strikes, demonstrations, social movements, labour conflicts",
      "energy": "Electricity, gas, oil, fuel supply, nuclear plants, grid, renewables",
      "transport": "Rail, road, air, maritime traffic and disruptions",
      "weather": "Storms, floods, heatwaves, wildfires, weather warnings",
      "health": "Epidemics, hospitals, drug shortages, public health alerts",
      "cyber": "Cyberattacks, data breaches, telecom or internet outages",
      "infrastructure": "Water, telecom networks, bridges, dams, industrial sites, other critical infrastructure",
      "defense": "Armed forces, military activity, geopolitical threats to France",
      "finance": "Markets, prices, economic shocks, major company failures",
      "other": "None of the above"
    }
  },
  "severity": {
    "type": "score",
    "instructions": "How severe is the situation described in `article` for people, services or infrastructure in France?",
    "criteria": [
      "No operational impact: information, announcement, analysis, statistics",
      "Localised and contained: a few people or one site affected, resolved or being resolved",
      "Significant ongoing disruption of a service, a network or a territory (a département or a city)",
      "Serious threat to life, to a critical infrastructure or to public order at regional scale",
      "National-scale crisis, major attack, disaster or outage in progress"
    ]
  },
  "in_france": {
    "type": "noul",
    "instructions": "Does the event in `article` take place in France (metropolitan or overseas) or directly affect French territory, population, institutions or infrastructure?",
    "criteria": { "true": "The event is located in France or has a stated direct effect on France", "false": "The event is abroad and only mentioned as international news" }
  },
  "ongoing": {
    "type": "noul",
    "instructions": "Is the event in `article` happening now or still unfolding, as opposed to a retrospective, an anniversary, an analysis, a trial or an investigation about a past event?",
    "criteria": { "true": "The situation is current and may still evolve", "false": "The article looks back at a past event or gives background" }
  },
  "institution_involved": {
    "type": "noul",
    "instructions": "Does `article` explicitly mention the involvement of a public institution, an operator or an emergency service (préfecture, police, gendarmerie, SAMU, pompiers, ARS, hospital, SNCF, RTE, Enedis, EDF, Météo-France, mairie, ministry)?",
    "criteria": { "true": "At least one such organisation is named as acting or affected", "false": "No such organisation is mentioned" }
  },
  "isolated_fait_divers": {
    "type": "noul",
    "instructions": "Is `article` an isolated crime or accident story (fait divers) with no consequence beyond the people directly involved?",
    "criteria": { "true": "A single incident with no effect on a service, a network or a territory", "false": "The event affects a service, a network, an institution or a whole area" }
  },
  "scope": {
    "type": "choice",
    "instructions": "What is the geographic scope of the event in `article`?",
    "criteria": { "commune": "One town or neighbourhood", "departement": "One département or several towns", "region": "One region or several départements", "national": "The whole country", "international": "Outside France or several countries", "unknown": "Cannot be determined" }
  },
  "infrastructure_type": {
    "type": "choice",
    "instructions": "If `article` concerns an infrastructure, which one? Answer `none` when no infrastructure is concerned.",
    "criteria": { "electricity": null, "gas": null, "fuel": null, "nuclear": null, "water": null, "telecom_internet": null, "rail": null, "road": null, "air": null, "port_maritime": null, "hospital": null, "none": "No infrastructure is concerned" }
  }
}
```

`infrastructure_type` est spéculative : on ne lit sa réponse que si `category` ∈ {energy, transport, infrastructure, cyber}. Les catégories `floods`/`fires` de `EventCategory` sont couvertes par `weather` + `infrastructure_type`, à décider selon les consommateurs (§4.5).

### 4.4 Combinaison en code (la politique reste dans le dépôt)

```ts
// api/_lib/jev-policy.js — pur, testable, sans appel réseau (généré depuis src/ comme server-classifier)
const SEV = ['info', 'low', 'medium', 'high', 'critical'];
export function derive(a, kw) {
  const relevance = a.relevance.score / 3;                        // 0..1
  const inFrance  = a.in_france.noul;
  const noise     = inFrance < 0.5 || relevance < 0.4 || a.isolated_fait_divers.noul > 0.7;
  const sevIdx    = Math.round(a.severity.score);                 // 0..4 → SEV
  const severity  = a.severity.confidence >= 0.6 ? SEV[sevIdx] : kw.severity;   // repli mots-clés
  const category  = a.category.confidence >= 0.5 && a.category.choice !== 'other' ? a.category.choice : kw.category;
  const alertable = !noise && sevIdx >= 3 && a.ongoing.noul >= 0.6 && inFrance >= 0.7
                    && (a.institution_involved.noul >= 0.5 || sevIdx === 4);
  const rank      = 0.5 * relevance + 0.3 * (sevIdx / 4) + 0.1 * a.ongoing.noul + 0.1 * inFrance;
  return { relevance, noise, severity, category, alertable, rank, scope: a.scope.choice,
           confidence: a.severity.confidence };
}
```

Les seuils (0,4 / 0,6 / 0,7) sont des points de départ à évaluer sur les données ; ils se changent **sans ré-inférence** puisque les réponses brutes sont stockées. Sur les exemples du §0 : « Lady Di » → `relevance` 0, `in_france` ≈ 0 → bruit ; « Guerre en Ukraine, décryptage » → `in_france` et `ongoing` bas → pas d'alerte ; « projet d'attentat avorté au lycée Colbert » → `security`, gravité 3, France, institution → alerte légitime, `ongoing` modéré (projet déjoué) → à surveiller.

### 4.5 Stockage et contrat API

Migration Neon additive (`scripts/init-db.mjs`, idempotent) :

```sql
ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS jev_answers jsonb,      -- réponses brutes, probabilités incluses
  ADD COLUMN IF NOT EXISTS relevance real,
  ADD COLUMN IF NOT EXISTS is_noise boolean,
  ADD COLUMN IF NOT EXISTS alertable boolean,
  ADD COLUMN IF NOT EXISTS scope text;
-- classifier_version passe à 'jev-1' pour les lignes scorées (réutilise le filtre existant)
CREATE INDEX IF NOT EXISTS news_items_relevant_idx ON news_items (published_at DESC) WHERE is_noise = false;
```

`/api/news` (`api/news.js:125-134`) ajoute `relevance`, `noise`, `alertable`, `scope`, `scoredBy` (dérivé de `classifier_version`, aujourd'hui jamais exposé) ; `mapIngestItem` (`src/services/rss.ts:287-367`) les porte dans `NewsItem` et renseigne enfin `threat.source` correctement (`'llm'` est déclaré mais jamais produit ; tout item serveur est étiqueté `'keyword'`, `rss.ts:330-340`). Les ≈ 15 consommateurs (annexe C §3) continuent de lire `level`/`category`/`confidence` sans modification ; `UnderMapNewsFeed` utilise ensuite `relevance` pour trier et `noise` pour masquer ; `buildAlertMonitorSituations` (`App.ts:6382-6413`) utilise `alertable` au lieu de `level ∈ {critical, high}`.

### 4.6 Coût, limites, risques

- **Coût** : état ≈ 200 tokens (le français tokenise ≈ 1,4× l'anglais) + 9 questions ≈ 800 tokens → ≈ 1 000 tokens par article. Le flux 24 h renvoie 1 000 items (plafond) ; à 1 000–3 000 articles/jour : 1–3 M tokens/jour → **0,04 à 0,13 $/jour, soit 1 à 4 $/mois**. Pas de palier gratuit documenté : dépense nouvelle à valider explicitement au regard de la règle « paliers gratuits uniquement ». Alternative sans coût : garder Groq mais lui demander le même JSON typé (moins calibré, quotas gratuits déjà saturables).
- **Latence** : non mesurée ; modèle conçu pour la décision rapide. 200 articles à concurrence 8 tiennent dans le budget de 240 s.
- **Score de stabilité v3** : `france-country-intel.ts:442-456` compte les items `critical`/`high` (pilier `security` 25 %, pilier `signal` 40 %, plafonds par situation). Jev réduira les faux critiques → le score montera. Les fixtures de `france-country-intel.test.ts` verrouillent la calibration et **ne doivent pas être retouchées** ; il faut un **mode ombre** (stocker sans utiliser) puis une bascule par drapeau `NEWS_SCORING=jev|keywords`, avec comparaison des deux séries de scores avant activation. Même vigilance pour `stability-index.ts` (poids 100/50/25/10/0 par département).
- **Vie privée** : seuls le titre et la description RSS (contenu public) sont envoyés ; aucune donnée utilisateur. Même périmètre que les deux appels Groq existants (reclassification, synthèse). À documenter dans `docs/privacy.md`.
- **Jaggedness** connue de `jev-1.13` : lecture littérale, faiblesse en comptage et en dates, sensibilité au contenu adversarial (titres accrocheurs), pas d'invariants structurels entre questions (ne pas déduire `P(non)` de `1 − P(oui)` d'une autre question). D'où : critères concrets, dates en code, une question par jugement, épinglage de version.

### 4.7 Plan de mise en œuvre et validation

1. **Jeu d'évaluation** (½ jour) : exporter 300 articles récents (`/api/news?limit=300`), étiqueter à la main `pertinent / bruit`, `gravité`, `France ?`. Script `scripts/eval-jev.mjs` qui appelle l'API et calcule l'accord, précision/rappel des alertes, part de `confidence < 0,5`. Comparer instructions en anglais vs en français. **Go/no-go sur ces chiffres et sur le coût constaté.**
2. **Mode ombre** (1 jour) : `api/_lib/jev-client.js` + `jev-policy.js` (générés et testés comme les autres libs `_lib`), colonnes Neon, scoring dans le cron avec budget par tick, drapeau `NEWS_SCORING`. Rien ne change côté client.
3. **Comparaison** (1 semaine de données) : script ou page `/sources-quality` : distribution mots-clés vs Jev, liste des désaccords, dérive du score de stabilité.
4. **Bascule progressive** : d'abord tri du flux et masquage du bruit (`relevance`, `noise`), puis alertes (`alertable`), enfin score de stabilité. Tests contractuels des seuils dans `tests/`.
5. **Nettoyage** : retirer la classification ML côté client (`ai-classifier.ts`, `ai-worker.ts`) ; garder les résumés locaux Ollama en option ; corriger `threat.source`.

---

## 5. Interface — simplification

### 5.1 Ce qu'un nouvel utilisateur voit au premier chargement (bureau 1440×900)

- En-tête : sélecteur Régions (10 presets repliés en `<select>`), FR/EN, « Note de situation », « Export », « Sources & qualité », menu « Sources de données » (40 entrées avec cache/latence), horloge : **17 éléments interactifs**.
- Colonne gauche (380 px fixes) : widget baromètre pannes réseau, bouton « Intelligence France », arbre **Couches** : 7 groupes tous dépliés, 35 cases définies (`LayerPanel.ts:17-54`), dont 7 servent aussi de déclencheur d'accordéon.
- Sur la carte : popup « Alertes » (3 items, dont deux faux positifs du classifieur), bandeau « Convergences 24 h », bascule Carte/Satellite, **panneaux « Environnement » et « Énergie » ouverts d'office** (`FIRST_LOAD_PRESET_LAYERS`, `App.ts:451-456`), bouton flottant « Baromètre Santé », 2 légendes sous la carte, bouton « Voir les modules », pied de page 6 liens.
- ≈ 65 éléments distincts visibles sans clic ; 89 boutons, 37 champs, 518 liens, 14 500 nœuds DOM. Aucun `h1`–`h6` : les titres de panneau sont des `<span class="panel-title">` (`Panel.ts:64-66`).
- **Visiteur récurrent** : `DEFAULT_LAYERS` (38 clés, toutes à `false`) sert de repli ; un `localStorage` « tout éteint » donne une carte vide (le correctif du 5 juillet ne couvre que le tout premier chargement).
- Mobile 390 px : le panneau Environnement recouvre toute la carte, le popup Alertes est coupé, « Régions » chevauche l'horloge ; aucune navigation dédiée ; **aucune mise en page tablette** (une seule règle entre 721 et 1180 px, pour un panneau de gare).

Le produit a un vrai vocabulaire visuel (fond sombre cohérent, badges de gravité, monospace pour les métadonnées) ; ce n'est pas un problème d'esthétique mais de **quantité de choses ouvertes en même temps** et de **hiérarchie**.

### 5.2 Audit technique (grille impeccable)

| # | Dimension | Score /4 | Constat principal |
|---|---|---|---|
| 1 | Accessibilité | 1 | 147 sites de création de boutons pour 68 `aria-label` ; 7 `role=` dans toute l'app ; aucun titre sémantique dans 26 panneaux ; `SearchModal` sans `aria-modal` ; 7 `outline:none` restants. Progrès depuis juillet : 14 règles `:focus-visible` (1 en juillet), 13 fichiers avec `keydown`, contrastes des tokens conformes (`--text-muted` 5,3:1) |
| 2 | Performance UI | 1 | 14 500 nœuds et 8 000 écouteurs au démarrage ; 52 tâches longues ; tous les panneaux construits d'emblée ; `DeckGLMap.ts` 12 723 lignes, `App.ts` 6 830 |
| 3 | Responsive | 1 | mobile : superpositions, panneau plein écran sans geste de fermeture ; tablette inexistante ; 11 seuils de breakpoint quasi doublons (768/767/760, 480/430/420) sans variable |
| 4 | Thématisation | 2 | 53 variables `:root` mais 156 hex et 499 `rgb()` hors `:root` ; 17 valeurs de `z-index` en dur alors qu'une échelle `--z-*` à 6 paliers existe ; 36 `!important` ; aucun mode clair |
| 5 | Anti-patterns | 3 | pas de « slop » IA ; mais 5 échelles de couleur de gravité parallèles (`--threat-*`, `--ecowatt-*`, `--meteo-*`, `--flood-*`, `truthBadge`) et surfaces flottantes empilées |
| | **Total** | **8/20** | « Poor » : refonte de l'état par défaut et de la hiérarchie nécessaire, pas du style |

### 5.3 Proposition « mode simple » par défaut

1. **Un état par défaut minimal** : carte + bandeau de synthèse (Convergences) + liste d'alertes réduite à une ligne dépliable ; **aucun panneau ouvert d'office** (Environnement ne s'ouvre que sur vigilance ≥ orange ou au clic). Remplacer le couple `FIRST_LOAD_PRESET_LAYERS`/`DEFAULT_LAYERS` par un preset nommé, appliqué aussi quand le `localStorage` est vide ou « tout éteint ».
2. **5 vues au lieu de 35 cases** : *Vue générale*, *Énergie*, *Sécurité & défense*, *Santé*, *Environnement & transports*. Chaque vue active un preset de couches et de panneaux ; l'arbre complet reste accessible derrière « Personnaliser » (jeu « essentiel » de 5-6 couches toujours visible, « avancé » replié). Les presets passent par `getEffectiveLayers()` et `syncTrafficGroupState()` (4 endroits à tenir synchronisés, cf. mémoire projet).
3. **Un seul tiroir de détail à droite** : tout ce qui s'ouvre (Environnement, module, dossier feu, sources, gouvernement) s'affiche dans le même tiroir, en onglets, jamais en popups superposés. `RightSidebar` (aujourd'hui réservé à `MinistresPanel`) devient ce tiroir.
4. **Légendes repliées** sous une icône « ? » par couche active ; les 2 légendes sous la carte disparaissent.
5. **Sources de données** : un point de statut (vert/orange/rouge + « 1 indisponible ») qui ouvre le tiroir ; la liste de 40 sources avec cache/latence est une vue de diagnostic, pas d'accueil.
6. **En-tête** : Régions, Vues, Recherche, Statut, Langue. « Note de situation » et « Export » vont dans un menu « ⋯ ».
7. **Flux news** : bruit masqué par défaut (`noise = false`, §4), tri par `relevance`, 50 items rendus (virtualisation), « voir plus ». Fusionner `MarketStrip` + `CommodityStrip` + historique en un seul bandeau sous la carte.
8. **Hiérarchie sémantique** : `h1` (visuellement masqué) pour le tableau de bord, `h2` par région d'interface, `h3` par panneau (remplacer le `<span class="panel-title">` de `Panel.ts:64-66`) ; `aria-label` sur tous les boutons icône ; `aria-modal` sur `SearchModal` ; cases de couches natives ou `role="switch"`.
9. **Une seule échelle de gravité** (token `--severity-*`) + un token de fraîcheur, à la place des 5 systèmes actuels ; respecter l'échelle `--z-*` existante ; 3 breakpoints nommés (mobile / tablette / bureau) avec une vraie mise en page tablette (sidebar repliable).
10. **Chargement perçu** : squelettes par panneau (le loader unifié existe), plus de spinner global ; la carte s'affiche avant les données (§3).
11. **Code mort à supprimer** (3 173 lignes, zéro référence) : `ToastNotification.ts`, `ElusPanel.ts`, `flood-geometry.ts`, `FilterPanel.ts` + `TimeBar.ts`, `osm-rail-graph.ts`, `ore-incidents.ts` ; retirer la clé `elus` masquée en dur de `LayerPanel.ts:53,94`.

### 5.4 Mobile

- Navigation par **bottom-sheet** à 3 hauteurs (fermé / aperçu / plein) pour le tiroir de détail, geste de fermeture, bouton « Carte » toujours visible.
- Barre inférieure : Vues · Alertes · Recherche · Plus. Pas de sélecteur Régions dans l'en-tête (il va dans « Vues »).
- Le fallback D3/SVG (`Map.ts`) reste ; vérifier les cibles tactiles ≥ 44 px sur les puces de gravité.

Commandes suggérées (skill impeccable) : `/impeccable distill` (état par défaut, presets), `/impeccable adapt` (mobile/tablette), `/impeccable harden` (a11y, états vides/erreur), puis `/impeccable polish`.

---

## Annexe — requêtes en double par chargement

`ecowatt` ×2 · `arcep?date=J` ×2 · `arcep?date=J-1` ×2 · `rss?url=cert.ssi` ×2 · `json-proxy?url=ransomware.live` ×2 (502) · `situation-history?days=7` ×2 + `situation-history` ×1 · `traffic/military` ×2 · `traffic/air` ×4 (10,5 s chacun) · `weather/vigilance` ×2 · `intelligence/v1/summarize` ×10 · Hub'Eau stations ×23 (deux passes).

Les inventaires complets (55 handlers et leurs en-têtes, 63 composants, séquence d'init ligne par ligne, contrat de données news) sont dans `docs/audit-2026-09-annexes/`.

---

## 6. Suivi de mise en œuvre (23/09/2026, branche `feat/audit-2026-09-hobby-perf`)

**État au 23/09/2026 au soir** :
- Branche commitée (`9d83531f`, 240 fichiers) et poussée sur GitHub ; build de prévisualisation Vercel réussi, routes non testées car la prévisualisation est protégée par l'authentification Vercel.
- `main` poussé et déployé en production en `0d44c1eb` (clic d'une alerte de vol militaire vers l'avion, borne de réflectivité du décodeur radar), CI verte ; la branche fusionne sans conflit avec ce `main` (fusion à blanc).
- Pas encore fusionnée : suivre `docs/runbook-passage-hobby.md` (QStash, vérification de la prévisualisation, fusion, passage en Hobby). Le décodeur radar n'est actif qu'après `railway up` depuis `services/radar-worker`.

Vérifié : typecheck, lint, 550 tests (64 fichiers), build, contrôle des fichiers générés, et 16 scénarios navigateur (Chrome sans interface sur le serveur de dev de la branche). Les chiffres « après » ci-dessous viennent du build et du serveur de dev ; les mesures de production (latences CDN, octets) ne pourront être refaites qu'après déploiement d'une prévisualisation.

| Mesure | Avant (prod 22/09) | Après (branche) |
|---|---|---|
| Chunk d'entrée JS | 922 Ko (269 Ko gzip) | 106 Ko (33 Ko gzip) |
| Préchargé sur l'accueil | maplibre + deck.gl + d3 | 1 Ko (utilitaire Vite) |
| Images de l'accueil | 27,9 Mo de PNG | 1,3 Mo de WebP/AVIF, chargement différé |
| Précache du service worker | 78 entrées, ≈ 14,5 Mo | 68 entrées, 1,7 Mo compressés |
| Nœuds DOM du tableau de bord | 14 549 | ≈ 3 400 |
| Appels `/api` au démarrage | 97 (prod) | 95 (dev, dont 26 géocodages d'articles appelés à baisser) |
| Appels tiers directs du navigateur | 165 | 0 hors fond de carte, NOAA et RainViewer |
| Géo-résolution des feux | 88 appels geo.api | 1 appel groupé `/api/geo/communes` |
| Erreurs console au démarrage | 5 (dev : 5, prod : 3) | 0 |
| Fonctions Vercel | 59 | 4 (limite Hobby : 12) |

Fait (§3.2) : P0 en totalité ; P1 « à la demande par couche », « données en parallèle de la carte » (préchauffage des caches), cache Redis + SWR des endpoints lents, filtrage des brèves côté client, déplacement partiel du travail par article (géocodage serveur 30 → 150/tick, géo-résolution groupée) ; P2 persistance locale (Écowatt, vigilance, Vigicrues, nucléaire), appels tiers rapatriés derrière `/api/opendata-proxy`, précache allégé, `Map.ts` paresseux ; P3 plafond de 50 articles rendus + délégation d'événements. §3.4 : routes ministres et GIE créées, timeout Groq, commentaires du cron corrigés, contrôle CI des fichiers générés.

Jev (§4) : mode ombre codé et testé (`api/_lib/jev-*.js`, migration idempotente, `/api/news` enrichi, `scripts/eval-jev.mjs`), **désactivé par défaut** (`NEWS_SCORING=off`) : aucune dépense tant que la clé et le drapeau ne sont pas posés. Étape suivante : `node scripts/eval-jev.mjs --export 300`, étiquetage, puis `--run` avec une clé.

Interface (§5.3) : vues prédéfinies, mode simple au premier chargement (aucun panneau ouvert), un seul panneau flottant à la fois avec barre de bascule (au lieu d'un tiroir à onglets), menu « ⋯ », `h1`, titres de panneaux, légendes repliées, statut des sources compact, bandeau marchés fusionné, jetons z-index et gravité, tablette (barre latérale repliable), bottom-sheet mobile pour tous les panneaux flottants, 7 fichiers morts supprimés.

Découvert et corrigé en cours de route (antérieur à la branche) : **Groq a retiré `llama-3.3-70b-versatile`** — résumés, synthèse, brief et reclassification échouaient tous en production (modèles centralisés dans `api/_lib/groq-models.js`) ; Enedis refusait `limit=200` (« 0 enedis records ») ; ARCEP a déménagé vers un bucket OVH ; GRDF a supprimé des champs (`biogas-sites` 502) ; `posts.json` de ransomware.live pèse 21 Mo (filtré à 45 jours, la limite de réponse d'une fonction est 4,5 Mo) ; `includeAssets` ajoutait 8 Mo de GeoJSON au précache ; un utilitaire Vite rangé dans le chunk deck.gl préchargeait toute la carte ; URL `localhost:3001` en dur dans 8 services ; masquer un panneau désactivait sa couche.

Non fait, et pourquoi :
- **Snapshot serveur unique (P2)** : le gain restant est faible une fois le cache CDN respecté et les couches chargées à la demande ; il demande un planificateur toutes les 5 min (budget QStash) et une refonte du démarrage. À reconsidérer sur mesures de production.
- **Historique de situation côté serveur** (audit infra §6.2) : exige de porter le moteur de score v3 et ses entrées côté serveur ; chantier dédié.
- **`alertable` dans les alertes** : la fonction concernée (`buildAlertMonitorSituations`) est en cours de modification dans votre copie principale ; à brancher après fusion, et seulement si Jev est activé.
- Doublons résiduels mineurs, tous servis par le CDN : `/api/arcep` ×3 et `/api/energy/ecowatt` ×2 en 35 s.
