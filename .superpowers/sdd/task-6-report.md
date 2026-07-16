# Task 6 — FiresPanel, contrôles et observabilité

## Périmètre livré

- Cinq lignes ordonnées : FIRMS, GIBS, MTG-FRP, radar 2D, radar 3D.
- Statuts runtime transmis par `App` sans réinitialiser l’état des filtres, de GIBS ou de l’accordéon.
- Horodatage et âge affichés pour les flux `ok`/`stale`.
- MTG-FRP marqué `DÉMONSTRATION` et activable par un bouton accessible.
- Radar 2D marqué comme aide à l’interprétation sans diagnostic automatique ni hauteur, avec bouton accessible.
- Radar 3D toujours `NON CONNECTÉ`, sans source opérationnelle ni Watchdog.
- Watchdog et Sources & qualité créés séparément pour MTG-FRP et radar 2D, uniquement après contact effectif du flux.
- L’état radar `not-configured` est rapporté comme une configuration requise, pas comme une panne.

## TDD — RED

Commande :

```text
npx vitest run src/components/fire-observation-model.test.ts src/services/sources-quality-dashboard.test.ts
```

Résultat attendu observé : 2 échecs.

- `fire-observation-model.test.ts` : métadonnée `observation` absente.
- `sources-quality-dashboard.test.ts` : entrées MTG-FRP/radar 2D absentes après contact simulé.

## TDD — GREEN

Commande ciblée finale :

```text
npx vitest run src/components/fire-observation-model.test.ts src/services/sources-quality-dashboard.test.ts
```

Résultat : 2 fichiers, 12 tests réussis.

## Vérification automatisée complète

```text
npm test
29 fichiers réussis, 245 tests réussis.

npm run build
Build Vite réussi en 2 min 28 s, 1490 modules transformés, PWA générée.

npm run typecheck
Succès, exit 0.

npx eslint src/App.ts src/components/FiresPanel.ts src/components/fire-observation-model.ts src/components/fire-observation-model.test.ts src/services/sources-quality-dashboard.ts src/services/sources-quality-dashboard.test.ts
Succès, exit 0.

git diff --check
Succès, aucune erreur d’espace.
```

Le build conserve deux avertissements non bloquants préexistants : export Node `spawn` externalisé par Vite dans `@loaders.gl`, et import à la fois statique/dynamique de `src/services/oil.ts`.

## Vérification navigateur

Vérifié dans l’application locale, en bureau puis avec une largeur étroite demandée à 400 px :

- exactement cinq lignes, dans l’ordre spécifié ;
- MTG-FRP et radar 2D désactivés par défaut (`aria-pressed="false"`) ;
- cibles de contrôle mesurées à environ 54 × 26 px ;
- MTG-FRP affiche une heure d’observation réelle et un âge calculé, avec `DÉMONSTRATION` ;
- le bouton MTG-FRP passe à `aria-pressed="true"` et notifie la carte ;
- radar 2D reste `CONFIGURATION REQUISE` sans worker et son bouton notifie la carte ;
- radar 3D reste `NON CONNECTÉ` ;
- accordéon natif actionnable au clavier et état conservé pendant les rerendus asynchrones ;
- liens présents, GIBS conservé, aucun débordement horizontal du panneau ou du module ;
- aucune erreur console filtrée sur fire/MTG/radar 2D.

## Auto-revue contre la spécification

- Vérité produit : conforme aux six libellés runtime ; aucune activité codée en dur pour les nouveaux flux.
- Accessibilité : boutons textuels, `aria-pressed`, libellés explicites, focus visible, statut écrit sans dépendre de la couleur.
- Résilience : dernière observation conservée en `stale`; rerendu local du module sans perte d’état annexe.
- Observabilité : deux identifiants indépendants (`fire-mtg-frp`, `fire-radar-2d`), enregistrés lors du premier contact seulement.
- Sécurité/périmètre : aucun secret client, aucune URL amont ajoutée, aucune source ou donnée radar 3D.
- Responsive : aucune largeur débordante et commandes repliées sous le texte au breakpoint mobile.

Conclusion : aucun défaut bloquant relevé. Le radar 2D restera légitimement `CONFIGURATION REQUISE` tant que le worker et son manifeste ne sont pas configurés.
