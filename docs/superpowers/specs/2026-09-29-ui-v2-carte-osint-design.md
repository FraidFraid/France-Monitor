# Refonte v2 « carte d'abord » — un outil OSINT propre et clair

Date : 29/09/2026. Statut : design validé section par section avec l'utilisateur ; spec à relire avant le plan.
Branche : `feat/ui-disposition-a1`. Suite de `2026-09-24-refonte-ui-poste-de-situation-design.md` (étapes 1 et 2 en production derrière `?ui=v2`).

## 1. Constat

Le 29/09, l'utilisateur ouvre la v2 (`?ui=v2`), la juge brouillonne et demande un vrai outil OSINT, propre et clair. Capture à 1 600 × 1 000 :

- le panneau « Indicateurs Santé Nationaux » s'ouvre seul, en position fixe, par-dessus la fiche de droite ;
- la carte superpose au chargement cinq couches (actualités en bulles d'articles, arcs d'échanges électriques rouge/vert, vols militaires, santé et son étiquette « Baromètre Santé — 37/100 », vigilances en aplat jaune-brun) ;
- la liste « À traiter » porte « AGGRAVÉ » sur presque chaque ligne et garde des sujets étrangers (Bangkok, Ormuz) ;
- des alertes hantavirus de mai s'affichent sous « Alertes du moment » ;
- l'en-tête empile deux rangées de pastilles de niveau.

Causes relevées dans le code (inventaire du 29/09) :

- `open-national-health` est émis par `ensureHealthPanels()` (`src/App.ts` ~3997) et `loadHealth()` (~6619) dès qu'une couche santé est active, sans lire `suppressFirstLoadPanelAutoOpen` ; la vue par défaut `general` (`src/config/layer-presets.ts`) contient `health` ;
- la vue `general` allume `news`, `powerGrid`, `military`, `health`, `environmental` ; les arcs sont les échanges électriques de `powerGrid` (`DeckGLMap.ts` ~8670) ;
- les étiquettes d'événements viennent du résumé des changements serveur depuis une ancre fictive de 24 h à la première visite (`eventBadge`, `src/services/work-queue.ts`) ;
- les alertes hantavirus sont des données de départ codées en dur (`src/services/hantavirus.ts`), filtrées sans critère d'âge (`NationalHealthPanel.renderAlertesDuMoment`) ;
- aucun mécanisme commun de fraîcheur : « TEMPS RÉEL / CACHE FIGÉ » reflètent l'heure de récupération, pas la date de la donnée.

## 2. Intention

Dit par l'utilisateur :
- un outil OSINT propre et clair, sur le modèle **carte d'abord** (Liveuamap, WorldMonitor) ;
- à l'ouverture, la carte montre les **événements et les vigilances** ;
- l'onglet **État de la France** de la version en ligne (« Intelligence France ») s'ouvre **par défaut, tout le temps**, avec ses graphiques et sa note ;
- cet onglet est repris **en entier mais nettoyé** ;
- approche : **finir la v2** plutôt que nettoyer la v1 ou repartir de zéro.

Supposé (non contredit) : public d'analystes de veille, notamment de services de l'État ; aucune fonctionnalité supprimée, mais tout ce qui n'est pas essentiel passe à la demande ; hébergement gratuit, TypeScript sans framework.

Réussite : **en 10 secondes, voir ce qui se passe maintenant en France, où, avec quelle gravité et selon quelles sources** ; rien de superposé, rien d'ouvert d'office, rien de périmé présenté comme actuel.

## 3. Cahier des charges graphique (validé)

1. La carte occupe l'essentiel de l'écran. Fond sombre, neutre, désaturé (routes et noms discrets). La couleur est réservée à l'information.
2. À l'ouverture, rien que deux choses : les événements en cours (un point par événement, couleur = gravité, taille = nombre de sources) et les vigilances officielles en aplat léger par département.
3. Une seule palette : vert, jaune, orange, rouge, celle de la vigilance officielle. Aucune autre couleur vive nulle part.
4. Un seul fil, étroit. Chaque ligne donne le titre, le lieu, l'heure et le nombre de sources, avec une étiquette au plus. Tri par gravité puis par fraîcheur.
5. Un seul panneau de détail à la fois. Un panneau de module prend la place de l’État (colonne de droite) ; il ne recouvre jamais le fil, la carte ni les commandes, et se ferme avec × ou Échap.
   5 bis. La colonne de droite est l'onglet **État de la France**, ouvert par défaut en permanence ; un clic sur un événement affiche sa fiche à la place ; Échap ou × ramène à l'État.
6. Toute donnée est datée. Au-delà de son délai de fraîcheur, elle est grisée ou masquée, jamais présentée comme « du moment ».
7. En-tête court : niveau national, heure de mise à jour, état des sources.
8. Tout le reste est à la demande (énergie, marchés, vols, navires, santé…) : couches ou tableaux activés par l'analyste, jamais ouverts d'office.
9. Sobriété : une seule police, trois tailles, chiffres alignés. Pas d'emoji, pas d'icône décorative, pas d'animation permanente.
10. Si un élément n'aide pas à décider, il n'est pas à l'écran.

Interdit : panneaux superposés, badges en série, arcs ou trajectoires affichés par défaut, chiffres sans unité, texte coupé.

## 4. Disposition et ouverture

```
┌────────────────────────────────────────────────────────────────────────────┐
│ FranceMonitor  ● Orange · soyez très vigilant · MAJ 12:07 · 33/39 sources   │
│ Vue générale  Énergie  Sécurité  Santé  Environnement   Régions  Couches  FR  ⋯ │
├───────────────┬──────────────────────────────────────┬─────────────────────┤
│ À traiter  12 │               CARTE                  │ État de la France   │
│ (fil)         │   événements + vigilances            │ (niveau, situations,│
│               │                                      │  note, graphiques)  │
└───────────────┴──────────────────────────────────────┴─────────────────────┘
   ~320 px                 le reste                          ~420 px
```

- **En-tête sur deux lignes fines** (remplace l'en-tête global et la barre v2 actuels, `renderShell`, `src/App.ts` ~2532) :
  - ligne 1 : logo, pastille et mot du niveau national, heure de mise à jour, sources à jour ;
  - ligne 2 : thèmes en onglets texte (pastille seulement si le thème est orange ou rouge), sélecteur Régions, bouton Couches, langue, menu ⋯ (qui reçoit « Sources & qualité » et le détail des sources indisponibles).
- **Colonnes** : fil « À traiter » ~320 px, carte, onglet État ~420 px. Aux largeurs où la v2 passe déjà en onglets (tablette, téléphone), le comportement actuel est gardé (`App.ts` ~2900).
- **Couches** : le bouton ouvre un tiroir superposé **à la carte seulement**.
- **Panneaux de module** (Santé, Gaz, Énergie, Cyber, Environnement…) : ouverts uniquement par une action explicite (bouton dans Couches, puce du sélecteur de panneaux, « Voir les indicateurs » d’une bulle de la carte), un seul à la fois, **à la place de l’État, dans la colonne de droite** (même position, même largeur et même hauteur que `.fm-v2-fiche`, mesurées par `App.syncV2ColumnVars`) ; la carte reste dégagée. × ou Échap y ramène (l’État ou la fiche réapparaît) ; toute sélection (ligne du fil, point de carte, lien de l’État) ferme d’abord le panneau (`PosteCallbacks.onSelect`) : jamais deux choses empilées. Les puces restent en haut de la carte (clic : ouvre, second clic : ferme). Tablette et téléphone inchangés. En v2, `NationalHealthPanel` n’est plus en position fixe à droite.
- **Rien ne s'ouvre au chargement.** En v2, l'écouteur de `open-national-health` (`App.ts` ~3074) n'ouvre le panneau que pour un événement marqué explicite (`detail.explicit === true`), posé par les deux déclencheurs utilisateur (panneau des couches, bulle de `DeckGLMap.ts` ~4265) ; les émissions de `ensureHealthPanels()` et `loadHealth()` sont ignorées. Même règle pour tout panneau de couche : l'activation d'une couche ne l'ouvre jamais (`layerActivationOptions`, `src/services/ui-mode.ts`).
- **Échap** : ferme d’abord le panneau de module ouvert (lui seul) ; sinon ferme la fiche ouverte et ramène à l'État, où que soit le focus (carte comprise), sauf dans un champ de saisie ; étend la gestion actuelle limitée au fil et à la fiche (`PosteSituation.ts` ~171).

## 5. Carte et couches

- **Couches au démarrage** d'une nouvelle visite : `events` (nouvelle) et `environmental` (vigilance Météo-France et Vigicrues). Toutes les autres éteintes, dont `powerGrid` (arcs), `military`, `health` (et l'étiquette « Baromètre »), `news` (bulles d'articles).
- **Mémoire des couches** : en v2, l'état des couches est gardé en `sessionStorage` (un rechargement le conserve, une nouvelle visite repart des deux couches) au lieu de `fm-active-layers` en `localStorage`. La v1 ne change pas.
- **Couche Événements** (`events`, libellé « Événements ») :
  - données : les événements consolidés déjà chargés par `startV2Intel` (`/api/events`, toutes les 5 min), statut actif ou refroidissement, avec coordonnées, hors zone « étranger » ;
  - un point par événement ; couleur = niveau L1 (`src/services/vigilance.ts`) ; taille selon les sources indépendantes, 3 paliers (1, 2 à 4, 5 et plus) ; « à confirmer » = anneau jaune vide ;
  - survol : titre ; clic : `PosteSituation.select('event:<id>')`, la même fiche que dans le fil ;
  - ajout d'une couche enfant de groupe : les quatre endroits obligatoires d'`App.ts` (`DEFAULT_LAYERS`, `onLayerToggle`, `syncTrafficGroupState`, `getEffectiveLayers`) plus `MapLayers`, `LayerPanel` et le groupe « Actualités ».
- **Vigilances allégées (v2)** : aplat Météo-France à faible opacité ; le jaune sans bordure, l'orange et le rouge bordés ; stations Vigicrues affichées seulement en orange ou rouge.
- **Thèmes** : choisir un thème active toutes ses couches (décision du 25/09/2026, `layer-presets.ts` inchangé) mais n'ouvre aucun panneau ; il filtre le fil et la carte.
- **Légende** : elle ne liste que les couches allumées.

## 6. Fil « À traiter »

Entrées inchangées (situations, alertes officielles orange ou rouge, événements recoupés, marchés au-delà de leur seuil — `buildWorkQueue`, `src/services/work-queue.ts`), avec ces règles :

- **Étranger** : un événement de zone `etranger` n'entre plus dans la liste ; il va dans un groupe replié en bas du fil, « Hors de France : n », consultable.
- **Ligne** (`WorkList.ts`) : titre entier sur autant de lignes que nécessaire ; puis `lieu · il y a <dernier article> · n sources` ; une étiquette au plus. Le mot de niveau (« Orange ») disparaît, la barre de couleur suffit.
  - **Lieu** : nom du département (« Ain », jamais « 01 ») ; pour un événement, déduit de ses coordonnées par point-dans-polygone sur `/data/departements.geojson` (fonction pure, testée) ; « France » sans coordonnées ou pour un sujet national.
  - **Heure** : celle du dernier article (`lastSeen`), pas l'apparition du sujet.
- **Étiquettes** : une seule, par priorité À CONFIRMER > AGGRAVÉ > NOUVEAU. **Aucune à la première visite** (pas de référence de visite précédente), événements compris.
- **Tri** : gravité, puis fraîcheur (dernier article), puis clé. La règle « lignes étiquetées d'abord » est retirée.
- Inchangé : 12 lignes puis « Voir les n autres », navigation clavier, rappel « hors de ce thème : n rouges ».

## 7. Onglet État de la France

Contenu par défaut de la colonne de droite en v2, construit à partir des blocs du panneau en ligne (`src/components/FranceIntelPanel.ts`, `france-intel-score.ts`, `france-intel-events.ts`, `france-intel-blocks.ts`, `BarometerWidget.ts`), sur l'instantané `buildFranceSnapshot` ; il remplace la fiche France actuelle de la v2 (`src/components/fiche/france.ts`).

De haut en bas :

1. **En-tête** : « France », pastille et mot du niveau (« soyez très vigilant »), « tirée par … », heure de mise à jour, nombre de situations actives. **Seul indicateur de niveau de l'onglet.**
2. **« Pourquoi ce niveau ? »**, replié par défaut (`renderWhyBody`).
3. **Situations** : une ligne par situation (couleur, titre, confiance) ; clic = sa fiche.
4. **Note de situation** (brief renseignement) : évaluation d'ensemble, jugements clés P1–P3 avec leurs preuves, « À surveiller », heure et niveau de rédaction.
5. **Depuis ta dernière visite** : une ligne de totaux, puis au plus 5 changements orange ou rouge, un par ligne, sans série d'étiquettes.
6. **Graphiques** : jauge Infrastructures France et tableau de continuité ; tuiles Domaines (avec unités) ; Énergie (mix, production) ; Pétrole & carburants (stocks, tension, courbe 30 jours) ; Chronologie 7 jours.

Retiré en v2 :
- la liste « Événements consolidés » (doublon du fil) ;
- le second « AI BRIEFING » de `BarometerWidget` (« cache figé », « score ISNR ») et la barre « Stabilité systémique » : ils contredisent le niveau national. L'appel `fetchISNRSynthesis` (`/api/intelligence/v1/synthesis`, Groq, `App.ts` ~7645) n'est plus fait en v2. La v1 garde son comportement.

Thèmes : choisir un thème ne remplace plus l'État par une fiche de thème ; la fiche de thème reste ouverte par un clic sur le thème actif.

L'onglet se met à jour quand l'instantané, le brief ou les événements changent (mêmes déclencheurs que `refreshFranceIntelPanel`).

## 8. Fraîcheur des données

- **Module pur** `src/services/freshness.ts` : table des délais par source et `freshnessOf(dataAt, source, now)` → `fresh` | `stale` ; une donnée sans date est traitée comme `stale` et affichée « date inconnue ».

| Source | Délai |
|---|---|
| Vigilance Météo-France | 6 h |
| Vigicrues | 2 h |
| Écowatt | 24 h |
| Carburants | 2 jours |
| Réseau Sentinelles (hebdomadaire) | 10 jours |
| Alertes sanitaires (hantavirus, ANSM) | 14 jours |
| Note de situation | 12 h |
| Baromètre réseaux (infrastructures) | 1 h |
| Marchés | 1 jour ouvré |

- **Au-delà du délai** : le bloc est grisé avec « données du jj/mm à hh:mm » ; l'élément sort de « Alertes du moment » et de « À traiter ».
- **Dates** : on affiche la date de la donnée, pas l'heure de récupération ; les étiquettes « TEMPS RÉEL » calculées sur l'heure de récupération disparaissent des surfaces v2.
- **Périmètre** : onglet État, fil, carte, panneau Santé (les alertes hantavirus de mai sortent des « Alertes du moment »). Les autres panneaux de module suivront, hors de cette spec (§ 11).

## 9. Tests

- **Logique (Vitest)** : entrées et tri du fil, exclusion de l'étranger, étiquettes à la première visite, priorité d'étiquette ; lieu par point-dans-polygone ; fraîcheur ; couches au démarrage et mémoire de session ; style d'un point d'événement ; composition de l'onglet État (blocs présents, second briefing absent, aucun appel `fetchISNRSynthesis` en v2).
- **Comportement (DOM)** : rien ne s'ouvre au chargement, santé comprise ; Échap ramène à l'État depuis la carte ; un thème ne remplace pas l'État ; un panneau de module s'ouvre dans la zone carte et un seul à la fois.
- **Contrôle visuel à chaque étape** : captures Chrome sans interface à 1 600 × 1 000 et 390 × 844, montrées à l'utilisateur, relues selon la grille du § 3 (rien de superposé, rien d'ouvert d'office, un seul indicateur de niveau, rien de périmé présenté comme actuel, aucun texte coupé).
- Avant chaque livraison : `npm run build`, `npm run typecheck`, tous les tests.

## 10. Mise en service

- Tout reste derrière `?ui=v2` jusqu'à validation de l'utilisateur sur écran.
- Ensuite la v2 devient l'interface par défaut ; la v1 reste accessible par `?ui=v1` jusqu'à ce que l'utilisateur décide de la retirer.
- Ordre de livraison proposé (le plan le détaille) : rien d'office et Échap global → couches de démarrage et couche Événements → fil → onglet État → fraîcheur → en-tête sur deux lignes → bascule par défaut.

## 11. Hors périmètre

- Seuil de la situation « Perturbation télécom significative » (rouge dès quelques pannes, déjà signalé comme suspect) : chantier séparé sur le moteur de situations.
- Fraîcheur des autres panneaux de module (Gaz, Cyber, Éolien, Maritime, Pannes…).
- Refonte mobile au-delà des onglets actuels.
- Authentification (reportée, décision du 05/07/2026).
