# Task 5 — Radar manifest proxy, client and map layer

## Statut

Implémentation terminée sur la base `0ce08ea`, commit `c005f60` (`feat: connect Météo-France radar overlay`), limitée au manifeste radar 2D, à son proxy same-origin, au client, à la couche MapLibre et à l’orchestration App. Aucun radar 3D n’a été ajouté. La couche RainViewer existante reste indépendante et inchangée.

## RED → GREEN

### RED initial

- Création de `src/services/radar-2d.test.ts` avant tout code de production.
- Commande : `npx vitest run src/services/radar-2d.test.ts`.
- Résultat : code 1, suite en échec attendu sur `Cannot find module './radar-2d.ts'`.

### GREEN initial

- Implémentation du parseur strict, du cache client, des proxies Vite/Vercel et des IDs MapLibre.
- Même commande : 11 tests réussis, 0 échec.

### RED de régression cache

- Ajout d’un test vérifiant qu’un ancien manifeste configuré n’est pas ressuscité après une réponse `{ configured:false }`.
- Résultat : 1 échec attendu ; le client retournait encore le manifeste mis en cache.

### GREEN de régression cache

- Invalidation explicite du cache lors du retrait de configuration.
- Même commande : 12 tests réussis, 0 échec.

## Implémentation

- `api/fire-observations/radar-2d.js` et `src/plugins/radar-2d-proxy.ts`
  - URL amont exclusivement issue de `METEO_FRANCE_RADAR_MANIFEST_URL` ; aucune URL client acceptée.
  - HTTPS obligatoire hors `localhost`, `127.0.0.1` et `::1`; credentials URL refusés.
  - Redirections refusées, timeout 10 s, corps plafonné à 64 KiB, JSON/MIME et manifeste validés.
  - `{ configured:false }` en HTTP 200 sans configuration ; cache CDN 120 s sur un manifeste valide.
- `src/services/radar-2d.ts`
  - Contrat `Radar2dManifest` conforme au worker (`schemaVersion:1`, source, dates UTC exactes, bounds ordonnées, image sûre, résolution et licence exactes).
  - Cache 120 s, une relance, fallback dégradé sur la dernière valeur valide et invalidation honnête quand la configuration disparaît.
- Carte
  - Source image géoréférencée avec IDs `fire-radar-2d-*`, opacité 0,58 et attribution Météo-France/Licence Ouverte.
  - Overlay désactivé par défaut, placé sous les points FIRMS.
  - Remplacement seulement quand `observedAt` change, rollback de la source/couche précédente en cas d’échec MapLibre.
  - `MapContainer` conserve et rejoue l’état si la carte desktop est initialisée après la donnée.
- `App.ts`
  - Poll 5 minutes uniquement si Feux ou l’overlay radar est actif, pause onglet masqué et verrou anti-chevauchement.
  - États `not-configured`, `ok`, `stale`, `error` dérivés de l’exécution ; dernière couche valide conservée sur panne.
  - État runtime MTG également mis à jour pour préparer le câblage UI dédié à la Task 6.
- `.env.example` documente `METEO_FRANCE_RADAR_MANIFEST_URL` sans préfixe client.

## Vérifications finales

- `npx vitest run src/services/radar-2d.test.ts` : 1 fichier, 12 tests réussis.
- `npm test` : 28 fichiers, 225 tests réussis.
- `npm run typecheck` : succès, aucune erreur.
- `npm run lint` : succès, aucune erreur.
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build` : succès, 1 490 modules transformés, PWA générée.
- `git diff --check` : succès.

Le build conserve deux avertissements préexistants : externalisation navigateur de `spawn` dans loaders.gl et import statique/dynamique simultané de `src/services/oil.ts`.

## Auto-revue

### Critique

Aucun problème critique restant.

### Important

- SSRF : l’amont est strictement configuré côté serveur, les redirections sont interdites et aucun paramètre client ne peut changer l’origine.
- Continuité : le fetch précède toute mutation cartographique ; le cache et le rollback MapLibre conservent la dernière couche valide.
- Cohérence App/carte : après auto-revue, un échec d’installation MapLibre restaure aussi le manifeste précédent dans App, pas seulement le raster.
- Vérité produit : l’absence de configuration est un état 200 explicite et invalide l’ancien cache.
- RainViewer : IDs, code, cadence et couche existants restent séparés ; aucun fallback silencieux.
- Aucun calcul ou rendu 3D, hauteur de panache, fumée ou pyroconvection.

### Risques résiduels

- Le chargement effectif du WebP reste soumis au CORS du stockage/CDN configuré ; le manifeste et le build ne peuvent pas valider un déploiement externe absent.
- Les contrôles et le rendu runtime dans `FiresPanel` appartiennent explicitement à la Task 6 ; Task 5 expose l’état et le callback carte nécessaires sans anticiper cette UI.

## Périmètre préservé

Les changements utilisateur préexistants de `vercel.json` et du dossier `FRANCE MONITOR orientation pour ministeres/` n’ont été ni modifiés par cette tâche ni inclus dans son index git.

---

## Correctifs de review — chargement atomique réel

### RED → GREEN

- RED : `src/components/DeckGLMap.radar-2d.test.ts` a reproduit trois défauts : remplacement de l’ancienne URL avant résolution du chargement, rejet CORS asynchrone non propagé, et manifeste `MapContainer` commité avant succès. Résultat initial : 3 tests en échec sur 3, avec un rejet non géré.
- GREEN : le raster est désormais préchargé par `MapLibre.loadImage()` avec un timeout de 10 secondes avant toute mutation de source/couche. `DeckGLMap.setRadar2dOverlay()` et `MapContainer.setRadar2dOverlay()` propagent une `Promise`; l’état du conteneur n’est commité qu’après installation réussie et `App` attend ce résultat.
- Continuité : un CORS/404/décodage/timeout laisse l’ancienne source, l’ancienne couche et l’ancien manifeste intacts. Le rollback synchrone existant reste actif pour les erreurs `addSource`/`addLayer` postérieures à la prévalidation.

### Couverture renforcée

- succès différé et échec asynchrone du chargement image ;
- visibilité désactivée par défaut et insertion sous `fires-glow` ;
- conservation effective des source/couche RainViewer lors d’un remplacement DPRadar ;
- plafond 64 KiB sans `Content-Length` et refus des réponses de redirection ;
- handler Vercel avec URL configurée valide et configuration HTTP invalide.

Le polling onglet masqué et le verrou anti-chevauchement restent vérifiés par inspection dans `App.ts`. Leur test unitaire isolé nécessiterait un refactoring de l’orchestrateur hors du correctif atomique demandé.

### Vérifications fraîches

- `npx vitest run src/components/DeckGLMap.radar-2d.test.ts src/components/DeckGLMap.mtg-frp.test.ts src/services/radar-2d.test.ts src/services/mtg-frp.test.ts` : 4 fichiers, 49 tests réussis.
- `npm test` : 29 fichiers, 233 tests réussis.
- `npm run typecheck` : succès.
- `npm run lint` : succès.
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build` : succès, 1 490 modules transformés, PWA générée.
- `git diff --check` : succès.

Les deux avertissements de build préexistants (`spawn` externalisé par loaders.gl et import statique/dynamique de `oil.ts`) sont inchangés. `vercel.json` et `FRANCE MONITOR orientation pour ministeres/` restent hors périmètre et hors index.
