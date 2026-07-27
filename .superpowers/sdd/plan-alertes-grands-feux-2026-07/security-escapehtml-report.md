# Rapport — Passe sécurité `escapeHtml` sans guillemets

## Statut : DONE

## Résumé

Les trois fichiers en astuce DOM identifiés par le brief (`AlertMonitor.ts`, `SituationMonitor.ts`,
`SituationBrief.ts`) ont été alignés sur la version manuelle déjà présente dans
`SentinelModal.ts:57-64` (échappe aussi `"` et `'`). Le bonus (validation de schéma sur
`AlertMonitor.ts:372`) a été traité avec la même approche que `WildfireDossierModal`
(`isSafeSourceUrl` via `new URL(...).protocol`).

Vérifié qu'aucun autre site d'injection en attribut n'existe dans ces trois fichiers : grep exhaustif
de tous les appels `escapeHtml(` dans les trois fichiers — les 5 sites du brief sont les seuls
contextes attribut (`title=`, `href=`), tout le reste est du contenu texte (span/li/p), où l'astuce
DOM restait sans danger. Aucun site supplémentaire à signaler.

## Les cinq sites — charge utilisée et preuve d'échec avant correction

| # | Fichier:ligne | Site | Test | Échoue avant correction ? |
|---|---|---|---|---|
| 1 | `AlertMonitor.ts:352` (ex `:328`) | `title="${escapeHtml(s.summary)}"` sur `.sit-mon__item` | `AlertMonitor.test.ts` — *« échappe les guillemets de summary dans l'attribut title de l'item »* — charge `Résumé" onmouseover="alert(1)` | **Oui** — `getAttribute('onmouseover')` renvoyait `"alert(1)"` |
| 2 | `AlertMonitor.ts:396` (ex `:372`) | `href="${escapeHtml(s.linkUrl)}"` sur `.alert-mon__detail-link` | `AlertMonitor.test.ts` — *« échappe les guillemets de linkUrl dans l'attribut href »* — charge `https://exemple.fr/article" onmouseover="alert(3)` (schéma https: valide, guillemet brut) | **Oui** — `getAttribute('onmouseover')` renvoyait `"alert(3)"` |
| 3 | `AlertMonitor.ts:402` (ex `:378`) | `title="${escapeHtml(r)}"` sur `.sit-mon__detail-source` | `AlertMonitor.test.ts` — *« échappe les guillemets de sourceRefs dans l'attribut title du détail »* — charge `Source AFP" onmouseover="alert(2)` | **Oui** — `getAttribute('onmouseover')` renvoyait `"alert(2)"` |
| 4 | `SituationMonitor.ts:424` (ex `:418`) | `title="${escapeHtml(s.summary)}"` sur `.sit-mon__item` | `SituationMonitor.test.ts` — même charge que le site 1 | **Oui** — même symptôme |
| 5 | `SituationBrief.ts:266` (ex `:260`) | `title="${escapeHtml(...)}"` sur `.sit-brief__item` | `SituationBrief.test.ts` — charge `Titre" onmouseover="alert(1)` dans le titre de la situation | **Oui** — même symptôme |

Les 5 tests d'exploitation ont été exécutés **avant** toute modification du code source (seuls les
fichiers de test existaient) : les 5 ont échoué avec `getAttribute('onmouseover')` non-null, preuve
que la charge sortait bien de l'attribut. Après application de la correction (remplacement de
`escapeHtml` par la version manuelle + gate `isSafeSourceUrl` sur le site 2), les 5 passent.

## Bonus — schéma de `AlertMonitor.ts:372`

Ajout de `isSafeSourceUrl` (copie conforme du pattern de `WildfireDossierModal.ts:53-64` :
`new URL(value).protocol` restreint à `http:`/`https:`, `try/catch` pour URL relative/malformée) et
gate du bloc `alert-mon__detail-actions` entier sur `s.linkUrl && isSafeSourceUrl(s.linkUrl)`. Contrairement
à `WildfireDossierModal` (qui garde un fallback texte avec le nom de la source), `AlertMonitor` n'a pas
de nom de source distinct pour ce lien — seul le libellé "Ouvrir la source" existe, indissociable du
lien lui-même — donc masquer le bloc entier quand le schéma est refusé est la correction minimale
cohérente avec « ne pas afficher de lien trompeur », sans changer le comportement au-delà de la
validation de schéma.

5 tests de schéma ajoutés, tous exécutés avant/après :

| Cas | Avant correction | Après correction |
|---|---|---|
| `javascript:alert(1)` | **Échoue** — un `<a href="javascript:alert(1)">` était produit | Passe — aucun `<a>` |
| `data:text/html,<script>alert(1)</script>` | **Échoue** — idem | Passe — aucun `<a>` |
| URL relative `/a/1` | **Échoue** — idem | Passe — aucun `<a>` |
| Chaîne vide `''` | Passait déjà (le `s.linkUrl &&` existant sautait déjà le rendu) | Passe toujours |
| `https://exemple.fr/article` (normal) | Passait déjà | Passe toujours |

Les deux derniers cas (chaîne vide, https normal) ne sont **pas** des tests d'exploitation — ce sont
des garde-fous de régression exigés par le brief pour vérifier que le nouveau gate ne casse pas le
comportement légitime. Ils passaient déjà avant la correction, ce qui est normal et attendu : ils ne
testent pas la vulnérabilité, ils protègent le comportement correct existant.

## Tests

- **10 tests ajoutés**, répartis dans 3 nouveaux fichiers colocalisés (`@vitest-environment happy-dom`,
  aucun fichier de test préexistant pour ces trois composants) :
  - `src/components/AlertMonitor.test.ts` — 8 tests (3 exploitation + 5 schéma)
  - `src/components/SituationMonitor.test.ts` — 1 test (exploitation)
  - `src/components/SituationBrief.test.ts` — 1 test (exploitation)
- Toutes les assertions sont **sémantiques** : parsing DOM réel (`happy-dom`) + `getAttribute(...)`,
  jamais de recherche de sous-chaîne.
- **RED confirmé explicitement** : run des 3 fichiers de test contre le code non corrigé →
  8 échecs / 2 passes (les 2 passes = garde-fous de régression, cf. ci-dessus, pas des exploits).
- **GREEN confirmé** : run après correction → 10/10 passent.

## Clôture

```
npm test          →  44 fichiers, 365 tests passés (baseline 41 fichiers / 355 tests + 3 fichiers / 10 tests, aucune régression)
npm run typecheck →  aucune erreur
npm run build     →  succès, aucun warning
```

## Fichiers modifiés

- `src/components/AlertMonitor.ts` — `escapeHtml` manuel + `isSafeSourceUrl` + gate sur le lien source
- `src/components/SituationMonitor.ts` — `escapeHtml` manuel
- `src/components/SituationBrief.ts` — `escapeHtml` manuel
- `src/components/AlertMonitor.test.ts` — nouveau
- `src/components/SituationMonitor.test.ts` — nouveau
- `src/components/SituationBrief.test.ts` — nouveau

## Non-objectifs respectés

- Aucune unification des deux `escapeHtml` dans un module partagé.
- Aucun autre fichier en astuce DOM touché (`ToastNotification.ts`, `MapPopup.ts`, `MarketStrip.ts`,
  `CommodityStrip.ts`, `UnderMapNewsFeed.ts`, `SituationHistoryPanel.ts` — non modifiés, vérifié par
  `git status`).
- Aucun changement de comportement au-delà de l'échappement et de la validation de schéma.
