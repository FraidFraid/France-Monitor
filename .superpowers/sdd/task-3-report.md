# Task 3 — Conversion dBZ calibrée contre la mosaïque 2D — RAPPORT

**Statut : DONE.** Décision utilisateur (2026-07-23) : adopter les constantes de
la LUT embarquée. L'investigation ci-dessous avait d'abord conclu BLOCKED (météo
trop calme pour la méthode mosaïque + le gain provisoire contredisait la LUT) ;
sur validation, les constantes finales ont été verrouillées et la tâche close.

Date : 2026-07-23. Branche : `feat/radar-3d-phase0`.
(Ce fichier remplace un ancien rapport « MTG-FRP » sans rapport, laissé par une
run SDD précédente au même chemin.)

## FINALISATION (post-décision)

- **Décision utilisateur** : `ZH_DBZ_GAIN = 1.0`, `ZH_DBZ_OFFSET = -10.5` (LUT
  embarquée 321193/021216). L'oracle LUT devient le test PRINCIPAL.
- **Constantes finales** (`pam_bitstream.py`) : `ZH_DBZ_GAIN = 1.0`,
  `ZH_DBZ_OFFSET = -10.5`. Commentaire réécrit (verrou LUT, rampe 1 dBZ,
  code 79 = saturation). `polar_geometry.column_sample` les importe → propagé.
- **Propagation gain 0.5→1.0** : `tests/test_polar_geometry.py` réfère désormais
  `ZH_DBZ_GAIN`/`ZH_DBZ_OFFSET` importés (fini le littéral `40*0.5-10.5`),
  commentaire recalé (code 40 → 29,5 dBZ). Grep de contrôle : le seul autre
  `code * 0.5` restant est `bufr_decoder.py:68` — c'est l'encodage de la
  **mosaïque IMFR27** (produit différent, 160 codes, offset −9), correct et
  laissé intact.
- **Critère de skip météo retenu** (contre-vérif mosaïque) : sauter si
  `N_co-localisés < 500` **OU** `N(mosaïque ≥ 25 dBZ) < 30`. Justification : le
  fit par quantiles (bande 0,60–0,99) et la corrélation ne sont significatifs
  que si (a) l'échantillon est assez grand pour des quantiles stables et (b) il
  y a assez de **vraie pluie** (≥25 dBZ ≈ 1–2 mm/h, bien au-dessus du fouillis /
  de la bruine) pour peupler la bande haute et donner un signal spatial. Le
  simple gate « ≥500 co-loc » ne suffit pas : il est franchi par le fouillis de
  sol (13 150 co-loc aujourd'hui pour seulement 5 px ≥25 dBZ). 30 px ≥25 dBZ ≈
  un noyau convectif/stratiforme minimal de ~30 km² (résolution mosaïque 1 km).
  Sous ce seuil → skip honnête ; au-dessus → exécution SANS relâcher les seuils
  (gain 0,8–1,2, offset −20…0, r > 0,5 inchangé).
- **Preuve verte** :
  - Suite complète worker : `55 passed, 5 skipped, 0 failed`
    (`venv/bin/python3 -m pytest tests/`).
  - Calibration avec fixtures appariées (mosaïque 10:20Z + PAM tour E 10:20Z) :
    `test_embedded_lut_confirms_conversion` **PASSED** (`dbz(centre) = 1.0000 *
    code + −10.5000`, module cohérent) ; `test_affine_calibration_and_spatial_
    agreement` **SKIPPED** avec message explicite : « pluie co-localisée
    insuffisante … 13150 px co-localisés (requis ≥ 500), 5 px ≥ 25 dBZ
    (requis ≥ 30) — météo trop calme dans la portée de la station ».
  - Indépendance vérifiée : l'oracle LUT tourne avec la seule fixture PAM
    (sans mosaïque) ; sans aucune fixture, les deux tests skippent (CI propre).
- **Commit** : `feat: conversion dBZ du ZH PAM verrouillée par la LUT embarquée`
  (fichiers : `pam_bitstream.py`, `tests/test_pam_calibration.py`,
  `tests/test_polar_geometry.py`). Fixtures `data/fixtures-pam/` non committées.

---

### Investigation initiale (conservée pour traçabilité)

---

## TL;DR

1. **Météo non coopérante** : au cycle courant, la France entière est quasi
   sèche. La méthode PRIMAIRE mandatée (ajustement quantiles + corrélation
   spatiale PAM↔mosaïque) ne peut pas satisfaire son contrat `r > 0.5` :
   aucune station métropole n'a assez de pluie **bien co-localisée**.
2. **Oracle secondaire décisif** : la table code→dBZ embarquée dans le message
   ZH (séquence locale 321193, bornes 021216), relue via eccodes, donne une
   rampe identité parfaite, **invariante par station et par tour** :
   `dbz(centre) = 1.0000 * code − 10.5000`.
3. **Conséquence** : `ZH_DBZ_OFFSET = −10.5` est **CORRECT** ; mais
   `ZH_DBZ_GAIN = 0.5` est **FAUX** — il devrait valoir **1.0**. Cela
   contredit la « famille pas 0,5 dBZ ». Conformément au Step 4 du brief
   (« s'il contredit la famille … STOP — rapporter … ne rien inventer »), je
   **n'ai ni modifié la constante ni committé**.

---

## Station / cycle choisis et pourquoi

- **Mosaïque courante** décodée (`decode_bufr`) pour localiser la pluie
  (elle couvre toute la France). Cycle retenu : **2026-07-23T10:20:00Z**.
- Répartition nationale des échos (mosaïque 10:20Z) : seulement **3 689
  pixels d'écho valides** sur 1536² ; **max 36 dBZ** (un seul pixel) ;
  `≥25 dBZ = 16 px`, `≥30 dBZ = 2 px`, `≥35 dBZ = 1 px`. Les 16 pixels
  `≥25 dBZ` sont **tous** groupés à la frontière belge (~50.40 N, 4.63 E).
- Le seul amas de pluie du pays est donc ce système faible à la frontière
  nord (majoritairement en Belgique). Le radar français **le plus proche** est
  **63 — L'AVESNOIS** (50.128 N, 3.812 E). Choisi pour cela.
- **Tour le plus bas** de la station 63 : décodage rapide des tours B–E →
  élévations 2.60 / 1.60 / 1.00 / **0.40°** → **tour E** (0.40°) est le plus bas.
- **Appariement temporel** : mosaïque 10:20Z **+** PAM tour E/D/C **10:20Z**
  → écart **0 min** (appariement parfait, cadence mosaïque = 5 min ici).

## Mesures — méthode PRIMAIRE mandatée (mosaïque)

Sur la paire exacte 10:20Z, tour E (0.40°, le plus bas) :

| grandeur | valeur | contrat | verdict |
|---|---|---|---|
| pixels co-localisés N | **13 150** | ≥ 500 (skip gate) | passe le gate (donc **échoue** au lieu de skipper) |
| gain (fit quantiles) | **0.317** | 0.35–0.65 | **ÉCHEC** (< 0.35) |
| offset (fit quantiles) | **−3.96** | −20…0 | passe |
| corrélation spatiale r | **−0.11** | > 0.5 | **ÉCHEC** (effondrée) |

Tour D (1.00°) pour comparaison : N=16 593, gain=0.474 (passe), offset=−1.41,
**r=−0.04** (échec). Restreint au seul secteur de pluie (NE, 40–100 km) :
r=−0.14 (D) / −0.09 (E) — toujours nul/négatif.

**La géométrie n'est PAS en cause** (vérifié) : les empreintes d'écho
concordent. Empreinte mosaïque `≥15 dBZ` dans 120 km : secteur **NE**,
bearing 8–141°, 3–101 km — exactement la position d'un système passant au NE
du radar. Les primitives PAM sont d'ailleurs verrouillées par eccodes
(`test_pam_differential`). L'effondrement de r vient de la **donnée** :
la pluie est faible (médiane 4 dBZ sur les co-loc, ~rien `≥30`), **en bord de
portée** (~60–90 km NE), et le champ PAM basse élévation est **dominé par le
fouillis de sol** (échos code≥20 : 76 % dans les 20 premiers km, répartis sur
tous les azimuts). Signal de pluie noyé → r ≈ 0. C'est le cas « pas assez de
pluie » du brief.

> Note : sans le fouillis, avec un vrai système convectif bien dans la portée
> (30–80 km, cœurs ≥40 dBZ), la méthode donnerait r>0.5. Elle est saine ; il
> manque juste la météo. À rejouer un jour de pluie franche.

## Oracle secondaire (LUT embarquée) — DÉCISIF, indépendant de la météo

Le message ZH embarque sa propre table code→dBZ (séquence locale **321193**
= réplication différée de `[201132, 030001, 201000, 021216, 021216]` : pour
chaque code, deux bornes de réflectivité `021216` en dBZ, échelle ×10). Relue
via eccodes (tables locales centre 85 v20 fournies dans `eccodes-definitions`) :

- codes **0–10** → `[0, 0]` (pas d'écho / sous le seuil) ;
- codes **11–78** → casiers **larges de 1 dBZ** : `[k−11, k−10]`, centre `k−10.5` ;
- code **79** → `[68, 100]` (**casier de saturation**, ≥ 68 dBZ).

Ajustement du centre sur la région linéaire (codes 11..78) :
**`dbz(centre) = 1.0000 * code − 10.5000`** (fit exact, résidu nul).
**Invariant** : identique sur station **63** (tours C, E) ET station **41**
(tours A, E) — `code40=[29,30]`, `code60=[49,50]`, `code79=[68,100]` partout.

**Contrôle physique** : avec gain 0.5, le code max 79 plafonne à
`0.5·79 − 10.5 = 29 dBZ` — impossible pour un radar (jamais d'orage/grêle).
Avec gain **1.0** : `1.0·79 − 10.5 = 68.5 dBZ` — correct. Le gain 0.5 divise
par deux toutes les réflectivités et écrête le radar à 29 dBZ.

**Verdict oracle** : `ZH_DBZ_GAIN` doit passer de **0.5 → 1.0** ;
`ZH_DBZ_OFFSET = −10.5` est déjà juste (convention centre-de-casier).

## TDD — preuves

- **Rouge/skip sans fixtures** : `pytest tests/test_pam_calibration.py -v`
  → `2 skipped` (skipif : paire de fixtures absente). CI propre.
- **Rouge avec fixtures appariées** (10:20Z) :
  - `test_affine_calibration_and_spatial_agreement` → **FAILED** :
    `calibration: dbz = 0.3174 * code + −3.9593` puis
    `AssertionError: gain hors de la famille attendue (pas 0,5 dBZ)` (0.317<0.35).
    (méthode primaire bloquée par la météo — attendu.)
  - `test_embedded_lut_confirms_conversion` → toutes les assertions **oracle**
    passent (`LUT embarquée : dbz(centre) = 1.0000 * code + −10.5000`, casiers
    de 1 dBZ, code 79 saturation) ; **échoue seulement** sur la cohérence
    module↔LUT : `AssertionError: ZH_DBZ_GAIN=0.5 incohérent avec la LUT (1.000)`.
    → rouge TDD qui **documente le bug** ; vire au vert dès que gain=1.0.

## Fichiers changés / créés

- **Créé (NON committé)** : `services/radar-worker/tests/test_pam_calibration.py`
  - `test_affine_calibration_and_spatial_agreement` : la méthode mandatée du
    brief, **fidèle**, avec un correctif nécessaire dans le helper
    `_mosaic_grid` (voir « Concerns »).
  - `test_embedded_lut_confirms_conversion` : oracle secondaire eccodes,
    indépendant de la pluie, verrouille gain=1.0 / offset=−10.5 et vérifie la
    cohérence du module (rouge tant que le gain n'est pas corrigé).
  - Injection de `ECCODES_DEFINITION_PATH` (tables locales centre 85) en tête
    de module pour rendre l'oracle auto-suffisant.
- **NON modifié** : `services/radar-worker/pam_bitstream.py` — constantes
  laissées telles quelles (`ZH_DBZ_GAIN=0.5`, `ZH_DBZ_OFFSET=−10.5`) faute de
  validation par la méthode primaire et parce que le brief impose STOP+report.
- **Fixtures** téléchargées sous `services/radar-worker/data/fixtures-pam/`
  (mosaïques 10:10Z/10:20Z, PAM 63 tours A–E) : dev only, non committées.
- **Aucun commit** (Step 5 conditionné au vert de la méthode primaire, jamais
  atteint ; et STOP explicite).

## Auto-revue

- Méthode primaire fidèle au brief ; **aucune** assertion desserrée. Le seul
  ajout est le calcul de `grid["bounds"]` dans le helper (voir Concerns) — pas
  une assertion.
- Oracle secondaire trianglé sur 2 stations × plusieurs tours : robuste.
- Constatation gain 0.5→1.0 corroborée par la physique (plafond 29 vs 68 dBZ).
- N'a rien inventé ni committé ; constante inchangée. Décision laissée au user.

## Concerns / à décider

1. **DÉCISION REQUISE — gain 0.5 → 1.0.** Preuve : LUT constructeur (exacte,
   invariante) + physique. Impact : double toutes les réflectivités PAM du
   rendu radar 3D et débloque la plage 29→68 dBZ. Recommandation : approuver le
   passage `ZH_DBZ_GAIN = 1.0`, puis rejouer `test_pam_calibration.py` (l'oracle
   LUT vire au vert immédiatement ; la méthode mosaïque à re-valider un jour de
   pluie franche). `polar_geometry.column_sample` importe déjà les constantes du
   module → le correctif se propage sans autre changement.

2. **Bug dans le test du brief (corrigé dans le helper).** Le `_mosaic_grid`
   du brief fait `return decode_bufr(...)` puis le test lit `grid["bounds"]` —
   or `decode_bufr` **n'expose jamais** `bounds` → `KeyError` même par temps de
   pluie. J'ai ajouté `grid["bounds"] = wgs84_bounds(grid)` (exactement la boîte
   WGS84 dans laquelle `build_manifest`/la carte placent la mosaïque). Sans ce
   correctif la méthode primaire n'aurait **jamais** pu tourner.

3. **Le gate `≥500` ne « skippe » pas gracieusement ici.** N=13 150 co-loc
   (fouillis + écho faible) franchit le gate, donc le test **échoue** au lieu de
   skipper. Les co-loc sont dominés par le fouillis de sol, pas par la pluie ;
   le seuil de 500 pixels bruts ne garantit pas 500 pixels *pluvieux*. À garder
   en tête si on rejoue : préférer un système convectif franc bien centré.

4. **Approximation carte (mapping linéaire dans les bounds).** À 50°N sur
   240 km, l'écart projection stéréographique polaire ↔ équirectangulaire est
   réel (linéaire vs exact : N passe de 18 336 à 11 892 pour un même tour).
   C'est l'approximation voulue (« même que l'affichage carte »), mais elle
   dégradera r même par bonne pluie ; ne pas s'en étonner à la re-validation.
