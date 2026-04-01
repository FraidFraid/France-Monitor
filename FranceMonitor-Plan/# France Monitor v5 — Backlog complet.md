 # France Monitor v5 — Backlog complet des enrichissements

## ✅ Points pré-prod traités

 ~~**Valider les selectors CSS de `coupure-elec.fr`**~~ | ✅ **Résolu** — selectors refactorisés (`a[href^="/ville/"]` + `[class*="p-6"]`), log diagnostic `"structure HTML changée ?"` si `stats.total === 0`. Plus de sélecteurs fragiles. |
~~**Clarifier le gap Enedis DataFair vs temps réel**~~ | ✅ **Résolu** — `outages.ts` génère déjà `'Indicateurs Historiques DataFair'`. Banner disclaimer ajouté en 2026-03-26 dans `OutagesPanel._renderElectric()` : "Ces indicateurs sont des données annuelles historiques Enedis — ils ne reflètent pas les pannes en temps réel." |

---

## Mise à jour repo (2026-04-01) — Fixes visuels & Fiabilisation Data

- ✅ **Correction des Pulse Markers (Alerte News)** : Résolution d'un conflit entre WebGL et le DOM dans `DeckGLMap.ts`. Les marqueurs HTML d'alerte critique (`PulseOverlay`) ignoraient le toggle de la couche "Actualités" et s'affichaient dès le zoom 10. Ils sont désormais synchronisés avec l'état réel de la visibilité globale.
- ✅ **Dé-clusterisation des labels AIS Maritimes** : Ajustement de l'affichage textuel des navires sur la carte. Le seuil d'affichage global est repoussé au zoom 10 (au lieu de 8) pour éviter la surcharge visuelle, la lisibilité est préservée au survol et à la sélection.
- ✅ **Stabilisation du réseau Gaz (ODRÉ)** : Fiabilisation de l'intégration des signaux `Ecogaz` et des flux `PEG NaTran` via l'Open Data Réseaux Énergies (ODRÉ). Nettoyage des logs HMR résiduels redondants (`AIS Relay`) pour alléger la console de développement.
- ✅ **Clarification UX Pannes Réseaux** : Précision du disclaimer dans le panneau d'électricité (`OutagesPanel`) pour différencier clairement "PDL hors réseau" (données historiques annuelles DataFair) de la "Tension réseau / Ecowatt" et "BGP Internet" (vrai temps réel).

---

## Mise à jour repo (2026-04-01) — Layer ferroviaire SNCF (trafficRail)

- ✅ **Layer `trafficRail` — Réseau ferroviaire perturbé** : nouveau calque MapLibre persistent dans le groupe TRAFICS. Toggle "RÉSEAU FERROVIAIRE" dans le LayerPanel, ouverture automatique du panneau SNCF à l'activation. Coloration par sévérité : critique `#ff3b30`, élevé `#ff9500`, moyen `#ffcc00`, faible `#8e8e93`.
- ✅ **`buildRailNetworkData()`** ajoutée dans `src/services/transport.ts` — transforme `TransportDisruption[]` en deux `GeoJSON.FeatureCollection` : arcs (LineString départ→arrivée quand les deux coordonnées sont connues) et gares (points dédupliqués par nom, sévérité la plus grave retenue, compteur d'occurrences). Fallback documenté dans le code : disruption sans coordonnées complètes → gare seule sans arc.
- ✅ **5 layers MapLibre** dans `DeckGLMap.ts` : `rail-arc-glow` (halo flou), `rail-arc` (ligne pointillée colorée), `rail-station-glow` (halo gare), `rail-stations-disrupted` (cercle gare), `rail-station-label` (label à partir du zoom 8). Sources `rail-disruptions-arcs-src` et `rail-disruptions-stations-src`.
- ✅ **Vercel serverless `api/transport/disruptions.js`** créé — le répertoire `api/transport/` était vide. Proxy SNCF API avec cache in-process 5 min, Basic Auth, timeout 15s.
- ✅ **Alignement prod/dev** : `sncf-proxy.ts` et `transport.ts` migrent de `/api/sncf/disruptions` vers `/api/transport/disruptions` — cohérence avec le path Vercel sans rewrite `vercel.json`.
- ✅ **Option B assumée** : layer vide si aucune perturbation active — pas de réseau ferroviaire de fond simulé. Mentalité OSINT : pas de signal = réseau calme.

---

## Mise à jour repo (2026-03-27) — Satellite : pivot vers basemap + EO Browser CTAs

- ✅ **Fond de carte satellite Esri World Imagery** ajouté dans `DeckGLMap.ts` — source raster injectée dans le style Carto Dark Matter au `init()`, layer `wm-basemap-satellite` masqué par défaut. Toggle `Satellite/Carte` (bouton `top-right` via `SatelliteBasemapControl`, `IControl` MapLibre). `setBasemapSatellite(enabled)` : affiche le raster Esri + masque les layers `fill`/`background`/`fill-extrusion` de Carto. Aucune clé API requise, attribution Esri obligatoire.
- ✅ **EO Browser CTAs dans les popups** — `MapPopup.ts` : bouton `🛰️ EO Browser` injecté en ligne dans le popup d'actualité (lien `<a>` direct S2 L2A centré sur l'événement via `buildEoBrowserUrl()`). `DeckGLMap.ts` popup Vigicrues : lien `🛰️ Voir SAR dans EO Browser` (collection `sentinel-1-grd`, bbox tronçon de crue). Plus de callback `onSatelliteView` — navigation native.
- ✅ **Nettoyage satellite** — `SatellitePanel.ts` supprimé, `src/plugins/copernicus-proxy.ts` supprimé (+ retiré de `vite.config.ts`), `src/services/copernicus.ts` réduit aux builders d'URL (`buildEoBrowserUrl`, `computeNewsItemBbox`, `computeFloodSegmentBbox`). Types `SatelliteViewState`, `CopernicusScene`, `SatelliteViewRequest`, `SatelliteSourceType` supprimés de `src/types/index.ts`. CSS satellite panel (~200 lignes) remplacé par styles minimalistes basemap toggle + CTAs.

---

## Mise à jour repo (2026-03-27) — Refonte Feux Actifs (FIRMS)

- ✅ **Ingestion Multi-source** : Basculement vers l'API NASA FIRMS avec intégration de 3 satellites (SNPP + NOAA-20 + NOAA-21). Filtrage géographique (BBox France) et déduplication réalisés côté serveur (`api/fires.js`). Fallback natif conservé si la clé n'est pas fournie.
- ✅ **Clustering "Incidents" (DBSCAN)** : Algorithme de clustering spatial implémenté en TypeScript pur `src/services/fire-clustering.ts`. Identifie les "foyers" au lieu de détections brutes isolées. Inclus un moteur de **scoring de gravité** (0-100) tenant compte du FPR, du temps écoulé, et de la densité.
- ✅ **Géocodage & Contextualisation** : Géocodage asynchrone pour afficher la commune la plus proche à côté des coordonnées GPS (via `fetchNearbyCommuneLabel`), appliqué aux centroïdes d'incidents et aux points orphelins. Intégration également d'un bloc dynamique "À savoir sur FIRMS" expliquant les sources et métadonnées en cours d'utilisation dans `FiresPanel.ts`.
- ✅ **Cartographie interactive (Highlight)** : Refonte de la connectique de survol (hover) ; le survol d'un incident entier dans la sidebar déclenche un highlight lumineux (`SRC_FIRES_HIGHLIGHT`) sur **tout le cluster** spatialement correspondant dans `DeckGLMap.ts` pour une meilleure localisation visuelle. Correction du bubbling d'événements JS garantie.

---

## Mise à jour repo (2026-03-26) — Quick wins backlog

- ✅ **Président de Département** (backlog #10) — déjà entièrement implémenté (découvert lors de l'audit) : `PRESIDENTS_DEPARTEMENT` (95 depts), `fetchElus()`, `ElusPanel._renderPresidentDept()`. Mis à jour roadmap.
- ✅ **Wording Enedis** (backlog "À faire avant prod") — note disclaimer ajoutée en haut du tab électricité dans `OutagesPanel._renderElectric()` : "Ces indicateurs sont des données annuelles historiques Enedis (DataFair) — ils ne reflètent pas les pannes en cours en temps réel."

---

## Mise à jour repo (2026-03-28) — Gouvernement / PM : sources officielles + cleanup UI

- ✅ **Chaîne de vérité gouvernement unifiée** — la résolution du gouvernement et du Premier ministre passe désormais par des sources officielles (`Service-Public / JORF`) avec fallback statique si indisponible. La logique est mutualisée entre dev et prod via `api/_shared/ministers.js`, `src/services/ministers.ts`, `src/plugins/ministers-proxy.ts` et `api/ministers/*`.
- ✅ **Wikidata reclassé en enrichissement** — Wikidata n'est plus considéré comme source de vérité pour le titulaire du poste ; il sert uniquement à enrichir les fiches (bio, photo, liens).
- ✅ **Production alignée sur le dev** — routes serverless `api/ministers/*` ajoutées pour éviter le décalage précédent entre proxy Vite et prod.
- ✅ **Traçabilité OSINT renforcée** — les fiches ministres exposent désormais un statut de vérification (`official-live`, `official-directory`, `fallback-static`), une chaîne de sources et un niveau de confiance.
- ✅ **Cleanup UI du panneau latéral gouvernement** — suppression du doublon "gouvernement dans gouvernement" : plus de faux widget PM en header, plus de sous-header interne ni de carte englobante inutile dans le panneau latéral.

---

## Mise à jour repo (2026-03-28) — Sentinel crues : état réel du repo

- ✅ **Sentinel-2 recentré sur les crues** — le flux news n'est plus le point d'entrée produit. Le chantier utile est désormais `Vigicrues -> modal Sentinel -> comparaison avant / après` sur zone de crue.
- ✅ **Viewer NDWI S2 branché** — le modal Sentinel peut générer un rendu `NDWI` à partir de `STAC + CDSE Process API`, avec cache mémoire backend/proxy, gestion d'erreur plus lisible et fallback `EO Browser` si l'authentification CDSE échoue.
- 🔄 **Couleurs NDWI réalignées sur le rendu Copernicus / Sentinel Hub** — le rendu s'appuie désormais sur une rampe continue officielle `vert -> blanc -> bleu`. Le sujet restant n'est plus la connectique mais le choix UX autour de cette visualisation.
- 🔄 **UI Sentinel nettoyée mais encore à stabiliser** — le modal a été simplifié, recentré sur l'image et les métadonnées utiles, mais le polish final desktop reste encore un sujet d'ajustement UX.
- ⏸️ **Sentinel-1 SAR gelé proprement** — pas de faux viewer SAR in-app basé sur des thumbnails catalogue. `S1` reste explicitement un sujet `Phase 2 backend raster`.
- ✅ **Mock Vigicrues retiré** — le segment `TEST DEV — Seine Paris centre` injecté en développement a été supprimé. Le service `vigicrues.ts` revient à un comportement `live only`.

---

## Roadmap mise à jour (2026-03-28) — Après sprint Sentinel

### Ce qui est effectivement livré

| Bloc | État réel | Notes |
|---|---|---|
| `S2 crues` | ✅ Fonctionnel | modal Sentinel depuis Vigicrues, scènes S2, comparaison `avant / après`, génération NDWI |
| `NDWI backend` | ✅ Fonctionnel | `STAC + CDSE Process API`, cache mémoire, erreurs explicites, fallback EO Browser |
| `S1 viewer in-app` | ⏸️ Gelé | pas de preview SAR trompeuse tant qu'aucun backend raster dédié n'est disponible |
| `News -> Sentinel` | ❌ Retiré | le flux Sentinel n'est plus branché sur les actualités |
| `Blink / afficher sur carte` | ❌ Retiré | options supprimées car non fiables / non produit |
| `Mock Vigicrues dev` | ❌ Retiré | retour au flux réel uniquement |

### Position produit actuelle

| Sujet | Décision actuelle | Ce qui manque encore |
|---|---|---|
| Sentinel-2 | focalisé sur `crues + NDWI + avant / après` | polish UX final, stabilité visuelle, éventuel affinage AOI |
| Sentinel-1 | gelé côté front | source raster/tuiles crédible avant toute réintégration |
| Carte principale | pas d'overlay Sentinel persistant | si besoin futur : vraie source raster standard branchée proprement |
| EO Browser | fallback assumé | reste l'outil de secours quand le rendu in-app échoue |

### Phase 2 à ouvrir si on continue

| Ticket | Objet | Avantages | Risques | Taille |
|---|---|---|---|---|
| Option A | **Étudier Sentinel Hub** | Intégration rapide, vraies tiles / recipes prêtes | coût récurrent, dépendance SaaS | M |
| Option B | **Étudier microservice raster self-hosted** (`TiTiler / GDAL`) | maîtrise complète, architecture pérenne | plus de DevOps, coût d'intégration plus élevé | L |
| Option C | **Étudier produits flood officiels** | posture OSINT crédible, temps d'intégration réduit | couverture / formats / licences à valider | S-M |

### Tâche backlog à conserver

- **Backend raster Sentinel-1/2 (Phase 2)** : brancher une source tuilée `S1 / S2` (`Sentinel Hub`, microservice raster ou produits flood officiels) et l'exposer comme layer standard dans la carte.

---

## Mise à jour repo (2026-03-26) — Détection brouillage GPS / Guerre Électronique

- ✅ **GPS Jamming Detection** : détecteur heuristique stateful `src/services/gps-jamming.ts` — 6 signaux ADS-B (NAC-P faible, chute NAC-P, vitesse implicite aberrante, ghost track, stall speed, cluster spatio-temporel ×1.4). Passthrough `nac_p` depuis `AdsbFiAircraft` (adsb.fi v2) jusqu'à `MilitaryFlight.nacP`. Mode best-effort si NAC-P absent (via proxy serverless). Seuils conservateurs, expiry state 5 min, gate hélico/drone sur le signal vitesse sol.
- ✅ **GpsJammingSignal** : nouveau type dans `src/types/index.ts` — `id`, `position [lng, lat]`, `timestamp` (Unix sec), `severity`, `confidence`, `reasons[]`, `affectedIcao24s[]`, `clusterRadius?`.
- ✅ **Toasts GPS jamming interactifs** : `showJammingSignals()` dans `ToastNotification.ts` — icône `📡`, bouton Voir, dedup par cellule 0.5°, cooldown 3 min. Clic corps ou bouton Voir → `flyTo` + activation couche military via `onLayerToggle('military', true)` (cascade `sovereignty` automatique) + `layerPanel.updateLayers`.
- ✅ **Intégration App.ts** : appelé dans `startMilitaryPolling()` après `detectMilitarySurges`, handler `setOnJammingSignalClick` avec zoom adaptatif (individuel : 11, cluster ≤50 km : 9, cluster >50 km : 8).

---

## Mise à jour repo (2026-03-23) — session 2

- ✅ **ISNR AI Synthesis** : serverless `api/intelligence/isnr-synthesis.js` (Groq + cache Upstash Redis 10 min), service frontend `src/services/isnr-synthesis.ts`, plugin Vite dev `src/plugins/isnr-synthesis-proxy.ts`. Câblé dans la boucle de refresh du baromètre (`App.ts`). `isnrNationalScore` injecté dans le prompt IA (prod edge function + dev proxy).
- ✅ **Section "AI BRIEFING"** ajoutée dans `BarometerWidget.ts` — briefing généré par Groq affiché sous l'arc SVG.
- ✅ **Progress bar `stabilityImpact`** ajoutée dans `BarometerWidget.ts`.
- ✅ **Fix layout arc+labels** : wrappé dans une inner row pour que "AI BRIEFING" se rende bien sous le widget.
- ✅ **Fix normalisation télécom** : diviseur `/5` → `/50` dans `normalizeTelecom()` (`network-barometer.ts`). Thresholds recalibrés : 0 HS → 100, 500 HS (routine) → 90, 2500 HS → 50, 5000 HS (10% réseau ~50k antennes) → 0.
- ✅ **Alertes épidémiques actives** dans `NationalHealthPanel.ts` : section `renderEpidemicAlerts()` avec tableau `EPIDEMIC_ALERTS` (cards color-codées critical/high/warning). Premier cas : Méningocoque B — cluster La Hague (Orano, Manche, 19/03).

---

## Mise à jour repo (2026-03-23)

- ✅ **Baromètre Pannes Réseau France** implémenté complet : `src/services/network-barometer.ts` + `src/components/BarometerWidget.ts`. Score composite 0–100 agrégeant Ecowatt (30%), BGP/IODA (25%), ARCEP (15%), Météo spatiale (10%), Cyber CERT-FR (5%). Cloud/Web phantom (15%, toujours null, redistribué automatiquement). Widget dans la sidebar gauche avant les couches, tooltip détaillé au hover, arc SVG animé, pulsation critique. Label DataFair corrigé dans `outages.ts`.

---

## Mise à jour repo (2026-03-20)

- ✅ `ai-classifier.ts` est déjà **branché** dans le pipeline RSS asynchrone via `App.ts` (`runAIClassification()`).
- ✅ `summarization.ts` est déjà **branché** dans le pipeline RSS asynchrone via `App.ts` (`runSummarization()`).
- 🔄 Le **maritime AIS** est déjà **bien présent en couche live partielle** : relais AIS local, `trafficMaritime`, trafic mondial/civil, navires militaires français, loader de connexion, statut de source, anomalies AIS et premiers signaux défense/câbles. Reste : robustesse produit, filtrage, port intelligence et UX analytique dédiée.
- 🔄 Le **gaz** est déjà **branché sur des sources réelles** : `EcoGaz` (signal) + `ODRE` (stockages, flux PIR) + infrastructure statique enrichie. La couche reste **partielle** car certains flux/interconnexions basculent encore sur des valeurs de fallback visuel quand la donnée live manque ou ne matche pas proprement.

---

## Priorité HAUTE (9 features)

| # | Feature | Source | Effort | Valeur ajoutée |
|---|---------|--------|--------|----------------|
| 1 | ~~**Tracking Maritime AIS**~~ 🔄 **PARTIEL** | aisstream.io WebSocket | Moyen | Flux AIS live déjà câblé (`military-ships.ts`, `getAllLiveTraffic()`, layer `trafficMaritime`). Reste : robustesse relais, filtrage, analyse portuaire/sûreté et UX dédiée. |
| 2 | ~~**Pannes Internet/BGP**~~ ✅ **FAIT** | Georgia Tech IODA + BGPView | — | Implémenté complet : `api/internet-outages.js` + `src/services/internet-outages.ts` + vite plugin. 6 ISPs français (Orange, Free, SFR, Bouygues, OVH, Scaleway), score national 0–100, circuit breaker, déduplification events. |
| 3 | ~~**Maire par commune**~~ 🔄 **EN COURS** | data.gouv.fr RNE | — | Voir bloc élus ci-dessous |
| 4 | ~~**Député par circonscription**~~ 🔄 **EN COURS** | nosdeputes.fr API | — | Voir bloc élus ci-dessous |
| 5 | ~~**Sénateur par département**~~ 🔄 **EN COURS** | nossenateurs.fr API | — | Voir bloc élus ci-dessous |
| 6 | ~~**Ministre par portefeuille**~~ ✅ **FAIT / ÉTENDU** | Service-Public / JORF + fallback `GOUVERNEMENT` + Wikidata enrichissement | — | Panneau gouvernement live/fallback branché (`ministers.ts`, `api/ministers/*`). Affichage contextuel par catégories déjà opérationnel. Reste éventuel : exposition plus profonde dans `elus.ts` ou cross-links carte. |
| 7 | ~~**Président de Région**~~ ✅ **FAIT** | Static map codeRegion | — | Déjà affiché dans le bloc élus via map statique `PRESIDENTS_REGION`, avec rendu dans `ElusPanel`. Voir bloc élus ci-dessous. |
| 8 | ~~**Imagerie MODIS (feux/fumée)**~~ ✅ **FAIT** | NASA GIBS | — | Overlay raster VIIRS SNPP Corrected Reflectance (NASA GIBS WMTS) sous les points FIRMS. Toggle dans `FiresPanel` (en haut, sous "À savoir sur FIRMS"). Date J-2 calculée dynamiquement. Source MODIS Terra abandonnée (hors service 2026) → VIIRS SNPP cohérent avec les données FIRMS. Voir architecture ci-dessous. |
| 9 | ~~**Interpolation position avions**~~ ✅ **FAIT** | Calcul client | — | `interpolateFlightPosition()` déjà dans `military-flights.ts`, maintenant appelée via timer 1s dans `DeckGLMap._startFlightInterpolation()`. GeoJSON icônes interpolé chaque seconde, trails mis à jour uniquement sur fetch réel (5s). Interval nettoyé dans `destroy()`. |

## Priorité MOYENNE (7 features)

| # | Feature | Source | Effort | Valeur ajoutée |
|---|---------|--------|--------|----------------|
| 10 | ~~**Président de Département**~~ ✅ **FAIT** | Static map `PRESIDENTS_DEPARTEMENT` | — | Déjà implémenté : table statique 95 départements dans `elus.ts`, exposé dans `fetchElus()`, rendu dans `ElusPanel._renderPresidentDept()` section "🏛 DÉPARTEMENT". |
| 11 | **Préfet de département** | data.gouv.fr / Légifrance | Faible | Pertinent lors de crises (arrêtés préfectoraux, plans ORSEC) |
| 12 | ~~**Premier Ministre**~~ ✅ **RECADRÉ** | Service-Public / JORF + fallback `GOUVERNEMENT` | — | Pas de badge PM dédié dans le header. Le PM est résolu et affiché dans le panneau gouvernement latéral avec sources officielles, fallback statique, et enrichissement Wikidata séparé. |
| 13 | ~~**Imagerie Sentinel-2 (post-crise)**~~ 🔄 **PARTIEL** | Copernicus/ESA + Esri | — | Flux crues recentré sur `Sentinel-2 avant / après` : endpoint STAC déjà branché, recadrage AOI côté modal, métadonnées minimales et sélection de scènes en cours de stabilisation. À clore quand la sélection auto de 2 dates, le toggle avant/après et le recadrage AOI sont validés proprement. |
| 14 | ~~**Imagerie Sentinel-1 SAR (crues)**~~ ⏸️ **GELÉ PHASE 2** | Copernicus/ESA | — | Le viewer `S1` in-app est gelé jusqu'au choix d'un backend raster dédié. Pas de faux viewer SAR basé sur des thumbnails catalogue. Reprise prévue uniquement via une vraie source tuilée ou des produits flood dérivés officiels. |
| 15 | ~~**Détection brouillage GPS**~~ ✅ **FAIT** | NAC-P / ADS-B data | — | `src/services/gps-jamming.ts` — détecteur stateful 6 heuristiques (NAC-P faible/chute, vitesse implicite aberrante, ghost track, stall speed, cluster spatio-temporel). Passthrough `nacP` depuis `adsb.fi v2` via `MilitaryFlight`. Toasts interactifs `📡 Suspicion de brouillage GPS` avec bouton Voir + `flyTo` + activation couche militaire. Voir Architecture ci-dessous. |
| 16 | **Intel cards clic droit** | Agrégation interne | Moyen | Fiche contextuelle sur clic : maire + sénateur + député + dernières alertes de la zone |

## Priorité BASSE (5 features)

| # | Feature | Source | Effort | Valeur ajoutée |
|---|---------|--------|--------|----------------|
| 17 | **Eurodéputé par région** | europarl.europa.eu / Wikidata | Faible | Pertinent pour événements UE affectant la France |
| 18 | ~~**Météo spatiale (Kp index)**~~ ✅ **FAIT** | NOAA SWPC | — | `src/services/space-weather.ts` + widget dans `EnergyPanel`. 7 niveaux Kp (calme → extrême G4-G5), risque France contextualisé, refresh 15 min. Fix bug : `contentEl.innerHTML` détachait `_kpCardEl` du DOM — corrigé par ré-attachement post-render. |
| 19 | **Satellites (CelesTrak + SGP4)** | CelesTrak | Moyen | Layer espace — CNES/Syracuse, pertinent mais secondaire |
| 20 | **Imagerie NICFI Planet** | Planet Labs | Faible | 4.77m résolution zones rurales — forêts, agriculture |
| 21 | ~~**Layer jour/nuit terminator**~~ ✅ **FAIT** | Calcul astronomique | — | `src/layers/DayNightLayer.ts` (Deck.gl CompositeLayer) + `src/components/DayNightPanel.ts` (panneau droit flottant draggable). 3 couches séparées (Nuit / Crépuscules / Soleil), slider ±12h, légende OSINT. Voir notes architecture ci-dessous. |

## Phase 3 — Reste à faire (backlog technique)

| Tâche | Priorité | Effort | Notes |
|-------|----------|--------|-------|
| **Enedis ORE API réelle** (pannes temps réel) | P1 | Haut | DataFair historique déjà branché. Manque : données temps réel panne en cours. API ORE non publique — explorer data.gouv flux ou partenariat |
| ~~**LLM classification async**~~ ✅ **BRANCHÉ** | — | — | `App.ts` lance déjà `runAIClassification()` en background sur les items RSS sans menace. Reste : tuning des seuils, observabilité et éventuel upgrade modèle. |
| ~~**Flux gaz réels**~~ 🔄 **PARTIEL** | P2 | Faible | `EcoGaz` + datasets `ODRE` déjà branchés dans `src/services/gas.ts`. Reste : clarifier ce qui est réel vs simulé dans les interconnexions et fiabiliser la visualisation. |
| **Trafic aérien civil robuste** (OpenSky pro) | P2 | Moyen | Quota API |
| **Cloudflare Radar token** (pannes cloud) | P3 | Trivial | Juste la clé env |
| **Desktop Tauri v2** | P4 | Haut | Nouvelle phase |
| ~~**Summarization IA des articles RSS**~~ ✅ **BRANCHÉ** | — | — | `App.ts` lance déjà `runSummarization()` en background et met à jour `aiSummary` sur les articles. Reste : UX de restitution, retry policy et pilotage local/cloud. |

## État des layers — Infrastructure & Réseaux

| Layer | Source(s) | Statut | Notes |
|-------|-----------|--------|-------|
| **Pannes ⚡ Électricité** | Enedis DataFair (3 endpoints) + Ecowatt | 🟢 Réel (historique) | `outages.ts` interroge les vrais endpoints DataFair : indicateurs continuité + fréquence + durée BT par département. Signal Ecowatt croisé. Données agrégées historiques (pas temps réel panne). API ORE temps réel non publique — reste un axe d'amélioration. |
| **Pannes 📱 Télécom 4G/5G** | ARCEP data.gouv | ✅ Réel | `api/arcep.js` + proxy dev |
| **Pannes ☁️ Internet BGP** | IODA (CAIDA) + BGPView | ✅ Réel | 6 ISPs français, events 24h + alerts actives, score national 0–100, circuit breaker |
| **Pannes ☁️ Cloud / IXP** | OVH·Scaleway·AWS·GCP·CF Statuspage + PeeringDB | ✅ Réel | CF Radar optionnel (CLOUDFLARE_RADAR_TOKEN) |
| **Pannes ⚡ Crowd-sourced** | infocoupure.fr + coupure-elec.fr | ✅ Réel | `api/outages/citizen.js` — scraping HTML réel (wpDiscuz comments), clustering DBSCAN Turf.js (rayon 10km, min 3 points), géocodage API Adresse, corrélation Ecowatt côté client. Vite plugin dev avec fallback mock. |
| **Énergie / Ecowatt** | RTE Écowatt | ✅ Réel | OAuth2 RTE |
| **Nucléaire** | EDF → | 🟡 Simulé | API EDF non publique — statuts de maintenance mockés |
| **Réseau Gaz** | EcoGaz + ODRE + config infra | 🟡 Partiel | `fetchGasNetwork()` consomme déjà EcoGaz + stockages + flux PIR/ODRE. Les interconnexions restent à rendre plus explicitement réelles côté UI et certains flux sont encore simulés en fallback. |
| **Réseau Pétrole** | UFIP / data.gouv | ✅ Réel | Stocks, raffineries, dépôts |
| **Câbles sous-marins** | GeoJSON statique | ✅ Réel | Données statiques (SubmarineCableMap) |

## État des layers — Surveillance / Sécurité

| Layer | Source(s) | Statut | Notes |
|-------|-----------|--------|-------|
| **Militaire / Vols** | ADSB-Exchange | 🟡 Partiel | Mock fallback si CORS bloqué |
| **Maritime (AIS)** | AISStream + relais local | 🟡 Partiel | Layer AIS live déjà branché côté app (`getAllLiveTraffic()`, `trafficMaritime`). Fallback statique/mock si relais offline ou absence de données. |
| **Cyber** | CERT-FR (ANSSI) + RansomwareLive + NVD/NIST | ✅ Réel | Score tension 0–100 |
| **Défense / Câbles** | Détection corrélation AIS | ✅ Réel | AlertesCâbles sous-marins |

## État des layers — Transport & Mobilité

| Layer | Source(s) | Statut | Notes |
|-------|-----------|--------|-------|
| **Transport SNCF** | API SNCF (`/api/transport/disruptions`) | ✅ Réel | Disruptions temps réel + layer carte `trafficRail` : arcs colorés par sévérité + gares impactées. Panneau latéral auto-ouvert à l'activation du layer. |
| **Trafic routier** | TomTom | ✅ Réel | Incidents + flux |
| **Trafic aérien** | OpenSky | 🟡 Partiel | Preview — quotas limités sans compte pro |

## État des layers — Environnement & Santé

| Layer | Source(s) | Statut | Notes |
|-------|-----------|--------|-------|
| **Météo / Vigilance** | Météo-France | ✅ Réel | API portail (clé requise) |
| **Crues / Vigicrues** | SCHAPI | ✅ Réel | Tronçons de rivières |
| **Feux de forêt** | NASA FIRMS + NASA GIBS | ✅ Réel | Clustering DBSCAN (SNPP+NOAA20+NOAA21), géocodage commune + overlay raster VIIRS. Highlight dynamique. |
| **Santé (ISS/OSCOUR/APL)** | Santé Publique France + DREES | ✅ Réel | Score stress sanitaire composite |
| **Jour / Nuit** | Calcul astronomique (pure JS) | ✅ Implémenté | Deck.gl CompositeLayer — 4 zones empilées (civil/nautique/astro/nuit) + point subsolaire. Panneau droit draggable avec slider ±12h UTC. Aucune API externe. |

## État des layers — Économie & Renseignement

| Layer | Source(s) | Statut | Notes |
|-------|-----------|--------|-------|
| **Finance (CAC40…)** | Boursorama / Yahoo Finance | 🟡 Partiel | Données réelles + mock fallback si quota |
| **Baromètre Pannes Réseau** | Ecowatt + IODA + ARCEP + NOAA + CERT-FR | ✅ Réel | Score composite 0–100, sidebar gauche, arc SVG animé, refresh 5 min |
| **ISNR (Indice Stabilité)** | Composite (tous services) | ✅ Réel | Score 0–100 calculé en temps réel |
| **Métropoles électriques** | RTE / Ecowatt | ✅ Réel | Conso par métropole |
| **Actualités RSS PQR** | 100+ sources | ✅ Réel | Classifieur keyword + géocodage + enrichissements async déjà branchés (classification ML et résumé IA). |

## Architecture — DayNightLayer (2026-03-19)

| Fichier | Rôle |
|---------|------|
| `src/layers/DayNightLayer.ts` | Deck.gl `CompositeLayer` — calcul astronomique + rendu WebGL |
| `src/components/DayNightPanel.ts` | Panneau UI droit draggable (horloge UTC, slider ±12h, 3 toggles, légende) |
| `src/components/DeckGLMap.ts` | `updateDayNightOptions()` + champ `dayNightOptions` |
| `src/components/MapContainer.ts` | Proxy `updateDayNightOptions()` |
| `src/services/space-weather.ts` | `computeTerminatorGeoJSON()` (MapLibre backup — désactivé, `LYR_TERMINATOR` toujours masqué) |

**Algorithme** : `subsolarPoint(ts)` via VSOP87 simplifié (JD → écliptique → équatorial → GMST). `terminatorLat()` résout l'équation trigonométrique pour chaque longitude. `buildNightPolygon()` génère la courbe −180→+180 + cap pôle.

**Piège cap** : `sunLat ≥ 0 → cap nord`, `sunLat < 0 → cap sud` — sens contre-intuitif mais correct pour earcut. L'inverser fait couvrir le côté jour.

**Rendu empilement** : 4 `PolygonLayer` superposés (civil α55 → nautique α80 → astro α100 → nuit α140). Pas de trous — `buildTerminatorRing` renvoie une courbe ouverte que Deck.gl fermerait en trait horizontal si utilisée comme trou.

**Intégration** : `onLayerToggle('dayNight')` → show/hide `DayNightPanel`. Le panel émet `onChange({showNight, showTwilight, showSunIcon, timestamp})` → `mapContainer.updateDayNightOptions()`. `LYR_TERMINATOR` MapLibre toujours masqué pour éviter le double rendu.

---

## Architecture — VIIRS Overlay (NASA GIBS) (2026-03-19)

| Fichier | Modification |
|---------|-------------|
| `src/components/DeckGLMap.ts` | `SRC_MODIS` + `LYR_MODIS` (raster, masqué par défaut), `_modisOverlayEnabled`, `setModisOverlayVisible()`, `_buildGibsDate()` |
| `src/components/MapContainer.ts` | Proxy `setModisOverlayVisible()` |
| `src/components/FiresPanel.ts` | Toggle "Imagerie VIIRS" (sous "À savoir sur FIRMS"), callback `onModisToggleCb` |
| `src/App.ts` | Câblage `firesPanel.setOnModisToggle → mapContainer.setModisOverlayVisible` |

**Source** : WMTS NASA GIBS — `VIIRS_SNPP_CorrectedReflectance_TrueColor`, EPSG:3857, date J-2 calculée dynamiquement (`_buildGibsDate()`). MODIS Terra abandonné (hors service 2026). `LYR_MODIS` inséré avant `LYR_FIRES_GLOW` → s'affiche sous les points FIRMS.

**Piège visibilité** : ne pas lire `getLayoutProperty(LYR_FIRES_GLOW)` pour conditionner l'activation — MapLibre retourne `undefined` si la propriété n'a jamais été settée explicitement, bloquant l'activation silencieusement.

---

---

## Architecture — Bloc Élus ✅ VERSION FONCTIONNELLE EN PLACE (2026-03-19)

### État actuel
- ✅ Panneau flottant draggable, clic direct sur la carte (n'importe où)
- ✅ Commune, département, région, population via `geo.api.gouv.fr`
- ✅ Proxy Vite `elusProxyPlugin` pour contourner CORS sur toutes les sources
- ✅ Map `PRESIDENTS_REGION` corrigée (codes INSEE corrects, DROM inclus)
- ✅ Map `PRESIDENTS_DEPARTEMENT` branchée
- ✅ Photos des élus (nosdeputes.fr / nossenateurs.fr) + popup détail au clic
- ✅ Version fonctionnelle : maire + députés + sénateurs + président de département + président de région déjà affichés dans le panel
- 🔄 Données maire : `tabular-api.data.gouv.fr` lent (~timeout parfois) — à optimiser
- 🔄 Données députés/sénateurs : `www.nosdeputes.fr` / `www.nossenateurs.fr` — à valider stabilité
- ❌ Pas encore de données pour les DROM (hors carte métropolitaine)
- ❌ Photo maire non disponible (RNE ne fournit pas de photo)

### Fichiers créés/modifiés

| Fichier | Rôle |
|---------|------|
| `src/services/elus.ts` | Service : commune, maire, députés, sénateurs, président de département, président de région |
| `src/components/ElusPanel.ts` | Panneau flottant draggable — clic carte → show(lat,lon). Cartes cliquables → popup détail |
| `src/plugins/elus-proxy.ts` | Proxy Vite : `/api/elus/communes`, `/maire`, `/deputes`, `/senateurs`, `/departements/:code`, `/regions/:code` |
| `src/App.ts` | Mount + wiring `setOnRawMapClick` (clic direct carte) + `onLayerToggle('elus')` |
| `src/components/DeckGLMap.ts` | `onRawMapClick` callback + `setOnRawMapClick()` |
| `src/components/MapContainer.ts` | Proxy `setOnRawMapClick()` + stockage field pour init() |

### Sources de données

| Donnée | API (via proxy) | Cache |
|--------|-----------------|-------|
| Commune (nom, INSEE, dept, région, population) | `geo.api.gouv.fr/communes?lat=&lon=` | 30 min coord |
| Noms dept/région | `geo.api.gouv.fr/departements/:code`, `/regions/:code` | 30 min coord |
| Maire | `tabular-api.data.gouv.fr` RNE (filtre fonction = Maire, hors adjoints) | 30 min coord |
| Députés | `www.nosdeputes.fr/deputes/json` (filtre `num_deptmt`) | 6h global |
| Sénateurs | `www.nossenateurs.fr/senateurs/json` (filtre `num_dept`) | 6h global |
| Président de Département | Static map `PRESIDENTS_DEPARTEMENT[codeDepartement]` | — |
| Président de Région | Static map `PRESIDENTS_REGION[codeRegion]` (MAJ après élections 2027) | — |
| Photos | `www.nosdeputes.fr/depute/photo/{slug}.jpg` / `www.nossenateurs.fr/senateur/photo/{slug}.jpg` | navigateur |

### Panel UI
6 sections color-codées : Localisation (indigo) · Mairie (bleu) · Assemblée (violet) · Sénat (rouge) · Département (ambre) · Région (vert). Cartes élus cliquables → overlay détail (grande photo, mandat, né(e) le, groupe, circonscription). Loading spinner pendant fetch. Graceful degradation par section si API échoue.

---

## Architecture — Baromètre Pannes Réseau + AI BRIEFING ✅ FAIT (2026-03-23)

### Fichiers créés/modifiés

| Fichier | Action | Rôle |
|---------|--------|------|
| `src/services/network-barometer.ts` | Créé | Service composite : agrège les caches des services upstream, normalise, calcule score global |
| `src/components/BarometerWidget.ts` | Créé | Widget standalone (pas d'extension Panel) — arc SVG + score + label + tooltip hover |
| `src/styles/main.css` | Modifié | `.barometer-arc` (transition + rotation 12h), `@keyframes barometerPulse`, `.barometer-pulse` |
| `src/App.ts` | Modifié | Import, champs, mount sidebar, boucle polling 5 min, destroy |
| `src/services/outages.ts` | Modifié | Label `'Bilan Enedis (historique annuel)'` → `'Indicateurs Historiques DataFair'` |

### Pondérations et normalisation

| Source | Poids | Normalisation |
|--------|-------|---------------|
| Ecowatt (élec) | 30% | Moyenne des signaux régionaux : green→100, orange→60, red→20 |
| BGP/IODA (internet) | 25% | `nationalScore` déjà 0–100, passage direct |
| ARCEP (télécom) | 15% | `100 − (hsSites / totalSites) × 200`, plancher 0 |
| Cloud/Web | 15% | Toujours `null` (phantom weight) — redistribué automatiquement |
| Météo spatiale (Kp) | 10% | `100 − kp × 12`, plancher 0 |
| Cyber CERT-FR | 5% | `100 − globalScore` (polarité inversée : 0=calme → health 100) |

**Score global** : `Σ(score × poids) / Σ(poids_actifs)` — divise par les poids actifs (pas 100), donc cloud null → activeWeights=85, renormalisation automatique.

**Seuils** : ≥ 85 → `nominal` (vert `#34c759`) · 60–84 → `degraded` (orange `#ffcc00`) · < 60 → `critical` (rouge `#ff2d55`).

### Positionnement

Widget monté sur `#sidebar-content` comme **premier enfant**, avant `LayerPanel`. `position: relative; width: 100%; margin-bottom: 8px` — intégré dans le flux de la sidebar. Tooltip positionné `top: calc(100% + 4px); left: 0; right: 0` (tombe sous le widget).

### Pièges notables

- **`transform-box: fill-box`** requis en SVG pour que `transform-origin: center` soit relatif à l'élément et non au viewport — sans ça, la rotation 12h du cercle est décalée.
- **`barometerPulse`** est un nouveau keyframe distinct de `alertPulse` existant (qui anime scale 0.5→1.5 + opacity→0, inadapté pour un dot permanent).
- **Cyber polarity** : `CyberState.meta.globalScore` augmente avec les menaces — il faut inverser (`100 − globalScore`) pour obtenir un score de santé.
- **`SpaceWeatherData`** s'importe depuis `./space-weather.ts`, pas depuis `../types/index.ts`.

### Trigger
Layer "Élus & Représentants" activé dans LayerPanel → placeholder "Cliquez n'importe où sur la carte" → clic carte → `onRawMapClick(lat, lon)` → `elusPanel.show()`. Le clic est intercepté dans le handler global MapLibre après cluster/articles.

---

## Architecture — ISNR AI Synthesis ✅ FAIT (2026-03-23)

### Fichiers créés/modifiés

| Fichier | Action | Rôle |
|---------|--------|------|
| `api/intelligence/isnr-synthesis.js` | Créé | Serverless Vercel — prompt Groq (llama-3.3-70b-versatile) avec contexte ISNR, cache Upstash Redis 10 min |
| `src/services/isnr-synthesis.ts` | Créé | Frontend service — `fetchISNRSynthesis(isnrScore)` → `{ briefing, model, cachedAt }` |
| `src/plugins/isnr-synthesis-proxy.ts` | Créé | Plugin Vite dev — route `/api/intelligence/isnr-synthesis`, forwardant vers Groq en dev |
| `src/components/BarometerWidget.ts` | Modifié | Section "AI BRIEFING" sous l'arc SVG, progress bar `stabilityImpact`, fix layout inner row |
| `src/App.ts` | Modifié | Forward `isnrNationalScore` vers `fetchISNRSynthesis()` dans la boucle refresh |
| `src/services/summarization.ts` (fetch service) | Modifié | Passage de `isnrNationalScore` dans le contexte du prompt |

### Flow de données

```
App.ts (refresh 5 min)
  → stabilityIndex.getNationalScore()          // ISNR 0–100
  → fetchISNRSynthesis(isnrScore)              // appel serverless
    → Groq llama-3.3-70b-versatile             // génère briefing FR
    → Upstash Redis cache 10 min               // évite sur-quota Groq
  → barometerWidget.update({ ..., aiSynthesis })
    → section "AI BRIEFING" dans le widget
```

### Prompt engineering
Le score ISNR est injecté littéralement dans le prompt avec contexte France (infrastructures, sécurité, météo, transport) pour que Groq génère un briefing opérationnel ~2–3 phrases en français.

---

## ~~Baromètre Pannes Réseau France (à implémenter)~~ ✅ FAIT

> Voir "Architecture — Baromètre Pannes Réseau" ci-dessus + session 2 du 2026-03-23 pour l'AI BRIEFING.

### Quick wins restants
- Option future : ajouter **badge PM dans le header** si souhaité, mais sans changer la source de vérité officielle ni dupliquer le panneau gouvernement

---

## Architecture — GPS Jamming Detection ✅ FAIT (2026-03-26)

### Fichiers créés/modifiés

| Fichier | Action | Rôle |
|---------|--------|------|
| `src/services/gps-jamming.ts` | Créé | Détecteur stateful — 6 heuristiques ADS-B, clustering 100 km, expiry state 5 min |
| `src/types/index.ts` | Modifié | `nacP?: number` sur `MilitaryFlight` + nouveau type `GpsJammingSignal` |
| `src/services/military-flights.ts` | Modifié | `nac_p?: number` sur `AdsbFiAircraft`, passthrough dans `parseFlight` et `parseProxyAircraft` |
| `src/components/ToastNotification.ts` | Modifié | `GpsJammingSignalClickHandler`, `setOnJammingSignalClick()`, `showJammingSignals()`, toast `📡` interactif |
| `src/App.ts` | Modifié | Import + appel `detectGpsJammingSignals(flights)` + handler clic avec `flyTo` + activation couche |

### Heuristiques (seuils conservateurs)

| # | Signal | Condition | Confiance |
|---|--------|-----------|-----------|
| 1 | NAC-P faible | `nacP < 3` en vol (alt > 500 ft) | +0.40 |
| 2 | NAC-P chute brutale | Drop ≥ 5 niveaux vs snapshot précédent | +0.25 |
| 3 | Vitesse implicite aberrante | Haversine(prev, curr) → speed > 1 800 km/h sur Δt < 5 min | +0.35 |
| 4 | Ghost track | ≥ 4 points trail dans rayon 3 km + speed > 50 kts | +0.35 |
| 5 | Stall speed en vol | 0 < speed < 15 kts + alt > 500 ft (exclu hélico/drone) | +0.15 |
| 6 | Cluster spatio-temporel | ≥ 3 aéronefs avec anomalies dans 100 km | ×1.4, cap 1.0 |

**Seuils de reporting** : individuel ≥ 0.35, cluster ≥ 0.50. Sévérité : ≥ 0.70 → `high`, ≥ 0.45 → `medium`, sinon `low`.

### Limitations connues

- **NAC-P absent via proxy serverless** : le proxy militaire ne relaie pas `nac_p`. Les heuristiques 1 et 2 ne s'activent que sur les données directes `adsb.fi v2`. Mode best-effort (heuristiques 3–5 + clustering) toujours actif.
- **Pas d'overlay carte** : v1 toast-only. Les champs `position`, `clusterRadius`, `affectedIcao24s` dans `GpsJammingSignal` permettront un layer Deck.gl sans refactor du service.

---

## Système Watchdog (nouveauté)

**Service TypeScript** (cron node ou worker) qui ping chaque API/proxy/service :
- Détecte pannes sources, proxies cassés, régressions perf, erreurs JS
- Enregistre statut + latence dans endpoint interne
- Remonte vers **health-panel dédié** dans Deck.GL/MapLibre (côté front)
- Collecte erreurs JS + temps chargement panels (Performance API)

**Valeur** : Fiabilité globale du dashboard visible en un coup d'œil.

## Lectures rapides

- 🔴 **9 features haute priorité** — toutes ont une source gratuite/publique et s'intègrent dans des services existants
- Le bloc **élus (3–7, 10)** est désormais largement branché : maire, députés, sénateurs, président de département et président de région sont déjà visibles, avec marge restante sur fiabilité des sources et enrichissements
- Le bloc **imagerie (8 ✅, 13, 14)** s'implémente par couches progressives : VIIRS/GIBS fait, puis Sentinel à la demande
- Les quick wins les plus immédiats côté produit sont désormais : **Préfet de département** (feature #11), **Eurodéputé par région** (feature #17) et **Intel cards clic droit** (feature #16)
- **AI BRIEFING** dans le baromètre est opérationnel — surveiller le quota Groq (cache Redis 10 min limite les appels)






| # | Feature | Source | Effort | Valeur ajoutée |
|---|---------|--------|--------|----------------|
| 22 | ✅ **Carte réseau ferroviaire** | API SNCF disruptions + OSM rail + future base SNCF Open Data réseau | Moyen | Validé en partiel avancé : layer `trafficRail` branché, gares impactées + segments colorés par sévérité, matching OSM best-effort sur tracé réel. Reste à faire : fond réseau ferré discret persistant (LGV + classique) avec source locale robuste. |
| 23 | ⏸️ **Positions trains temps réel** | À requalifier — pas de source publique simple de position GPS train par train validée à ce stade | Moyen | À ne pas promettre comme du "live train" tant qu'aucune source fiable n'est validée. Option prudente seulement : estimation expérimentale clairement marquée. |
| 24 | ❌ **Heatmap retards** | API SNCF disruptions + gares géocodées | Faible | Non fait. Faisable après stabilisation du layer `trafficRail` : agrégation des retards / suppressions / travaux en points pondérés, puis rendu HeatmapLayer ou grid layer. |
| 25 | ❌ **Timeline perturbations** | API SNCF + historique local à stocker | Moyen | Non fait. Nécessite collecte et persistance historiques (par ligne/gare/jour). Non pertinent sans base temporelle locale. |
| 26 | ❌ **Flux voyageurs gares** | SNCF Open Data fréquentation gares + référentiel gares | Faible | Non fait. Bulles proportionnelles à la fréquentation ; utile comme couche de contexte et de criticité, pas comme temps réel. |
| 27 | ⏸️ **Prédiction retards ML** | Historique local + météo + événements + travaux | Haut | Phase 2 uniquement. À repousser tant qu'il n'existe pas de stockage historique propre et d'objectif produit clair. |

## Détails techniques

### Layer Trains — Représentations visuelles

| Composant | Technologie | Description |
|-----------|-------------|-------------|
| **Perturbations réseau (actuel)** | MapLibre line/circle layers | `trafficRail` affiche segments perturbés + gares impactées, colorés par sévérité. Focus hover/clic séparé du layer persistant. |
| **Tracé réel rail (partiel)** | OSM rail + graphe topologique + matching best-effort | Si départ/arrivée connus, tentative de reconstruction sur vrai tracé OSM ; fallback segment simple si matching impossible. |
| **Fond réseau ferré (à faire)** | MapLibre line layer ou Deck.GL PathLayer | Base discrète LGV + réseau classique, idéalement prépackagée en local plutôt que fetch Overpass à la demande. |
| **Trains en mouvement** | À requalifier | Pas encore branché. Ne pas implémenter sans source temps réel crédible de position ou d'estimation suffisamment honnête. |
| **Heatmap retards** | Deck.GL HeatmapLayer ou aggregation grid | Faisable après fiabilisation des points gares et définition d'un score d'impact. |
| **Gares principales** | Scatterplot / Symbol layer | À faire via fréquentation annuelle + incidents actifs + référentiel gares officiel. |
| **Timeline** | Chart.js / D3 | À faire uniquement après collecte historique locale. |
| **Infocards gares** | Popup / panel dédié | À faire après branchage du référentiel gares + services trafic par gare. |

### APIs SNCF nécessaires
- **Temps réel déjà exploité**
  - `https://api.sncf.com/v1/coverage/sncf/disruptions`
- **Référentiels à brancher ensuite**
  - `https://ressources.data.sncf.com/explore/dataset/gares-de-voyageurs/`
  - `https://ressources.data.sncf.com/explore/dataset/lignes-lgv-et-par-ecartement/`
  - `https://ressources.data.sncf.com/explore/dataset/frequentation-gares/`
- **Pistes à valider avant toute promesse produit**
  - `https://api.sncf.com/v1/coverage/sncf/vehicle_journeys`
  - `https://api.sncf.com/v1/coverage/sncf/traffic_reports`

### Ce qui est réellement fait dans le repo

| Bloc | État réel | Notes |
|------|-----------|-------|
| `trafficRail` | ✅ Partiel avancé | Toggle dédié, layer carte persistant, gares impactées + segments colorés par sévérité |
| API proxy SNCF | ✅ Fait | `api/transport/disruptions.js` + proxy Vite aligné |
| Géoloc gares | ✅ Partiel | Coordonnées SNCF quand disponibles + fallback géocodage par nom de gare |
| Tracé réel sur réseau | ✅ Partiel | Matching best-effort sur OSM rail via Overpass + graphe topologique ; fallback segment si échec |
| Hover / clic panneau SNCF | ✅ Fait | Hover = highlight, clic = `flyTo` + focus |
| Fond réseau ferré persistant | ❌ Non fait | Aucun fond local LGV/classique encore embarqué |
| Heatmap retards | ❌ Non fait | Aucun HeatmapLayer ferroviaire |
| Timeline perturbations | ❌ Non fait | Aucun historique stocké |
| Flux voyageurs gares | ❌ Non fait | Pas encore branché |

## État actuel

| Layer | Statut | À développer |
|-------|--------|--------------|
| **Transport SNCF** | ✅ Réel / Partiel avancé | Disruptions temps réel + visualisation graphique `trafficRail` (gares + segments colorés). Géocodage des gares manquantes et matching OSM best-effort sur tracé réel. |
| → Réseau ferré | 🔄 En cours | Ajouter un fond de réseau ferré local robuste (LGV + classique) et distinguer visuellement `matched` vs `fallback`. |
| → Heatmap retards | ❌ Non fait | Ajouter après stabilisation du score d'impact et des points gares. |
| → Flux voyageurs gares | ❌ Non fait | Brancher fréquentation annuelle + référentiel gares. |


## Benchmarks et pistes externes à explorer

- **Shadowbroker / OSINT event dashboards**
  - Référence d'inspiration UI/UX et agrégation multi-sources :
    - https://hackers-arise.com/open-source-intelligence-osint-tracking-world-events-with-shadowbroker/
  - À comparer avec France Monitor sur :
    - hiérarchisation visuelle des couches
    - widgets synthétiques persistants
    - densité d'information sans surcharger la carte

- **Écosystème INSEE**
  - Catalogue APIs :
    - https://portail-api.insee.fr/catalog/all
  - Carte intercommunale :
    - https://www.insee.fr/fr/outil-interactif/7737357/map.html
  - Pistes d'usage :
    - enrichissements territoriaux
    - découpages intercommunaux
    - indicateurs socio-éco contextualisant les alertes locales

- **Autres sources / benchmarks OSINT**
  - https://tools.osintnewsletter.com/
  - https://honeypot.land/
  - Projet à comparer aussi : **Shadowbroker** et **Crucix**

---

## Arborescence cible des layers

Principe :
- un parent = une famille de lecture cartographique
- un child = une couche activable sur la carte
- les widgets, indices composites et corrélations IA restent hors arbre

### 1. Signal & Actualités

- `news`
- `alerts`

### 2. Réseaux critiques

- `energy`
- `gas`
- `oil`
- `infrastructure`
- `outagesElec`
- `outagesTelecom`
- `outagesInternet`
- `outagesCloud`
- plus tard : lecture cartographique du baromètre réseau si matérialisée en couche
- plus tard éventuellement : `subseaCables` si traité comme infrastructure

### 3. Sûreté & Souveraineté

- `military`
- `cyber`
- plus tard : `gps-jamming`
- plus tard éventuellement : `subseaCables` si traité comme couche de menace / sûreté

### 4. Mobilité & Flux

- `trafficRoad`
- `trafficMaritime`
- `trafficAir`
- plus tard : `rail-network`
- plus tard : `trains-realtime`
- plus tard : `train-delays-heatmap`
- plus tard : `stations-flow`

### 5. Environnement & Observation

- `fires`
- `environmental`
- `dayNight`
- plus tard : `sentinel-1`
- plus tard : `sentinel-2`
- plus tard : `nicfi`
- plus tard : `satellites`

### 6. Territoires & Institutions

- `elus`
- plus tard : `maire`
- plus tard : `depute`
- plus tard : `senateur`
- plus tard : `president-region`
- plus tard : `president-departement`
- plus tard : `prefet`
- plus tard : `premier-ministre`
- plus tard : `eurodepute`

### 7. Santé & Cohésion

- `health`
- `healthOscour`
- `healthApl`
- `hospitals`

### Hors arbre des layers

- `finance`
- `ISNR` : indice composite transverse, pas une couche métier autonome
- `barometre reseau` si implémenté comme widget synthétique
- watchdog / health service
- widgets gouvernement / header
- future corrélation IA inter-signaux

---

## Mise à jour du jour

### UI / Shell carte

- création d'un espace **sous la carte** accessible en scroll et via un handle discret `Voir les modules`
- intégration du **flux boursier** sous la carte
- déplacement du **flux news** sous la carte, à côté du flux boursier
- déplacement du **bandeau temporel news** et des **filtres news** sous la carte
- retrait des doublons `news` et `finance` de la colonne latérale gauche

### Carte / rendu

- homogénéisation des **news sur la carte** : suppression des icônes par catégorie
- conservation des **couleurs par gravité** et des **agrégations**
- ajout d'une **légende Actualités**
- retrait du contour noir sur les clusters news

### Alertes / overlays

- déplacement des **alertes existantes** en bandeau sous le header, sur toute la largeur côté carte
- style conservé en mode glass / semi-transparency / halo
- stacking max `3` conservé

### UX panneaux

- amélioration du scroll de la **colonne gauche** quand beaucoup de layers sont dépliés
- triangles des **parents de layers** :
  - gauche quand replié
  - haut quand ouvert
- ajustement du bouton `Voir les modules` et des légendes carte pour éviter les collisions visuelles

### Santé

- tentative de stabilisation des layers `healthApl` et `healthOscour`
- fallback partiel ajouté côté service Santé pour mieux supporter les sources partielles
- point à revalider lors de la prochaine session :
  - vérifier l'affichage carte réel de `APL`
  - vérifier l'affichage carte réel de `OSCOUR`
  - vérifier l'alimentation du **Baromètre Santé**
  - vérifier le positionnement par défaut du panneau santé à droite



🛠️ Prompt Final : Baromètre Réseau & Hook ISNR

Act as a Senior Fullstack Engineer & OSINT Specialist. Implement the "Baromètre Réseau France" for France Monitor v5, designed as the primary technical feeder for the future ISNR (Indice de Stabilité Nationale en Temps Réel).

### 1. DATA ARCHITECTURE (src/services/network-barometer.ts)
- Create a service to aggregate health metrics from existing services (use cached data):
    - **Elec (30%)**: Ecowatt + Enedis DataFair (Note: Label Enedis as "Historique" in UI).
    - **Internet/BGP (25%)**: IODA score (6 ISPs).
    - **Telecom (15%)**: ARCEP 4G/5G.
    - **Cloud/Web (15%)**: OVH, Scaleway, AWS, GCP, Cloudflare.
    - **Space Weather (10%)**: Kp Index (NOAA).
    - **Cyber (5%)**: Tension score.
- **ISNR Hook**: Define an interface `InfrastructureHealth` and implement a method `getMetricsForISNR()` that returns the normalized scores. This will be consumed by a future `isnr-synthesis.ts`.
- **Logic**: If a source is missing, redistribute its weight proportionally.

### 2. UI COMPONENT (src/components/BarometerWidget.ts)
- **Placement**: Fixed at the **TOP-LEFT** of the map (OSINT Command Center style).
- **Aesthetics**: 
    - Glassmorphism design (`backdrop-blur-md`, semi-transparent).
    - A compact "System Health" jauge or segmented bar.
    - Colors: Green (>=85), Orange (60-84), Red (<60).
    - Add a "Trend" icon (arrow) based on the previous calculation.
- **Interactions**: 
    - Hover: Detailed tooltip with breakdown (ex: "BGP: 92% | Cloud: 100%").
    - Pulse effect: Subtle red glow if the global score drops below 60.

### 3. WIRING & REFINEMENT
- **App Integration**: Mount in `App.ts`. Refresh cycle: 5 minutes.
- **Terminology Fix**: Ensure all Enedis DataFair tooltips across the app are updated to: "Indicateurs Historiques (Flux DataFair annuel)".
- **State**: Use a simple event-driven update (EventEmitter or similar) so the UI reacts to the service without full re-renders.

### 4. WORLD MONITOR INSPIRATION
- Add a tiny, grisé (grayed out) placeholder label at the bottom of the widget: "ISNR: Pending Synthesis..." to prepare the UI for the future AI-driven national stability index.

---

## Mise à jour repo (2026-03-28) — Sentinel NDWI crues + retrait du mock dev

- ✅ **Viewer NDWI Sentinel-2 branché pour les crues** — depuis un tronçon Vigicrues réel, le modal Sentinel peut désormais générer un rendu NDWI via `STAC + CDSE Process API`, avec cache mémoire côté backend/proxy, fallback explicite EO Browser si l'auth CDSE échoue et comparaison `avant / après` dans l'UI.
- ✅ **Couleurs NDWI réalignées sur le rendu Copernicus / Sentinel Hub** — le rendu utilise désormais une rampe continue officielle `vert -> blanc -> bleu`, sans seuil local ajouté côté app. Le sujet restant n'est plus la connectique technique mais uniquement le choix produit/UX autour de cette visualisation.
- 🔄 **UI Sentinel nettoyée mais encore à stabiliser finement** — le modal a été compacté, les métadonnées ont été rationalisées et l'ascenseur desktop a été réduit, mais le polish final reste un sujet UX à reprendre séparément si l'on veut figer une version vraiment définitive.
- ✅ **Mock Vigicrues de développement retiré** — le segment `TEST DEV — Seine Paris centre` injecté en `DEV` a été supprimé de `src/services/vigicrues.ts`. Le service revient à un comportement `live only`, sans fallback artificiel local.
- ℹ️ **Conclusion backlog** — la brique `S2 / NDWI crues` est maintenant suffisamment prouvée techniquement pour servir de base produit. Le vrai sujet de phase suivante reste `qualité UX` côté modal et, pour `S1`, un backend raster dédié si l'on veut sortir du simple gel produit.



- sur les legendes prevoir bouton pour réduite les legendes