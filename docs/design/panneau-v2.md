# Panneau v2 : kit de style « fmk »

![Panneau « État de la France » de la v2 : score, échelle, piliers, situations actives et début de la note](panneau-v2-etat.png)

Référence de style des panneaux de la v2, établie sur l'onglet « État de la France » (spec
`docs/superpowers/specs/2026-10-01-panneau-etat-reference-design.md`). Tout panneau restylé
reprend ces jetons, ces composants et ces règles.

## Jetons
| Rôle | Valeur |
|---|---|
| Fond de panneau | `--bg-primary` (#0a0a0f), fond de la colonne |
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

## Fiches sans score (événement, situation, thème, alerte officielle, marché)
Spec `docs/superpowers/specs/2026-10-01-fiches-kit-design.md` (fiches construites avec `kit.ts`). Seul l'en-tête est en grand ; tout le reste est au même niveau.
- En-tête kit : sur-titre (`fmk-eyebrow`, type et thème), titre 19 px (`fmk-title`), ligne de niveau (pastille, contexte, séparateurs « • »), synthèse en une ou deux phrases (`fmk-lead`, 14,5 px).
- Section « Indicateurs » ouverte sous l'en-tête ; tous les titres de section ont la même taille (11 px, capitales).
- Ton « référence » (`fmk-sec--ref`, #6e6e80) pour les sections de consultation (articles, sources) : plus discrètes que les sections d'action.
- Courbe de corroboration en escalier, neutre (gris #c8c8d4), étiquettes d'axe hors du tracé ; aucune couleur de niveau.
- Barres d'indicateurs d'une situation à la couleur de leur propre intensité (85 % rouge, 70 % orange, 55 % jaune, sinon vert) ; la confiance reste en gris.
- « À faire » : liste numérotée (`fmk-todo`) avec, sous chaque action, les rôles en petit.
- Heures absolues, heure de Paris : `hh:mm` le jour même, `jj/mm hh:mm` sinon ; le relatif n'est jamais seul.
- Aucun tiret cadratin dans un texte affiché : séparateur « · » ou « : », valeur absente « n.d. », plage « à ».
- Retour d'action (« Référence copiée », « Copie impossible ») : `fiche-toast`, en haut à gauche de la fiche.

## Panneaux de couches
Cadre commun des panneaux flottants de couche (code : `src/components/layer-panel/frame.ts`, styles : bloc « Panneaux de couches : cadre commun » de `src/styles/main.css`). Panneaux migrés : Réseau électrique (`grid.ts`), Parc nucléaire (`nuclear.ts`), Réseau gaz (`gas.ts`), Stress hydro (`hydro.ts`), Pétrole (`oil.ts`), Éolien (`wind.ts`), Charge métropolitaine (`metro.ts`, panneau nouveau), Énergie DROM (`drom.ts`) ; Santé (spec 2026-10-03) : Veille sanitaire (`veille.ts` et `veille-tabs.ts`, onglets France, Outre-mer, International, Produits), Urgences et SOS Médecins (`urgences.ts`), Accès aux soins (`acces-soins.ts`) et Hôpitaux (`hopitaux.ts`), aides communes dans `layer-panel/health-format.ts`, carte dans `deckgl/health-map.ts` ; Trafics (spec 2026-10-03 trafics) : Trafic routier (`route.ts`), Trafic aérien (`aerien.ts`, panneau nouveau), Réseau ferroviaire (`rail.ts`) et Trafic maritime (`maritime.ts` et `maritime-tabs.ts`, onglets Veille, Marine nationale, Alertes), aides communes dans `layer-panel/traffic-format.ts`, carte dans `deckgl/traffic-map.ts`, légendes de carte dans `layer-panel/traffic-legend.ts` ; Environnement (spec 2026-10-04 environnement) : Vigilance météo (`vigilance.ts`, onglets Aujourd’hui et Demain), Crues (`crues.ts`, panneau nouveau), Radar météo (`radar.ts`, mosaïque Météo-France, profil vertical `radar-profile-view.ts`) et Feux de forêt (`feux.ts` et `feux-dossier.ts`, onglets Veille et Dossier d'un feu), aides communes dans `layer-panel/environment-format.ts`, carte dans `deckgl/environment-map.ts`, légendes de carte dans `layer-panel/environment-legend.ts`, jour aéronautique dans `services/aeronautical-day.ts`. Environnement, phase B (spec 2026-10-04 environnement § 3) : Sécheresse (`secheresse.ts`), Qualité de l’air (`qualite-air.ts`), Séismes (`seismes.ts`) et la section Submersion marine du panneau Vigilance météo (`submersion.ts`), carte dans `deckgl/environment-map-b.ts`, légendes dans `layer-panel/environment-legend.ts`. Outils communs : formateurs `layer-panel/format.ts`, courbe `layer-panel/chart.ts`, lignes `listRow` et `barRow` (`frame.ts`).

Structure, de haut en bas :
- En-tête collant (`lp-head`) : sur-titre « Thème · Couche », titre = libellé de la pastille de la couche, gros chiffre facultatif (`lp-figure`, avec sa légende), ligne de niveau (pastille de niveau puis contexte séparé par « · »), synthèse en une ou deux phrases, puis onglets s'il y en a. Le bouton de fermeture rond (28 px) reste visible en haut à droite pendant le défilement. En feuille basse (mobile, 768 px au plus), l'en-tête de tous les panneaux de couches défile avec le corps ; la croix reste collante.
- Corps (`lp-body`) : sections du kit (`FicheSection`), séparées par des filets fins, chacune avec son résumé sur la ligne de titre ; l'essentiel est ouvert, le détail replié ; l'ouverture choisie par l'utilisateur et l'onglet actif survivent au rafraîchissement.
- Sources : section en ton « référence » (`fmk-sec--ref`), en dernier.

États :
- Chargement : loader unique (`fmLoaderHTML`) et « Chargement des données… ».
- Erreur de source : encart (`fmk-callout`) « Source injoignable » avec l'heure des dernières données, jamais « indisponible » pour une donnée qui charge.
- Vide : une phrase dite (`fiche-empty`), jamais un zéro.
- En retard : la ligne de niveau dit « données de hh:mm (en retard) » au-delà de deux périodes de rafraîchissement de la source ; l'heure est celle de la donnée, en absolu (heure de Paris).

Règles :
1. Pas de dégradé, pas de tuile d'icône, pas de glisser-déposer : le panneau est ancré (à droite en v1, dans la colonne en v2, en feuille basse sous 768 px).
2. Couleurs : un état ou un seuil prend la palette des niveaux (`levelColorVar`, `levelDot`, `renderVigilancePill`, gris « n.d. ») ; une catégorie prend un jeton `--mix-*` ou `--cat-*` défini dans `:root`. Jamais de couleur brute dans le HTML d'une vue, jamais de jauge grise : chaque barre prend une couleur de niveau ou de catégorie. Jetons de catégorie :

   | Jeton | Usage |
   |---|---|
   | `--mix-nuclear`, `--mix-hydro`, `--mix-wind`, `--mix-solar`, `--mix-thermal`, `--mix-bio` | filières de production (Réseau électrique, Parc nucléaire, Stress hydro, Éolien, DROM) |
   | `--mix-coal`, `--mix-oil`, `--mix-turbine`, `--mix-geo`, `--mix-storage`, `--mix-links`, `--mix-other` | filières des DROM et de la Corse |
   | `--cat-onshore`, `--cat-offshore` | éolien terrestre et en mer |
   | `--cat-gazole`, `--cat-sp95`, `--cat-sp98`, `--cat-e10`, `--cat-gpl` | carburants (graphe et légende des prix) |
   | `--cat-lng` | terminaux GNL (utilisation), part du GNL |
   | `--cat-crude` | origines du pétrole brut |
   | `--cat-renewable` | part renouvelable des territoires |
   | `--cat-substation`, `--cat-pylon`, `--cat-production` | types d'actifs DROM |
   | `--cat-hosp-chu`, `--cat-hosp-ch`, `--cat-hosp-private`, `--cat-hosp-gcs`, `--cat-hosp-army` | catégories d'hôpitaux (CHU et CHR, centres hospitaliers, cliniques privées, groupements, armées ; « autres » prend `--mix-other`) : panneau Hôpitaux, carte et légende (valeurs reprises dans `deckgl/health-map.ts`, vérifiées par test) |
   | `--cat-airport` | aéroports : jauges des départs (Trafic aérien), disques de la carte et légende (valeur reprise dans `layer-panel/traffic-legend.ts`, vérifiée par test) |
   | `--cat-port` | ports : jauges du panneau maritime, route récente d'un navire, mouillages de la carte et légende (même vérification) |
   | `--cat-station-hydro` | stations hydrométriques des tronçons en vigilance (Crues : carte et légende ; valeur reprise dans `layer-panel/environment-legend.ts`, vérifiée par test) |
   | `--cat-feu-recurrent`, `--cat-feu-etranger` | sources de chaleur récurrentes (« à vérifier, probablement industrielles ») et détections hors de France (Feux : liste, courbe, carte, légende ; même vérification) |
   | `--cat-secheresse-vigilance` | vigilance sécheresse (sensibilisation, sans restriction) : jauge, puce, carte et légende du panneau Sécheresse ; jamais une couleur de niveau (valeur reprise dans `layer-panel/environment-legend.ts`, vérifiée par test) |
   | `--radar-dbz-1` à `--radar-dbz-9`, `--echo-top-1` à `--echo-top-6` | classes de l'image radar et des sommets d'écho, palettes du worker (`services/radar-worker/render.py`, vérifiées par test) : palettes d'image, pas des niveaux |
3. Chiffres en `fmk-num`, aucune police à chasse fixe, aucun tiret cadratin.
4. Tout texte et tout lien venant d'un tiers est échappé ; les liens passent par `safeHref`.
5. Fermer par la croix éteint la couche (rappel `onClose`, appelé une seule fois) ; le masquage silencieux (`hide({ silent: true })`) ne l'appelle jamais.

Règles du lot 2 (R1 à R4) et préférences de l'utilisateur :
- R1 : une valeur tient sur une ligne. Espace insécable entre le nombre et l'unité et avant « % », valeurs en `white-space: nowrap`, gros chiffre avec son unité et sa légende dessous ; c'est la légende qui passe à la ligne. Contrôle par `breakableValue` dans le test de chaque vue et à l'écran.
- R2 : graphes et indicateurs colorés repris au restylage, jamais neutralisés (voir la règle 2 et le tableau des jetons). Les jauges sont toujours en couleur.
- R3 : le gros chiffre prend la couleur de son propre niveau quand il en a un (Parc nucléaire, Réseau gaz, Éolien selon l'état du vent, Charge métropolitaine selon l'écart du total à la veille : orange dès +5 %, vert sinon, Énergie DROM selon la part renouvelable : vert dès 50 %, jaune dès 25 %, orange en dessous) ; sinon il hérite du niveau de la pastille du panneau (c'est le cas de Stress hydro : pas de niveau propre, mais pas de couleur non plus quand l'éCO2mix a plus de 45 min). Un `level: null` explicite (donnée en retard : éCO2mix au-delà de 45 min, lecture RTE au-delà de 30 min, gaz sur valeurs de référence), une valeur « n.d. » ou une pastille « n.d. » le laisse en couleur de texte. Une part placée dans la légende du chiffre (facteur de charge éolien, part du parc hydraulique) prend la couleur du chiffre. Santé : Veille sanitaire selon l'activité Sentinelles des IRA, Urgences selon le niveau saisonnier de l'IRA, Accès aux soins selon l'évolution de la part de population sous 2,5 consultations (deux hausses orange, une jaune, aucune vert) ; Hôpitaux sans niveau (couleur du texte). Trafics : Trafic routier, Trafic aérien et Réseau ferroviaire selon leur pastille ; Trafic maritime sans couleur (un nombre de navires n'est pas une gravité). Environnement : Vigilance météo, Crues et Feux de forêt selon la couleur officielle la plus haute (vigilance, tronçons, météo des forêts) ; Radar météo sans couleur (une heure d'image n'est pas une gravité). Environnement, phase B : Sécheresse rouge dès un département en crise ; Qualité de l’air selon ses épisodes (alerte rouge, information orange, sinon vert) ; Séismes selon la plus forte magnitude de 3 ou plus en France sur 7 jours, vert à 0.
- R4 : aucun tiret cadratin.
- Toute mesure principale qui est une quantité est le gros chiffre, avec son unité (« 46,4 GW », « 93,4 % », « 1,689 € », « 336 MW »).
- Échanges (Réseau électrique) : import en rouge, export en vert, avec une flèche ▲ ou ▼ de tendance par rapport à l'historique sur 7 jours.
- Donnée en retard : la ligne de niveau dit « (en retard) » et les couleurs de niveau disparaissent.
- Rien ne disparaît à la migration : chaque indicateur, graphe ou note de l'ancien panneau est conservé, ou déplacé dans « Méthode et sources ».
- Une phrase qui décrit une fraîcheur (et non une valeur) passe à la ligne dans les détails repliés : libellé de largeur fixe, jamais recouvert.

Règles des panneaux Santé (spec 2026-10-03) :
- Hausse d'un indicateur sanitaire en rouge, baisse en vert ; le seuil de ±10 % s'applique à l'évolution affichée (arrondie).
- Niveau saisonnier : comparaison au maximum de la même semaine des trois saisons précédentes ; vert au plus ce maximum, jaune au-dessus, orange dès 1,15 fois, rouge dès 1,5 fois ; moins de deux saisons de référence : « n.d. ».
- Données hebdomadaires ou annuelles, jamais « temps réel » : la ligne de niveau dit la semaine (« S39 ») et la date de publication ; le panneau des sources reçoit la date de la donnée, jamais l'heure de lecture.
- Source en retard : « (en retard) », couleurs retirées, entrée écartée du niveau national et nommée. Une alerte épidémique dont la dernière ligne a plus de trois semaines est « hors saison » (gris clair sur la carte), jamais « niveau 1 ».
- Sélecteurs de carte (syndrome des urgences, profession de l'APL) : boutons `lp-seg` en tête du corps du panneau, mémorisés avec les onglets (`fm.layer.tabs`) ; la carte change de propriété peinte sans nouvelle requête.
- Niveau national de santé : plus haut niveau des entrées non en retard (alertes épidémiques, médecine générale, urgences, eaux usées) ; repris dans la fiche thème Santé de la v2 avec les liens d'ouverture des quatre panneaux.
- Infobulles de la carte (`hm-tip` dans `.dark-popup`) : titre, sous-titre, lignes libellé et valeur, puce de niveau ; même texte que les panneaux, valeurs insécables.

Règles des panneaux Trafics (spec 2026-10-03 trafics) :
- T1 : le périmètre est dit dans chaque panneau et dans sa légende de carte (réseau routier national non concédé des DIR, 12 agglomérations TomTom, zone suivie par OpenSky, trains signalés par la SNCF, eaux côtières couvertes par l'AIS) ; jamais une couverture France entière implicite.
- T2 : un événement routier démarré depuis plus de 24 h, ou planifié, va dans « Fermetures et chantiers de longue durée », jamais dans « Événements en cours » ni dans le gros chiffre ; les chantiers ne comptent jamais comme incidents.
- T3 : un signal automatique (statut AIS, code transpondeur, trajectoire) ne colore une pastille qu'après croisement documenté ; sinon il est une information (trajectoires inhabituelles, manœuvrabilité restreinte, en pêche).
- T4 : les sources à quota (TomTom, OpenSky, SNCF) sont collectées par le serveur ; plus aucun budget dans le navigateur ; la vitesse d'un tronçon TomTom au clic passe par le budget serveur du jour.
- Chaque partie d'un panneau porte la date de sa source (« DIR 14:57 · TomTom 15:00 ») ; au-delà du seuil de la source (tableau S2 de la spec), « (en retard) », couleurs retirées, pastille « n.d. » quand la source principale est en retard ; une partie en panne dit « Source indisponible : … », jamais « aucun ».
- Pastilles : route (les accidents ne dépassent jamais le jaune ; coupures non planifiées et météo font l'orange et le rouge), aérien (7500 rouge, 7700 orange, 7600 jaune, seulement au-dessus du territoire ou de ses approches et vus sur deux relevés ; un aéronef au sol n'est jamais compté ; sinon gris, « vu une fois, à confirmer » ; prédicat unique `emergencyColoursPill`), rail (retard moyen d'un axe ou d'une région d'au moins 3 trains, trains supprimés, trains grandes lignes à 15 min ou plus), maritime (signalement confirmé : pétrolier ou passagers rouge, autre navire orange). La phrase vient de `services/traffic-levels.ts`, rendue insécable par `glueUnits`.
- Carte : couleur portée par chaque objet, teinte neutre `#c7c7cc` pour une donnée en retard ou sans niveau ; avions colorés selon l'altitude (cinq tranches : moins de 5 000 ft, 5 000 à 15 000, 15 000 à 25 000, 25 000 à 35 000, 35 000 ou plus ; gris neutre « Altitude non transmise »), icônes nettes à tous les zooms (positions animées à partir du zoom 7), indicatif au survol seulement ; infobulles `hm-tip` préparées avec la donnée ; légendes datées par source (« Données : … »).
- Panneau maritime : onglet mémorisé avec les autres (`fm.layer.tabs`) ; Marine nationale et Alertes lisent les positions vivantes du WebSocket ; recherche, filtre de territoire et pagination gardés ; millésimes des listes de pavillons affichés.

Règles des panneaux Environnement (spec 2026-10-04 environnement) :
- E1 : une alerte officielle (Vigilance Météo-France, Vigicrues, météo des forêts) se lit avec son émetteur, l'heure de son produit et un lien vers la source ; le panneau reprend son niveau tel quel, jamais recalculé.
- E2 : un stock n'est pas un événement : une vigilance déjà connue ou une source de chaleur industrielle s'affiche, mais n'entre ni dans le score ni dans une situation.
- E3 : une détection satellite se dit avec son satellite, son heure d'acquisition et son âge, sa confiance (lettres VIIRS, 0 à 100 MODIS) et sa FRP ; une source récurrente est « à vérifier, probablement industrielle », jamais un feu de forêt ; une confiance faible n'est jamais rouge.
- E4 : le périmètre est dit (« métropole et Corse », « 337 tronçons surveillés par l'État », « départements français seulement, détections hors de France en gris »).
- E5 : une courbe partout où la donnée existe déjà (frise horaire de la vigilance, départements en vigilance sur 30 jours, hauteurs sur 48 h, météo des forêts de la saison, détections sur 10 jours, profil radar) ; axe en heure de Paris, couleur de niveau ou de catégorie, aucun point inventé : un trou de mesure reste un trou ; une série courte dit « référence en construction (N jours) ».
- Sécheresse : pastille rouge dès un département en crise, orange en alerte renforcée, jaune en alerte ; la vigilance (sensibilisation) en teinte de catégorie `--cat-secheresse-vigilance`, jamais une couleur de niveau ; « aucun arrêté » en vert, non rempli sur la carte ; un stock, hors du score (E2) ; courbe quotidienne depuis la mise en service.
- Qualité de l’air : requêtes WFS toujours filtrées en CQL par date et par propriétés (une requête sans filtre a renvoyé 285 Mo), garde « réponse non filtrée » ; un jour non publié se dit « prévision non encore publiée », jamais « aucun épisode » ; indice sur la palette L1 (1 et 2 vert, 3 jaune, 4 orange, 5 et plus rouge), pas la palette officielle ATMO, dit dans le panneau et la légende ; départements sans indice nommés ; textes des arrêtés préfectoraux hors du flux, dit.
- Séismes : « en France » = territoire métropolitain (Corse comprise) ou eaux françaises ; hors de France à 20 km au plus, en gris ; tirs de carrière et explosions écartés et comptés ; seuil d’affichage 2,5 (plus faibles en gris clair), vert dès 2,5, jaune dès 3, orange dès 4, rouge dès 5 ; pastille sur 72 h, gros chiffre sur 7 jours ; situation dès magnitude 4, élevée dès 5 (plafond du score à 78).
- Submersion marine (section du panneau Vigilance météo) : domaines littoraux « XX10 » par couleur ; marégraphes du SHOM (liste fixe de 19 ports) avec hauteur, variation sur 1 h, heure et courbe de 24 h repliable (mémorisée comme une section) ; aucun écart à la marée prédite (clé exigée), dit ; marégraphes lus seulement couche Vigilance active ou panneau ouvert.
- Deux remplissages départementaux actifs à la fois (Sécheresse et Qualité de l’air) : celui activé en dernier masque l’autre, et les légendes ne le disent pas encore.
- Retard propre à chaque source (tableau S2 de la spec) ; au-delà, « (en retard) » et couleurs retirées ; la météo des forêts hors saison dit « hors saison, dernière publication le … », jamais « (en retard) ». Une panne est nommée, jamais « aucune vigilance » ni « 0 ».
- Jour aéronautique (règle française) : lever, coucher et « fin du jour aéronautique » (coucher plus 30 min) au centroïde du département, heure de Paris ; la dernière heure le dit. Il remplace la couche Jour / Nuit, retirée.
- Hauteur du panache (Feux) : profil vertical radar à la station la plus proche, DÉMONSTRATION, heure avec la date ; option « Sommets d'écho » partagée avec le panneau Radar ; note sur la pyroconvection.
- Pictogrammes de la vigilance sur la carte : images SDF calculées par `alphaToSdf` (jamais l'alpha brut d'un dessin, bords crénelés), couche sous les points de feu (`ENV_LAYER_BEFORE`).

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
7. Une valeur dans une colonne de largeur fixe reste courte ; tout qualificatif va sur la ligne de note sous la ligne.

## Restyler un autre panneau
1. Construire son modèle en `FicheModel` (ou ses blocs avec `kit.ts`).
2. Donner un `id` et un résumé à chaque section ; choisir ce qui est ouvert par défaut.
3. Remplacer cadres et polices à chasse fixe par filets, `fmk-num` et `meterRow`.
4. Vérifier à 1600, 1280 et 390 px.
