# France Monitor - Document de cadrage pour projet demo, candidatures et videos explicatives

Version : 2026-06-27  
Statut : document source pour Google Docs, NotebookLM, pitch recruteur et videos explicatives

## 1. Resume executif

France Monitor est une plateforme de veille open-source geospatiale dediee a la France. Le projet collecte des signaux publics heterogenes, les normalise, les qualifie, les classe, les cartographie et les restitue dans un tableau de bord interactif. Il couvre aujourd'hui plusieurs domaines critiques : actualites regionales et nationales, energie, meteo, crues, transport, sante, cyber, finance, infrastructures, defense, maritime, aviation et signaux environnementaux.

L'objectif n'est pas de presenter France Monitor comme un simple projet OSINT. Le bon positionnement est de le presenter comme un demonstrateur de transformation de donnees ouvertes non structurees en information qualifiee, sourcee, tracee et exploitable. Ce positionnement parle davantage aux recruteurs, car il montre des competences en architecture, automatisation, data engineering leger, qualification de sources, modelisation de donnees, IA appliquee, supervision, documentation, tests et pilotage de produit.

La prochaine evolution du projet consiste a ajouter une couche transverse de qualification et de tracabilite. Cette couche permettra d'expliquer pourquoi un signal est affiche, d'ou il vient, quel est son niveau de confiance, quelle regle a contribue au score, s'il est recoupe avec d'autres sources et s'il doit etre valide par un humain.

Le projet devient ainsi un PoC de veille operationnelle : ingestion de sources publiques, normalisation, scoring, classification, restitution cartographique, historique, supervision des sources et documentation des workflows. Ce document sert a expliquer le projet, a guider son evolution, a preparer des videos explicatives et a construire un discours solide pour les candidatures.

## 2. Formulation strategique du projet

### 2.1 Formulation courte

France Monitor est une plateforme de veille open-source qui transforme des signaux publics heterogenes en evenements qualifies, scores, geolocalises et auditables.

### 2.2 Formulation pour CV

Conception d'une plateforme de veille open-source geospatiale : ingestion de sources publiques, normalisation de donnees structurees et non structurees, classification automatique, scoring de confiance, cartographie interactive, dashboard de suivi, historique des signaux et documentation technique des workflows.

### 2.3 Formulation pour entretien

J'ai construit France Monitor comme un demonstrateur de veille open-source structuree. Le projet collecte des donnees publiques issues d'API, de flux RSS, de sources techniques et de bases ouvertes. Ces signaux sont ensuite normalises, classes, geocodes, scores et restitues dans une carte interactive et plusieurs panneaux de supervision. L'objectif est de montrer comment transformer des informations fragmentees et non structurees en une information exploitable, tracee et explicable.

### 2.4 Formulation orientee postes data, automation et IA

France Monitor est un PoC de pipeline data et intelligence appliquee : collecte multi-sources, nettoyage, deduplication, enrichissement, classification hybride par regles et IA, scoring de fiabilite, supervision des sources et restitution operationnelle. Le projet montre une capacite a passer d'un besoin flou de veille a un systeme structure, testable et documente.

## 3. Ce que le projet prouve techniquement

France Monitor doit etre presente comme une preuve de competences, pas seulement comme une application. Chaque module doit correspondre a une competence lisible par un recruteur.

### 3.1 Collecte de donnees publiques

Le projet ingere des informations provenant de flux RSS, d'API publiques, de donnees ouvertes, de sources techniques et de proxys serverless. Cette partie prouve la capacite a identifier des sources, comprendre leurs contraintes, contourner les problemes d'acces legitimes comme le CORS, appliquer du cache, gerer les echecs et maintenir une fraicheur acceptable.

Competences demontrees :

- identification et qualification de sources ;
- ingestion de donnees heterogenes ;
- usage d'API publiques et flux RSS ;
- gestion des limites techniques ;
- cache, deduplication et fraicheur ;
- architecture frontend plus serverless functions.

### 3.2 Normalisation des donnees

Les sources collectees ne parlent pas le meme langage. Un article RSS, un signal Ecowatt, une vigilance meteo, une crue Vigicrues, un incident cyber ou un vol militaire n'ont pas le meme format. Le projet doit donc transformer ces donnees en objets exploitables par l'interface et par la carte.

Competences demontrees :

- modelisation de donnees ;
- separation entre donnees brutes et donnees affichees ;
- creation de types TypeScript ;
- transformation de donnees non structurees en donnees structurees ;
- logique de compatibilite entre services.

### 3.3 Classification et enrichissement

France Monitor utilise une logique hybride : classification par mots-cles pour la rapidite, puis possibilite de surclassement par IA pour les cas ambigus. Cette approche est plus credible qu'un systeme uniquement base sur un LLM, car elle combine rapidite, controle et explicabilite.

Competences demontrees :

- classification automatique ;
- taxonomie d'evenements ;
- categories et niveaux de severite ;
- extraction de lieux et d'entites ;
- fallback IA local ou cloud ;
- arbitrage entre performance, cout et confidentialite.

### 3.4 Cartographie et restitution

La carte interactive est un element fort du projet. Elle montre des signaux geolocalises, des couches d'infrastructures, des flux et des zones de risque. Le projet utilise Deck.gl et MapLibre pour le rendu WebGL desktop, avec un fallback mobile en D3/SVG.

Competences demontrees :

- visualisation geospatiale ;
- contraintes de performance ;
- manipulation de coordonnees ;
- clustering ;
- couches cartographiques ;
- UX de supervision.

### 3.5 Supervision et resilience

Une plateforme de veille ne doit pas seulement afficher des donnees. Elle doit aussi indiquer si les sources fonctionnent, si les donnees sont fraiches et si certains services sont en erreur. France Monitor contient deja une logique de status panel, watchdog, cache et fallback.

Competences demontrees :

- observabilite applicative ;
- gestion des erreurs ;
- degradation gracieuse ;
- circuit breaker ;
- monitoring de sources ;
- separation entre panne de source et absence de signal.

### 3.6 Documentation et pilotage

Pour les candidatures, cette dimension est essentielle. Beaucoup de candidats montrent du code. Peu montrent une methode claire : probleme, architecture, donnees, choix techniques, workflow, limites, tests, evolutions.

Competences demontrees :

- cadrage fonctionnel ;
- architecture technique ;
- documentation de workflows ;
- explicitation des arbitrages ;
- preparation de demonstrations ;
- capacite a piloter un PoC.

## 4. Architecture actuelle du projet

### 4.1 Vue generale

Le projet suit une architecture simple et lisible :

1. Le navigateur charge l'application Vite en TypeScript vanilla.
2. Les composants affichent les panneaux, la carte, les filtres et les popups.
3. Les services frontend collectent ou demandent les donnees.
4. Les routes serverless Vercel sous `/api/*` servent de proxy, de cache ou de couche de securisation.
5. Les donnees sont classees, normalisees et geocodees.
6. La carte et les panneaux restituent les signaux.
7. L'historique et le cache local permettent de conserver certains etats.

### 4.2 Frontend

Le frontend est en TypeScript vanilla, sans React, Vue ou Angular. Ce choix montre une capacite a construire une application riche avec manipulation directe du DOM. L'interface est organisee autour de composants comme `NewsPanel`, `EnergyPanel`, `WeatherPanel`, `TransportPanel`, `CyberPanel`, `DeckGLMap`, `MapContainer` et `StatusPanel`.

Point important pour entretien : ce choix peut etre explique comme un choix de performance et de controle, inspire de WorldMonitor. Il reduit la complexite framework et force une meilleure comprehension du cycle de vie de l'interface.

### 4.3 Backend serverless

Les routes `/api/*` sont gerees par des fonctions serverless Vercel. Elles permettent de :

- contourner les problemes CORS ;
- cacher des reponses ;
- proteger les cles API ;
- uniformiser les appels externes ;
- isoler les sources instables ;
- preparer une architecture deployable.

### 4.4 Services metier

Les services dans `src/services/` portent la logique metier : RSS, classification, geocodage, energie, meteo, crues, transport, finance, cyber, sante, defense et situation intelligence.

Chaque service suit idealement le meme pattern :

1. recuperer les donnees ;
2. parser la reponse ;
3. normaliser le format ;
4. appliquer cache et deduplication ;
5. exposer une fonction asynchrone stable ;
6. remonter un statut exploitable par l'interface.

### 4.5 Carte et donnees geospatiales

La carte est un composant central. Elle relie les signaux a des lieux concrets : departements, villes, infrastructures, cours d'eau, centrales, ports, bases, couloirs de transport et zones de vigilance.

Regle technique importante : les coordonnees doivent toujours etre dans l'ordre `[longitude, latitude]`. Cette convention est essentielle pour MapLibre, Deck.gl et la plupart des formats geospatiaux web.

## 5. Ce qu'il manque pour en faire un projet demo tres convaincant

Le projet est deja riche fonctionnellement. Ce qui manque pour les candidatures n'est pas forcement une nouvelle source ou un nouveau panneau. Ce qui manque est une couche de preuve : montrer que les donnees sont qualifiees, que les decisions sont explicables et que le systeme est gouverne.

### 5.1 Manque actuel : qualite des sources trop implicite

Aujourd'hui, une source peut etre consommee par le projet sans qu'un recruteur voie immediatement :

- son type ;
- sa fiabilite ;
- sa fraicheur ;
- son taux d'echec ;
- son niveau de confiance ;
- sa documentation ;
- sa contribution aux scores.

### 5.2 Manque actuel : scoring pas assez transversal

Il existe des scores dans certains domaines, mais il faut une logique plus visible et commune : un signal devrait porter un score de confiance comprehensible.

Exemple :

- 85/100 : source officielle, date recente, geolocalisation precise, recoupement disponible ;
- 55/100 : source media fiable mais non recoupee ;
- 30/100 : source non officielle, information ancienne ou incertaine.

### 5.3 Manque actuel : demonstration recruteur pas assez guidee

Un recruteur ne va pas lire tout le code. Il faut lui donner un chemin :

1. comprendre le probleme ;
2. voir l'architecture ;
3. voir le pipeline ;
4. voir la qualification ;
5. voir la carte ;
6. voir les tests ;
7. voir la documentation ;
8. comprendre ce que cela prouve pour le poste.

## 6. Evolution principale proposee : Qualification & Traceability Layer

### 6.1 Objectif

Ajouter une couche transverse qui qualifie chaque signal affiche par France Monitor. Cette couche doit repondre a une question simple :

Pourquoi ce signal merite-t-il d'etre affiche, avec quel niveau de confiance, et comment peut-on verifier son origine ?

### 6.2 Donnees ajoutees a chaque signal

Chaque evenement ou signal important devrait pouvoir porter les champs suivants :

- `sourceName` : nom de la source ;
- `sourceType` : officielle, media, open data, technique, crowdsourced, inconnue ;
- `sourceUrl` : lien vers la source ;
- `collectedAt` : date de collecte par France Monitor ;
- `publishedAt` : date de publication par la source ;
- `freshnessScore` : score de fraicheur ;
- `reliabilityScore` : score de fiabilite de la source ;
- `geocodingConfidence` : confiance dans la localisation ;
- `classificationConfidence` : confiance dans la classification ;
- `crossCheckCount` : nombre de sources qui confirment ou recoupent ;
- `confidenceScore` : score global ;
- `validationStatus` : nouveau, a verifier, valide, rejete, archive ;
- `explanation` : explication courte du score ;
- `reviewerComment` : commentaire humain facultatif.

### 6.3 Statuts de validation

Les statuts proposes :

- `new` : signal nouveau, pas encore examine ;
- `to_review` : signal interessant mais confiance moyenne ;
- `validated` : signal exploitable ;
- `rejected` : signal faux, bruit ou non pertinent ;
- `archived` : signal conserve mais plus actif.

### 6.4 Scores proposes

Echelle simple :

- 0 a 39 : faible confiance ;
- 40 a 69 : a verifier ;
- 70 a 100 : exploitable.

Cette echelle est assez simple pour etre comprise par un recruteur et assez riche pour montrer une logique de gouvernance.

### 6.5 Exemple de regles

Un signal gagne des points si :

- la source est officielle ;
- l'information est datee ;
- l'information est recente ;
- la source a deja reussi plusieurs collectes ;
- l'evenement est geolocalise avec precision ;
- le signal est recoupe par une autre source ;
- la classification est coherente avec le contenu.

Un signal perd des points si :

- la source n'est pas identifiee ;
- la date manque ;
- la geolocalisation est vague ;
- le contenu est trop ancien ;
- le flux source est instable ;
- la classification est ambigue ;
- le signal ressemble a du bruit local non significatif.

### 6.6 Exemple d'explication affichable

Score de confiance : 78/100. Source officielle, publication datee, collecte recente, localisation precise au departement. Aucun recoupement externe disponible. Statut recommande : exploitable.

Ou :

Score de confiance : 46/100. Source media regionale, information datee mais non recoupee, classification automatique incertaine. Statut recommande : a verifier.

## 7. Source Registry

### 7.1 Objectif

Le Source Registry est un registre des sources utilisees par France Monitor. Il donne une vue claire de la gouvernance du projet.

### 7.2 Informations par source

Chaque source devrait etre documentee avec :

- nom ;
- domaine ;
- type ;
- URL ;
- format ;
- frequence attendue ;
- criticite ;
- fiabilite ;
- fraicheur ;
- responsable ou organisme ;
- limites connues ;
- statut technique ;
- derniere collecte reussie ;
- derniere erreur ;
- usage dans l'application.

### 7.3 Exemple de fiche source

Nom : Meteo-France Vigilance  
Type : source officielle  
Domaine : meteo et risques naturels  
Format : API ou flux structure  
Frequence attendue : reguliere  
Usage : affichage des niveaux de vigilance par departement  
Fiabilite : tres elevee  
Limites : dependance a la disponibilite du service externe  
Statut : actif  

### 7.4 Valeur pour candidature

Cette partie prouve que le projet ne consomme pas des donnees au hasard. Il applique une logique de gouvernance : savoir quelles sources sont utilisees, pourquoi elles sont utilisees, comment elles sont surveillees et quelles sont leurs limites.

## 8. Moteur de qualification

### 8.1 Role du moteur

Le moteur de qualification transforme un signal brut en signal qualifie. Il ne remplace pas les services existants. Il s'ajoute apres la collecte et avant l'affichage.

### 8.2 Pipeline logique

1. Reception d'un signal brut.
2. Identification de la source.
3. Verification de la date.
4. Evaluation de la fraicheur.
5. Evaluation de la fiabilite source.
6. Evaluation de la precision geographique.
7. Evaluation de la classification.
8. Recherche de recoupements eventuels.
9. Calcul du score global.
10. Attribution d'un statut.
11. Generation d'une explication.

### 8.3 Ce que cela montre techniquement

Le moteur de qualification montre une competence rare : relier des regles explicites, des donnees imparfaites et une interface utilisateur. C'est exactement le type de competence utile dans des postes data, automation, business analyst technique, product owner data, technical data, IA appliquee ou transformation numerique.

### 8.4 Pourquoi c'est mieux qu'ajouter seulement un LLM

Un LLM peut resumer, classer ou extraire. Mais un recruteur technique veut voir :

- des regles ;
- de la structure ;
- des tests ;
- de la tracabilite ;
- des limites ;
- du controle humain.

Le moteur de qualification donne cette credibilite. L'IA devient un enrichissement, pas une boite noire.

## 9. IA appliquee dans le projet

### 9.1 Role de l'IA

L'IA doit etre presentee comme un assistant d'enrichissement :

- resume d'articles ;
- extraction d'entites ;
- classification des themes ;
- aide a la priorisation ;
- generation de briefs situationnels ;
- reformulation de syntheses.

### 9.2 Principe de prudence

Le projet doit rester privacy-first et controle. La chaine recommandee est :

1. regles locales rapides ;
2. IA locale avec Ollama si disponible ;
3. fallback cloud seulement si configure ;
4. validation humaine pour les signaux sensibles.

### 9.3 RAG futur

Le RAG peut devenir une evolution forte, mais il doit venir apres la qualification. Le bon ordre est :

1. collecter ;
2. normaliser ;
3. sourcer ;
4. scorer ;
5. valider ;
6. indexer ;
7. interroger avec un assistant RAG.

Un RAG construit sur des donnees non qualifiees serait moins credible. Un RAG construit sur des sources scorees et tracees devient un vrai assistant documentaire.

### 9.4 Cas d'usage RAG possible

Questions auxquelles l'assistant pourrait repondre :

- Quels sont les signaux energie critiques des dernieres 24 heures ?
- Quelles sources confirment cette alerte ?
- Quels departements cumulent vigilance meteo et tensions reseau ?
- Quels evenements cyber ont un score de confiance superieur a 70 ?
- Quels signaux ont ete rejetes et pourquoi ?

## 10. Interface cible pour la demo

### 10.1 Ce que l'utilisateur doit voir

La demo doit rendre visibles les competences techniques. L'interface devrait montrer :

- une carte ;
- des panneaux thematiques ;
- un score de confiance ;
- un statut de validation ;
- une explication du score ;
- le lien source ;
- la date de publication ;
- la date de collecte ;
- la fraicheur ;
- les sources en erreur ;
- un historique.

### 10.2 Popup d'evenement ideale

Une popup d'evenement pourrait afficher :

- titre ;
- categorie ;
- severite ;
- localisation ;
- source ;
- score de confiance ;
- statut ;
- explication ;
- bouton vers la source ;
- bouton pour filtrer les signaux similaires.

### 10.3 Panneau "Qualite des sources"

Un panneau dedie pourrait afficher :

- nombre de sources actives ;
- nombre de sources en erreur ;
- fraicheur moyenne ;
- taux de reussite ;
- repartition par type de source ;
- top sources officielles ;
- sources a surveiller ;
- derniers echecs.

### 10.4 Panneau "Evenements a verifier"

Ce panneau serait tres fort en entretien, car il montre le controle humain :

- signaux a confiance moyenne ;
- raison du doute ;
- source ;
- score ;
- date ;
- action recommandee ;
- statut.

## 11. Scenarios de demonstration

### 11.1 Scenario court : demonstration en 3 minutes

Objectif : montrer la valeur globale.

Script :

France Monitor collecte des signaux publics sur plusieurs domaines : actualites, energie, meteo, transport, cyber, sante et infrastructures. Ces signaux sont normalises dans un modele commun, classes automatiquement, geolocalises et affiches sur une carte. La prochaine couche ajoute un score de confiance et une explication afin de savoir si l'information est exploitable, a verifier ou a archiver. Le projet montre donc une chaine complete : collecte, qualification, enrichissement, restitution et supervision.

### 11.2 Scenario moyen : demonstration en 8 minutes

Objectif : montrer la methode.

Plan :

1. presenter le probleme : trop de sources publiques dispersees ;
2. montrer l'architecture ;
3. ouvrir la carte ;
4. afficher les actualites et signaux geolocalises ;
5. montrer un panneau energie ou meteo ;
6. expliquer la classification ;
7. montrer le futur score de confiance ;
8. conclure sur la valeur pour un poste data/automation/IA.

### 11.3 Scenario long : demonstration technique en 15 minutes

Objectif : convaincre un profil technique.

Plan :

1. contexte et objectif ;
2. architecture frontend plus serverless ;
3. ingestion des sources ;
4. normalisation des donnees ;
5. classification keyword et IA ;
6. geocodage ;
7. carte Deck.gl et fallback mobile ;
8. supervision et cache ;
9. couche qualification proposee ;
10. tests et documentation ;
11. limites et roadmap.

## 12. Scripts pour videos explicatives

### 12.1 Video 1 - Presentation generale

Titre : France Monitor, transformer des donnees publiques en veille operationnelle.

Script :

France Monitor est une plateforme de veille open-source dediee a la France. L'application collecte des signaux publics provenant de flux RSS, d'API, de sources techniques et de bases ouvertes. Ces donnees sont ensuite normalisees, classees, geocodees et restituees dans une carte interactive. Le projet couvre plusieurs domaines : energie, meteo, transport, sante, cyber, finance, infrastructures et actualites locales. L'objectif n'est pas de remplacer les sources officielles, mais de construire une vue consolidee et exploitable des signaux publics.

### 12.2 Video 2 - Pipeline data

Titre : De la source brute a l'evenement qualifie.

Script :

Le coeur de France Monitor est un pipeline de transformation. Une source publique est collectee, puis son contenu est parse, nettoye et transforme dans un format commun. Ensuite, le signal est classe par categorie, geocode si un lieu est detecte, dedoublonne si necessaire, puis envoye vers les panneaux et la carte. La prochaine evolution ajoute un score de confiance : source officielle ou non, date disponible, fraicheur, precision geographique, recoupement et statut de validation. Cette approche permet de passer d'informations dispersees a des signaux exploitables.

### 12.3 Video 3 - IA et regles metier

Titre : Pourquoi combiner IA et regles explicites.

Script :

France Monitor n'utilise pas l'IA comme une boite noire. La classification commence par des regles rapides et explicables, comme des mots-cles, des categories et des niveaux de severite. L'IA peut ensuite intervenir pour les cas ambigus : resumer, extraire des entites ou proposer une classification. Cette approche hybride est plus robuste, car elle combine la vitesse des regles, la souplesse de l'IA et la possibilite de controle humain. La future couche de qualification rendra chaque decision plus transparente avec un score et une explication.

### 12.4 Video 4 - Carte et supervision

Titre : Une carte pour comprendre les signaux publics.

Script :

La carte de France Monitor permet de visualiser les signaux dans leur contexte geographique. Les evenements peuvent etre affiches par categorie, severite, localisation ou couche thematique. L'application utilise Deck.gl et MapLibre pour les rendus performants sur desktop, avec un fallback mobile en D3/SVG. Cette carte n'est pas seulement un affichage : elle sert a correler des donnees. Par exemple, on peut rapprocher une vigilance meteo, une crue, une tension infrastructure ou un incident de transport.

### 12.5 Video 5 - Projet vitrine pour candidature

Titre : Ce que France Monitor demontre dans une candidature.

Script :

France Monitor est un projet vitrine car il montre une chaine complete : cadrage du besoin, collecte de donnees, architecture technique, normalisation, classification, scoring, restitution, documentation et supervision. Ce n'est pas seulement un projet OSINT. C'est un demonstrateur de veille structuree et de transformation de donnees publiques en information exploitable. Il permet de montrer des competences utiles pour des postes data, automation, IA appliquee, product owner technique ou technical data.

## 13. Roadmap proposee

### Phase 1 - Documentation demo

Objectif : rendre le projet comprensible sans lire le code.

Livrables :

- document de cadrage ;
- architecture expliquee ;
- schema du pipeline ;
- modeles de donnees ;
- scenario de demo ;
- scripts video ;
- page README orientee recruteur.

### Phase 2 - Source Registry

Objectif : documenter et afficher les sources.

Livrables :

- fichier de registre source ;
- types TypeScript ;
- service de lecture ;
- panneau qualite des sources ;
- documentation des criteres.

### Phase 3 - Qualification Engine

Objectif : ajouter le scoring transversal.

Livrables :

- moteur de scoring ;
- regles testees ;
- explications de score ;
- integration sur actualites ;
- integration progressive sur autres domaines.

### Phase 4 - UI de validation

Objectif : montrer le controle humain.

Livrables :

- statut de validation ;
- liste des signaux a verifier ;
- affichage des raisons ;
- commentaires reviewer en local ;
- filtres par statut.

### Phase 5 - Assistant documentaire source

Objectif : ajouter un RAG credible.

Livrables :

- corpus indexe ;
- recherche semantique ;
- reponses avec sources ;
- refus si source absente ;
- historique des citations.

## 14. Backlog priorise

### Priorite 1

- ecrire le registre de sources ;
- definir les champs de qualification ;
- creer le moteur de scoring ;
- tester le moteur avec des fixtures ;
- afficher le score dans les popups news ;
- documenter la methode.

### Priorite 2

- ajouter un panneau qualite des sources ;
- integrer le score dans l'historique ;
- ajouter les statuts de validation ;
- creer une page demo recruteur ;
- ajouter des captures d'ecran annotees.

### Priorite 3

- construire un assistant RAG ;
- ajouter l'export de rapports ;
- creer un mode presentation ;
- ajouter des tests end-to-end Playwright ;
- publier une video walkthrough.

## 15. Criteres de reussite

Le projet devient un bon support de candidature si une personne externe peut comprendre en moins de 10 minutes :

- quel probleme le projet resout ;
- quelles sources sont utilisees ;
- comment les donnees sont transformees ;
- comment les evenements sont classes ;
- comment le score de confiance est calcule ;
- comment l'interface restitue les signaux ;
- quelles garanties existent ;
- quelles limites sont assumees ;
- quelles competences le projet demontre.

## 16. Limites a assumer

Il faut etre clair sur les limites pour etre credible.

France Monitor ne remplace pas :

- les sources officielles ;
- les services d'urgence ;
- les journalistes ;
- les analystes humains ;
- les systemes professionnels de crise.

France Monitor est :

- un outil de veille ;
- un agregateur ;
- un demonstrateur ;
- un outil de correlation ;
- un projet open-source experimental ;
- une preuve de competences techniques.

## 17. Discours pour entretien

### Question : Pourquoi ce projet ?

Reponse :

Je voulais construire un projet qui demontre plus qu'une interface. France Monitor montre une chaine complete : identifier des sources publiques, les connecter, les nettoyer, les structurer, les classer, les geolocaliser et les restituer dans un dashboard utile. C'est un projet volontairement transversal, car il touche a la data, a l'automatisation, a l'IA appliquee, a l'architecture et a la documentation.

### Question : Quelle est la partie la plus technique ?

Reponse :

La difficulte n'est pas un seul algorithme. Elle est dans l'integration : faire cohabiter des sources instables, des formats differents, des donnees temps reel, une carte performante et une interface comprehensible. La prochaine couche de qualification ajoute une difficulte supplementaire : rendre les signaux explicables et scores.

### Question : Ou intervient l'IA ?

Reponse :

L'IA intervient comme une couche d'enrichissement : resume, classification, extraction d'entites et generation de briefs. Mais je ne veux pas que le systeme depende uniquement d'un LLM. Je combine regles explicites, scoring et validation humaine pour garder de la tracabilite.

### Question : Que feriez-vous ensuite ?

Reponse :

J'ajouterais une couche de gouvernance des sources : registre de sources, score de fiabilite, fraicheur, statut de validation et explication du score. Ensuite, je construirais un assistant RAG qui repond uniquement a partir des sources qualifiees et citees.

## 18. Phrases CV pretes a utiliser

Version courte :

Plateforme open-source de veille geospatiale : ingestion de sources publiques, classification, geocodage, scoring, cartographie interactive, supervision des sources et documentation technique.

Version data :

Conception d'un pipeline de transformation de donnees publiques heterogenes en evenements structures : collecte, parsing, deduplication, normalisation, classification, scoring de confiance et restitution dashboard.

Version IA :

Integration d'une classification hybride combinant regles metier, taxonomie d'evenements et enrichissement IA pour resumer, classifier et prioriser des signaux publics.

Version product/PO :

Pilotage d'un PoC de veille open-source : cadrage fonctionnel, architecture, modele de donnees, documentation des workflows, criteres de qualite, tests et roadmap produit.

Version Airbus/technical data :

Prototype d'automatisation documentaire applique a des sources ouvertes : transformation de contenus non structures en donnees qualifiees, application de regles de validation, tracabilite des sources, dashboard de controle et documentation technique.

## 19. Structure recommandee pour Google NotebookLM

L'outil auquel tu penses est probablement Google NotebookLM. Il permet d'importer des documents sources puis de generer des syntheses, des guides, des FAQ, des mind maps et des contenus audio ou video explicatifs selon les options disponibles.

Pour obtenir de bonnes videos ou explications, il faut importer :

1. ce document de cadrage ;
2. le README du projet ;
3. la roadmap ;
4. l'architecture ;
5. une fiche sur le Source Registry ;
6. une fiche sur le Qualification Engine ;
7. quelques captures d'ecran de l'application ;
8. eventuellement un exemple de donnees qualifiees.

Prompt utile dans NotebookLM :

Explique ce projet comme un demonstrateur professionnel pour candidature data, automation et IA appliquee. Structure la reponse en probleme, architecture, pipeline, IA, scoring, interface, valeur recruteur et roadmap. Le ton doit etre clair, pedagogique et credible.

Prompt video court :

Genere un script video de 3 minutes qui explique France Monitor a un recruteur non technique. Insiste sur la transformation de donnees publiques non structurees en information qualifiee, sourcee, scoree et visualisee.

Prompt video technique :

Genere un script video de 8 minutes pour un recruteur technique. Detaille l'architecture Vite, TypeScript, serverless functions, ingestion multi-sources, classification, geocodage, carte Deck.gl, scoring de confiance et roadmap RAG.

## 20. Conclusion

France Monitor doit devenir plus qu'une application de veille. Il doit devenir une preuve structuree de ta capacite a concevoir un systeme data complet : collecte, transformation, qualification, IA, restitution, supervision et documentation.

La meilleure prochaine etape n'est pas d'ajouter encore dix sources. La meilleure prochaine etape est de rendre la qualite visible : sources documentees, signaux scores, decisions expliquees, statuts de validation et demonstration claire.

Le projet pourra alors etre presente comme un PoC professionnel de veille open-source qualifiee. C'est un angle solide pour reduire l'ecart entre une candidature et des postes qui demandent de l'automatisation, de la data, de l'IA appliquee, du cadrage technique et de la documentation.
