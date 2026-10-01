# Panneau v2 — kit de style « fmk »

![Panneau « État de la France » de la v2 : score, échelle, piliers, situations actives et début de la note](panneau-v2-etat.png)

Référence de style des panneaux de la v2, établie sur l'onglet « État de la France » (spec
`docs/superpowers/specs/2026-10-01-panneau-etat-reference-design.md`). Tout panneau restylé
reprend ces jetons, ces composants et ces règles.

## Jetons
| Rôle | Valeur |
|---|---|
| Fond de panneau | `--bg-secondary` (#12121a) |
| Filet | `--border-color` (#2a2a3e) |
| Piste de barre | `--bg-surface-hover` (#22223a) |
| Texte principal / secondaire / discret | `--text-primary` / `--text-secondary` / `--text-muted` |
| Niveaux | `--sev-green`, `--sev-yellow`, `--sev-orange`, `--sev-red` (via `levelColorVar`) |
| Interactif | `--v2-brand` (#4bfc94) |
| Points retirés (perte, pas un niveau) | `--fmk-loss` (#ff9f6b) |

## Typographie
- Texte : police système. Chiffres : `font-variant-numeric: tabular-nums` (classe `fmk-num`) ; pas de police à chasse fixe.
- Sur-titres et titres de section : `fmk-eyebrow` (11 px, capitales, interlettrage 0,06 em).
- Chiffre héros : 46 px, graisse 650, couleur du niveau.

## Composants (`src/components/fiche/kit.ts`, `src/components/fiche/parts.ts`, `src/components/shared/vigilancePill.ts`)
| Composant | Rendu | Usage |
|---|---|---|
| En-tête Instrument | rendu par `renderFiche` à partir des données `FicheModel.score` (pas un composant de `kit.ts`) | score, échelle 0–55–70–85–100, fraîcheur, piliers, facteur, plafond |
| Section | `FicheSection` avec `id`, `summary`, `collapsible`, `open` | titre + résumé à droite + chevron ; mémoire par `data-section` |
| Ligne de mesure | `meterRow()` | libellé · barre · valeur · colonnes en plus ; une seule forme |
| Point de niveau | `levelDot()` | domaine, résumé |
| Comptes par niveau | `levelCounts()` | résumé d'une section à plusieurs niveaux |
| Clé · valeur | `kvRow()` | chiffre isolé (production, stocks, prix) |
| Encart | `fmk-callout` | une condition qui change la lecture (plafond) |
| Pastille de niveau | `renderVigilancePill()` | niveau d'une ligne ; largeur fixe |

## Correspondance avec la spec
- `fmk-chip` : pastille `fm-vig` (`renderVigilancePill`)
- `fmk-ref` : `fiche-ref`
- `fmk-btn` : `fiche-action`
- `fmk-sec`, `fmk-score`, `fmk-meter` : mêmes noms

## Règles
1. Aucun cadre dans un cadre : séparer par des filets.
2. Les couleurs de niveau disent un niveau, rien d'autre ; le vert de marque désigne ce qui est cliquable.
3. Chaque section repliée dit l'essentiel sur sa ligne de titre (« 96/100 · 2 à surveiller »).
4. L'essentiel tient dans la première hauteur d'écran ; le détail se déplie.
5. Jamais « indisponible » pour une donnée qui charge : « en attente », « chargement… », « en préparation ».
6. Même rendu en colonne de 420 px et en pleine largeur.

## Restyler un autre panneau
1. Construire son modèle en `FicheModel` (ou ses blocs avec `kit.ts`).
2. Donner un `id` et un résumé à chaque section ; choisir ce qui est ouvert par défaut.
3. Remplacer cadres et polices à chasse fixe par filets, `fmk-num` et `meterRow`.
4. Vérifier à 1600, 1280 et 390 px.
