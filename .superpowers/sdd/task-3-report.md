# Task 3 — MTG-FRP map layer and App orchestration

## Statut

Implémentation terminée sur la base `e67f08f`, limitée à la couche MTG-FRP et à son orchestration. `vercel.json`, le dossier `FRANCE MONITOR orientation pour ministeres/` et le radar n'ont pas été modifiés par cette tâche.

## RED

Le prérequis Task 2 contenait déjà `getMtgFrpTileTemplate()`. Le test exact demandé pour le token MapLibre et le proxy same-origin était donc déjà vert sur la base de départ. Pour conserver un vrai cycle TDD sur le comportement nouveau de Task 3, le test a été complété avec le contrat des identifiants MapLibre stables.

- Commande : `npx vitest run src/services/mtg-frp.test.ts`
- Résultat RED observé : 28 tests exécutés, 1 échec attendu.
- Cause attendue : `MTG_FRP_SOURCE_ID` était `undefined` au lieu de `fire-mtg-frp-source`; 27 tests préexistants réussissaient.

## GREEN

- `src/components/deckgl/format-utils.ts`
  - Ajout des IDs stables `fire-mtg-frp-source` et `fire-mtg-frp-layer`.
- `src/components/DeckGLMap.ts`
  - Ajout de `ensureMtgFrpLayer(force?)` et de l'état de visibilité, désactivé par défaut.
  - La métadonnée est chargée avant toute mutation de la carte.
  - Source raster MapLibre same-origin avec bbox EPSG:3857, attribution LSA SAF, opacité `0.82` et temps d'observation versionné dans l'URL.
  - Aucun remplacement lorsque `observedAt` est inchangé.
  - Remplacement source/couche avec restauration de la version précédente si l'installation de la nouvelle version échoue.
  - Raster inséré sous les points FIRMS pour conserver les détections interactives visibles.
- `src/components/MapContainer.ts`
  - `setMtgFrpEnabled(enabled)` délègue à la carte desktop; le fallback mobile reste sans raster.
- `src/App.ts`
  - App possède `mtgFrpEnabled`, la dernière métadonnée valide et un verrou d'appel.
  - Poll de 10 minutes uniquement si la couche Feux ou l'overlay MTG est actif.
  - Tick ignoré quand `document.hidden`; chevauchement empêché; dernière métadonnée et dernier raster conservés en cas d'échec.
  - Intervalle nettoyé dans `destroy()`.
  - Callback MTG enregistré depuis `FiresPanel`; l'activation visuelle du contrôle reste la responsabilité de la Task 6 prévue au plan.
- `src/components/FiresPanel.ts`
  - Callback public `onMtgFrpToggle` et setter cohérent avec les callbacks existants, sans anticiper le rendu/observabilité de Task 6.
- `src/types/index.ts` / `src/services/mtg-frp.ts`
  - `MtgFrpMetadata` centralisé dans les types partagés et ré-exporté par le service pour préserver l'interface Task 2.

## Vérifications

- `npx vitest run src/services/mtg-frp.test.ts` — 28 tests réussis, 0 échec.
- `npm run typecheck` — succès.
- `npm run build` — succès, 1 489 modules transformés, PWA générée.
- `git diff --check` — succès.
- Smoke endpoint via le serveur Vite déjà actif :
  - `curl -g -fsS --max-time 30 'http://[::1]:3001/api/fire-observations/mtg-frp?operation=metadata'`
  - Réponse valide avec `observedAt: "2026-07-16T13:20:00Z"`, cadence 10 minutes et attribution LSA SAF.
  - Le serveur existant écoutait uniquement sur IPv6 (`[::1]:3001`), donc la forme stricte `127.0.0.1:3001` ne pouvait pas se connecter; le même endpoint same-origin a bien été exercé sans accès CORS direct à l'amont.

Le build conserve deux avertissements préexistants : externalisation navigateur de `spawn` dans loaders.gl et import statique/dynamique simultané de `src/services/oil.ts`.

## Auto-revue

### Critique

Aucun problème critique identifié.

### Important

- La métadonnée est obtenue avant de retirer une source existante; une panne réseau ne provoque donc pas de disparition du dernier raster valide.
- Un échec MapLibre pendant le remplacement déclenche une tentative de restauration de la version précédente.
- Une désactivation pendant un chargement reste sûre : l'état de visibilité est relu au moment d'ajouter la couche, qui demeure masquée.
- Le timer est borné par le retry unique du service Task 2, protégé contre les appels concurrents et détruit avec App.

### Mineur / risque résiduel

- Le cycle MapLibre est vérifié par contrat/typecheck et smoke, mais il n'existe pas encore de test DOM avec une carte MapLibre simulée; le fichier de test imposé couvre les IDs et l'URL de tuile.
- Le fallback mobile D3/SVG n'affiche pas le raster MTG-FRP, conformément à la délégation desktop-only actuelle de `MapContainer`.
- L'interrupteur et l'état dynamique du panneau sont volontairement laissés à la Task 6 du plan; Task 3 expose seulement le callback et l'orchestration nécessaires.

### Fichiers concernés

- `src/App.ts`
- `src/components/DeckGLMap.ts`
- `src/components/FiresPanel.ts`
- `src/components/MapContainer.ts`
- `src/components/deckgl/format-utils.ts`
- `src/services/mtg-frp.test.ts`
- `src/services/mtg-frp.ts`
- `src/types/index.ts`
- `.superpowers/sdd/task-3-report.md`

---

## Correctifs après review

### Finding critique — visibilité MTG-FRP après le wrapper anti-flash

Cause confirmée : le wrapper installé dans `DeckGLMap.init()` force chaque nouvelle couche applicative à `visibility: none`. `addMtgFrpLayer()` déclarait bien la visibilité selon `_mtgFrpEnabled`, mais ne la réappliquait pas après `map.addLayer()`. La création initiale, chaque remplacement temporel et le rollback pouvaient donc laisser le raster activé logiquement mais masqué dans MapLibre.

Correctif minimal : `addMtgFrpLayer()` réapplique explicitement la propriété de layout juste après `addLayer()`. Cette primitive étant utilisée pour la création, le remplacement et la restauration, le même invariant couvre les trois chemins.

Un test MapLibre simulé reproduit le wrapper anti-flash et vérifie le cycle complet :

- création activée visible ;
- remplacement par une nouvelle observation toujours visible ;
- échec d'un remplacement, restauration de l'observation précédente et visibilité maintenue.

### RED

- Commande : `npx vitest run src/components/DeckGLMap.mtg-frp.test.ts`
- Résultat : 1 test exécuté, 1 échec attendu.
- Sortie caractéristique : `expected 'none' to be 'visible'` sur la création initiale.

### GREEN et vérifications

- `npx vitest run src/components/DeckGLMap.mtg-frp.test.ts src/services/mtg-frp.test.ts` — 2 fichiers, 29 tests réussis, 0 échec.
- `npm run typecheck` — succès (`tsc --noEmit`, code 0).
- `npm run build` — succès, 1 489 modules transformés, build Vite et PWA générés (`built in 49.87s`).
- `git diff --check` — succès.

Les deux avertissements de build déjà documentés restent inchangés : externalisation navigateur de `spawn` dans loaders.gl et import statique/dynamique simultané de `src/services/oil.ts`.

### Finding mineur — encapsulation FiresPanel

Le callback MTG-FRP est désormais stocké dans un champ privé `onMtgFrpToggleCb` et reste configuré uniquement par `setOnMtgFrpToggle()`, comme les autres callbacks du panneau. Le setter ignore une réaffectation de la même fonction.

### Périmètre préservé

`vercel.json` et `FRANCE MONITOR orientation pour ministeres/` n'ont pas été modifiés ni indexés par ces correctifs.
