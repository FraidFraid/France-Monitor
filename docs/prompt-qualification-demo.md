# Prompt : qualification de France Monitor et préparation d'une démonstration experte

> À coller tel quel dans une nouvelle session Claude Code ouverte dans le dépôt `~/Desktop/FranceMonitor`.
> Le prompt demande un travail en lecture seule : aucun code modifié, aucun commit, aucun envoi externe.

---

## Rôle

Tu es à la fois :
- un **auditeur de maturité** de produits de renseignement d'origine sources ouvertes (OSINT), habitué aux services de l'État (cabinets ministériels, préfectures, SGDSN, centres opérationnels) ;
- un **relecteur sceptique** qui se met à la place d'un expert reconnu de la sécurité, de la criminologie et de la gestion de crise, du type d'Alain Bauer : il a vu passer des dizaines de « tableaux de bord » ; il repère en deux minutes l'esbroufe, le chiffre sans source et la promesse de prédiction ;
- un **metteur en scène de démonstration** : tu prépares une démo de 10 à 15 minutes qui tient debout devant ce public.

Ta règle d'or : **la crédibilité vient de l'exactitude, pas de l'enthousiasme.** Tout ce que tu affirmes sur le projet doit être vérifié dans le code, les tests, la documentation ou la production. Si tu ne peux pas vérifier, écris « non vérifié » et dis comment le vérifier. Ne jamais gonfler une capacité, ne jamais présenter une maquette comme un service opérationnel.

## Le projet en bref (à vérifier, pas à recopier)

- **France Monitor** (https://www.francemonitor.com) : poste de situation OSINT de la France à l'instant T, destiné aux cabinets ministériels, préfectures et entreprises. Il agrège des sources publiques (presse régionale, Météo-France, Vigicrues, RTE/Écowatt, SNCF, DIR, ARCEP, ASNR, BCE, ANSSI/CERT, ADS-B, GDACS, Copernicus EMS, etc.), les corrèle et donne un **niveau national** (vert, jaune, orange, rouge) assorti d'un indice et d'une note de synthèse.
- **Ce que l'outil n'est pas** : ni un outil de prédiction, ni une évaluation officielle, ni un outil politique. Les seules échéances futures affichées sont celles annoncées par les sources elles-mêmes, attribuées.
- **Statut** : bêta v2, aucun utilisateur à ce jour, développé par une seule personne, hébergé en paliers gratuits (VM Oracle Cloud, Cloudflare, Neon, Upstash, Groq). Une migration vers un hébergement souverain français est prévue une fois un financement obtenu.
- **Stack** : TypeScript strict sans framework, Vite, MapLibre + Deck.gl ; API Node sur la VM ; tests Vitest (environ 5 800 tests) ; CI GitHub Actions et déploiement automatique sur la VM.
- **Indice national** : moteur v3 dans `src/services/france-country-intel.ts` (base 95, quatre piliers pondérés, plafonds liés aux situations, lissage), seuils dans `src/services/vigilance.ts`, méthode publique dans `public/methodology.html`. Historique relevé toutes les 15 minutes par un navigateur sans écran sur la VM (`scripts/score-recorder.mjs`), avec la couverture des sources de chaque relevé.

## Ce que tu dois faire

Travaille dans cet ordre. Lis avant de conclure. Cite chaque constat avec un chemin `fichier:ligne`, une commande lancée ou une URL interrogée.

### 1. Inventaire factuel

1. Lis `CLAUDE.md`, `README*`, `docs/` (dont `docs/roadmap.md`, `docs/deployment-oracle.md`, `docs/classification.md`), `public/methodology.html` et la mémoire du projet si elle est accessible.
2. Dresse l'**inventaire des sources** réellement branchées : pour chacune, l'émetteur, la nature (officielle, presse, communautaire, commerciale gratuite), la fréquence de relève, la licence ou les conditions d'usage connues, le quota, ce qu'elle nourrit (carte, situation, indice, note), et son état en production à l'instant de ton audit (interroge les routes `/api/...` publiques ; pour lire le corps d'une erreur 502 masquée par Cloudflare, interroge l'origine : `curl -sk --resolve www.francemonitor.com:443:141.145.223.156 https://www.francemonitor.com/api/...`).
3. Dresse l'**inventaire des fonctions** par onglet (Vue générale, Sécurité et défense, Énergie, Environnement, Santé, Transports, Pannes, Intelligence France, etc.) : ce que l'utilisateur voit, ce qui est calculé, ce qui est simplement affiché.
4. Mesure la **santé technique** : `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` ; derniers passages CI (`gh run list`) ; dernier déploiement ; historique de la note des 7 derniers jours (`/api/situation-history?days=7&resolution=15m`) avec la couverture des sources.

### 2. Qualification de maturité

Pour chaque grand bloc (collecte, normalisation, classification des événements, géolocalisation, corrélation, indice national, note de synthèse IA, historique, carte, alertes, exploitation multi-utilisateurs, sécurité, hébergement), donne :
- un **niveau de maturité** sur une échelle explicite (par exemple TRL 1 à 9, ou : maquette / prototype / bêta / opérationnel) avec la justification ;
- ce qui est **démontrable aujourd'hui sans risque** ;
- ce qui est **fragile** (dépend d'un quota gratuit, d'un seul serveur, d'une source instable, d'un réglage non éprouvé) ;
- ce qui **manque** pour un usage institutionnel réel.

Sois précis sur les limites connues, notamment :
- les pondérations de l'indice n'ont pas été rétro-testées sur des crises passées ;
- une source muette peut faire paraître la situation plus calme qu'elle n'est ;
- un seul serveur, pas de redondance, pas d'astreinte ;
- pas d'authentification ni de gestion de droits (choix assumé de la bêta) ;
- pas d'alertes poussées ;
- la note de synthèse dépend d'un modèle de langage cloud (Groq) avec un repli déterministe.

### 3. Lecture critique « expert sécurité »

Écris les **20 questions les plus dures** qu'un expert du niveau d'Alain Bauer poserait, et pour chacune :
- la réponse honnête, vérifiée dans le dépôt ;
- la preuve à montrer à l'écran (onglet, panneau, page méthodologie, ligne de code, relevé) ;
- si la réponse est faible, ce qu'il faudrait faire pour qu'elle devienne solide, avec un effort estimé.

Couvre au minimum :
- **D'où vient le chiffre ?** Traçabilité de l'indice jusqu'aux sources, reproductibilité, explicabilité.
- **Qu'est-ce que ça m'apprend que je n'ai pas déjà ?** Valeur de la corrélation par rapport à la lecture des sources une à une.
- **Le bruit.** Faits divers, doublons, mauvaise géolocalisation, emballement médiatique.
- **Le biais et la manipulation.** Désinformation, saturation volontaire d'une source, sources communautaires.
- **Le retard et la panne.** Que voit-on quand une source tombe ? Comment l'utilisateur le sait-il ?
- **L'aide à la décision.** Que fait un préfet de cette information ? Où s'arrête l'outil ?
- **La légalité et l'éthique.** RGPD (identités d'aéronefs, comptes de réseaux sociaux, presse), droit des bases de données, conditions d'usage des API, propriété des contenus, absence de traitement de données personnelles par les IA cloud.
- **La souveraineté.** Hébergement hors de France aujourd'hui, et pourquoi c'est acceptable pour une bêta de données publiques.
- **La robustesse.** Que se passe-t-il pendant une vraie crise (pic de trafic, sources saturées) ?
- **La comparaison.** Ce que font déjà les outils existants côté État ou privé, et ce qui distingue France Monitor.

### 4. Positionnement

- Formule la **proposition de valeur** en une phrase, puis en trois.
- Identifie **trois cas d'usage concrets** et crédibles (par exemple : point de situation du matin d'un cabinet, veille d'une préfecture pendant un épisode de crues, cellule de crise d'un opérateur d'importance vitale), avec ce que l'outil apporte et ce qu'il n'apporte pas.
- Liste ce qu'il ne faut **jamais dire** pendant la démo (prédire, anticiper les émeutes, remplacer un service, temps réel là où la relève est de 15 min, etc.).

### 5. Scénario de démonstration

Écris un **déroulé minute par minute** de 12 minutes, plus 5 minutes de questions :
- point de départ (quel écran, quelle URL, quel niveau affiché) ;
- l'histoire racontée : de la vue nationale à un événement, de l'événement à ses sources, de la source à la décision ;
- les phrases clés, sobres, sans superlatifs ;
- pour chaque étape, un **plan B** si la donnée en direct est vide, en panne ou trompeuse ce jour-là (relevé historique, capture préparée, page méthodologie) ;
- le moment où l'on montre les limites, volontairement : c'est ce qui rend crédible devant ce public.

### 6. Liste de contrôle avant démo

Une liste à cocher, J-7, J-1 et H-1 :
- sources indispensables à vérifier et commande pour chacune ;
- quotas (adsb.lol 500 appels par jour, Groq, Neon) ;
- couverture des derniers relevés (viser 14/14) ;
- navigateur, résolution, réseau de secours, captures de secours ;
- textes de la page méthodologie relus ;
- typographie de l'interface (aucun tiret cadratin, valeurs et unités jamais coupées).

### 7. Plan d'action priorisé

Ce qui rendrait la démo nettement plus crédible, classé par rapport gain / effort, en distinguant :
- **avant la démo** (jours) ;
- **avant un pilote** avec une préfecture ou un cabinet (semaines) ;
- **avant un usage opérationnel** (mois, financement nécessaire).

Contrainte : aucune recommandation payante pour la phase actuelle (paliers gratuits uniquement). Les coûts ne sont mentionnés que dans la colonne « avec financement ».

## Livrables

Produis un seul document Markdown, `docs/qualification-demo-AAAA-MM-JJ.md`, structuré ainsi :

1. **Synthèse d'une page** : ce qu'est le projet, où il en est, ce qu'on peut montrer, ce qu'il manque, verdict de crédibilité sur 10 avec la justification.
2. Inventaire des sources (tableau).
3. Inventaire des fonctions par onglet (tableau).
4. Santé technique (résultats des commandes, avec la date).
5. Grille de maturité (tableau).
6. Les 20 questions dures et leurs réponses.
7. Positionnement et cas d'usage.
8. Scénario de démo minute par minute, avec les plans B.
9. Liste de contrôle avant démo.
10. Plan d'action priorisé.
11. Annexe : tout ce qui n'a pas pu être vérifié, et comment le vérifier.

Ajoute ensuite une **fiche d'une page** séparée, `docs/fiche-presentation-AAAA-MM-JJ.md`, destinée à être remise à l'interlocuteur. Elle doit être sobre, factuelle, en français administratif clair, sans jargon technique, et mentionner explicitement le statut de bêta et les limites.

## Règles de forme

- Français, phrases complètes, ton d'une note de cabinet : précis, sobre, sans superlatifs ni marketing.
- Aucun tiret cadratin « — » : utiliser « : », « · » ou une nouvelle phrase.
- Chaque chiffre a sa source et sa date.
- Distinguer partout **vérifié**, **déclaré par la documentation** et **non vérifié**.
- Ne rien modifier dans le code, ne rien commiter, ne rien publier en ligne, ne contacter aucun tiers.
