# France Monitor — Audit UI : structure & complexité

Lecture seule, 2026-09-22. Périmètre : `index.html`, `src/main.ts`, `src/App.ts` (6830 lignes), `src/components/**`, `src/styles/main.css` (8016 lignes), `src/locales/*`. Toutes les références sont `fichier:ligne`.

---

## 1. Inventaire

**Fichiers composants** : 52 dans `src/components/*.ts` (hors tests) + 8 dans `src/components/deckgl/` + 3 dans `src/components/shared/` = **63 fichiers composants**. 11 fichiers `*.test.ts` associés. **27 fichiers `*Panel.ts`** (dont la classe de base abstraite `Panel.ts`), les 36 autres sont modales, monitors, strips, la carte, etc.

**Panels instanciés et visibles par défaut au premier chargement desktop** (visiteur réellement premier passage, aucun `localStorage`/URL `layers`) :
- `EnvironmentPanel` et `EnergyPanel` (montés en dur, non lazy) s'affichent car `FIRST_LOAD_PRESET_LAYERS` (`src/App.ts:451-456`) active `environmental` et `powerGrid`.
- `UnderMapNewsFeed` se peuple (layer `news` activé par le même preset).
- Tous les autres panels flottants (24 restants) sont montés dans le DOM mais **masqués** tant que leur layer n'est pas actif — cf. `Panel.ts` et le pattern `if (this.hasRestoredActiveLayerPanels && this.activeLayers.X) panel.show(...)` répété pour chaque panel lazy (ex. `src/App.ts:2632-2646` DromEnergyPanel, `:2649-2661` HydraulicPanel, `:2684-2695` NationalHealthPanel).
- Pour un **visiteur récurrent**, `DEFAULT_LAYERS` (`src/App.ts:404-441`, 38 clés, **toutes à `false`**) sert de fallback : si le `localStorage` contient un état "tout éteint", la carte est vide — le correctif du 5 juillet ne couvre que le tout premier chargement.

**Panels collapsed/masqués/lazy/feature-flaggés** :
- **Lazy (`import()` dynamique au montage)** : DromEnergyPanel, HydraulicPanel, EolienPanel, NationalHealthPanel, HealthBarometerPanel, FiresPanel, TrafficPanel, MaritimePanel, CyberPanel, OilPanel, NuclearPanel, OutagesPanel, DefensePanel, SituationHistoryPanel, RightSidebar, SentinelModal, WildfireDossierModal, SearchModal, ExportMenu, SituationReport — **19 composants** chargés en chunk séparé (`src/App.ts:2632` et suivants, `src/App.ts:6630`, `:6653`).
- **Feature-flag opt-out** (actifs par défaut sauf mise à `'false'` explicite) : Cyber (`VITE_ENABLE_CYBER_PANEL`, `src/services/cyber.ts:461`), Gaz (`VITE_ENABLE_GAS_PANEL`, `src/services/gas.ts:383`), Pétrole (`VITE_ENABLE_OIL_LAYER`, `src/services/oil.ts:143`). **Correction par rapport à la mémoire projet** : ces flags ne sont renseignés nulle part en prod (`.env.example:134-136` commentés, `.env` ne les définit pas) → **actuellement actifs**, contrairement à "invisibles par défaut" noté en juillet.
- **Mort/désactivé en dur** : `ElusPanel` (851 lignes) — `src/App.ts:2315` et `:2912` ne sont que des commentaires `// ElusPanel disabled`, aucun import ni instanciation. Son entrée de layer `elus` est définie puis explicitement masquée : `src/components/LayerPanel.ts:53` + `:94` (`hidden = def.key === 'elus' || ...`).
- **Masqué si config absente** : layer `trafficMaritime` caché si `AIS_RELAY_URL` non défini (`src/components/LayerPanel.ts:94`, `src/services/ais-connection.ts:21-22`).

**Layers carte** : type `MapLayers` = **38 clés** (`src/App.ts:404-441`). `LayerPanel` en expose **35 lignes à cocher** (36 définies moins `elus` masqué) réparties en **7 groupes dépliables** (`src/components/LayerPanel.ts:17-54`) : ACTUALITÉS (2 enfants), SYSTÈMES ÉNERGÉTIQUES (8), SANTÉ (3), TRAFICS (4), ENVIRONNEMENT (4), SOUVERAINETÉ (3), PANNES RÉSEAU (4). La clé `alerts` (présente dans `MapLayers`) n'a **aucune ligne** dans `LayerPanel` — pilotée par code uniquement, pas de contrôle utilisateur direct.

**Contrôles de premier niveau (header, 1440 px, presets non compactés)** : 1 bouton logo/titre (ouvre modale À propos), **10 boutons de préréglages régionaux** (repliables en 1 `<select>` si l'espace manque, `src/App.ts:3157-3179`), 2 boutons FR/EN, 1 bouton "Note de situation", 1 bouton "Export", 1 lien "Sources & qualité", 1 déclencheur dropdown `StatusPanel` (sources de données) — **17 éléments interactifs** + horloge + pastille "live" (passifs). Sidebar gauche : 1 widget `BarometerWidget` (pannes réseau), 1 bouton "Intelligence France", **35 cases à cocher** de layers dont **7 doublent comme déclencheurs d'accordéon** (`src/components/LayerPanel.ts:97` `<input type="checkbox">` générique à toutes les lignes). Pied de page : nav de **6 liens** (`src/App.ts:2381-2393`).

**Modales** : 3 vraies boîtes de dialogue `aria-modal="true"` — À propos (`src/App.ts:2241`), `SentinelModal` (`src/components/SentinelModal.ts:140`), `WildfireDossierModal` (`src/components/WildfireDossierModal.ts:316`). `SearchModal` existe mais **ne déclare pas `aria-modal`** malgré son nom — écart resté non corrigé depuis l'audit RGAA de juillet.

**Strips/bandeaux** : `SituationBrief` (bandeau "Convergences 24 h", haut-centre carte, conditionnel), `AlertMonitor` (se masque lui-même si 0 alerte — `src/components/AlertMonitor.ts:102,131-132`), `MarketStrip`, `CommodityStrip`, conteneur `SituationHistoryPanel` ("toujours visible", `src/App.ts:2561-2564`) — ces 4 derniers sous la carte (`under-map-grid`).

---

## 2. Taille des composants (top 15, lignes)

| # | Fichier | Lignes |
|---|---|---|
| 1 | `src/components/DeckGLMap.ts` | 12 723 |
| 2 | `src/components/OutagesPanel.ts` | 1 364 |
| 3 | `src/components/OilPanel.ts` | 1 189 |
| 4 | `src/components/UnderMapNewsFeed.ts` | 1 057 |
| 5 | `src/components/FiresPanel.ts` | 1 051 |
| 6 | `src/components/MapPopup.ts` | 1 044 |
| 7 | `src/components/deckgl/constants.ts` | 884 |
| 8 | `src/components/ElusPanel.ts` | 851 (mort, §1) |
| 9 | `src/components/NuclearPanel.ts` | 797 |
| 10 | `src/components/CyberPanel.ts` | 789 |
| 11 | `src/components/FranceIntelPanel.ts` | 739 |
| 12 | `src/components/MaritimePanel.ts` | 717 |
| 13 | `src/components/DefensePanel.ts` | 666 |
| 14 | `src/components/ToastNotification.ts` | 658 (mort, §2) |
| 15 | `src/components/MapContainer.ts` | 587 |

`App.ts` lui-même fait **6 830 lignes** (hors composants) — orchestrateur monolithique conforme à la note du `CLAUDE.md` du dépôt ("~2000 lignes" y est sous-estimé d'un facteur 3). `DeckGLMap.ts` à lui seul (12 723 lignes) dépasse la somme des 14 composants suivants du classement.

**Dead-code confirmé** (vérifié par `grep -rl` sur tout `src/`, hors le fichier lui-même et son test — pas seulement l'ancien audit de mémoire, revérifié aujourd'hui) :

| Fichier | Lignes | Preuve |
|---|---|---|
| `src/components/ToastNotification.ts` | 658 | Zéro référence hors du fichier ; jamais importé par `App.ts` ni ailleurs. |
| `src/components/ElusPanel.ts` | 851 | Seules occurrences : commentaires `// ElusPanel disabled` (`src/App.ts:2315`, `:2912`). |
| `src/services/flood-geometry.ts` | 1 077 | Zéro référence (le seul hit textuel est un type homonyme sans rapport, `src/types/index.ts:294`). |
| `src/components/FilterPanel.ts` | 202 | Zéro référence hors fichier. |
| `src/components/TimeBar.ts` | 81 | Utilisé uniquement par `FilterPanel.ts` (lui-même mort) → mort par transitivité. |
| `src/services/osm-rail-graph.ts` | 211 | Zéro référence dans `src/` ni `api/`. |
| `src/services/ore-incidents.ts` | 93 | Zéro référence dans `src/` ni `api/`. |
| **Total** | **3 173 lignes** | |

Composants faussement suspects (importés indirectement, donc **vivants**, à ne pas supprimer) : `panelHeader.ts` (14 panels), `NewsHeatmap.ts` (via `UnderMapNewsFeed.ts`), `MinistresPanel.ts` (via `RightSidebar.ts`), `fire-observation-model.ts` et `radar-profile-view.ts` (via `FiresPanel.ts`).

---

## 3. Description de la mise en page (1440×900)

- **Header** fixe, 56 px, grid 3 colonnes (`src/styles/main.css:162-172`).
- **Sidebar gauche** largeur fixe **380 px** (`--sidebar-width`), scroll interne propre (`src/styles/main.css:1170-1189`) : `BarometerWidget` → bouton "Intelligence France" → accordéon `LayerPanel` (35 lignes/7 groupes).
- **Zone carte** (`flex:1`) : c'est elle qui **scrolle verticalement** (`overflow-y:auto`, `src/styles/main.css:801-809`), pas la page globale. Sous la carte, `under-map-area` (`MarketStrip`+`CommodityStrip`, historique, `UnderMapNewsFeed`) est atteint par scroll ou par le bouton flottant "Voir les modules" (`src/App.ts:2396-2422`) qui suit la position de scroll.
- **Sidebar droite** (`.right-sidebar`, `src/styles/main.css:1460-1470`) : largeur **0 par défaut**, ne s'ouvre (360 px) que pour le panneau "Gouvernement" (`RightSidebar.ts` — un seul contenu : `MinistresPanel`, cf. `src/components/RightSidebar.ts:7,30,47`). Fermée au premier chargement.
- **Pied de page** : nav de liens, 46 px, toujours visible (`padding-bottom:46px` sur `.main-container`, `src/styles/main.css:793-798`).
- **Tablette** : quasiment **aucune mise en page intermédiaire dédiée**. Une seule règle `@media (min-width:721px) and (max-width:1180px)` existe dans tout le fichier, et elle ne repositionne qu'un unique panneau de détail gare (`src/styles/main.css`, bloc "rail-station-detail-panel") — pas de réagencement du header/sidebar. Le layout saute directement du desktop (sidebar 380 px fixe) au mode mobile.
- **Mobile** (`@media (max-width:768px)`, ex. `src/styles/main.css:2017-2040`) : `--sidebar-width` passe à `100%`, `.main-container` devient `column-reverse`, header devient multi-lignes (`flex-wrap`, hauteur auto). Bascule carte **indépendante** des breakpoints CSS : `isMobileDevice()` (`src/components/MapContainer.ts:21-31`) teste `innerWidth < 768` **OU** absence de WebGL2/WebGL **OU** (tactile + `deviceMemory < 4`) → bascule vers `Map.ts` (D3/SVG) au lieu de `DeckGLMap.ts`.

---

## 4. Métriques CSS

| Métrique | Valeur |
|---|---|
| `main.css` | 8 016 lignes / 164 Ko (+ `landing.css` : 515 lignes / séparé, réutilise les tokens de `main.css`) |
| Propriétés custom `:root` | 53 (`src/styles/main.css:1-72`) |
| Couleurs hex hors `:root` | 156 (186 au total dans le fichier) |
| `rgb()`/`rgba()` hors `:root` | 499 |
| Règles `@media` | 20, sur **11 seuils différents** dont des quasi-doublons non harmonisés : `768px`×3, `767px`×2, `760px`, `720px` — et `480px`×3, `430px`, `420px` — aucun n'est piloté par une variable |
| `!important` | 36 |
| Valeurs `z-index` distinctes utilisées | **17** : `1,2,5,12,13,50,200,420,500,1000,1200,1400,2000,2100,5000,9999,10000` — alors que `:root` définit une échelle propre à 6 paliers (`--z-map:1` … `--z-tooltip:50`, `src/styles/main.css:56-63`) **majoritairement ignorée** par les 17 valeurs en dur |
| Déclarations `font-size` | 330, pour 17 valeurs distinctes (raisonnablement cohérent) |
| `cursor:pointer` | 71 occurrences (en baisse depuis les ~151 relevées par l'audit RGAA de juillet) |
| Mode clair | **Aucun** — 0 occurrence de `prefers-color-scheme` ou `data-theme` dans `main.css` malgré l'architecture par variables CSS qui s'y prêterait |
| `prefers-reduced-motion` | 2 blocs (`src/styles/main.css:3326`, `:3927`) |

---

## 5. Scan accessibilité rapide

| Métrique | Valeur |
|---|---|
| `<button` (littéral + `createElement('button')`) | 106 + 41 = ~147 sites de création de bouton (`src/components/*.ts`, `src/App.ts`) |
| `aria-label` | 68 occurrences |
| `:focus-visible` dans `main.css` | 14 règles (contre 1 seule relevée en juillet — progrès réel) |
| `outline:none` restants | 7 |
| Gestionnaires `keydown` | 13 fichiers (contre "5 composants" en juillet) : `MapPopup.ts`(6), `ExportMenu.ts`(2), `WildfireDossierModal.ts`(2), `App.ts`(2), + 7 fichiers à 1 |
| `role=` utilisés | **7 occurrences seulement**, 6 fichiers : `role="img"`×2 (`FranceIntelPanel.ts`, `radar-profile-view.ts`), `role="button"`×2 (`SituationMonitor.ts`, `AlertMonitor.ts`), `role="listitem"` (`SituationBrief.ts`), `role="group"` + `role="dialog"` (`App.ts`) |
| Titres `<h1>`–`<h6>` | Quasi absents de l'app opérationnelle : seuls `LandingPage.ts` (h1×1, h2×4, h3×8 — mais **remplacée** dès qu'on entre dans le dashboard), `WildfireDossierModal.ts` (h3×3), `MapLegend.ts` (h4×1), `FranceIntelPanel.ts` (h2×1), `DeckGLMap.ts` (h4×7, dans des popups). **`App.ts` et les 26 autres `*Panel.ts` n'utilisent aucune balise de titre réelle** — les "titres" de panel sont des `<span class="panel-title">` (`src/components/Panel.ts:64-66`), donc invisibles dans la hiérarchie de document/lecteur d'écran. `index.html` n'a un `<h1>` que dans le `<noscript>` (jamais vu par un navigateur JS actif). |
| `aria-modal` | 3/4 modales (`SearchModal` en manque — §1) |
| Contraste — tokens `:root` | Fonds : `--bg-primary #0a0a0f`, `--bg-secondary #12121a`, `--bg-surface #1a1a2e`. Textes : `--text-primary #e8e8ec` (contraste ~15:1 sur fond primaire, très bon), `--text-secondary #9898a8` (~6,7:1, correct), `--text-muted #8a8a9a` (~5,3:1 — corrigé en juillet, conforme au seuil 4,5:1 AA). Accent `--text-accent #6c8cff`. |

---

## 6. Charge cognitive au premier chargement

Pour un **visiteur réellement premier passage** (aucun état stocké), visible **sans aucune interaction** dans le viewport 1440×900 :

| Élément | Compte |
|---|---|
| Contrôles interactifs du header | 17 (§1) |
| Widgets/entrées sidebar gauche | 1 widget pannes réseau + 1 bouton Intelligence + 35 cases layers (7 groupes) |
| Panels flottants auto-affichés | 2 (`EnvironmentPanel`, `EnergyPanel` — cf. §1) |
| Bandeau de synthèse | `SituationBrief` (si situations actives — "Convergences 24 h") |
| Alertes | `AlertMonitor` (0 élément visible si aucune alerte active — se masque seul) |
| Bouton flottant | "Baromètre Santé" (FAB, `src/App.ts:2441-2477`) |
| Légende carte | `MapLegend` (apparaît dès qu'un layer avec légende est actif) |
| Liens de bas de page | 6 |
| **Total contrôles/éléments distincts visibles sans clic** | **≈ 65** |

En un scroll ou un clic ("Voir les modules") : `MarketStrip`, `CommodityStrip`, historique de situation, `UnderMapNewsFeed` (qui a elle-même ses propres filtres catégorie/période/recherche, non comptés ci-dessus).

**Voix visuelles distinctes** (systèmes de couleur/badges qui ne partagent pas un token commun) — **5 échelles parallèles**, toutes définies séparément dans `:root` (`src/styles/main.css`) :
1. Niveaux de menace (`--threat-critical/high/medium/low/info`, 5 couleurs)
2. Signaux Écowatt (`--ecowatt-green/orange/red`, 3 couleurs)
3. Vigilance météo (`--meteo-green/yellow/orange/red/violet`, 5 couleurs)
4. Vigilance crues (`--flood-green/yellow/orange/red`, 4 couleurs)
5. Fraîcheur de source `truthBadge` (vert/orange/rouge/gris calculés dynamiquement, `src/components/shared/truthBadge.ts:21-24`)

Ces échelles se recoupent partiellement par hasard (ex. `--threat-medium` et `--meteo-yellow` valent tous deux `#ffcc00`) mais restent **5 systèmes à maintenir séparément**, sans token de sévérité unique — un utilisateur doit apprendre 5 grammaires de couleur différentes pour un même concept ("est-ce grave ?").

---

## 7. Pistes de simplification (classées)

1. **Supprimer le code mort confirmé** — 3 173 lignes sans aucune référence (`ToastNotification.ts`, `ElusPanel.ts`, `flood-geometry.ts`, `FilterPanel.ts`+`TimeBar.ts`, `osm-rail-graph.ts`, `ore-incidents.ts`, §2). Gain immédiat de lisibilité du repo, risque quasi nul (zéro import à couper).
2. **Unifier les 5 échelles de couleur de sévérité** (§6) en un seul token de sévérité + un token de fraîcheur séparé, réutilisés partout au lieu de `--threat-*`/`--ecowatt-*`/`--meteo-*`/`--flood-*` redéfinis à l'identique. Fichiers : `src/styles/main.css:1-72`, `src/components/shared/truthBadge.ts`.
3. **Faire respecter l'échelle `--z-*` existante** au lieu des 17 valeurs de z-index en dur (§4) — risque de bugs d'empilement (modales sous popups, etc.) et dette pure à corriger sans changement visuel voulu. Fichier : `src/styles/main.css`.
4. **Réduire le catalogue de layers plutôt que le cacher couche par couche** — 35 cases à cocher sur 7 groupes dans une seule sidebar (`src/components/LayerPanel.ts:17-54`) pour un outil dont le premier réflexe produit design est déjà "cacher tout par défaut" (`DEFAULT_LAYERS`, `src/App.ts:404-441`). Proposer 2 niveaux : un jeu "essentiel" (5-6 layers) toujours visible + un "avancé" replié, plutôt qu'un accordéon plat à 7 groupes.
5. **Donner de vrais titres sémantiques aux panels** — aucun `*Panel.ts` (26 fichiers) n'utilise `<h1>`–`<h6>` (§5) ; remplacer `<span class="panel-title">` (`src/components/Panel.ts:64-66`) par un heading réel. Suite logique et peu coûteuse du chantier clavier déjà livré en juillet.
6. **Combler l'écart `SearchModal`** — seule modale sans `aria-modal` sur les 4 (§1, §5) ; faible effort, cohérence avec les 3 autres déjà conformes.
7. **Harmoniser les points de rupture CSS** — 11 seuils quasi-doublons (768/767/760, 480/430/420) sans variable partagée (§4), et **aucune mise en page tablette réelle** entre 768 px et le desktop fixe à 380 px de sidebar (§3). Définir 2-3 breakpoints nommés et une vraie transition tablette.
8. **Nettoyer les entrées orphelines du catalogue de layers** — la clé `elus` est définie puis masquée en code (`src/components/LayerPanel.ts:53,94`) au lieu d'être retirée ; la clé `alerts` de `MapLayers` (`src/App.ts`) n'a aucune ligne UI correspondante. Fait partie du même chantier que le point 1.
9. **Fusionner les widgets "sous la carte"** — `MarketStrip`, `CommodityStrip` et le conteneur `SituationHistoryPanel` (`src/App.ts:2538-2564`) sont 3 composants indépendants avec chacun leurs états de chargement/vide, pour un contenu financier/historique connexe ; un seul strip combiné réduirait une voix visuelle de plus sans perte d'information.
10. **Clarifier le statut des flags Gaz/Pétrole/Cyber** — actuellement actifs par défaut faute de variable d'environnement positionnée (§1), contrairement à ce qu'indiquait la doc interne ; trancher explicitement (les retirer si le produit les veut actifs, ou les documenter comme "activés par défaut, désactivables" dans `.env.example`) pour éviter une divergence future entre code et documentation.
