# Observation multi-capteurs des incendies

## Objectif

Ajouter au panneau Feux un module pédagogique compact qui explique comment FranceMonitor et les systèmes externes observent un incendie depuis le foyer au sol jusqu'au panache, sans laisser croire que les flux MTG-FRP ou radar 3D sont déjà intégrés.

## Périmètre validé

- Ajouter un accordéon fermé par défaut dans `FiresPanel`, après « À savoir sur FIRMS » et avant le toggle NASA GIBS.
- Titre : « Observation multi-capteurs » avec un badge « EXPÉRIMENTAL ».
- Présenter quatre lignes : FIRMS VIIRS, NASA GIBS, MTG-FRP et radar Météo-France.
- Pour chaque ligne, afficher sa fonction, sa cadence ou latence et son statut dans FranceMonitor.
- Ajouter une note courte expliquant que la pyroconvection peut signaler un feu intense et une propagation plus erratique, sans transformer cette observation en diagnostic automatique.
- Ajouter un lien externe vers l'expertise scientifique collective du CNRS sur les interfaces entre incendies, villes et infrastructures.

## Contenu et statuts

| Source | Rôle affiché | Temporalité affichée | Statut |
| --- | --- | --- | --- |
| FIRMS VIIRS | Activité thermique au sol | Revisite ~1 h avec plusieurs satellites, sinon ~3 h | ACTIF |
| NASA GIBS | Fumée et cicatrices visibles | Dernière image publiée ; délai variable | ACTIF À LA DEMANDE |
| MTG-FRP | Intensité thermique et évolution rapide | Mesure toutes les 10 min ; livraison typique ~20 min, jusqu'à 45 min | NON CONNECTÉ |
| Radar Météo-France | Structure et hauteur du panache | Mesures radar toutes les 5 min ; analyse volumique requise | NON CONNECTÉ |

Les libellés de revisite FIRMS restent dynamiques à partir de `apiKeyUsed` et `sourcesInfo`, comme le bloc FIRMS actuel.

## Architecture

Le contenu sémantique sera défini dans un petit module pur et testable qui produit le modèle des quatre sources à partir du contexte FIRMS. `FiresPanel` restera responsable de la création du DOM et du style visuel. Aucun nouveau service réseau, endpoint, état global, dépendance ou stockage ne sera ajouté.

## UX et accessibilité

- Utiliser l'élément natif `<details>` avec `<summary>` afin de conserver navigation clavier et état d'ouverture natifs.
- Garder le module fermé par défaut pour préserver la priorité des filtres et incidents.
- Employer du texte, des icônes existantes et des badges explicites ; la couleur ne sera pas le seul indicateur de statut.
- Les liens externes s'ouvriront dans un nouvel onglet avec `rel="noopener noreferrer"`.
- Le module utilisera le flux vertical existant et restera compatible avec la largeur mobile du panneau.

## Gestion des données absentes

Le module ne dépend d'aucune donnée distante. Les lignes MTG-FRP et radar restent visibles avec le statut « NON CONNECTÉ », ce qui documente la capacité visée sans simuler de mesure. Aucune hauteur de panache, puissance MTG ou alerte de pyroconvection ne sera calculée.

## Tests et vérification

- Test unitaire du modèle multi-capteurs : quatre sources, ordonnées, statuts exacts et revisite FIRMS dynamique.
- Test unitaire des URLs documentaires afin qu'elles soient des liens HTTPS directs et non des redirections LinkedIn.
- Vérification manuelle : accordéon visible au bon emplacement, fermé par défaut, contenu lisible, badges non ambigus et lien CNRS fonctionnel.
- Vérifications dépôt : test ciblé, `npm run build` et `npm run typecheck`.

## Hors périmètre

- Connexion au WMS MTG-FRP.
- Téléchargement ou traitement des volumes radar Météo-France.
- Corrélation automatique FIRMS/MTG/radar.
- Détection automatique de pyroconvection ou calcul d'une hauteur de panache.
- Reproduction du post LinkedIn ou de ses images.
