# Panneau « État de la France » : réagencement et style de référence (v2)

Date : 01/10/2026. Statut : conception validée en séance (maquettes A et « version 2 avec chevron »).

## 1. Objectif

Réagencer et redessiner l'onglet « État de la France » de la v2 (colonne de droite, `?ui=v2`). Une fois validé à l'écran, son style devient la **référence** pour restyler les autres panneaux.

Constats de départ (production du 01/10) : quatre langages visuels empilés (texte simple en haut ; widgets v1 en police à chasse fixe et cadres imbriqués ; pastilles ; boutons) ; note de situation en bloc compact, preuves détachées des paragraphes ; fraîcheur dispersée (« MAJ », « Rédigée à », « Brief : IA ») ; panneau de 2 400 px sans hiérarchie après l'en-tête.

Contraintes : v2 seulement, v1 inchangée ; aucune donnée ajoutée ni retirée, aucune fonctionnalité retirée ; français ; fond sombre ; TypeScript strict, DOM natif.

## 2. Décisions validées

- **En-tête « Instrument » (maquette A)** : le score et la couleur se lisent d'abord, avec le détail du calcul.
- **Sections repliables avec résumé et chevron (version 2)** : l'essentiel tient sur un écran ; chaque section repliée dit l'important sur sa ligne de titre.
- Le volet « Pourquoi ce niveau ? » disparaît de la fiche France : son contenu devient l'en-tête. La règle A7 (« sous-scores du moteur visibles seulement dans Pourquoi ce niveau ») est levée pour l'État ; elle reste valable pour les autres fiches tant qu'elles ne sont pas restylées.

## 3. Contenu, dans l'ordre

### 3.1 En-tête (toujours visible, non repliable)

1. Sur-titre « État de la France ».
2. Score en grand (46 px, couleur du niveau) suivi de « /100 » ; à droite, la pastille de niveau et « tirée par … » (texte actuel de l'en-tête, `drivenByText`).
3. Échelle 0–55–70–85–100 : quatre zones aux couleurs des niveaux, repère blanc au score, graduations.
4. Ligne de fraîcheur : « n situations actives · x/y sources à jour · MAJ hh:mm · 24 h : <variation> » ; à droite, la courbe 7 jours (80 × 18 px, légende « 7 jours »), reprise du volet actuel.
5. Sous-titre « Ce qui retire des points (base 95) », puis une ligne par pilier (Continuité, Sécurité, Signal, Défense) : libellé · barre de la valeur du pilier (couleur `pillarLevel`) · valeur · variation 24 h du pilier · points retirés.
6. « Facteur principal : … » (`dominantFactorText`), si présent.
7. Encart de plafond (filet gauche orange, fond teinté) : « Plafonné à N tant qu'une situation corrélée est active », si `situationCap` est défini.
8. Avant le premier calcul : « Calcul du niveau national… » à la place des points 2 à 7.

### 3.2 Sections

| Section | Ouverte par défaut | Repliable | Résumé sur la ligne de titre |
|---|---|---|---|
| Situations actives | oui | non | nombre de situations ; sans situation : « Aucune situation active. » dans le contenu |
| Note de situation | oui | oui | « IA · rédigée hh:mm » (« IA, en cache » si servie du cache, « Synthèse automatique » pour le repli déterministe) ; « · au niveau X » si le niveau de rédaction diffère du niveau actuel ; grisé si périmée (`freshness.ts`) ; « en préparation » sans note |
| Depuis votre dernière visite | non | oui | « aucun changement orange ou rouge », ou « n changements orange ou rouges » ; « chargement… » avant les événements. L'ancre (première visite, heure de la visite) reste en tête du contenu |
| Infrastructures | non | oui | point de couleur + « score/100 · n à surveiller » (lignes sous 85) |
| Domaines | non | oui | nombre de domaines par niveau (points orange, jaune, vert) |
| Énergie | non | oui | « Écowatt <couleur> · <production> MW » |
| Carburants | non | oui | pastille de tension + « stocks n j » |
| Chronologie 7 jours | non | oui | « pic <domaine> le jj/mm », ou « calme » |
| Preuves et sources | non | oui | « n preuves · m sources » |

Puis les boutons « Voir sur la carte » et « Note de situation ».

Contenu des sections :
- **Situations** : une ligne par situation : pastille de niveau (largeur fixe) · titre cliquable · confiance en mots. Comportement de sélection inchangé.
- **Note** : « En bref : » + `bluf` (les lignes « Rédigée à … » et « Brief : IA … » quittent le contenu, remplacées par le résumé) ; chaque jugement en paragraphe à filet gauche, sa pastille de preuve (S<n> / E<id>, cliquable comme aujourd'hui) et sa confiance ; « À surveiller » en échéancier (horizon aligné à gauche, texte). Repli déterministe : même rendu. Jamais « indisponible ».
- **Depuis votre dernière visite** : les lignes actuelles (`franceChangeDigest`).
- **Infrastructures** : une ligne de mesure par source du baromètre (libellé · barre · valeur), « Résilience cyber infra » en dernière ligne, puis la phrase d'explication actuelle en petit texte. Source indisponible : « — » sans barre.
- **Domaines** : grille de deux colonnes ; par domaine : point de niveau · nom · chiffre principal, détail en petit dessous ; puis les pastilles d'alerte actuelles (« Orages · Jaune × 10 »…).
- **Énergie** : barre du mix (couleurs actuelles) et légende en une ligne ; production totale ; éolien en direct et taux de charge.
- **Carburants** : stocks nationaux ; tension et part d'anomalies ; un prix par carburant avec variation sur 7 jours ; la courbe des prix sur 30 jours (outil actuel `fuelPriceChart`), sous le tableau.
- **Chronologie** : la carte de chaleur actuelle (domaines × 7 jours, valeurs dans les cases), dans le style du kit.
- **Preuves et sources** : les preuves (pastille + libellé, cliquables) puis les sources en étiquettes.

### 3.3 Mémoire des sections

L'état ouvert ou fermé de chaque section repliable est retenu par clé (`france:<id de section>`) : en mémoire pour survivre aux re-rendus de la fiche (rafraîchissements de données), et dans `localStorage` (lecture et écriture sous `try/catch`, rendu correct sans stockage). Sans état retenu, la valeur par défaut du tableau s'applique.

## 4. Architecture

- **Modèle commun de fiche** (`src/components/fiche/parts.ts`) :
  - `FicheModel.score?: FicheScore` : données de l'en-tête « Instrument » (score, niveau, conducteur, piliers, facteur, plafond, variation 24 h, série 7 jours). Présent : l'en-tête Instrument remplace l'en-tête simple.
  - `FicheSection` gagne `id`, `summary?` (HTML échappé), `collapsible?`, `defaultOpen?`. Une section repliable est rendue en `<details data-section="…">` avec titre, résumé et chevron ; une section non repliable garde un titre simple au même style.
  - Les fiches qui ne renseignent ni `score` ni les nouveaux champs gardent leur rendu actuel (aucun changement visible ailleurs).
- **Indicateurs v2** : nouveau module de fonctions pures (`src/components/fiche/france-indicators.ts`) qui, à partir des mêmes données (`snapshot.signals`, `meteo`, `energy`, `timeline`, résultat du baromètre), produit chaque section (titre, résumé, HTML). Les blocs v1 (`france-intel-blocks.ts`, `BarometerWidget`) ne changent pas et restent utilisés par la v1.
- **Baromètre des infrastructures** : la fiche reçoit le résultat du baromètre dans `FranceFicheInput` ; la v2 cesse d'attacher le widget dans `.fiche-infra-slot` (`onFicheRendered`). Le widget reste créé pour la v1.
- **Mémoire des sections** : tenue par le contrôleur de la fiche (`PosteSituation` / `FichePanel`), sur le modèle de `whyOpen`.

## 5. Kit de style de référence

Classes préfixées `fmk-` (kit), écrites une fois dans `src/styles/main.css`, sous `#app.ui-v2` :

- **Surfaces** : fond de panneau `--bg-primary` (#0a0a0f), fond de la colonne ; filets `--border-color` (#2a2a3e) ; piste de barre `--bg-surface-hover` (#22223a).
- **Texte** : principal #e8e8ec ; secondaire #9898a8 ; discret #8a8a9a.
- **Typographie** : police système pour le texte ; chiffres en `font-variant-numeric: tabular-nums` (plus de police à chasse fixe) ; sur-titres et titres de section en capitales 11 px, interlettrage 0,06 em ; score 46 px graisse 650.
- **Couleur** : les quatre teintes de niveau (`levelHex` / `--sev-*`) seulement pour exprimer un niveau ; le vert de marque `--v2-brand` (#4bfc94) seulement pour l'interactif (chevron et titre au survol, pastilles de preuve, boutons).
- **Composants** : `fmk-score` (score + échelle), `fmk-meter` (libellé · barre · valeur · variation · écart), `fmk-sec` (section : titre, résumé, chevron), `fmk-chip` (pastille de niveau, largeur fixe), `fmk-dot`, `fmk-kv` (clé · valeur), `fmk-ref` (pastille de preuve), `fmk-callout` (encart à filet gauche), `fmk-btn` (bouton à contour vert).
- **Règles** : aucun cadre dans un cadre ; séparation par filets ; une seule forme de ligne de mesure ; chevron 16 px à droite du titre, pivoté de 90° à l'ouverture ; titre entier cliquable ; focus clavier visible (contour vert).
- **Largeur** : rendu identique en colonne de 420 px et en pleine largeur (tablette, téléphone).

Référence écrite : `docs/design/panneau-v2.md` (jetons, composants, règles, captures de l'État), pour restyler ensuite les autres panneaux.

## 6. Hors périmètre

Restyle des autres fiches et des panneaux de couche (étape suivante, après validation de l'État) ; v1 ; données, calculs et seuils ; carte.

## 7. Vérification

- Tests d'abord pour les fonctions pures : résumés de chaque section (cas nominal, données absentes, première visite, note périmée ou en repli), rendu des sections repliables (ouverte, fermée, non repliable), en-tête Instrument (avec et sans plafond, avant calcul).
- Tests existants adaptés : A7 levé pour la fiche France seulement.
- Contrôle visuel sans interface (production locale, `?ui=v2`) à 1600, 1280 et 390 px : en-tête et situations visibles sans défiler à 1600 × 1000 ; chevrons ; mémoire des sections après rafraîchissement ; v1 (`?view=app`) inchangée.
- `npm run typecheck`, suite de tests complète, `npm run build`.
