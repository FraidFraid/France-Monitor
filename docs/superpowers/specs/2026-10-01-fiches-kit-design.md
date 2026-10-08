# Fiches de la colonne dans le kit de l'État, et aucun tiret cadratin

Date : 01/10/2026. Statut : conception validée en séance (maquette « fiches v7c »). Étape 1 du chantier « reprendre les autres panneaux avec le kit de l'État » ; étapes suivantes : cadre commun des 19 panneaux de couches, puis leur contenu par lots thématiques (specs séparées).

Référence de style : `docs/design/panneau-v2.md` (kit `fmk-`), spec `2026-10-01-panneau-etat-reference-design.md`.

## 1. Objectif

Mettre les cinq autres fiches de la colonne de droite de la v2 (événement, situation (alertes comprises), thème, alerte officielle, marché) dans le kit de l'État, mieux hiérarchisées, au niveau d'un outil OSINT professionnel. Et supprimer tout tiret cadratin de l'application.

Contraintes : v2 seulement ; aucune donnée ajoutée côté serveur ; aucune fonctionnalité retirée ; français, « » et ’ ; TypeScript strict, DOM natif.

## 2. Décisions validées

1. **Une seule forme de section** pour tout le contenu : titre en petites capitales, résumé à droite, chevron ; mêmes tailles, couleurs, espacements (composant `fmk-sec` de l'État). La hiérarchie vient de l'ordre, pas de styles différents.
2. **En-tête, seul passage en grand** : sur-titre (type · thème), titre 19 px, ligne de niveau (pastille à largeur fixe, puis contexte séparé par « • »), puis la phrase de synthèse en 14,5 px, sans titre « L'essentiel ».
3. **Indicateurs sous l'en-tête, ouverts** : le contenu de l'ancien volet « Pourquoi ce niveau ? » devient la section « Indicateurs », en données visuelles. Le volet replié du bas disparaît. La règle A7 (« sous-scores seulement dans Pourquoi ») est levée pour toutes les fiches.
4. **Couleur** : seuls les niveaux sont colorés. Pastilles de niveau : texte noir sur les quatre teintes. Barres d'indicateurs d'une situation : couleur de leur propre intensité (part du maximum : ≥ 85 % rouge, ≥ 70 % orange, ≥ 55 % jaune, sinon vert) ; confiance en gris. Courbe de corroboration et chiffres : neutres.
5. **Ordre** : en-tête → Indicateurs → détail (ouvert) → référence (repliée, titres et résumés en ton discret `#6e6e80`) → actions.
6. **Aucun tiret cadratin** « — » nulle part dans l'application (§ 7).
7. Sections mémorisées **par type de fiche** (clé `<type>:<section>`, ex. `event:articles`) : ouvrir « Articles » sur un événement le garde ouvert sur tous les événements. Même store que l'État (`fm.v2.sections`).

## 3. Exigences « OSINT pro » (revue du 01/10)

Constats sur l'existant et exigences retenues, toutes réalisables avec les données déjà disponibles :

| Constat | Exigence |
|---|---|
| « depuis 19:11 » sur un événement vieux de 47 h, heures d'articles sans date | **Horodatage absolu** partout : `jj/mm hh:mm` (heure de Paris) dès que ce n'est pas aujourd'hui, `hh:mm` sinon ; le relatif (« il y a 8 h ») seulement en second, jamais seul |
| Corroboration noyée dans une phrase | Ligne **Confirmation** explicite, en mots : « confirmé par n groupes indépendants », « un seul groupe de presse (n titres) », « source unique » ; « à confirmer » quand la gravité signalée dépasse la retenue |
| Indicateurs d'une situation sans origine | **Provenance et fraîcheur** sous les indicateurs : sources de données (`sourceRefs`) et heure de mise à jour (`updatedAt`) |
| Identifiant de preuve affiché sans usage | Action **« Copier la référence »** : copie `E13516 · <titre> · <niveau> · <première apparition jj/mm hh:mm>` (événement) ou `<identifiant de situation> · <titre> · <niveau> · <mise à jour jj/mm hh:mm>` (situation) dans le presse-papiers ; message « Référence copiée » ; repli silencieux si l'API presse-papiers est refusée |
| Statut d'un événement peu visible | Statut dans la ligne de niveau (« actif », « en refroidissement depuis 08:30 », « clos ») ; fiche grisée si périmée (règle existante `freshness.ts`) |
| Lieu imprécis | Département avec son numéro quand il est connu (« Haut-Rhin (68) ») ; « France » ou « étranger » sinon |
| Liste d'articles en cadres, heures sans date | Articles en **lignes simples** (titre, flux, date absolue), du plus récent au plus ancien, liens externes ouverts dans un nouvel onglet |

Hors de portée (données absentes, à prévoir plus tard) : cote de fiabilité par article à la manière de l'échelle de l'OTAN (fiabilité de la source × crédibilité de l'information) ; date de calcul propre à chaque sous-score du moteur.

## 4. Contenu par type de fiche

### 4.1 Événement

- **En-tête** : sur-titre « Événement · <thème> » ; titre ; ligne de niveau : pastille, lieu, « depuis <première apparition absolue> », statut ; phrase de synthèse (essentiel actuel).
- **Indicateurs** (ouverte ; résumé « n groupes indépendants · m articles ») :
  - courbe en escalier du nombre de groupes indépendants, reconstruite depuis le journal (`log`, changements `corroborated` avec `from`/`to`), axe des heures sous la courbe, valeurs « 1 » et « max » hors de la zone tracée ; sans journal chargé ou sans changement : pas de courbe, ligne Confirmation seule ;
  - lignes clé · valeur : Confirmation, Gravité (« <pastille> signalée → <pastille> retenue »), Motifs (si présents, liste en mots), Volume (« m articles · f flux »), Lieu, Temporalité, Preuve (identifiant).
- **Évolution** (ouverte ; résumé « n changements ») : journal en heures absolues, le plus récent en avant (texte clair et heure en gras), les autres en gris.
- **Articles** (référence, repliée ; résumé « m articles · f flux ») : lignes simples, chargement « Chargement des articles… », erreur « Articles indisponibles pour le moment. ».
- **Actions** : « Voir sur la carte », « Copier la référence ».

### 4.2 Situation (et alerte)

- **En-tête** : sur-titre « Situation · <thème> » ; titre ; ligne de niveau : pastille, phrase du niveau (« soyez très vigilant »), zones (3 au plus puis « + n »), « mise à jour <heure absolue> » ; phrase de synthèse.
- **Indicateurs** (ouverte ; résumé « confiance <mot> » et tendance si connue) : une barre par ligne chiffrée du moteur (`n/m` ou `score n/100`, libellé · barre · valeur) ; barre Confiance (gris, en %) ; puis « Sources : … · mise à jour hh:mm ».
- **À faire** (ouverte ; résumé « n actions ») : liste numérotée, texte de l'action puis rôle · type en petit.
- **Facteurs** (ouverte ; résumé n) : facteurs non chiffrés.
- **Zones** (ouverte ; résumé « n départements ») : étiquettes ; scores de zone dans Indicateurs.
- **Sources** (référence, repliée ; résumé « n sources ») ; lien vers la source d'origine s'il existe.
- **Actions** : existantes (« Voir sur la carte », dossier) + « Copier la référence ».

### 4.3 Thème

- **En-tête** : « Thème » ; nom ; pastille + élément le plus grave ; fraîcheur des sources ; synthèse (essentiel).
- **Indicateurs** (ouverte) : chiffres clés du thème en lignes clé · valeur ; « Signaux officiels » et « Éléments à traiter » (ex-volet) en listes avec pastille de niveau.
- **Sources** (référence, repliée). **Actions** : « Afficher sur la carte ».

### 4.4 Alerte officielle

- **En-tête** : « Alerte officielle · <émetteur> » ; titre ; pastille + émetteur ; fraîcheur ; synthèse.
- **Indicateurs** (ouverte) : « Lieux concernés », « Niveau publié par <émetteur>, repris tel quel » (et mention violet le cas échéant).
- **Détail par lieu** (ouverte). **Sources** (repliée). **Actions** : « Afficher la couche ».

### 4.5 Marché

- **En-tête** : « Marché » ; nom ; pastille + « mouvement exceptionnel » ; synthèse.
- **Indicateurs** (ouverte) : cours, variation, et le texte de l'ex-volet.
- Pas de section Sources (aucune source nommée aujourd'hui).

## 5. Architecture

- `renderFiche` : toutes les fiches passent par le kit (`fiche fmk`). L'en-tête simple devient l'en-tête kit (sur-titre, titre 19 px, ligne de niveau, synthèse) ; l'en-tête « Instrument » reste celui de la France. Les parties génériques (essentiel, changements, chiffres, à surveiller, sources, volet) disparaissent du rendu : chaque constructeur produit ses sections (`FicheSection` à `id`, `summary`, `collapsible`, `open`, et un nouveau champ `tone?: 'reference'` pour le ton discret).
- `FicheModel` gagne `lead?: string` (synthèse) et `context?: string[]` (éléments de la ligne de niveau) ; les champs devenus inutiles (`essentiel`, `changes`, `figures`, `watch`, `why`, `whyOpen`, `whyFirst`) sont retirés quand plus aucun constructeur ne les lit.
- Nouvelles briques pures dans `kit.ts` : `stepCurve(points, opts)` (courbe en escalier SVG, axes hors zone), `intensityLevel(value, max)` (seuils § 2.4), `absoluteTime(ms, now, lang)` (§ 3) ; réutilise `meterRow`, `kvRow`, `levelDot`.
- Mémoire des sections : `PosteSituation` passe à chaque constructeur l'état de son type (`sectionsOf(state, type)`), FichePanel inchangé (clé `data-section="<clé de fiche>:<id>"` → la clé de mémoire devient `<type>:<id>` : l'extraction du type se fait dans `PosteSituation` au moment de l'enregistrement).
- « Copier la référence » : action de fiche `copy-ref` traitée par `PosteSituation` (`navigator.clipboard.writeText`, sous `try/catch`), message bref dans la fiche (zone `aria-live="polite"`).
- CSS : kit existant ; ajouts limités (en-tête kit sans score, courbe, ton « référence », message de copie), sous `#app.ui-v2`.

## 6. Hors périmètre

Les 19 panneaux de couches (étapes suivantes) ; v1 ; nouvelles données serveur (fiabilité par article, dates par sous-score).

## 7. Aucun tiret cadratin

Règle : aucun « — » dans un texte affiché, à aucun moment.

- **Textes du code** (`src/`, `api/`, hors commentaires et tests) : séparateur ou incise → « · » ou « : » selon le sens ; valeur absente → « n.d. » ; plage → « à ». Environ 380 lignes dans `src/` et 27 dans `api/` au 01/10.
- **Textes externes** (titres et résumés d'articles, titres d'événements, textes du moteur de situations, brief IA) : fonction pure `noEmDash(text)` appliquée à la frontière des données (normalisation des articles, lecture des événements, sortie du moteur, validation du brief) : « X — Y » → « X : Y », « — » isolé → « : » ; l'invite du brief demande de ne jamais en écrire.
- **Garde-fou** : un test qui échoue si un littéral de chaîne de `src/` ou `api/` (hors tests et commentaires) contient « — ».
- Documents affichés à l'utilisateur dans l'application (pages À propos, Méthodologie…) : même règle.

## 8. Vérification

- Tests d'abord pour les fonctions pures : `absoluteTime` (aujourd'hui, autre jour, minuit, anglais), `intensityLevel` (seuils), `stepCurve` (aucun point, un point, plusieurs, axes hors zone), `noEmDash` (incise, isolé, sans tiret), chaque constructeur (ordre et ouverture des sections, résumés, provenance, ligne Confirmation, absence de « — »).
- Garde-fou des tirets (§ 7) vert.
- Contrôle visuel sans interface à 1600, 1280 et 390 px sur un événement, une situation, un thème, une alerte officielle : aucun défilement horizontal, sections uniformes, aucun « — » visible, « Copier la référence » fonctionnel.
- `npm run typecheck`, suite complète, `npm run build`.
