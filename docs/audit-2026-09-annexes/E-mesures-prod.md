# Annexe E — Mesures brutes en production (22/09/2026)

Chrome headless (DevTools Protocol), rendu WebGL logiciel, depuis Paris. Un fichier JSON par scénario a servi de source ; ci-dessous les requêtes same-origin du scénario « dashboard, bureau, cache vidé » (t de départ en ms, durée, statut, Ko transférés, état du cache CDN Vercel, URL).

```
     0    183ms  200      2KB HIT   /?view=app
   188    120ms  200    262KB HIT   /assets/index-C8x3PCOr.js
   189    104ms  200    276KB HIT   /assets/maplibre-Zm9Tf1Pn.js
   189    122ms  200    212KB HIT   /assets/deck-gl-Dsov5BYY.js
   189     61ms  200     12KB HIT   /assets/d3-D4RHrXCp.js
   189     82ms  200     10KB HIT   /assets/maplibre-DwUhsmFz.css
   189     82ms  200     27KB HIT   /assets/index-C_ZHuYkm.css
   202     98ms  200      1KB HIT   /manifest.webmanifest
   368     37ms  200      3KB HIT   /assets/workbox-window.prod.es5-BBnX5xw4.js
   378     35ms  200      5KB HIT   /assets/DromEnergyPanel-BnjLN4YI.js
   378     39ms  200      6KB HIT   /assets/HydraulicPanel-BVv2FI7e.js
   378     35ms  200      5KB HIT   /assets/EolienPanel-DHfdvnTP.js
   378     38ms  200      6KB HIT   /assets/NationalHealthPanel-DXrSoTPz.js
   379     38ms  200      3KB HIT   /assets/HealthBarometerPanel-BJtg7Yo7.js
   396     37ms  200      1KB HIT   /api/energy/ecowatt
   397     36ms  200      1KB HIT   /api/internet-outages
   398    155ms  404      0KB MISS  /api/arcep?date=2026-09-22
   399     43ms  200      2KB HIT   /api/rss?url=https%3A%2F%2Fwww.cert.ssi.gouv.fr%2Ffeed%2F
   399    154ms  502      0KB MISS  /api/json-proxy?url=https%3A%2F%2Fdata.ransomware.live%2Fposts.json
   400   1052ms  200      6KB MISS  /api/json-proxy?url=https%3A%2F%2Fservices.nvd.nist.gov%2Frest%2Fjson%2Fcves%2F2.0%3FpubStartDate%3D
   401     43ms  200     11KB HIT   /api/infra-network
   401   1061ms  200     11KB MISS  /api/threats
   401    209ms  502      0KB MISS  /api/json-proxy?url=https%3A%2F%2Fdata.ransomware.live%2Fposts.json
   401     42ms  200      2KB HIT   /api/rss?url=https%3A%2F%2Fwww.cert.ssi.gouv.fr%2Ffeed%2F
   401     41ms  200      0KB HIT   /api/exposure
   402     40ms  200     12KB HIT   /assets/FiresPanel-DZ1UpmU2.js
   402     37ms  200      2KB HIT   /assets/TrafficPanel-sapYH4CP.js
   402     38ms  200      9KB HIT   /assets/MaritimePanel-BrNaRGVW.js
   402     48ms  200      9KB HIT   /assets/CyberPanel-DlUXHBUM.js
   402     37ms  200     12KB HIT   /assets/OilPanel-IPbWO7iq.js
   402     39ms  200      2KB HIT   /assets/fuelPriceChart-CwsHgP9B.js
   402     37ms  200      7KB HIT   /assets/NuclearPanel-mPpSwiw8.js
   402     37ms  200     11KB HIT   /assets/OutagesPanel-BG-R6C36.js
   402     41ms  200      5KB HIT   /assets/DefensePanel-DTw3ng8V.js
   404     38ms  200      0KB HIT   /version.json?t=1790058138105
  2243     60ms  200     83KB HIT   /assets/DeckGLMap-BYXXWA-d.js
  2243     38ms  200      1KB HIT   /icon.svg
  2259     84ms  404      0KB MISS  /api/arcep?date=2026-09-21
  2744    125ms  200      0KB MISS  /api/intelligence/v1/synthesis
  2769     40ms  200      1KB HIT   /icon.svg
  5202     36ms  200      1KB HIT   /icon.svg
  8081      5ms  200      0KB HIT   /assets/dsfr-mapping.json
  8086      1ms  200      0KB HIT   /assets/dsfr-atlas.png
  8106      1ms  200      0KB HIT   /data/submarine-cables.json
  8552     99ms  200      0KB MISS  /api/situation-history?days=7
  8552      4ms  200      0KB HIT   /assets/SituationHistoryPanel-CQlpYD7Y.js
  8555      2ms  200      0KB HIT   /data/apl-departements.json
  8556   4755ms  200      0KB MISS  /api/news?since=2026-09-21T06%3A22%3A26.257Z&limit=1000
  8562    158ms  200      0KB MISS  /api/traffic/military
  8567    124ms  200      0KB MISS  /api/situation-history
  8567      1ms  200      0KB HIT   /data/submarine-cables.json
  8568     37ms  200      0KB HIT   /api/finance/market
  8568     38ms  200      0KB HIT   /api/finance/commodities
  8571  10719ms  200      0KB MISS  /api/traffic/air?t=1790058146270
  8572     43ms  200      0KB HIT   /api/energy/ecowatt
  8573   4725ms  200      0KB STALE /api/weather/vigilance
  8574   4724ms  200      0KB STALE /api/weather/vigilance
  8575   5410ms  200      0KB MISS  /api/json-proxy?url=https%3A%2F%2Fwww.vigicrues.gouv.fr%2Fservices%2FInfoVigiCru.geojson
  8576     38ms  200      0KB HIT   /api/nuclear/rte-unavailability
  8577    182ms  200      0KB MISS  /api/rte-iip
  8577      2ms  200      0KB HIT   /assets/military-bases-db-CKNzdAkV.js
 13265      7ms  200      0KB HIT   /assets/osm-france-military-B7txvy7D.js
 13285    112ms  200      0KB MISS  /api/situation-history?days=7
 13286     57ms  200      0KB HIT   /data/departements.geojson
 13439     87ms  200      0KB MISS  /api/intelligence/v1/summarize
 13439     69ms  200      0KB MISS  /api/intelligence/v1/summarize
 13439     93ms  200      0KB MISS  /api/intelligence/v1/summarize
 13905     12ms  200      0KB HIT   /assets/hydraulic-backbone-Q2BJG29s.js
 14066     81ms  200      0KB MISS  /api/intelligence/v1/summarize
 14067     85ms  200      0KB MISS  /api/intelligence/v1/summarize
 14067     76ms  200      0KB MISS  /api/intelligence/v1/summarize
 14267     76ms  200      0KB MISS  /api/intelligence/v1/summarize
 14268     79ms  200      0KB MISS  /api/intelligence/v1/summarize
 14268     75ms  200      0KB MISS  /api/intelligence/v1/summarize
 17709     74ms  200      0KB MISS  /api/intelligence/v1/summarize
 18133      3ms  200      0KB HIT   /data/regions.geojson
 18159    118ms  200      0KB HIT   /api/fires
 18160     38ms  200      0KB STALE /api/energy/eolien
 18161   4498ms  200      0KB MISS  /api/energy/eolien?parks=1
 18161      2ms  200      0KB HIT   /assets/transport-7o_Weeiz.js
 18167    151ms  404      0KB MISS  /api/arcep?date=2026-09-22
 18171  10485ms  200      0KB MISS  /api/traffic/air?t=1790058155870
 18174      1ms  200      0KB HIT   /assets/health-DKmCK1AY.js
 18281   2613ms  200      0KB MISS  /api/transport/disruptions?mode=active
 18283    156ms  200      0KB HIT   /api/health/epidemiology
 18284    156ms  200      0KB HIT   /api/health/sentinelles
 18284     44ms  200      0KB HIT   /api/health/epidemic-alerts
 18284    156ms  200      0KB HIT   /api/health/drug-shortages
 18284     43ms  200      0KB HIT   /api/health/departmental
 18284     54ms  200      0KB HIT   /api/health/oscour-sos
 18284     57ms  200      0KB HIT   /api/health/apl
 18284     55ms  200      0KB HIT   /api/health/epidemiology-monitor
 18284     55ms  200      0KB HIT   /api/health/sentinelles-ingestion
 18284     78ms  200      0KB HIT   /api/health/hantavirus
 18425     77ms  404      0KB MISS  /api/arcep?date=2026-09-21
 20871   5260ms  200      0KB MISS  /api/outages/citizen
 32591  10667ms  200      0KB MISS  /api/traffic/air?t=1790058170276
 43575     48ms  200      0KB STALE /api/traffic/military
 44588       ms           0KB -     /api/traffic/air?t=1790058182275
```

Appels externes (hôte + motif de chemin, nombre, durée moyenne) :

```
  88 x    55ms  geo.api.gouv.fr/communes
  26 x   153ms  api-adresse.data.gouv.fr/search/
  23 x   215ms  hubeau.eaufrance.fr/api/v2/hydrometrie/referentiel/stations
   8 x   111ms  odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records
   2 x    21ms  tiles.basemaps.cartocdn.com/fonts/Montserrat%20Medium,Open%20Sans%20Bold,Noto%20Sans%20Regular,Ha
   2 x   914ms  hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr
   2 x   142ms  odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-metropoles-tr/records
   1 x   116ms  services.swpc.noaa.gov/json/planetary_k_index_1m.json
   1 x    20ms  basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json
   1 x   115ms  tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json
   1 x   115ms  tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite.json
   1 x   113ms  tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/sprite.png
   1 x    21ms  tiles.basemaps.cartocdn.com/fonts/Montserrat%20Regular%20Italic,Open%20Sans%20Italic,Noto%20Sans%
   1 x    20ms  tiles.basemaps.cartocdn.com/fonts/Montserrat%20Medium%20Italic,Open%20Sans%20Italic,Noto%20Sans%2
   1 x   142ms  api.rainviewer.com/public/weather-maps.json
   1 x  9142ms  odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-regional-tr/records
   1 x    27ms  tiles.basemaps.cartocdn.com/fonts/Open%20Sans%20Bold/0-N.pbf
   1 x   179ms  opendata.enedis.fr/api/explore/v2.1/catalog/datasets/indicateur-continuite-dalimentation
   1 x   179ms  opendata.enedis.fr/api/explore/v2.1/catalog/datasets/frequence-moyenne-de-coupure-par-cl
   1 x   179ms  opendata.enedis.fr/api/explore/v2.1/catalog/datasets/duree-moyenne-de-coupure-bt/records
```

Métriques navigateur par scénario :

| Scénario | Requêtes | Ko | FCP | DCL | Tâches longues | Script (s) | Tâches (s) | Nœuds DOM | Écouteurs | Heap Mo |
|---|---|---|---|---|---|---|---|---|---|---|
| desktop-cold | 19 | 28750 | 5788 ms | 308 ms | 1 | 0.04 | 0.75 | 177 | 10 | 8 |
| app-desktop-cold | 317 | 1486 | 4316 ms | 2244 ms | 52 | 13.64 | 28.93 | 14549 | 8033 | 89 |
| app-desktop-warm | 281 | 91 | 552 ms | 348 ms | 43 | 8.97 | 18.88 | 14553 | 7063 | 103 |
| app-mobile-cold | 221 | 114 | 5932 ms | 149 ms | 8 | 0.1 | 15.82 | 14828 | 23666 | 56 |
| throttled-desktop-cold | 308 | 1469 | 5712 ms | 3004 ms | 152 | 16.04 | 56.55 | 14570 | 9027 | 101 |
