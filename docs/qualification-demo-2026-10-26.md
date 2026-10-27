# France Monitor : dossier de qualification et de démonstration

Audit du 26 octobre 2026, réalisé entre 12 h et 13 h 15 UTC, mis à jour le même jour à 16 h 20 UTC, puis **le 27 octobre à 7 h UTC** après les corrections du soir. Relevés faits sur le dépôt (`main` = 791b438f) et sur la production (https://www.francemonitor.com).

Légende de fiabilité :
- **[V]** : vérifié pendant l'audit (commande, lecture de code, appel à la production) ;
- **[D]** : déclaré dans la documentation ou la mémoire du projet, sans revérification ;
- **[NV]** : non vérifié.

---

## 1. Synthèse d'une page

**Ce qu'est le projet.** France Monitor est un poste de situation. Il agrège une quarantaine de sources publiques françaises et européennes : presse nationale et régionale, Météo-France, Vigicrues, RTE, SNCF, Bison Futé, ARCEP, ASNR, CERT-FR, BCE, ADS-B, GDACS, Copernicus, Santé publique France. Il les place sur une carte, les regroupe en « situations » par thème et par territoire, et en tire :
- un **niveau national** (vert, jaune, orange, rouge) ;
- un indice de 0 à 100 ;
- une note de synthèse dont chaque phrase cite ses preuves.

Il publie aussi ses **alertes aux formats CAP et Atom**. [V]

**Où il en est.** C'est une bêta v2, sans utilisateur, développée par une personne et hébergée sur des offres gratuites (VM Oracle Cloud, Cloudflare, Neon, Upstash, Groq). [V]
- 1 346 commits depuis le 23 mars 2026, dont 27 le seul 26/10 ;
- 529 fichiers de test et 5 897 tests, tous verts ;
- CI et déploiement automatiques.

**Ce qui a changé le 26/10, et qui renforce la crédibilité :**
1. **L'indice a été rejoué sur une crise réelle.** Le 17/10 (jusqu'à 800 000 manifestants, 1 200 interpellations, puis pillages le 18), l'indice était resté jaune sans aucune situation sociale. Le rejeu a trouvé trois causes :
   - la page ne lisait que 4 à 8 heures de presse ;
   - le moteur comptait des articles, pas des événements ;
   - la couche Manifestations n'entrait pas dans l'indice.

   Deux situations nouvelles (« Mobilisation sociale étendue », « Violences et troubles étendus ») corrigent ce défaut. Mesuré par rejeu, le résultat est le suivant : 17/10 orange (65), 18/10 orange (55), journées calmes inchangées. Les tests de calibration n'ont pas été modifiés. [V]
2. **Historique fiable.** La note est relevée toutes les 15 minutes par la VM, avec la liste des sources lues. Elle est sauvegardée chaque nuit hors de la VM. La couche Manifestations est archivée toutes les heures par la VM et recopiée hors VM (27/10). [V]
3. **Aide à la décision, sans prédiction :**
   - alertes CAP 1.2 et Atom ;
   - fiche par département ;
   - notes de situation archivées (une par tranche de 6 h, 90 jours) ;
   - échéances annoncées par les sources (Écowatt J+3, vigilance J+1, hausses annoncées par Vigicrues, rassemblements annoncés), toujours attribuées. [V]
4. **Interface assainie :**
   - plus de « temps réel » trompeur ;
   - couverture de l'indice affichée (« indice sur 14/14 sources ») ;
   - la note A4 affiche le niveau national, et l'ISNR n'y est plus présenté comme « stabilité nationale » ;
   - les annonces des gilets jaunes sont masquables ;
   - les blocs marchés sont lisibles et expliqués. [V]

**Ce qui manque encore pour un usage institutionnel :**
- comptes et droits d'accès ;
- alertes poussées par courriel ou par messagerie de l'État ;
- hébergement souverain ;
- redondance et supervision avec astreinte ;
- un **historique long** : le rejeu ne couvre que la presse, et les autres sources ne sont archivées que depuis le 26/10. [V]

**Point technique ouvert (27/10, 7 h).** Un « gardien » relance depuis le 26/10 au soir les sources de l'indice qui manquent. Il a amélioré la couverture sans la stabiliser.
- Depuis sa mise en ligne : 48 relevés sur 57 lisent 14 sources sur 14.
- Entre 3 h 30 et 6 h 40 UTC le 27/10, la plupart des relevés n'en lisaient que 11 à 13 (militaire, carburants, pétrole). Les sources répondaient pourtant bien côté serveur : c'est la lecture dans la page qui varie encore.
- Garde-fou en place : un relevé où plus d'une source manque ne déclenche jamais d'alerte. [V]

**Verdict de crédibilité devant un expert sécurité et gestion de crise :**
- **le 26/10 au matin : 6/10** ;
- **le 26/10 au soir : 7,5/10.** Le rejeu du 17/10 répond à la question la plus dure, et les fonctions d'aide à la décision existent ;
- **avec le 31/10 rejoué et la couverture stabilisée : environ 8/10** ;
- **le plafond sans financement reste autour de 8/10.**

---

## 2. Inventaire des sources

État relevé le 26/10/2026 vers 16 h 15 UTC, avec un appel par route et sans interroger directement les fournisseurs. [V]

| Domaine | Sources | Nature | Cadence | Alimente | État |
|---|---|---|---|---|---|
| Presse | 35 flux RSS nationaux et régionaux (3 retirés le 26/10 : Marianne et Le Télégramme, fermés aux robots ; guadeloupe.fr, supprimé) | Presse | 30 min (VM) | Événements, piliers Sécurité et Signal, situations d'étendue | OK : 35 flux lus, 0 erreur |
| Étendue des mouvements | Comptage d'événements distincts sur 24 h (`/api/news/event-pressure`) | Calcul sur la presse | 10 min | Situations « Mobilisation sociale étendue » et « Violences et troubles étendus » | OK. Le 26/10 au soir : 57 événements sociaux, 45 de sécurité élevés, dont l'essentiel concerne l'attentat de Trappes et ses suites, d'où « Violences et troubles étendus » en élevée |
| Météo | Vigilance Météo-France (J et J+1), radar | Officiel | 5 à 15 min | Pilier Continuité, échéances | OK |
| Eau | Vigicrues, Hub'Eau, VigiEau, marégraphes | Officiel | VM | Continuité, couches | OK |
| Feux | NASA FIRMS, EUMETSAT MTG-FRP (étiqueté démonstration) | Officiel | 10 à 15 min | Pilier Signal | OK |
| Électricité | RTE Écowatt J..J+3, éCO2mix, indisponibilités, nucléaire | Officiel (clé) | 5 à 15 min | Continuité, échéances | OK |
| Carburants, pétrole | Ministère de l'Économie, SDES | Officiel | 15 min à 3 h | Continuité | OK côté serveur ; lecture irrégulière dans la page (voir § 1) |
| Gaz | GIE AGSI/ALSI, ENTSOG | Officiel | Page | Panneau gaz | OK (ENTSOG a eu des lenteurs passagères) |
| Trains | SNCF Navitia, SIRI-SX | Officiel (clé) | 5 min | Continuité | OK côté serveur (une réponse à 2,4 s) ; lecture irrégulière dans la page |
| Routes | Bison Futé (DIR), TomTom agglomérations (toutes les heures) | Officiel / API gratuite | 5 min et 1 h | Continuité | Bison Futé OK. **TomTom** : la vraie clé est posée sur la VM, mais le compte n'a plus de crédit (« InsufficientFunds »). Données du 15/10, correctement **écartées de l'indice** |
| Aérien | OpenSky, sites d'aéroports | Communautaire | 2 à 10 min | Couche | OK |
| Défense | adsb.lol (militaire 5 min, GNSS 1 h), NOAA, veille des câbles (AIS) | Communautaire / officiel | 5 min, 1 h | Pilier Défense | **Militaire rétabli** le 26/10 (quota respecté). Grille GNSS en reconstruction (environ 23 h). Câbles OK |
| Cyber | CERT-FR, CISA KEV, ENISA, EPSS, abuse.ch, ransomware.live, DDoSia | Officiel / communautaire | 1 à 6 h | Pilier Sécurité | OK |
| Télécoms | ARCEP | Officiel | 30 min | Continuité | OK |
| Pannes réseau | Cloudflare Radar, IODA, RIPE Atlas, pages d'état cloud, Bluesky et Mastodon (décomptes) | Mixte | 2 à 30 min | Salle des pannes | OK. Le référentiel DRIEAT est en panne côté État depuis le 09/10, géré proprement |
| Société | Démosphère, GDELT, presse, arrêtés, carte des gilets jaunes | Mixte | VM, horaire | Couche Manifestations, échéances | OK. **Archive horaire tenue par la VM** depuis le 27/10 (`/api/social/protests-archive`), recopiée sur la branche `sauvegarde-historique`. 414 rassemblements annoncés pour le 31/10 |
| Souveraineté | Vigipirate (SGDSN), gel des avoirs, RIPEstat, PeeringDB | Officiel | 1 à 24 h | Panneaux | Vigipirate : le site du SGDSN est désormais derrière un **contrôle anti-robot** (Gcore), affiché comme tel. Le niveau affiché reste la saisie datée du 04/10 |
| Finance | BCE (CISS, taux, €STR), écart OAT-Bund, marchés | Officiel / API | 5 à 15 min | Pilier Signal | OK |
| Santé | Santé publique France, ANSM, ECDC, OMS, Sentiweb, eaux usées | Officiel | 30 min à hebdomadaire | Panneaux (hors indice) | OK, sauf **DGS-Urgent** : PEPS injoignable et page officielle derrière un captcha, affiché « n.d. » avec un lien vers la source |
| Catastrophes | GDACS, Copernicus EMS, séismes | Officiel | Page | Couches, situations | OK |

**Les 14 sources de l'indice** : presse, ISNR, Écowatt, vigilance, crues, feux, trains, routes, télécoms, cyber, militaire, finance, carburants, pétrole. La fiche France affiche celles qui ont été lues. [V]

**Données personnelles** [V] :
- les aéronefs militaires sont affichés avec leur identité complète : données ADS-B émises en clair par les appareils et déjà republiées par des sites mondiaux, décision confirmée le 26/10 ;
- pour Bluesky et Mastodon, seuls des décomptes sont gardés ;
- la presse est conservée en titres et liens ;
- aucune donnée d'utilisateur n'est collectée.

**Flux vers l'IA (Groq, États-Unis)** : titres et extraits de presse publique uniquement. Le fournisseur se change par configuration (`docs/privacy.md`). [V]

---

## 3. Fonctions par onglet

Sept onglets en v2. Éléments communs à tous [V] :
- bandeau d'état ;
- liste « À traiter » ;
- fiche France ;
- fil d'alertes ;
- pastilles de couches ;
- recherche Cmd+K ;
- export CSV et GeoJSON.

| Onglet | Ce qu'on voit | Calculé par France Monitor | Simplement affiché |
|---|---|---|---|
| Vue générale | Vigilance, crues, événements, couches qui passent en jaune ou plus, « En bref », niveau national | Indice, niveau, situations, pression par département | Bulletins officiels |
| Énergie | Réseau, nucléaire, gaz, pétrole, éolien, DROM, métropoles | Tension carburants, arrêts nucléaires imprévus | Données RTE, GRTgaz, SDES |
| Sécurité et défense | Militaire, cyber, câbles, manifestations (gilets jaunes masquables), flux piétons, criminalité | Pression cyber et défense, fusion des manifestations, foule estimée | Criminalité SSMSI, avis ANSSI |
| Pannes | Salle des pannes, journal de 7 jours, rejeu | Rafraîchissement 60 s, cascade | Pages d'état |
| Santé | Urgences, veille, hôpitaux, accès aux soins | Peu de calcul | Santé publique France, DREES |
| Environnement | Crues, radar, feux, air, sécheresse, séismes, catastrophes | Enjeux exposés, habitants en zone inondable | Radar, GDACS, EMS |
| Transports | Route, rail, mer, air | Trains supprimés ou très retardés | Trafic, AIS, ADS-B |

**Fonctions transverses** [V] :

| Fonction | État au 26/10 au soir |
|---|---|
| Comptes, droits | Absents (choix assumé de la bêta) |
| **Alertes** | **Présentes** : flux Atom `/api/alerts/atom` et alertes CAP 1.2 `/api/alerts/cap`. Deux déclencheurs (changement de couleur, situation élevée ou critique), confirmés sur deux relevés, avec une urgence CAP toujours « inconnue » puisque ce n'est pas une prévision. Pas encore d'envoi par courriel |
| **Fiche département** | **Présente** : niveau, signaux cliquables, vigilance météo, presse des 24 h. S'ouvre depuis la pression par département ou d'un clic sur la carte |
| **Notes archivées** | **Présentes** : une note par tranche de 6 h, 90 jours, écrites par la VM. Section « Notes archivées » de la fiche France, ouverture au format A4. Première note en production le 26/10 à 15 h 20 UTC |
| **Échéances annoncées** | **Présentes** dans la fiche France : Écowatt J+1 à J+3 (RTE), vigilance de J+1 (Météo-France), hausses annoncées par Vigicrues sur les tronçons en vigilance, rassemblements annoncés sur 7 jours. Toutes attribuées |
| Historique | Note toutes les 15 min (35 j sur la VM), sauvegardée chaque nuit hors VM ; manifestations archivées toutes les heures par la VM (90 j), recopiées hors VM |
| Outil de rejeu | `npm run replay:score` : recalcule l'indice d'un instant passé sur la presse archivée, avec le moteur réel |
| Supervision | `/api/health-check`. Le test de fumée quotidien ouvre un ticket GitHub (courriel) en cas d'échec et le referme au retour au vert |
| Sauvegardes | Base Neon chaque nuit sur la VM ; historique de la note et archive des manifestations hors VM (GitHub) |

---

## 4. Santé technique

Relevée le 27/10/2026 vers 7 h UTC. [V]

| Contrôle | Résultat |
|---|---|
| Typecheck, lint, build | OK |
| Tests | 529 fichiers, **5 897 tests, tous verts** |
| CI et déploiement VM | Succès jusqu'à e7db0fe4 ; 791b438f poussé le 27/10 |
| `/api/health-check` | `ok`, 35 flux lus, 0 erreur |
| Relevés de la note (depuis le gardien) | 57 relevés, dont 48 à 14/14 sources ; voir le point ouvert du § 1 |
| Notes archivées | Une par tranche de 6 h, sans trou depuis le 26/10 à 15 h 20 UTC, toutes à 14/14 |

---

## 5. Grille de maturité

| Brique | Niveau | Évolution du 26/10 |
|---|---|---|
| Collecte | Bêta | Quotas adsb.lol respectés, flux morts retirés, TomTom en attente de crédits |
| Classification | Bêta avancée | Inchangée |
| Situations | Bêta | **+2 règles d'étendue**, mesurées par rejeu ; « Escalade sociale » sans effet sur la note ni sur les alertes |
| Indice national | Bêta | **Rejoué sur le 17/10** ; formule des piliers inchangée ; couverture affichée |
| Note de synthèse | Bêta | Note A4 corrigée (niveau national en tête) |
| Historique | **Bêta** (prototype le matin) | Relevé de 15 min, sauvegarde hors VM, notes archivées |
| Alertes | **Prototype** (maquette le matin) | Flux CAP et Atom publics ; pas encore d'envoi par courriel |
| Vue départementale | **Bêta** (partielle le matin) | Fiche département |
| Comptes et droits | Absent | Inchangé |
| Exploitation | Prototype | Ticket automatique si le test de fumée échoue |
| Hébergement | Prototype | Inchangé (gratuit, une VM, hors de France) |

---

## 6. Les 20 questions dures, et les réponses honnêtes

**1. D'où sort votre chiffre ?**
- **Réponse.** Le calcul part d'une base de 95, moins quatre déductions pondérées : continuité 35 %, sécurité 30 %, signaux faibles 20 %, défense 15 %. Des plafonds s'appliquent quand une situation est élevée ou critique. La fiche France indique combien de sources ont été lues.
- **Preuve.** `public/methodology.html`, « pourquoi ce niveau ? », ligne « indice sur 14/14 sources ».

**2. Vos poids, qui les a fixés, et les avez-vous testés ?**
- **Réponse.** Ce sont des choix de conception, et c'est écrit. **Nous les avons rejoués sur la mobilisation du 17 octobre** : l'indice était resté jaune, sans situation sociale. Nous avons trouvé pourquoi (la page ne voyait que 4 à 8 heures de presse, le moteur comptait des articles et pas des événements) et ajouté deux situations d'étendue, mesurées avant mise en ligne.
- **Résultat.** 17/10 orange (65), 18/10 orange (55), 24/10 orange (55), journées calmes inchangées, et le crash isolé du Mirage du 21/10 ne déclenche rien.
- **Preuve.** `docs/rejeu/constats-2026-10-26.md`, `npm run replay:score`.
- **Limite.** Seule la presse est rejouable avant le 26/10. Les seuils sont calés sur deux semaines et seront revérifiés après le 31/10.

**3. Qu'est-ce que ça m'apprend que mon centre opérationnel n'a pas déjà ?**
- **Réponse.** Aucune donnée nouvelle. L'apport est la **mise en regard**, à la même heure, de sources que personne ne lit ensemble, et la **mesure de l'étendue** d'un mouvement : combien d'événements distincts, combien de départements.

**4. Comment traitez-vous le bruit ?**
- **Réponse.** Un fait divers sans institution citée est déclassé, un niveau élevé exige deux groupes de presse indépendants, et **un sujet repris par cent médias compte une fois**, puisque l'étendue se mesure en événements. [D pour la mesure du 30/09]
- **Limite, à dire nous-mêmes.** Une affaire qui dure plusieurs jours se découpe en plusieurs événements : l'enquête, les réactions, les rassemblements. Le 26/10, l'attentat de Trappes et les violences qui ont suivi pesaient pour l'essentiel des 45 événements de sécurité. Le signal était réel, mais son ampleur est grossie par ce découpage. Nous le mesurerons sur le rejeu du 31/10 avant de toucher à quoi que ce soit.

**5. Et la désinformation ou la saturation d'une source ?**
- **Réponse.** Atténuées par ces mêmes règles, mais pas détectées en tant que telles. C'est une piste ouverte.

**6. Que voit-on quand une source tombe ?**
- **Réponse.** Elle est affichée en erreur avec sa dernière date. Une donnée périmée est écartée : TomTom, figé au 15/10, est sorti de l'indice. Un relevé où plus d'une source manque ne déclenche **jamais** d'alerte.
- **Limite.** Une source muette ne pèse pas.

**7. Vous dites « temps réel » ?**
- **Réponse.** Non : chaque donnée porte son heure, et l'interface dit « À JOUR » ou « DIFFÉRÉ ». Les derniers libellés « temps réel » trompeurs ont été retirés le 26/10.

**8. Vous prédisez ?**
- **Réponse.** Non. La fiche France reprend les **échéances annoncées par les sources** (Écowatt J+3, vigilance J+1, hausses annoncées par Vigicrues, rassemblements annoncés), attribuées. Les alertes CAP portent une urgence « inconnue » : elles décrivent, elles ne prévoient pas.

**9. Que fait un préfet de votre niveau orange ?**
- **Réponse.** Il ouvre la **fiche de son département** : niveau, signaux, vigilance, presse locale des 24 h. C'est un point d'entrée, pas une décision.

**10. RGPD ?**
- **Réponse.** Pas de compte, pas de traceur. Les réseaux sociaux ne sont gardés qu'en décomptes.
- **Aéronefs militaires** : leur identité est émise en clair par les appareils eux-mêmes et déjà republiée par des sites mondiaux. France Monitor ne fait que la compter et la mettre en contexte.

**11. Vos données partent aux États-Unis ?**
- **Réponse.** Seuls des extraits de presse publique partent, vers Groq. Le fournisseur se change par configuration (Albert, modèle local).

**12. Hébergé où ?**
- **Réponse.** Sur une VM Oracle Cloud gratuite, derrière Cloudflare [NV pour la région]. La migration vers un hébergeur qualifié se fera avec un financement.

**13. Ça tient en pleine crise ?**
- **Réponse.** Non démontré : une VM et pas de test de charge. Le 31/10 donnera une première indication sur la tenue des collectes.

**14. Qui maintient ?**
- **Réponse.** Une personne. 1 346 commits, 5 897 tests, CI, déploiement documenté.

**15. Pourquoi pas les outils existants ?**
- **Réponse.** France Monitor est ouvert, gratuit, explicable et publie en CAP, donc il peut alimenter d'autres outils. [NV pour une comparaison détaillée]

**16. Votre IA invente-t-elle ?**
- **Réponse.** Chaque phrase de la note cite ses preuves, et les sources affichées sont déduites par le serveur. Si l'IA échoue, un texte déterministe la remplace.

**17. Votre historique a des trous et des sauts.**
- **Réponse.** C'est l'ancien système, alimenté par les navigateurs. Depuis le 26/10, la VM relève la note toutes les 15 minutes et la sauvegarde hors VM, et chaque relevé indique ses sources lues. Les notes de situation sont archivées toutes les 6 h.

**18. Et à l'échelle d'un département ?**
- **Réponse.** Il y a une fiche par département, ouverte d'un clic sur la carte ou dans la pression par département.

**19. Combien ça coûte ?**
- **Réponse.** Zéro euro aujourd'hui. Un pilote demanderait un hébergement qualifié, une IA souveraine et une supervision. [À chiffrer]

**20. Pourquoi vous ferais-je confiance ?**
- **Réponse.** Parce que tout est traçable, la méthode et ses limites sont publiques, et **nous montrons nos erreurs** : le 17/10 manqué, puis corrigé et mesuré.

---

## 7. Positionnement

**En une phrase.** France Monitor met sur une seule carte, à la même heure, ce que disent les sources publiques sur l'état de la France, explique pourquoi la situation est jugée calme ou tendue, et publie ses alertes dans un format standard.

**Trois cas d'usage :**
1. **Point du matin d'un cabinet** : niveau, ce qui a changé, échéances annoncées, note archivée de la nuit.
2. **Préfecture pendant une crue ou une mobilisation** : fiche du département, vigilance, presse locale, rassemblements annoncés.
3. **Cellule d'un opérateur** : pannes, cyber, énergie, flux CAP repris dans ses propres outils.

**À ne jamais dire :** « prédire », « anticiper les émeutes », « temps réel », « remplace », « souverain » (pas encore), « validé », « utilisé par ».

---

## 8. Scénario de démonstration (12 min + 5 min de questions)

| Minute | Écran | Ce qu'on dit | Plan B |
|---|---|---|---|
| 0:00 à 1:00 | Vue générale | « Ce que disent les sources publiques, à cette heure-ci. Rien de secret, rien de prédit. » | Capture du matin |
| 1:00 à 2:30 | Fiche France : niveau, « indice sur 14/14 sources », « pourquoi ce niveau ? » | Le niveau et ses trois contributions principales, avec les sources lues | Note archivée la plus récente |
| 2:30 à 4:00 | Une situation, puis ses événements et ses sources | Traçabilité, de l'indice jusqu'à l'article | Situation stable repérée à H-1 |
| 4:00 à 5:30 | **Fiche d'un département** (clic sur la carte) | « Ce qu'un préfet ouvre en premier. » | Département repéré à H-1 |
| 5:30 à 7:00 | Fiche France : **échéances annoncées**, **notes archivées** | « Ce que les sources annoncent, attribué, et ce que nous avons noté il y a 6 heures. » | Ouvrir une note A4 archivée |
| 7:00 à 9:00 | **Le rejeu du 17/10** (`docs/rejeu/constats-2026-10-26.md`) | « Nous avons rejoué le 17 octobre. L'indice avait sous-réagi. Voici pourquoi, et voici la correction, chiffrée. » | Le tableau du constat imprimé |
| 9:00 à 10:00 | `/api/alerts/atom` ouvert dans un lecteur de flux | « Nos alertes sont publiées au format CAP, la norme des alertes de crise, reprenables par vos outils. » | Exemple CAP imprimé |
| 10:00 à 11:00 | Une source en panne (TomTom), page méthodologie, section Limites | Montrer les limites, volontairement | Page méthodologie |
| 11:00 à 12:00 | Retour à la carte | Bêta, gratuite, une personne. Pour un pilote : hébergement qualifié, IA souveraine, comptes, alertes par courriel ou Tchap. « Quel usage verriez-vous ? » | |

**Phrase de sortie.** « Ce n'est pas un outil qui décide. C'est un outil qui montre, sources à l'appui, où regarder, et qui dit quand il s'est trompé. »

---

## 9. Liste de contrôle avant démo

**J-7**
- [x] Clé TomTom réelle sur la VM (fait le 26/10 ; reste : crédits du compte TomTom)
- [x] Vols militaires rétablis (26/10) ; grille GNSS à vérifier
- [x] Vigipirate affiché correctement (contrôle anti-robot nommé)
- [x] Flux RSS morts retirés
- [x] DGS-Urgent affiché « n.d. » proprement
- [x] Libellés « temps réel » revus
- [x] Décision sur l'identité des aéronefs militaires : affichée (données publiques)
- [x] Rejeu de l'indice sur un épisode passé (17/10)
- [x] Prévisions Vigicrues ajoutées aux échéances (26/10)
- [x] « Escalade sociale » sans effet sur la note ni sur les alertes (décision A du 26/10), libellé corrigé (27/10)
- [x] Résumé des alertes coupé à la fin d'un mot (27/10)
- [x] Archive horaire des manifestations tenue par la VM (27/10 ; installation du minuteur sur la VM à confirmer)
- [ ] **Couverture des relevés stabilisée** : gardien en place, mais relevés de nuit encore à 11 à 13 sources (militaire, carburants, pétrole)
- [ ] Rejeu du 31/10 le 01/11, avec l'archive des manifestations ; décider ensuite des seuils, au vu des données

**J-1**
- [ ] Derniers relevés à 14/14, au plus un à 13/14 sur 12 h : `curl -s "https://www.francemonitor.com/api/situation-history?days=7&resolution=15m"`
- [ ] `curl -s https://www.francemonitor.com/api/health-check` renvoie `ok`, sans flux en erreur
- [ ] `curl -s https://www.francemonitor.com/api/alerts/atom` répond, et le texte de chaque entrée se lit en entier
- [ ] `curl -s https://www.francemonitor.com/api/situation-notes` : une note par tranche de 6 h, sans trou
- [ ] `curl -s https://www.francemonitor.com/api/social/protests-archive` liste les jours ; branche `sauvegarde-historique` à jour (note et manifestations)
- [ ] Quotas : adsb.lol, Groq, Neon
- [ ] Constats du rejeu du 17/10 et du 31/10 imprimés ; captures de secours de chaque étape
- [ ] Une phrase prête pour chaque situation levée (par exemple : « 45 événements de sécurité, dont l'essentiel concerne Trappes et ses suites »)
- [ ] Pas de tiret cadratin visible, valeurs jamais coupées de leur unité

**H-1**
- [ ] Application ouverte depuis 3 minutes, « indice sur 14/14 sources » affiché ; sinon, nommer la source manquante plutôt que la cacher
- [ ] Échéances : vérifier ce qui s'affiche ce jour-là (un jour passé n'y figure plus)
- [ ] Département et situation du jour choisis pour la démo
- [ ] Lecteur de flux prêt sur `/api/alerts/atom`
- [ ] Partage de connexion testé, notifications coupées

---

## 10. Plan d'action priorisé

**Avant la démo** (jours, gratuit) :

| Action | Gain | État |
|---|---|---|
| Stabiliser la couverture des relevés (militaire, carburants, pétrole, surtout la nuit) | Fort : alertes et « 14/14 » fiables | En cours : gardien en place le 26/10, à poursuivre |
| Rejouer le 31/10 et réajuster les seuils si besoin | Très fort : deuxième épisode réel | Le 01/11 ; archive horaire de la VM en place |
| Ajouter les prévisions Vigicrues aux échéances | Moyen | **Fait le 26/10** |
| Revoir l'ancienne règle « Escalade sociale » (ISNR), qui se déclenche à tort certains soirs calmes | Moyen | **Fait** : décision A du 26/10, affichée mais sans effet sur la note ni sur les alertes ; libellé corrigé le 27/10 |
| Toutes les autres actions « avant démo » du matin | | **Faites le 26/10** |

**Avant un pilote** (semaines) :
- alertes par courriel ;
- comparaison avec les outils existants ;
- test de charge ;
- fournisseur d'IA local testé ;
- rejeu élargi à d'autres sources.

**Avant un usage opérationnel** (mois, financement nécessaire) :
- hébergement qualifié ;
- IA souveraine ;
- comptes ProConnect ;
- Tchap ;
- deux nœuds et astreinte ;
- audit de sécurité ;
- conventions avec les émetteurs ;
- une deuxième personne.

---

## 11. Annexe : non vérifié, et comment le vérifier

| Point | Comment le vérifier |
|---|---|
| Région exacte de la VM | Console Oracle Cloud |
| Crédits TomTom (offre, remise à zéro) | Compte developer.tomtom.com |
| Licences des sources hors adsb.lol, OpenSky, TomTom, MTG | Conditions de chaque émetteur ; dresser un registre |
| Tenue des collectes un jour de forte affluence | Relevés et `health-check` du 31/10 |
| Comparaison avec les outils existants | Recherche documentaire dédiée |
| Précision de la géolocalisation | Échantillon de 100 événements vérifiés à la main |
