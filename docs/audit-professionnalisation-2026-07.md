# France Monitor — Audit de professionnalisation & recommandations

**Date : 4 juillet 2026** · Cible produit : *plateforme de lecture situationnelle souveraine pour les services publics* (préfectures, VIGINUM/SGDSN)

**Verdict global** : socle technique mûr (~90 000 lignes TS strict, CI existante, docs riches, watchdog client, PWA, commits propres). Écart avec l'ambition ministères sur 4 fronts : **crédibilité des indicateurs, sécurité, garanties de non-régression, sorties exploitables**.

---

## 1. Quick wins crédibilité (semaines 1-2)

| # | Problème | Localisation | Action |
|---|---|---|---|
| 1 | Carte vide au premier chargement (tous layers `false`) | `src/App.ts:374` | Preset d'accueil "vue d'ensemble" (news + énergie + vigilance météo) |
| 2 | Badges "TEMPS RÉEL" codés en dur (~8 panels : Cyber, Défense, Energy, Fires, Finance, Transport, Traffic, ISNR) | ex. `DefensePanel.ts:309`, `CyberPanel.ts:298`, `EnergyPanel.ts:218` | Brancher sur la fraîcheur réelle du `Watchdog` |
| 3 | Scores heuristiques présentés comme des mesures | `DromEnergyPanel.ts:273` (`assets*10`), `NuclearPanel.ts:568` ("heuristique v1"), `HydraulicPanel.ts:392` (date figée 30/09/2025) | Étiqueter systématiquement "observé / modélisé / estimé" (modèle : `EnvironmentPanel` "Tracé reconstruit") |
| 4 | Placeholders visibles utilisateur | `ElusPanel.ts:226` ("non livré"), `SentinelModal.ts:351` (Sentinel-1 "en cours de développement") | Masquer ou terminer |
| 5 | Finitions | `TransportPanel.ts:157-169` (accents manquants), `SearchModal.ts:50` (icône loupe vide), `console.log` debug (`DefensePanel.ts:624`, `App.ts:2053`) | Corriger |
| 6 | Code mort (0 import, vérifié) | `NewsPanel.ts`, `WeatherPanel.ts`, `FloodsPanel.ts`, `CyberBreachPanel.ts`, champ orphelin `FinancePanel` (`App.ts:1312`) | Supprimer |
| 7 | 3 modules finis mais invisibles (feature flags) | `VITE_ENABLE_GAS_PANEL`, `VITE_ENABLE_OIL_LAYER`, `VITE_ENABLE_CYBER_PANEL` | Décision produit : activer ou retirer |

## 2. Sécurité (bloquant institutionnel)

| # | Problème | Localisation | Action |
|---|---|---|---|
| 1 | 3 clés API dans le bundle JS public | `traffic.ts:418,508` + `DeckGLMap.ts:772` (TomTom, clé dans l'URL), `vigilance-meteo.ts:321` (Météo-France), `military-ships.ts:118` (AISStream) | Tout router par des proxies serveur (celui de TomTom existe : `api/traffic/road.js`) ; supprimer le préfixe `VITE_` |
| 2 | XSS : `innerHTML` non échappé avec données externes | `TrafficPanel.ts:185,192`, `MapLegend.ts:166,184` | Échapper (helper existant dans SourcesQualityPage) |
| 3 | SSRF par redirection (allowlist contournable via 302) | `rss-proxy.js:122`, `json-proxy.js:72`, `oil-proxy.js`, `ingest/news.ts:157` | `redirect: 'manual'` + revalidation d'hôte |
| 4 | Proxies semi-ouverts : CORS `*` global, pas de rate-limit ni taille max | `vercel.json` + 31 fonctions | `@upstash/ratelimit` (Redis déjà en place) + limite de taille + CORS restreint |
| 5 | scrapling-proxy : `/clear-cache` sans auth, `debug` via env | `app.py:415`, `app.py:424` | Auth + `debug=False` en dur |
| 6 | Aucune authentification nulle part | Toute l'app + toutes les fonctions `api/` | Court terme : accès protégé simple pour démos ; moyen terme : ProConnect + RBAC |

## 3. Filet de sécurité qualité (mois 1)

| # | Problème | État actuel | Action |
|---|---|---|---|
| 1 | CI n'exécute qu'un seul test | `npm test` = `test-situation-engine.mjs` ; ~13 scripts de test orphelins ; couverture ~2,5 % | Migrer vers Vitest, câbler tous les tests dans `ci.yml` |
| 2 | ESLint désarmé | `.eslintrc.cjs:22-24` : `no-explicit-any: off`, `no-unused-vars: off` ; 34 `as any` réels ; ESLint 8 en fin de vie | Réarmer progressivement, passer à ESLint 9 |
| 3 | Robustesse réseau inégale | Circuit breaker : 9/75 services ; timeout : 37/75 ; 4 services sans aucune gestion d'erreur (`copernicus.ts`, `hospitals.ts`, `cable-threats.ts`, `sentinel-ndwi.ts`) | Helper partagé `fetchWithBreaker` (modèle : `hubeau-hydrometry.ts`) |
| 4 | Observabilité serveur inexistante | Échecs du cron d'ingestion (5 min) invisibles hors logs Vercel ; aucun error tracking | Sentry (ou équiv.) sur fonctions Vercel + persistance des échecs feeds + alerte si 0 article ingéré depuis 30 min |
| 5 | Chaîne d'approvisionnement | Pas de `npm audit` en CI, pas de Dependabot, pas de protection de branche | Ajouter les trois |

## 4. Différenciant "ministères" (trimestre)

| # | Chantier | Socle existant | Livrable |
|---|---|---|---|
| 1 | Sorties exploitables | `urlState.ts` (permaliens OK) | Note de situation 1 page (print CSS), exports CSV/GeoJSON par couche |
| 2 | Corrélation au centre | `situation-engine.ts` (le mieux testé) | "Les 3 convergences critiques des dernières 24 h" en ouverture |
| 3 | Sources auditables | Page `/sources-quality` (scores codés en dur : RSS 58, Météo-France 92…) | Scores calculés depuis l'historique watchdog + historisation |
| 4 | KPI d'impact | Données Neon déjà stockées | Temps de détection, taux de faux positifs, couverture territoriale — publiés |
| 5 | Accessibilité RGAA (obligatoire secteur public) | ARIA partiel (~78 attributs) | Audit axe/Lighthouse + navigation clavier |
| 6 | Interopérabilité | API interne non documentée | Spéc OpenAPI publique |

---

## Onglet par onglet (les 8 groupes de couches)

| Groupe / panel | État | Action prioritaire |
|---|---|---|
| **Actualités** — UnderMapNewsFeed | Solide (live + historique) | Erreurs avalées en silence (`catch {}` :916, :987) → afficher un état d'erreur ; régions en dur |
| — ISNRPanel (stabilité) | Bon concept | Badge "TEMPS RÉEL" permanent factice (:252) ; pondérations 30/30/30/10 codées dans l'UI → config documentée |
| — SituationMonitor / AlertMonitor | Fonctionnels | **Duplication massive** (drag/persist/i18n copiés-collés) → factoriser ; brancher l'i18n maison sur `i18n.ts` |
| — StatusPanel | Utile | Listes de sources en dur **et divergentes** entre les 2 variantes (:146 vs :210) → une seule source de vérité |
| **Énergie** — EnergyPanel (Écowatt) | Fini | Valeurs magiques du score (:180-191) à documenter |
| — NuclearPanel | Riche (4 onglets) | Étiqueter "estimé" partout où l'heuristique v1 s'applique |
| — GasPanel / OilPanel | **Finis mais invisibles** (feature flags) | Trancher : activer ou retirer |
| — HydraulicPanel | OK | Date source figée "30/09/2025" ; pas d'état vide (loading infini si 0 assets) |
| — DromEnergyPanel | OK | Score `assets*10` factice (:273) → vrai indicateur ou suppression ; listes tronquées à 40 sans pagination |
| — EolienPanel | OK | Migrer vers le helper `panelHeader.ts` comme les autres |
| **Santé** — NationalHealthPanel, HealthBarometerPanel | Riches | Fetch direct Odissé depuis le composant (:410) → passer par un service ; erreurs avalées (:502) ; doc "4 sous-indices" vs 5 rendus |
| **Trafics** — TrafficPanel (TomTom) | OK | **XSS innerHTML (:185,:192)** + badge factice + clé API exposée — le panel le plus urgent |
| — TransportPanel (SNCF) | OK | Accents manquants, badge factice |
| — MaritimePanel | Bon (3 onglets) | Millésime "2024" figé ; lien externe douteux `vesselfinderimage.com` (:604) ; désactivé en silence en prod sans relais AIS — l'indiquer |
| **Environnement** — EnvironmentPanel | **Le modèle à suivre** ("Tracé reconstruit" = honnêteté des données) | RAS majeur |
| — FiresPanel | Bon (DBSCAN) | Géocodage sans try/catch (:249-307) ; bug CSS `gap:x 8px` (:776) |
| **Souveraineté** — DefensePanel | Bon | `console.log` debug (:624), badge factice (:307) |
| — CyberPanel | Fini mais **invisible** (flag) | Trancher |
| **Pannes** — OutagesPanel | Bon (4 onglets) | Source Enedis = scraping AJAX fragile (20 communes en dur dans scrapling) — prévoir dégradation propre |
| **Élus** — ElusPanel | **Mort** : rendu réel jamais atteint, placeholder "non livré", couche masquée | Finir ou supprimer |
| **Chrome** — MarketStrip/CommodityStrip, DayNightPanel, SearchModal, FranceIntelPanel | Bien finis globalement | FranceIntelPanel : parsing du brief LLM par regex fragiles (:122) ; finance = TradingView non officiel (peut casser sans préavis) |

## Top 10 des sources les plus fragiles

| # | Source | Localisation | Risque |
|---|---|---|---|
| 1 | Enedis (scraping API AJAX interne + bypass Cloudflare) | `scrapling-proxy/app.py:244-409` | Casse à chaque évolution du site ; 20 communes en dur |
| 2 | TradingView Scanner (API non officielle) | `api/finance/market.js` | Schéma modifiable sans préavis |
| 3 | RSS PQR sous Cloudflare (Les Échos, Voix du Nord, Paris-Normandie) | `scrapling-proxy/app.py` | Casse à chaque MàJ anti-bot |
| 4 | infocoupure.fr (crowd-sourced tiers) | `citizen-outages-handler.js`, `outages-scraper.ts` | HTML non contractuel |
| 5 | ransomware.live / frenchbreaches.com | `api/threats.js` | Projets bénévoles, disponibilité incertaine |
| 6 | Hantavirus SPF (scraping HTML + PDF datés en dur) | `api/health/hantavirus.js` | URLs de PDF figées |
| 7 | AISStream (WebSocket navigateur + clé exposée) | `military-ships.ts:118` | Désactivé en silence en prod sans relais |
| 8 | OpenSky anonyme | `api/_shared/air-traffic.js` | Quota 400 req/j épuisable en quelques heures |
| 9 | TomTom trafic (appels client directs) | `traffic.ts:523` | Clé publique, budget en localStorage contournable |
| 10 | Eolien ODRE/BRGM + annuaire ministres | `api/energy/eolien.js`, `api/_shared/ministers.js` | Schémas opendatasoft/WxS évolutifs |

## Ordre d'attaque

| Horizon | Contenu |
|---|---|
| **Semaines 1-2** | XSS TrafficPanel/MapLegend · clés `VITE_*` derrière proxies · badges temps réel réels · preset de couches par défaut · suppression code mort · finitions visibles |
| **Mois 1** | Vitest + tous les tests en CI · ESLint réarmé · `fetchWithBreaker` généralisé · Sentry + alerting ingestion · durcissement proxies (redirect, rate-limit, taille max) |
| **Trimestre** | Export note de situation · sources-quality 100 % live · corrélation en ouverture · audit RGAA · accès protégé pour démos |
| **Ensuite** | ProConnect · API OpenAPI publique · KPI d'impact publiés |
