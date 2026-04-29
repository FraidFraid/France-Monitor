# Couche DROM Energy

La couche `dromEnergy` utilise une ingestion statique. Les sources distantes sont téléchargées et normalisées par `npm run ingest:drom-energy`, puis le front et l'API lisent uniquement les fichiers produits dans `public/data/drom-energy`.

## Architecture

- `public/data/drom-energy/territories.json` liste les territoires DROM suivis.
- `public/data/drom-energy/sources.json` est le catalogue unique des datasets et de leurs URLs candidates.
- `scripts/ingest-drom-energy.mjs` télécharge les sources, applique les mappings et régénère les fichiers normalisés.
- `src/services/drom-energy/static-runtime.js` centralise les chemins statiques, les garde-fous de lecture et l'assemblage du dashboard.
- `api/energy/drom.js` et `src/plugins/drom-energy-proxy.ts` exposent le même dashboard depuis les fichiers statiques.

## Ajouter Un Territoire

1. Ajouter le territoire dans `public/data/drom-energy/territories.json`.
2. Ajouter le code territoire dans `DromTerritoryCode` dans `src/services/drom-energy/types.ts`.
3. Ajouter le code dans `DROM_TERRITORY_CODES` dans `src/services/drom-energy/static-runtime.js`.
4. Mettre à jour `toDromTerritoryCode()` dans `src/services/drom-energy/sources.ts`.
5. Ajouter ce code dans `territoryCodes` des datasets concernés dans `public/data/drom-energy/sources.json`.
6. Lancer `npm run typecheck` et `npm run build`.

Les coordonnées restent toujours en `[lng, lat]`.

## Ajouter Un Dataset

1. Ajouter une entrée dans `public/data/drom-energy/sources.json` avec `id`, `label`, `family`, `geometry`, `source`, `territoryCodes`, `url` et si besoin `urls`.
2. Si une nouvelle famille est nécessaire, l'ajouter dans `DromEnergyDatasetFamily` puis dans `toDatasetFamily()`.
3. Si le dataset alimente un fichier existant, ajouter son `id` dans le dispatch de `scripts/ingest-drom-energy.mjs`.
4. Si le dataset produit un nouveau fichier statique, ajouter son chemin dans `DROM_ENERGY_STATIC_FILES` et dans les lecteurs API/proxy/service.
5. Centraliser les champs source dans `FIELD_MAPPINGS` avant d'ajouter une nouvelle règle de normalisation.
6. Régénérer avec `npm run ingest:drom-energy`.

Ne pas inventer de géométrie: un dataset tabulaire reste dans `tables/*` sauf si des coordonnées fiables sont présentes dans la source.

## Regenerer Les Fichiers Statiques

```bash
npm run ingest:drom-energy
```

Le script est idempotent: il réécrit les mêmes fichiers cibles à chaque exécution. Si une source échoue, le log indique le dataset concerné et le pipeline continue avec les autres sources.

Fichiers générés:

- `public/data/drom-energy/geo/substations.geojson`
- `public/data/drom-energy/geo/pylons.geojson`
- `public/data/drom-energy/geo/production-sites.geojson`
- `public/data/drom-energy/tables/commune-consumption.json`
- `public/data/drom-energy/tables/co2-emissions.json`
- `public/data/drom-energy/tables/production-limitations.json`
- `public/data/drom-energy/tables/efficiency-actions.json`

## Verification

Avant de considérer un changement terminé:

```bash
npm run typecheck
npm run build
```

La couche maritime et les autres couches énergie ne doivent pas importer `src/services/drom-energy/*` ni lire `public/data/drom-energy/*`.
