# France Monitor — Audit d'accessibilité RGAA 4.x

**Date : 5 juillet 2026** · Audit statique du code (lecture seule) · Niveau global estimé : **≈ 50-55 % des critères applicables respectés**

Socle sémantique solide (landmarks, lang dynamique, noscript, pages annexes bien structurées, ~78 ARIA majoritairement corrects, sévérités non portées par la seule couleur). Non-conformités concentrées sur : contrastes du texte secondaire, opérabilité clavier des éléments non-sémantiques, labels de formulaire, gestion du focus.

## Top 10 des non-conformités

| # | Non-conformité | Localisation | Critère RGAA |
|---|---|---|---|
| 1 | `--text-muted: #606070` → ratios 2,5-3,2:1 (seuil 4,5:1), utilisé partout en texte méta | `main.css` `:root` | 3.2 |
| 2 | Headers de panels collapsables `<div click>` sans rôle/tabindex/aria-expanded/clavier — **classe de base** de la majorité des panels | `Panel.ts:38-40` | 7.1, 7.3 |
| 3 | 7 accordéons de couches non opérables au clavier | `LayerPanel.ts:135-220` | 7.1, 7.3 |
| 4 | Items monitors `role="button" tabindex="0"` sans handler keydown (Entrée/Espace inopérants) | `SituationMonitor.ts:362`, `AlertMonitor.ts:310` | 7.3 |
| 5 | Champs sans étiquette (select région, inputs recherche avec placeholder seul) | `UnderMapNewsFeed.ts:226,243`, `FilterPanel.ts:106` | 11.1 |
| 6 | Aucun lien d'évitement "Aller au contenu" | `index.html` / `App.ts` renderShell | 12.7 |
| 7 | Modales sans piège de focus ni restauration (À propos, Search, Sentinel) | `App.ts:2180`, `SearchModal.ts:123`, `SentinelModal.ts:206` | 7.3, 12.8 |
| 8 | SentinelModal sans role="dialog"/aria-modal (contrairement à la modale À propos, correcte) | `SentinelModal.ts:132-135` | 12.9 |
| 9 | ToastNotification sans role/aria-live — notifications invisibles pour les lecteurs d'écran | `ToastNotification.ts` | 9.4 |
| 10 | `outline:none` multiples avec une seule règle `:focus-visible` dans tout le CSS | `main.css:810,2290,3931,5495` + inline | 10.7 |

## Quick wins (< 1 h chacun)

1. `--text-muted` → ≈ `#8a8a9a` (≈ 4,6:1) ; vérifier aussi `#636366`, `#7c8aa5` en hover, `--threat-critical` sur surface hover
2. Lien d'évitement + style visible-au-focus
3. `role="dialog"` + `aria-modal` + `aria-label` sur SentinelModal
4. `aria-label` sur les champs (select région, inputs recherche)
5. `role="status"` + `aria-live="polite"` sur ToastNotification
6. Handlers keydown (Entrée/Espace) sur les items de monitors
7. Règle globale `:focus-visible { outline: 2px solid var(--text-accent); outline-offset: 2px; }`

## Chantiers lourds

- Refonte clavier de `Panel.ts` + accordéons `LayerPanel.ts` (headers → `<button aria-expanded>`) — un fix de classe de base débloque des dizaines d'écrans
- Utilitaire de modale accessible factorisé (piège de focus + restauration + inert arrière-plan) appliqué aux 4-5 modales
- Audit des ~151 `cursor:pointer` sur éléments non-sémantiques (5 composants seulement ont un keydown)
- Alternative texte à la carte : renforcer/documenter le rôle des panels (le canvas MapLibre/Deck.gl reste non navigable)

## Les 3 chantiers les plus rentables

1. **Opérabilité clavier** des éléments non-sémantiques (gisement le plus large, critères 7.x/12.x)
2. **Contrastes** — une poignée de variables CSS, effet global immédiat (3.2)
3. **Modales + focus** — composant factorisé + `:focus-visible` global + lien d'évitement (lève 7.3, 10.7, 12.7, 12.9 d'un coup)
