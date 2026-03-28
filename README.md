# France-Monitor

Tableau de bord de conscience situationnelle temps réel centré sur la France, avec carte interactive, flux d'actualités géolocalisées, vigilance météo, Vigicrues, énergie, transports et couches OSINT.

## Statut Sentinel

France Monitor supporte actuellement un flux `Sentinel-2` orienté `avant / apres` sur zone de crue via l'endpoint STAC Copernicus déjà branché dans le repo.

`Sentinel-1 SAR` n'est pas encore visualisé proprement in-app. Cette brique nécessite un backend raster dédié, ou un produit flood dérivé exploitable, pour fournir des tuiles ou des extraits réellement centrés sur l'événement. Le projet ne conservera pas de faux viewer SAR basé sur de simples thumbnails catalogue.

Le chantier Phase 2 associé consiste à brancher une source tuilée `Sentinel-1 / Sentinel-2` proprement consommable dans la carte :

- option `Sentinel Hub`
- option `microservice raster` type `TiTiler / GDAL`
- option `produits flood officiels`
