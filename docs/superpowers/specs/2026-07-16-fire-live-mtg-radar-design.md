# Connexion MTG-FRP et radar 2D des incendies

## Objectif

Faire évoluer le module « Observation multi-capteurs » du panneau Feux pour afficher deux observations réellement connectées : le produit MTG-FRP de LSA SAF et la réflectivité radar 2D de Météo-France. La reconstruction volumique 3D du panache reste une capacité distincte, visible mais explicitement non connectée tant qu'un pipeline scientifique validé n'existe pas.

## Périmètre validé

- Connecter le WMS public `MTG-FRP` de LSA SAF, sans secret, par un proxy same-origin.
- Afficher le produit FRP sous forme de couche raster cartographique désactivée par défaut, avec horodatage réel, latence calculée et état de fraîcheur.
- Connecter la mosaïque nationale de réflectivité 2D de l'API Radar Météo-France lorsque l'accès `DPRadar` est configuré.
- Décoder et convertir le produit radar côté serveur/worker ; aucun BUFR n'est envoyé au navigateur.
- Afficher la réflectivité 2D sous forme de tuiles ou d'image géoréférencée, désactivée par défaut, avec horodatage et avertissement d'interprétation.
- Remplacer l'actuelle ligne radar ambiguë par deux lignes : « Réflectivité radar 2D » et « Analyse volumique 3D du panache ».
- Conserver l'analyse 3D au statut exact `NON CONNECTÉ` et ne produire aucune hauteur de panache ni diagnostic de pyroconvection.

## Vérité produit et statuts

Les statuts sont dérivés de l'état d'exécution, jamais codés comme actifs sans preuve :

| État technique | Libellé UI |
| --- | --- |
| flux chargé et suffisamment frais | `ACTIF` |
| requête en cours sans donnée précédente | `CHARGEMENT` |
| dernière donnée valide conservée au-delà du seuil de fraîcheur | `CACHE · DÉGRADÉ` |
| source implémentée mais secret ou worker absent | `CONFIGURATION REQUISE` |
| échec sans donnée exploitable | `INDISPONIBLE` |
| pipeline scientifique 3D absent | `NON CONNECTÉ` |

Une image MTG vide est une observation valide signifiant qu'aucun pixel-feu n'est visible ; elle ne doit pas être traitée comme une panne. La réflectivité radar ne prouve pas qu'un écho est de la fumée : l'interface affiche « aide à l'interprétation, sans diagnostic automatique ».

## Source MTG-FRP

### Amont

- Service : WMS public LSA SAF ADAGUC.
- Dataset : `MTG-FRP`.
- Couche : `FRP`.
- Style : `pointdata/point`.
- Projection de référence : `CRS:84`, ordre de bbox `[ouest, sud, est, nord]`.
- Cadence : 10 minutes.
- Latence attendue : typiquement 20 minutes, jusqu'à 45 minutes.
- Licence et attribution : EUMETSAT LSA SAF, CC BY 4.0.
- Statut amont : produit de démonstration ; ce caractère reste visible dans l'interface.

### Proxy

Le navigateur appelle uniquement `/api/fire-observations/mtg-frp`. Le proxy accepte une liste fermée d'opérations :

- `metadata` : lit `GetCapabilities`, extrait le temps par défaut et retourne un JSON normalisé ; cache 120 secondes.
- `map` : relaie un `GetMap` PNG transparent avec bbox, largeur et hauteur validées ; cache CDN 10 minutes avec stale-while-revalidate.
- `feature-info` : relaie un `GetFeatureInfo` JSON uniquement pour une bbox et un pixel validés ; aucune URL amont arbitraire n'est acceptée.

Le proxy refuse les bbox hors couverture, dimensions supérieures à 1024 px, formats non PNG/JSON et toute valeur d'URL ou de couche fournie par le client. Une réponse HTTP 200 contenant une exception XML WMS est convertie en erreur structurée.

### Carte

MapLibre consomme la couche raster via le proxy, avec visibilité désactivée par défaut et opacité adaptée au fond sombre. Le panneau expose un interrupteur « MTG-FRP » et affiche l'heure d'observation, l'âge et l'état du flux. Le rafraîchissement des métadonnées a lieu toutes les 10 minutes uniquement lorsque la couche Feux ou l'overlay MTG est actif, avec verrou anti-chevauchement et pause lorsque le document est masqué.

## Source radar 2D Météo-France

### Amont

- API : `https://public-api.meteofrance.fr/public/DPRadar/v1`.
- Produit : mosaïque `METROPOLE`, observation `REFLECTIVITE`, maille 1000 m, découvert dynamiquement par le catalogue de l'API.
- Cadence : 5 minutes ; rétention amont 20 heures.
- Format source : BUFR compressé.
- Licence : Licence Ouverte 2.0.
- Authentification : `METEO_FRANCE_RADAR_API_KEY`, conservée exclusivement côté serveur. `METEO_FRANCE_API_KEY` peut servir de repli seulement si cette clé est effectivement abonnée à `DPRadar`.

### Worker de conversion

Le BUFR n'est ni décodé dans le frontend ni relayé brut par Vercel. Un worker Python isolé utilise ecCodes et pyproj/GDAL pour :

1. interroger le catalogue Radar et télécharger le dernier produit de réflectivité ;
2. décoder les valeurs dBZ et la géoréférence ;
3. produire un PNG/WebP géoréférencé ou des tuiles XYZ ainsi qu'un `metadata.json` normalisé ;
4. conserver la dernière sortie valide si l'amont échoue ;
5. publier le résultat sur un stockage/CDN configuré par `METEO_FRANCE_RADAR_TILES_URL`.

Le dépôt fournit le worker, son conteneur et ses tests de parsing/métadonnées. En l'absence de clé ou d'URL de sortie, le frontend affiche `CONFIGURATION REQUISE` ; il ne bascule jamais silencieusement sur RainViewer sous l'étiquette Météo-France.

### Consommation FranceMonitor

L'endpoint `/api/fire-observations/radar-2d` relaie uniquement le manifeste JSON du worker et contrôle son origine. La carte utilise les tuiles publiées par le worker. Le panneau affiche l'heure d'observation, l'âge, la résolution 1 km et l'avertissement « réflectivité atmosphérique 2D — aide à l'interprétation du panache ».

## Modèle frontend

Un modèle commun représente l'état des deux flux :

```ts
type FireObservationRuntimeStatus =
  | 'loading'
  | 'ok'
  | 'stale'
  | 'not-configured'
  | 'error';

interface FireObservationFeedState {
  status: FireObservationRuntimeStatus;
  observedAt: number | null;
  fetchedAt: number | null;
  source: string;
  detail?: string;
}
```

`App` possède l'état d'orchestration, le transmet à `FiresPanel` et aux composants de carte, et gère les intervalles. `FiresPanel` transforme cet état en libellés accessibles. `DeckGLMap`/MapLibre reste responsable des sources raster, de leur visibilité et de leur remplacement atomique lors d'un nouveau produit.

## UX du module multi-capteurs

Le module conserve son accordéon natif. Il contient désormais cinq lignes :

1. FIRMS VIIRS — activité thermique au sol ;
2. NASA GIBS — fumée et cicatrices visibles ;
3. MTG-FRP — intensité thermique rapide, avec interrupteur et état dynamique ;
4. Réflectivité radar 2D Météo-France — aide à l'interprétation, avec interrupteur et état dynamique ;
5. Analyse volumique 3D du panache — `NON CONNECTÉ`.

Les interrupteurs utilisent des boutons accessibles avec `aria-pressed`, un libellé explicite et une zone tactile d'au moins 36 × 24 px. Le statut textuel reste lisible sans dépendre de la couleur.

## Résilience et sécurité

- Timeout, retry borné, circuit breaker et cache stale pour les métadonnées des deux sources.
- Origines amont fixées dans le code serveur ; aucune fonction de proxy générique.
- Secrets Météo-France absents du bundle client et des réponses JSON.
- Cache CDN adapté à la cadence de chaque source.
- Désactivation propre d'une couche si son manifeste devient invalide, tout en conservant la dernière donnée valide.
- Entrées Watchdog et Sources & qualité seulement pour les flux réellement interrogés.
- Aucun calcul automatique de hauteur, volume, attribution fumée/pluie ou pyroconvection.

## Tests et vérification

- Tests unitaires des parseurs `GetCapabilities`, dates, latence, état de fraîcheur et exceptions XML WMS.
- Tests des paramètres et limites du proxy MTG-FRP.
- Tests du manifeste radar, du mapping des statuts et du comportement `not-configured`.
- Tests Python du worker radar sur un petit fixture BUFR autorisé ou un fixture de valeurs décodées, sans dépendance réseau.
- Tests du modèle du panneau : cinq lignes, libellés exacts et statut 3D toujours `NON CONNECTÉ`.
- Vérification navigateur : overlays désactivés par défaut, activation/désactivation, horodatages, affichage mobile, absence de débordement et non-régression GIBS.
- Vérification dépôt : tests ciblés, suite complète, `npm run build` et `npm run typecheck`.

## Déploiement et configuration

La connexion MTG-FRP fonctionne sans secret après déploiement des endpoints Vercel. La connexion radar 2D nécessite :

- une souscription Météo-France à l'API `DPRadar` ;
- `METEO_FRANCE_RADAR_API_KEY` dans l'environnement du worker ;
- un stockage/CDN pour les images ou tuiles ;
- `METEO_FRANCE_RADAR_TILES_URL` dans FranceMonitor.

Le code et les états dégradés sont livrés dans ce périmètre. La création des comptes, l'abonnement externe, le provisionnement du stockage et le déploiement Cloud Run nécessitent des identifiants et une autorisation séparée.

## Hors périmètre

- Estimation de hauteur ou reconstruction volumique 3D.
- Fusion Trappes/Bourges ou sélection dynamique des radars autour d'un feu.
- Diagnostic automatique de fumée, de pyroconvection ou de propagation.
- Ingestion EUMETCast ou téléchargement continu des NetCDF natifs LSA SAF.
- Archivage historique au-delà du cache nécessaire à la continuité du service.
- Remplacement de la couche RainViewer existante, qui conserve son usage météo indépendant.
