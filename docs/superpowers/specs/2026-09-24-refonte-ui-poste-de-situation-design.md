# Refonte de l'interface : « poste de situation »

- **Date** : 24/09/2026
- **Statut** : design validé en séance, spécification à relire par l'utilisateur
- **Base de code** : `main` après fusion de `feat/audit-2026-09-hobby-perf` puis de `feat/socle-intelligence-france`
- **Maquettes** (locales, non versionnées) : `.worktrees/audit-2026-09/.superpowers/brainstorm/52931-1790237702/content/` (`disposition.html`, `langage.html`, `fiche.html`, `themes-liste.html`, `mobile.html`)

## 1. Problème

L'utilisateur trouve l'écran « brouillon et peu intelligible ». Constats sur les captures de production du 24/09/2026 :

1. **Rangé par source, pas par question.** 35 couches à cocher, un panneau par API (Écowatt, pétrole, maritime), des modules de bourse. Il faut savoir quelle source ouvrir pour savoir ce qui se passe.
2. **Pas de point d'entrée.** À l'ouverture, cinq éléments se disputent l'attention : alertes flottantes, pastille « 3 convergences », tiroir Intelligence, liste des couches, dix pastilles de régions.
3. **Trop de notes sans échelle commune.** « 43 DÉGRADÉ » et « vigilance (81/100) » dans le même tiroir, « Infrastructures 82 DÉGRADÉ », « Écowatt 47 », « pétrole 49 ». Le sens de chaque nombre n'est pas dit.
4. **Vocabulaire du moteur exposé.** `SIT-01 · ENERGY_STRESS`, `CONF 0.95`, « moteur 10 règles », « Plafonné à 55 », `STRUCTURAL`, « fallback consolidé », « 16 slots non capturés » ; français et anglais mélangés.
5. **Panneaux superposés.** Alertes, légende, fiche de droite et pastille recouvrent la carte ; la fiche Écowatt reste ouverte par-dessus la page Modules.
6. **La couleur ne veut plus rien dire.** Le même rouge sert au critique, à un CAC 40 à −0,19 %, à un import d'électricité et à une région Écowatt.
7. **Typographie uniforme** : petites capitales, chasse fixe, pastilles et bordures partout.

Deux bugs de production, à corriger dans l'étape 1 :
- le brief affiche un score calculé à l'ouverture (81) qui contredit l'indice courant (43) : le brief n'est pas recalculé quand l'indice change ;
- des entités HTML restent brutes dans le flux d'actualités (`d&#039;anciennes`).

La branche d'audit règle déjà une partie des points 2 et 5 : cinq vues prédéfinies, régions dans un menu, aucun panneau ouvert au premier chargement, un seul panneau flottant à la fois. La refonte part de là.

## 2. Objectif et critères de réussite

Organiser l'écran autour de trois questions : **que se passe-t-il, où, qu'est-ce qui a changé ?** Public : décideurs de services publics et analystes OSINT.

Critères de réussite, vérifiables à l'œil sur l'écran d'ouverture en 1 440 px :
- le niveau national est lisible en mot et en couleur, avec ce qui le tire, sans aucun clic ;
- les changements depuis la dernière visite sont visibles sans clic ;
- aucun code du moteur (`SIT-`, noms de types en anglais, `CONF`) ni aucun score brut hors du volet « Pourquoi ce niveau ? » ;
- une couleur ne signifie qu'une gravité, sur tout l'écran ;
- aucun panneau ne recouvre la carte sur ordinateur, à l'exception des outils de carte (couches, légende, zoom) ;
- tout élément de la liste s'ouvre en un clic dans la fiche de droite.

## 3. Décisions validées

| Sujet | Décision |
|---|---|
| Piste | A, « poste de situation » |
| Disposition | A1 : trois colonnes fixes, liste « À traiter », carte, fiche |
| Échelle | L1 : les quatre couleurs de vigilance officielles |
| Fiche | un format unique pour tout ce qu'on sélectionne (§6) |
| Thèmes | un thème filtre la liste, la carte et la fiche, avec une garde pour les rouges hors thème |
| Marchés | hors de l'écran principal (page « Tableaux »), sauf mouvement exceptionnel |
| Mobile | trois onglets, fiche en volet |

## 4. Langage commun (échelle L1)

### 4.1 Niveaux

Quatre niveaux, mêmes teintes que Météo-France, Vigicrues et Écowatt (jetons existants `--sev-green`, `--sev-yellow`, `--sev-orange`, `--sev-red` de `src/styles/main.css`, déjà alignés sur les couleurs officielles) :

| Niveau | Libellé court | Phrase officielle |
|---|---|---|
| vert | Vert | pas de vigilance particulière |
| jaune | Jaune | soyez attentif |
| orange | Orange | soyez très vigilant |
| rouge | Rouge | vigilance absolue |

Texte noir sur les quatre pastilles : c'est le seul choix qui atteint le contraste AA sur ces teintes (le blanc sur `#ff3b30` et sur `#34c759` échoue). Les maquettes, qui mettaient du blanc sur le rouge, sont remplacées par cette règle.

### 4.2 Conversion vers le niveau

Une seule fonction pure fait toutes les conversions (§10). Les seuils du score v3 (85/70/55) ne changent pas ; les fixtures de `france-country-intel.test.ts` restent intactes.

| Ce qui est noté | Vert | Jaune | Orange | Rouge |
|---|---|---|---|---|
| Indice national (0–100) | ≥ 85 | 70–84 | 55–69 | < 55 |
| Situation du moteur (`SituationSeverity`) | — | `watch`, `medium` | `high` | `critical` |
| Événement consolidé (`ThreatLevel`) | `info`, `low` | `medium` | `high` | `critical` |
| Signal officiel (Écowatt, vigilance Météo, Vigicrues) | vert | jaune | orange | rouge ; le violet Météo compte comme rouge |
| Thème | le niveau le plus élevé parmi ses signaux officiels et ses éléments « À traiter » |
| Marché | jamais coloré, sauf seuil exceptionnel (§4.4) → jaune |

« Dégradé » et « critique » de l'indice national fusionnent en rouge ; la distinction reste lisible dans « Pourquoi ce niveau ? ».

Cette conversion ne vaut que pour le niveau affiché dans le bandeau, la liste et les fiches. Sur la carte, les couches officielles gardent leurs couleurs d'origine, violet Météo compris.

### 4.3 Règles d'écriture

- Le mot d'abord ; le nombre seulement dans « Pourquoi ce niveau ? ».
- Tout en français. Aucun code du moteur à l'écran : les types de situation s'affichent par leur titre (déjà en français), jamais par leur identifiant ou leur type.
- Confiance en mots : ≥ 0,75 « élevée », ≥ 0,55 « moyenne », sinon « faible » (seuils déjà utilisés par le brief).
- Phrases en casse normale ; majuscules réservées aux sigles.
- Durées relatives (« il y a 30 min », « depuis 2 j ») et heures au format 24 h.
- Fraîcheur : un seul voyant commun (« 33 sources sur 35 à jour »), le détail dans « Sources et qualité ». Plus de badges par source (`STRUCTURAL`, `DIFFÉRÉ`, « fallback consolidé ») dans les fiches ; la fiche d'un thème dit en clair la périodicité (« données SDES 2024, mises à jour chaque mois »).

### 4.4 Marchés

Couleur neutre (gris) par défaut, graphiques compris. Un mouvement exceptionnel entre dans « À traiter » en jaune :
- indice boursier : variation de ±3 % ou plus sur la journée ;
- pétrole (Brent, WTI) ou gaz naturel : ±5 % ou plus sur la journée ; il apparaît aussi dans le thème Énergie.

## 5. Écran principal (disposition A1)

De haut en bas :

1. **En-tête** : logo, « Régions ▾ », puis à droite « Note de situation », « Tableaux », « Sources et qualité », bascule FR/EN.
2. **Bandeau d'état** (une ligne) : pastille du niveau national, « France · tirée par <thème> · <tendance 24 h> », « Depuis votre visite (<durée>) : <n> aggravations · <n> nouveaux », voyant de fraîcheur à droite. Première visite : « Première visite : dernières 24 h ».
   « Tirée par » nomme les thèmes dont le niveau égale le niveau national, deux au plus ; s'il n'y en a aucun, le thème au niveau le plus élevé ; si tous sont verts, « sans pression dominante ».
3. **Barre de thèmes** : « Vue générale », « Énergie », « Sécurité et défense », « Santé », « Environnement et transports » (les cinq vues de `src/config/layer-presets.ts`), chacun avec sa pastille de niveau.
4. **Trois colonnes** :
   - gauche, liste « À traiter » (≈ 30 %, 300 px minimum) ;
   - centre, carte (reste de la largeur) ;
   - droite, fiche (≈ 28 %, 340 px minimum).

Disparaissent de l'écran principal : le panneau flottant `AlertMonitor`, la pastille « convergences » et le bandeau `SituationBrief`, `SituationMonitor`, le tiroir `FranceIntelPanel` (remplacé par la fiche France), les panneaux par source ouverts sur la carte (remplacés par des fiches), les légendes posées sur la carte (derrière un bouton), les dix pastilles de régions (déjà en menu sur la branche d'audit).

## 6. Fiche unique (colonne de droite)

### 6.1 Types de fiche

Pays (France, affichée quand rien n'est sélectionné), thème, région, situation, événement consolidé, alerte officielle, navire ou aéronef. Chaque type remplit les mêmes parties ; les parties vides sont omises.

### 6.2 Parties, toujours dans cet ordre

1. **En-tête** : type, nom, pastille de niveau et une ligne « tiré par … », fraîcheur.
2. **L'essentiel** : une à trois phrases.
3. **Ce qui a changé** : depuis la visite (ancre `intel-last-visit`), une ligne par changement avec son heure.
4. **Chiffres clés** : trois au plus, chiffres tabulaires.
5. **À surveiller** : indicateur précis et horizon (6 h, 24 h, 48 h).
6. **Preuves et sources** : boutons cliquables (preuves `E…` / `S…` du brief v14, articles d'un événement, sources d'un thème).
7. **Pourquoi ce niveau ?** : replié. Contient l'indice chiffré, les piliers, les plafonds, les règles du moteur, la confiance, l'historique 7 jours.
8. **Actions** : « Voir sur la carte », et « Note de situation » sur la fiche France.

### 6.3 Contenu par type

- **France** : l'essentiel = BLUF du brief v14 ; « Jugements » (partie propre à la France, entre 3 et 4) = jugements du brief avec leurs preuves et leur confiance en mots ; « À surveiller » = `watch` du brief. Le brief est redemandé quand le niveau national change de couleur, ce qui corrige le bug 81/43.
- **Thème** : niveau du thème, signaux officiels du thème, trois chiffres (ex. Énergie : production nationale, stocks de carburant, solde des échanges), sources. Les panneaux Écowatt, Pétrole, Gaz, Nucléaire, Éolien, Maritime, etc. deviennent le contenu « Pourquoi ce niveau ? » et « Chiffres clés » de leur thème.
- **Événement** : articles (titre, source, heure, lien http(s) seulement), journal (créé, aggravé, corroboré…), sources indépendantes.
- **Situation** : résumé, facteurs (ex-`drivers`), zones, actions recommandées, sources.
- **Navire / aéronef** : identité, position, dernière observation, motif d'alerte.

## 7. Liste « À traiter » (colonne de gauche)

### 7.1 Ce qui entre

- toutes les situations détectées par le moteur ;
- les alertes officielles orange ou rouges (Écowatt, vigilance Météo, Vigicrues) ;
- les alertes maritimes et aériennes (approche de câble, squawk d'urgence) ;
- les événements consolidés au moins jaunes, s'ils sont corroborés par au moins 2 groupes indépendants **ou** s'ils sont orange ou rouges ;
- les mouvements de marché exceptionnels (§4.4).

Rien de vert n'entre dans la liste.

### 7.2 Tri et affichage

- Tri : couleur (rouge d'abord), puis « nouveau » ou « aggravé » depuis la visite, puis le plus récent.
- Au plus 12 lignes, puis « Voir les <n> autres ».
- Une ligne : barre de couleur, titre en clair, « <Niveau> · <lieu> · <depuis> · <n> sources indép. », badge `NOUVEAU` ou `AGGRAVÉ` s'il y a lieu.
- En tête de liste : « À traiter · <thème> · <n> ».

### 7.3 Filtre par thème et garde

Un thème filtre la liste, les couches de la carte et la fiche. Rattachement des éléments :

| Catégorie ou source | Thème |
|---|---|
| `energy`, Écowatt, carburants, gaz, nucléaire, éolien, pétrole et gaz des marchés | Énergie |
| `security`, `cyber`, `social`, situations de défense, alertes maritimes et aériennes | Sécurité et défense |
| `health` | Santé |
| `weather`, `floods`, `fires`, `transport`, `infrastructure` | Environnement et transports |
| `finance`, `general`, indices boursiers | Vue générale seulement |

**Garde** : tant qu'un élément rouge existe hors du thème sélectionné, une ligne fixe reste en bas de la liste : « Hors de ce thème : <n> rouge(s) (<thèmes>) » ; un clic bascule vers le thème concerné.

### 7.4 États

- Première visite : le bandeau le dit, la liste est inchangée.
- Rien à traiter : « Rien à traiter. <n> éléments suivis sont au vert. » ; la fiche du thème s'affiche, verte.
- Historique d'événements indisponible : la liste garde les situations et les alertes officielles, avec la ligne « Événements indisponibles pour le moment » ; la fiche France reste affichée.

## 8. Carte, couches et « Tableaux »

- Par défaut, la carte montre les lieux des éléments de la liste (situations et événements géolocalisés, zones des alertes officielles) et les couches du thème sélectionné.
- Bouton « Couches » (outil de carte) : les 35 couches existantes, groupées comme aujourd'hui, pour l'analyste.
- Bouton « Légende » : la légende des couches visibles, fermée par défaut.
- Aucun autre panneau flottant sur la carte, sur ordinateur.
- La page « Modules » devient « **Tableaux** », hors de l'écran principal : marchés, matières premières, historique de situation, flux brut des articles. Les marchés y sont en couleur neutre.

## 9. Mobile, tablette, accessibilité

- **Mobile (< 700 px)** : trois onglets en bas de l'écran, « À traiter », « Carte », « France » (ou le thème choisi). Bandeau d'état et barre de thèmes en haut, défilement horizontal pour les thèmes. Une sélection ouvre sa fiche en volet remontable (panneaux mobiles déjà codés sur la branche d'audit).
- **Tablette (700–1 100 px)** : deux colonnes, liste et carte ; la fiche s'ouvre en volet à droite, par-dessus la carte.
- **Accessibilité** : le mot accompagne toujours la couleur ; liste navigable au clavier, Entrée ouvre la fiche, Échap la referme ; le focus survit aux reconstructions (état d'interface gardé hors du DOM, comme pour le socle) ; contrastes AA.

## 10. Architecture

Nouveaux modules purs (sans DOM ni réseau, testables sous Node) :
- `src/services/vigilance.ts` : type `VigilanceLevel = 'vert' | 'jaune' | 'orange' | 'rouge'`, conversions du §4.2, libellés du §4.1, confiance en mots, seuils de marché. Devient la source unique des libellés de bande côté client : `FranceIntelPanel.ts` et `france-intel-brief.ts` cessent de dupliquer les bandes. Le handler serveur `api/_handlers/intelligence/v1/france-intel-brief.js` garde ses propres seuils pour l'invite, mais ses libellés deviennent ceux de L1 (« vigilance orange »…), avec une version d'invite v15 ; un test vérifie que ses seuils restent alignés sur 85/70/55.
- `src/services/work-queue.ts` : construit la liste « À traiter » depuis les situations, les événements, les alertes officielles et les marchés ; tri, plafond, filtre par thème, garde hors thème, badges nouveau/aggravé par rapport à l'ancre de visite.
- `src/components/fiche/*.ts` : rendu HTML échappé de chaque partie de fiche et de chaque type (même principe que `france-intel-events.ts`).

Composants d'interface :
- `StatusBar.ts` (bandeau d'état), `ThemeBar.ts`, `WorkList.ts`, `FichePanel.ts` ; intégration dans `App.ts`.
- Pendant les étapes 2 et 3, le paramètre d'URL `?ui=v2` active la nouvelle interface ; l'ancienne reste l'interface par défaut jusqu'à la fin de l'étape 3, où le paramètre et l'ancienne interface sont retirés.

Réutilisés tels quels : services de données, moteur de situations, score v3, événements et preuves du socle, ancre de dernière visite, vues de `layer-presets.ts`, carte (`MapContainer`, `DeckGLMap`, repli D3 mobile).

## 11. Livraison

0. **Préalable** : vérification du socle sur une branche Neon, puis fusion de `feat/audit-2026-09-hobby-perf`, puis de `feat/socle-intelligence-france`.
1. **Langage commun, dans la disposition actuelle** : `vigilance.ts` ; libellés et couleurs appliqués au tiroir, aux alertes, aux fiches de thème existantes ; codes du moteur remplacés ; marchés neutres et seuils ; typographie allégée ; correction des deux bugs de production. Utile seule.
2. **Disposition A1** (derrière `?ui=v2`) : bandeau d'état, liste « À traiter » avec garde, fiche unique pour France, thème et événement ; retrait, dans la v2, d'`AlertMonitor`, de la pastille convergences, de `SituationBrief`, de `SituationMonitor` et du tiroir.
3. **Thèmes et carte** : filtre par thème, carte limitée à l'essentiel, boutons « Couches » et « Légende », panneaux par source convertis en fiches de thème, fiches situation, région, alerte officielle, navire ; « Modules » → « Tableaux » ; bascule définitive vers la v2 et retrait de l'ancienne interface.

Le mobile et la tablette sont livrés à chaque étape, pas à la fin. Chaque étape fait l'objet de son propre plan d'implémentation, écrit et validé avant d'être exécuté.

## 12. Tests

- **Unitaires** (vitest, Node) : conversions et libellés de `vigilance.ts` (bornes 85/70/55, chaque gravité, signaux officiels, seuils de marché) ; `work-queue.ts` (règles d'entrée, tri, plafond, filtre, garde hors thème, badges) ; rendu de chaque partie de fiche (échappement, liens http(s) seulement, parties vides omises).
- **Non-régression** : fixtures du score v3 inchangées ; test d'alignement des seuils du handler serveur sur `vigilance.ts`.
- **Navigateur** (Chrome sans interface, script CDP) à chaque étape, à 1 440, 1 280, 820 et 390 px : première visite, rien à traiter, historique indisponible, données factices ; clavier de la liste vers la fiche ; aucun panneau superposé à la carte sur ordinateur ; absence de codes moteur dans le texte visible.
- **Critères du §2** vérifiés sur capture à chaque étape.

## 13. Hors périmètre

- Authentification, listes de veille personnelles, épingles.
- Nouvelles sources de données.
- Modification de la formule ou de la calibration du score v3.
- Recoloration des couleurs officielles (Écowatt, Météo-France, Vigicrues).
- Refonte de la page « Sources et qualité » et de la note de situation (seuls leurs libellés suivent le langage commun).

## 14. Aucune fonctionnalité retirée

Règle validée par l'utilisateur le 24/09/2026 : la refonte déplace et réorganise, elle ne supprime aucune fonction. Tout ce qui quitte l'écran principal reste accessible, avec le même contenu, à l'endroit indiqué ci-dessous. Chaque étape vérifie cette table dans le navigateur avant d'être considérée comme terminée.

| Fonction actuelle | Nouvel emplacement |
|---|---|
| Panneau flottant des alertes : liste, détail, « Voir toutes », ouverture du dossier grands feux, lien source | Liste « À traiter » (toutes les alertes) et fiche de l'alerte (détail, lien, dossier grands feux) |
| « Convergences — 24 h » (`SituationBrief`) : actives et résolues récemment, survol, centrage carte | Liste « À traiter » (badges nouveau/aggravé), bandeau d'état ; les situations résolues dans les 24 h restent dans « Ce qui a changé » de la fiche France |
| `SituationMonitor` : liste des situations, détail, centrage carte | Liste « À traiter » et fiche situation |
| Tiroir Intelligence : score, jauge, piliers, Δ24 h, courbe 7 jours, plafond, facteur principal | Fiche France, volet « Pourquoi ce niveau ? » |
| Tiroir : situations corrélées (résumé, facteurs, zones, actions, sources) | Liste « À traiter » et fiche situation |
| Tiroir : brief (BLUF, jugements, preuves cliquables, à surveiller), fil « dernière visite », événements consolidés | Fiche France et liste « À traiter » |
| Tiroir : domaines, bloc énergie, chronologie 7 jours, baromètre des infrastructures (et son infobulle) | Fiche France (« Pourquoi ce niveau ? ») et fiches de thème |
| Panneaux par source : Écowatt/réseau électrique, pétrole, gaz, nucléaire, hydraulique, éolien, énergie DROM, maritime (recherche, filtres, onglets), trafic, feux et dossier, santé, cyber, défense, pannes, ministres, météo spatiale | Fiches de thème et fiches d'objet, avec tout leur contenu, leurs recherches, filtres et onglets |
| Les 35 couches et leurs groupes | Bouton « Couches » de la carte |
| Légendes de couches | Bouton « Légende » de la carte |
| Pastilles de régions | Menu « Régions » (déjà sur la branche d'audit) |
| Page Modules : flux boursier, matières premières, historique de situation (7 j / 30 j), flux d'actualités (filtres, recherche, périodes) | Page « Tableaux », à l'identique (seules les couleurs de marché suivent §4.4) |
| Note de situation, export, sources et qualité, FR/EN, carte/satellite, zoom, jour/nuit | Inchangés |
| Panneaux mobiles en volet | Volets de la fiche (§9) |
