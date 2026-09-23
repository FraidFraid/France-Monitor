# Audit serveur — API Vercel & caching (France Monitor)

Périmètre : `api/` (Vercel Serverless/Edge Functions), Upstash Redis, ingestion Neon. Lecture seule, aucune modification. Toutes les références sont `fichier:ligne`.

## Résumé des comptages

- **83 fichiers** sous `api/` : **55 handlers HTTP** routés (un par fichier, via `vercel.json` rewrites ou routing par dossier), **9** libs d'ingestion (`api/_lib/`), **14** modules partagés/données statiques (`api/_shared/`), **4** utilitaires transverses (`api/utils/`), 1 `.DS_Store`.
- **10/55 handlers** tournent en runtime **Edge** (`api/rss.js`, `api/exposure.js`, `api/fuel-prices-proxy.js`, `api/oil-proxy.js`, `api/rss-proxy.js`, `api/json-proxy.js`, `api/threats.js`, `api/intelligence/v1/{synthesis,summarize,france-intel-brief}.js`) ; les 45 autres sont en Node.js serverless par défaut.
- **51/55 handlers** posent un en-tête `Cache-Control`/`s-maxage` explicite. **1 gap réel** confirmé (`api/sentinel-ndwi.ts`) ; 2 faux positifs apparents (`intelligence/v1/synthesis.js` et `france-intel-brief.js` sont des endpoints **POST** cachés côté **Redis** uniquement — un `Cache-Control` HTTP serait sans effet côté CDN sur du POST) ; `api/citizen-outages.js` délègue à `api/_shared/citizen-outages-handler.js:87,98,107` qui pose bien des en-têtes.
- **13 fichiers** utilisent Redis (Upstash) : cache réponse (TTL 15 min–24 h), rate-limit fenêtre fixe, verrou anti-chevauchement cron, historique de situation, signal de santé.
- Timeout amont : couverture **très bonne** — sur les ~20 handlers vérifiés avec fetch multiples, quasiment tous posent `AbortSignal.timeout(...)`. **1 gap concret confirmé** : `api/intelligence/v1/synthesis.js:167` (appel Groq sans signal), alors que ses deux voisins du même dossier (`summarize.js`, `france-intel-brief.js`) en ont un.
- **Découverte majeure hors périmètre "latence"** : la route `/api/ministers/*` (9 sites d'appel côté client, rewrite déclarée dans `vercel.json`) n'a **aucun fichier handler** en prod — seul un module orphelin `api/_shared/ministers.js` (827 lignes, jamais importé) porte la logique, câblée uniquement au plugin Vite de dev (`src/plugins/ministers-proxy.ts:2`). Voir section 0.

---

## 0. Constat critique (hors classement latence) — route `/api/ministers/*` cassée en prod

- `src/services/ministers.ts:114,118,138,248,269-270,314-315,359,379` appelle 9 sous-routes : `/api/ministers/wikidata-search`, `/wikidata`, `/profile-meta`, `/opendata`, `/agenda`, `/prime-minister`, `/composition`.
- `vercel.json` déclare le rewrite `{ "source": "/api/ministers/(.*)", "destination": "/api/ministers/$1" }` mais **aucun fichier** `api/ministers.js` ni `api/ministers/*.js` n'existe (`find api -iname "*minister*"` ne retourne que `api/_shared/ministers.js`).
- La logique existe pourtant : `api/_shared/ministers.js` exporte `handleMinistersRequest` (827 lignes, 10 appels `fetch` vers Wikidata, Assemblée nationale, Élysée RSS, gouvernement.fr) et est câblée **uniquement** au serveur de dev via `src/plugins/ministers-proxy.ts:1-13`.
- En prod, chaque appel de `ministers.ts` retombe sur le rewrite catch-all `{"source": "/(.*)", "destination": "/index.html"}` (dernière règle de `vercel.json`) : réponse `200 text/html` au lieu de JSON → le panel ministres fonctionne en `npm run dev` et est **silencieusement mort en production** depuis un temps indéterminé (aucun test ne couvre ce chemin, cf. `tests/`).
- Correctif : créer `api/ministers/[...path].js` (ou une route par sous-chemin) qui réexporte `handleMinistersRequest`, sur le modèle 3 lignes de `api/citizen-outages.js:1-3`. **Attention** : `api/_shared/ministers.js` ne pose **aucun** `Cache-Control` nulle part (grep vide) — le correctif ne doit pas être un simple re-export, il faut aussi ajouter du cache (Redis + `s-maxage`) avant mise en prod, sinon 9 sous-routes non cachées (dont un scrape HTML `gouvernement.fr` en `api/_shared/ministers.js:590`) partent en clair à chaque appel client.
- Effort : S (re-export) + S (cache). Impact : fonctionnalité actuellement à 0 % d'usage réel, donc gain "latence perçue" nul tant que non corrigé — mais c'est un correctif de correction fonctionnelle prioritaire, distinct des optimisations de la section 6.

---

## 1. Inventaire des endpoints par domaine

### News & ingestion (5)
| Endpoint | Amont | Cache CDN | Redis | Timeout | Travail lourd/requête |
|---|---|---|---|---|---|
| `GET /api/news` (`api/news.js:169-184`) | Neon Postgres (`news_items` JOIN `feeds`) | `public, s-maxage=60, SWR=300` (news.js:181) | non | driver Neon (HTTP, pas d'AbortSignal explicite) | requête SQL paramétrée, jusqu'à 1000 lignes (`MAX_LIMIT`, news.js:16) |
| `GET /api/news/history` (`api/news/history.js:83-98`) | Neon Postgres (agrégat `GROUP BY` bucket/catégorie/sévérité) | `public, s-maxage=300, SWR=300` (history.js:95) | non | idem | agrégation SQL, fenêtre par défaut 7 j |
| `POST /api/ingest/news` (cron, `api/ingest/news.ts`) | 38 flux RSS/Atom (`api/_lib/feeds-snapshot.js`) | `no-cache` sur le fetch amont (ingest/news.ts:168), N/A côté client (cron only) | verrou `ingest_lock` NX/EX 280s (news.ts:92-93,349-361) ; `ingest:last-tick` TTL 24h (news.ts:35-36,476-477) | 10s/flux (news.ts:89) ; budget global 240s (news.ts:88) ; `maxDuration:300` (vercel.json) | 40 flux max/tick, concurrence 6 (news.ts:86-87,276-296), parsing XML, classification keyword + Groq optionnel (15/tick, news.ts:31), géocodage (30/tick) |
| `GET /api/rss` (`api/rss.js`) | flux RSS whitelistés → JSON pré-parsé serveur | `public, s-maxage=300, SWR=60` succès / `no-cache` erreur (rss.js:127,148) | via `checkRateLimit` (rate-limit.js) | Edge | parsing XML serveur (`_lib/parse-rss.js`) |
| `GET /api/rss-proxy` (`api/rss-proxy.js`) | flux RSS (XML brut, fallback client) | idem `rss.js` (rss-proxy.js:128,146) | rate-limit | `AbortSignal.timeout(8000)` (rss-proxy.js:130) | passthrough + anti-SSRF (`safeFetch`) |

Le client garde un **double chemin** : `src/services/rss.ts:1-9` documente `/api/rss` (JSON serveur) comme chemin principal, avec `/api/rss-proxy` (XML brut) conservé en fallback, plus Scrapling pour les flux Cloudflare. Le flux `news` (Neon) est un troisième chemin indépendant consommé ailleurs dans `App.ts:4341` (`fetchAllFeeds`) — à confirmer avec l'équipe frontend si les trois cohabitent réellement sur les mêmes vues ou si `news.js` a vocation à remplacer `rss.ts` à terme (cf. section 2).

### Énergie & carburants (12)
| Endpoint | Amont | Cache CDN | Redis | Timeout |
|---|---|---|---|---|
| `energy/ecowatt.js` | ODRE eco2mix | `s-maxage=900, SWR` (ecowatt.js:47) | non | 2 fetch, 2 AbortSignal |
| `energy/eolien.js` | ODRE + WFS BRGM éolien | `s-maxage=300, SWR` succès / `no-store` erreur (eolien.js:84,91,117) | non | 2/2 |
| `energy/gas-pir.js` | ENTSOG operationaldata | `s-maxage=${TTL}` dynamique (gas-pir.js:98,131) | non | 2/2 |
| `energy/biogas.js` | GRDF opendata | `s-maxage=3600, SWR` (biogas.js:34) | non | 1/1 |
| `energy/biogas-sites.js` | GRDF opendata (sites) | `s-maxage=86400, SWR=3600` (biogas-sites.js:31) | non | 1/1 |
| `energy/drom.js` | fichiers statiques `public/data/drom-energy` (lecture disque) | `s-maxage=300, SWR` (drom.js:80) | non | lecture fichier, pas de fetch réseau |
| `nuclear/rte-unavailability.js` | RTE OAuth2 + unavailability API | `s-maxage=${TTL}` (rte-unavailability.js:39,92) | non | 2/2, flow OAuth inline |
| `rte-iip.js` | 2 flux RSS RTE (IIP) | `s-maxage=600, SWR=120` (rte-iip.js:49,75,81) | non | `FETCH_TIMEOUT_MS=22_000` (rte-iip.js:24,100-101) — **le plus long timeout du repo**, runtime Node choisi exprès pour contourner un blocage réseau Edge (commentaire rte-iip.js:9-11) |
| `fuel-price-series.js` | lecture cache uniquement (503 si vide) | `no-store` si vide (fuel-price-series.js:11) / `s-maxage=900, SWR=7200` (fuel-price-series.js:20) | `francemonitor:fuel-price-series:v1` (`_lib/fuel-price-series.js:5`) | N/A (pas de fetch direct) |
| `fuel-price-series-refresh.js` (cron 3h) | agrège data.economie.gouv.fr | `no-store` (fuel-price-series-refresh.js:36,46) | écrit la même clé | `maxDuration:30` (vercel.json) |
| `fuel-prices-proxy.js` | data.economie.gouv.fr, opendatasoft | `no-cache` erreur / `s-maxage=300, SWR=60` succès (fuel-prices-proxy.js:95) | rate-limit | `AbortSignal.timeout(20_000)` (fuel-prices-proxy.js:69), Edge |
| `oil-proxy.js` | statistiques.developpement-durable.gouv.fr, INSEE | idem (oil-proxy.js:60,79) | rate-limit | `AbortSignal.timeout(30_000)` (oil-proxy.js:62), Edge |

### Finance (2)
| Endpoint | Amont | Cache CDN | Redis (clé/TTL) | Timeout |
|---|---|---|---|---|
| `finance/market.js` | TradingView Scanner API | `s-maxage=900, SWR=120` (market.js:74,133) | `fm:finance:market:v7:tv:fx4`, 900s (market.js:41-42) | 1 fetch/1 signal |
| `finance/commodities.js` | Yahoo Finance Spark API | `s-maxage=900, SWR=120` (commodities.js:33,64) | `fm:finance:commodities`, 900s (commodities.js:16-17) | `AbortSignal.timeout(10_000)` (commodities.js:44) |

Les deux instancient leur propre client `@upstash/redis` (`new Redis(...)`) plutôt que d'utiliser le wrapper *never-throw* `api/utils/redis.js` — voir section 6.

### Météo & satellite (3)
| Endpoint | Amont | Cache CDN | Redis | Timeout |
|---|---|---|---|---|
| `weather/vigilance.js` | Météo-France DPVigilance (clé serveur) | `s-maxage=300, SWR=600` (vigilance.js:41) | non | 1/1 |
| `copernicus.js` | AWS Earth Search STAC v1 (Sentinel-1/2) | `s-maxage=600, SWR=120` (copernicus.js:69) | non | 1/1 |
| `sentinel-ndwi.ts` (POST) | Copernicus Data Space (OAuth + traitement NDWI) | **aucun `Cache-Control`** — seulement CORS (sentinel-ndwi.ts:398-400) | **non** — cache **en mémoire** `Map<string, NdwiCacheEntry>` module-scope, TTL 15 min (sentinel-ndwi.ts:76,105,424-440) | 3 fetch / 3 signal |

### Feux & observation radar (4)
| Endpoint | Amont | Cache CDN | Timeout |
|---|---|---|---|
| `fires.js` | NASA FIRMS VIIRS (3 sources) ou fallback CSV public filtré serveur | `s-maxage=3600, SWR=600` (fires.js:161) | 2/2 |
| `fire-observations/mtg-frp.js` | IPMA adaguc (Meteosat FRP) | `s-maxage=120` manifest / `s-maxage=600, SWR=1800` détail (mtg-frp.js:124,161) | `FETCH_TIMEOUT_MS=10_000` (mtg-frp.js:2,96) |
| `fire-observations/radar-2d.js` | worker radar Railway (manifest) | `s-maxage=120` (radar-2d.js:137) | 10_000ms (radar-2d.js:1,125) |
| `fire-observations/radar-column.js` | worker radar Railway (profil vertical) | `s-maxage=120` (radar-column.js:148) | 10_000ms (radar-column.js:3,132) |

### Transport & trafic (7)
| Endpoint | Amont | Cache CDN | Timeout |
|---|---|---|---|
| `traffic/air.js` | relais WS ADS-B ou `_shared/air-traffic.js` (OpenSky) | délégué aux modules importés | `_shared/air-relay.js` 20s, `_shared/air-traffic.js` 12-20s (air-traffic.js:112,478,646,671) |
| `traffic/flow.js` | TomTom Flow Segment v4 | `s-maxage=60, SWR=60` (flow.js:40) | 1/1 |
| `traffic/military.js` | `_shared/military-flights.js` (OpenSky filtré) | `s-maxage=30, SWR=10` (military.js:11) | 10-12s ×3 (military-flights.js:151,169,189) |
| `traffic/road.js` | TomTom incidents | pas de header vu dans le extrait lu — **à vérifier**, clé TomTom obligatoire sinon 500 | 1/1 |
| `traffic/tile.js` | TomTom tuiles raster PNG | `s-maxage=120, SWR=300` (tile.js:47) — "le CDN absorbe la volumétrie" (tile.js:6) | non vérifié en détail (binaire) |
| `transport/disruptions.js` | SNCF API (perturbations + fiches trajet) | `public, max-age=300` (disruptions.js:214,233) — **seul endpoint en `max-age` au lieu de `s-maxage`**, donc caché aussi navigateur, pas seulement CDN | 3/3, `maxDuration:30` (vercel.json `api/transport/*.js`) ; cache mémoire interne `_cacheByMode`/`_tripStopTimesCache` (disruptions.js:15-16), enrichissement trajets concurrence 4 (disruptions.js:13) |
| `transport/osm-railways.js` | Overpass API | `public, max-age=600` (osm-railways.js:75,102) | 1/1 ; **cache en mémoire `Map()` module-scope**, TTL 10 min (osm-railways.js:7-8) — mêmes limites que `sentinel-ndwi.ts` |

### Santé (10) — toutes passent par `api/_shared/health-utils.js`
`fetchJson`/`fetchText` du helper partagé imposent un **timeout par défaut 12s** avec repli `curl` si `fetch` échoue (`health-utils.js:24,33,47,56,69-80`) : couverture timeout uniforme sur tout le domaine santé sans qu'aucun des 10 fichiers n'ait à le redéclarer.

| Endpoint | Amont | Cache CDN |
|---|---|---|
| `health/apl.js` | data.gouv.fr (DREES/IRDES CSV) + snapshot statique `_shared/apl-departements-snapshot.js` | `s-maxage=3600, SWR=600` / `s-maxage=86400, SWR=3600` (apl.js:124,140) |
| `health/departmental.js` | multi-sources DREES/SPF | `s-maxage=900, SWR=300` (departmental.js:369) |
| `health/drug-shortages.js` | ANSM (page + export HTML) | `s-maxage=1800, SWR=300` (drug-shortages.js:121) |
| `health/epidemic-alerts.js` | SPF méningocoque + ODISSE | `s-maxage=3600/900` selon branche (epidemic-alerts.js:452,474,488) |
| `health/epidemiology-monitor.js` | ODISSE | `s-maxage=14400, SWR=3600` (epidemiology-monitor.js:76) |
| `health/epidemiology.js` | DREES covid régional | `s-maxage=900, SWR=300` (epidemiology.js:230) |
| `health/hantavirus.js` | DGS-urgent + SPF + PEPS (**cheerio ×2**, `hantavirus.js:234,289`) | `s-maxage=1800, SWR=900` (hantavirus.js:683) — 3 fetch **séquentiels** 10s chacun (hantavirus.js:613,633,655), voir section 6 |
| `health/oscour-sos.js` | data.gouv.fr SURSAUD/SOS Médecins | `s-maxage=1800/300` (oscour-sos.js:234,263,274) |
| `health/sentinelles-ingestion.js` | Sentiweb RSS + indicateurs | `s-maxage=21600, SWR=3600` (sentinelles-ingestion.js:131) |
| `health/sentinelles.js` | Sentiweb API | `s-maxage=21600` / `s-maxage=900` (sentinelles.js:67,141,154) |

### Cyber / exposition infrastructure (5)
| Endpoint | Amont | Cache CDN | Redis | Timeout |
|---|---|---|---|---|
| `threats.js` (Edge) | FrenchBreaches + HIBP FR + RansomwareLive + CERT-FR + recherche-entreprises.api.gouv.fr | `s-maxage=600, SWR=120` (threats.js:23,983) | non visible | 6 fetch / 6 signal ; commentaire "cache interne 10 min" (threats.js:6) — **986 lignes, le plus gros handler direct** hors `_shared` |
| `exposure.js` (Edge) | Shodan InternetDB (sans clé) + Shodan Search + Censys (avec clés) | `s-maxage=1800, SWR=300` / `no-store` sur erreur (exposure.js:29,388) | non visible | 5/5, `maxDuration:30` |
| `arcep.js` | data.gouv.fr sites indisponibles ARCEP, fallback J-1 | `s-maxage=3600, SWR=600` (arcep.js:54,67) | non | 2/2 |
| `internet-outages.js` | IODA (Georgia Tech) + BGPView | `s-maxage=300, SWR=60` (internet-outages.js:146) | non | `fetchWithTimeout` local 6-9s ×5 (internet-outages.js:46-114) |
| `infra-network.js` | statuspage AWS/GCP + PeeringDB + snapshots statiques OSM/manuel | `s-maxage=300, SWR=60` (infra-network.js:282) | non | `fetchWithTimeout` local 8-10s ×4 (infra-network.js:26,59,81,110,141,155) ; importe `OSM_FRANCE_DATACENTERS_SNAPSHOT` (2282 lignes, 52 Ko, `_shared/osm-datacenters-snapshot.js`) |

### Autres (5)
| Endpoint | Amont | Cache CDN | Redis |
|---|---|---|---|
| `citizen-outages.js` → `_shared/citizen-outages-handler.js` (1007 lignes) | scrape multi-pages villes (cheerio + turf) | `s-maxage=600, SWR=120` global / `s-maxage=60` partiel (citizen-outages-handler.js:87,98,107) | non visible dans l'extrait |
| `intelligence/v1/summarize.js` (Edge, POST) | Groq | `no-store` HTTP (summarize.js:132,218) ; cache réel = Redis | clé non extraite, TTL `SUMMARY_CACHE_TTL=86400` (summarize.js:11) |
| `intelligence/v1/synthesis.js` (Edge, POST) | Groq | pas de header (POST) | `isnr:synthesis:fr:v2`, 900s (synthesis.js:9-10) ; **fetch Groq sans timeout** (synthesis.js:167, aucun `signal`) |
| `intelligence/v1/france-intel-brief.js` (Edge, POST) | Groq | pas de header (POST) | clé dynamique `france-intel:brief:{lang}:v13:{hash}`, 21600s=6h (france-intel-brief.js:17,44-58) |
| `situation-history.js` (Node) | aucun amont — stockage pur | `no-store` (situation-history.js:90) | `redisSetNX` par slot 6h, TTL 31j (situation-history.js:20,49) ; `redisMGet`/`redisRPush`/`redisLTrim` pour l'index |
| `health-check.js` | Redis `ingest:last-tick` + Neon `max(collected_at)` | `no-store` (health-check.js:42) | lecture seule, pas d'écriture |
| `json-proxy.js` (Edge) | api.ransomware.live, data.ransomware.live, services.nvd.nist.gov (whitelist, json-proxy.js:8) | idem pattern proxy (json-proxy.js:77,95) | rate-limit, `AbortSignal.timeout(20_000)` (json-proxy.js:79) |

---

## 2. Pipeline news

**Ingestion** (`api/ingest/news.ts`, cron `*/30 * * * *` dans `vercel.json`, `maxDuration:300`) :
1. Auth `Authorization: Bearer $CRON_SECRET` sinon 401 (news.ts:336-341).
2. Verrou Redis `ingest_lock` NX/EX 280s anti-chevauchement (news.ts:349-362) — best-effort, continue sans verrou si Redis indisponible.
3. Sync table `feeds` depuis `api/_lib/feeds-snapshot.js` — **38 flux** déclarés (`export const FEEDS = [...]`, généré par `scripts/sync-feeds.mjs` depuis `src/config/feeds.ts`, ne jamais éditer à la main).
4. Sélection des flux dus (`enabled`, `next_poll_at<=now()`, hors cooldown), max **40/tick**, tri par tier (news.ts:375-384).
5. Fetch (timeout 10s, `redirect:'follow'`) → parse XML/Atom (`_lib/parse-rss.js`) → dédup intra-flux par hash sha256 (`contentHash`) → classification keyword (`_lib/server-classifier.js`) → `INSERT ... ON CONFLICT (content_hash) DO NOTHING` en un seul batch `unnest()` par flux (news.ts:243-259) — **pool de concurrence 6** avec deadline commun 240s (news.ts:276-296).
6. Si `GROQ_API_KEY` : reclassification LLM des items `confidence<0.60`, **budget 15/tick** (news.ts:31,395-439).
7. Géocodage best-effort des items insérés, **max 30/tick** (news.ts:300-323,442).
8. Purge `> 90 jours` (news.ts:445), libération verrou, écriture stats `ingest:last-tick` (TTL 24h) consommée par `/api/health-check`.

**Lecture** :
- `GET /api/news` (`news.js:66-167`) : filtres `since/until/before` (ISO ou epoch ms), `category`, `severity` (liste `,`), `region`, `limit` (défaut 500, **plafond 1000**). SQL 100 % paramétré (`$1..$n`). Réponse `{ items, count, generatedAt }`, 14 champs/item (id, feedId, feedName, feedRegion, tier, title, link, description, publishedAt, collectedAt, category, severity, confidence, lat, lon). **Estimation payload** : ~350-500 octets/item non compressé → à `limit=500` (défaut), **~175-250 Ko** par réponse avant gzip/brotli (Vercel compresse automatiquement en sortie, donc le payload réseau réel est nettement plus petit ; taille non mesurée ici faute d'accès réseau).
- `GET /api/news/history` (`history.js:22-81`) : `date_trunc(bucket, published_at)` groupé par `(t, category, severity)`, `bucket∈{hour,day,week}`, fenêtre par défaut 7 j. Pas de pagination — le volume dépend du nombre de combos catégorie×sévérité×bucket sur la fenêtre, généralement quelques centaines de lignes max.
- 503 explicite sur les deux endpoints si `DATABASE_URL` absent — le client est censé retomber sur le fetch RSS direct (commentaire news.js:9-10).

**Double chemin confirmé** : `src/services/rss.ts:1-9` documente explicitement `/api/rss` (JSON serveur) comme chemin principal et `/api/rss-proxy` (XML brut + `DOMParser` client) comme fallback de robustesse, plus Scrapling pour 4 domaines Cloudflare (`rss.ts:26-31`). `grep` confirme que seuls `src/services/rss.ts` et `src/services/rte-iip.ts` référencent `rss-proxy`/`/api/news` dans `src/services/` — `App.ts` lui-même n'appelle directement ni `rss-proxy` ni `/api/news` par chaîne littérale (il passe par les services). Les 3 chemins (`/api/news` Neon, `/api/rss` JSON, `/api/rss-proxy` XML) coexistent donc bien en prod ; à confirmer avec l'équipe frontend s'il s'agit d'un état transitoire (migration en cours vers Neon) ou d'une redondance voulue (résilience).

---

## 3. Poids cold-start

**Dépendances lourdes** (`package.json`) et empreinte disque (`node_modules`) :

| Dépendance | Taille installée | Utilisée dans `api/` ? |
|---|---|---|
| `@huggingface/transformers` | 143 Mo | **Non** — confirmé absent de `api/` (grep vide), usage client uniquement (classifieur IA embarqué navigateur, cf. `ai-classifier.ts`) |
| `onnxruntime-web` | 133 Mo | **Non** — idem, client-only |
| `cheerio` | 1.5 Mo | Oui — `health/hantavirus.js`, `_shared/citizen-outages-handler.js` (2 handlers Node uniquement) |
| `@turf/turf` | 1.2 Mo | Oui — `_shared/citizen-outages-handler.js` seul |
| `@upstash/redis` | 972 Ko | Oui — 13 fichiers |
| `@neondatabase/serverless` | 440 Ko | Oui — `news.js`, `news/history.js`, `_lib/db.js` (→ `ingest/news.ts`, `health-check.js`) ; driver HTTP compatible Edge mais actuellement utilisé en runtime Node partout |
| `ws` | — | **Non utilisé côté `api/`** (grep vide ; probablement client/relais externe uniquement) |

Vercel bundle chaque fonction indépendamment (pas de bundle partagé), donc `transformers`/`onnxruntime-web` **n'affectent aucun cold start serveur** — seulement le bundle client. Le vrai risque cold-start est concentré sur 2 fonctions Node : `citizen-outages.js` (cheerio + turf + 1007 lignes de logique) et `hantavirus.js` (cheerio + 2 parseurs).

**Fichiers les plus volumineux** (`wc -l`) :
| Fichier | Lignes | Nature |
|---|---|---|
| `_shared/osm-datacenters-snapshot.js` | 2282 | **Donnée statique** (array JSON littéral de data centers OSM), importé uniquement par `_shared/infra-network-datacenters.js:1` → `infra-network.js` |
| `_shared/air-traffic.js` | 1136 | Logique (OpenSky, détection de signaux trafic aérien) |
| `_shared/citizen-outages-handler.js` | 1007 | Logique + cheerio + turf |
| `threats.js` | 986 | Logique cyber (le plus gros handler routé directement, pas via `_shared`) |
| `_shared/ministers.js` | 827 | Logique — **mais jamais importée**, donc hors bundle de toute fonction actuellement (voir section 0) |
| `health/hantavirus.js` | 704 | Logique + cheerio |
| `_lib/server-geocoder.js` | 524 | Géocodage (généré), utilisé par `ingest/news.ts` |
| `health/epidemic-alerts.js` | 509 | Logique |
| `intelligence/v1/france-intel-brief.js` | 492 | Prompt-building + validation JSON |
| `ingest/news.ts` | 487 | Pipeline cron |
| `_lib/server-classifier.js` | 482 | Classifieur (généré), utilisé par `ingest/news.ts` |

`osm-datacenters-snapshot.js` (52 Ko) est un candidat naturel à déplacer en JSON statique servi/caché plutôt qu'un module JS littéral parsé à chaque cold start de `infra-network.js` — impact réel probablement faible (52 Ko parse une fois par instance froide) mais gratuit à corriger, voir section 6.

**`api/_lib` / `api/_shared` partagés par plusieurs handlers** (fan-in réel, donc code réellement critique au cold start de plusieurs fonctions) :
- `_shared/health-utils.js` → **10 handlers** (`health/*`) : le module le plus réutilisé du repo.
- `_shared/departments.js` → `health/oscour-sos.js`, `health/apl.js`.
- `_lib/db.js`, `_lib/parse-rss.js`, `_lib/server-classifier.js`, `_lib/feeds-snapshot.js`, `_lib/groq-classifier.js`, `_lib/server-geocoder.js` → tous consommés par `ingest/news.ts` uniquement (+ `db.js` par `health-check.js` et `news.js`/`news/history.js` via `@neondatabase/serverless` direct, pas via `_lib/db.js`).
- `utils/redis.js` → 13 fichiers ; `utils/rate-limit.js` → 4 proxies génériques ; `utils/safe-fetch.js` → 4 proxies génériques.

**Modules `_shared` orphelins** (aucun importeur trouvé) :
- `_shared/ministers.js` (827 lignes) — voir section 0, bug de routage.
- `_shared/datacentermap-france-snapshot.js` — **1 seule ligne** (probablement un export vide/placeholder), non significatif.

---

## 4. Lacunes de caching

- **Vrai gap sans aucune couche de cache HTTP ni Redis** : `api/sentinel-ndwi.ts`. Utilise un `Map<string, NdwiCacheEntry>` **en mémoire de module** (sentinel-ndwi.ts:76), TTL 15 min (sentinel-ndwi.ts:55) — ce cache est **perdu à chaque cold start** et **non partagé entre instances Lambda concurrentes**, contrairement à tous les autres endpoints IA du repo (`summarize.js`, `synthesis.js`, `france-intel-brief.js`) qui utilisent Redis. Le call chain inclut un flow OAuth CDSE (cache token en mémoire aussi, `cdseTokenCache`, sentinel-ndwi.ts:77) + recherche STAC + traitement Sentinel Hub — probablement l'endpoint le plus coûteux en latence du repo sur cache-miss, et il a la pire stratégie de cache.
- **Même pattern** sur `api/transport/osm-railways.js:7-8` (`const cache = new Map()`, TTL 10 min) — Overpass API est un service public tiers connu pour son rate-limiting agressif ; un cache non partagé entre instances expose à des 429 Overpass inutiles.
- **`intelligence/v1/synthesis.js` et `france-intel-brief.js`** n'ont **pas** de `Cache-Control` HTTP — c'est normal et non un gap : ce sont des endpoints **POST**, jamais mis en cache par le CDN Vercel de toute façon ; le cache Redis (clé de contenu, TTL 15 min / 6 h) est la bonne stratégie ici.
- **TTL incohérents sur des sources sœurs** : `energy/biogas-sites.js` (24h, biogas-sites.js:31) vs `energy/biogas.js` (1h, biogas.js:34) — deux datasets GRDF adjacents avec des cadences de rafraîchissement très différentes ; à vérifier si volontaire (l'un est une liste de sites quasi-statique, l'autre une série temporelle) ou un oubli.
- **`transport/disruptions.js`** utilise `Cache-Control: public, max-age=300` (disruptions.js:214,233) au lieu de `s-maxage` — c'est le seul endpoint du repo à utiliser `max-age` plutôt que `s-maxage` pour un cache CDN. `max-age` est aussi respecté par le cache navigateur, ce qui est probablement voulu ici (perturbations SNCF, contenu peu sensible à la fraîcheur seconde), mais casse la convention "un seul style de directive" suivie partout ailleurs.
- **Redis instancié en double** : `finance/market.js:8-16` et `finance/commodities.js:12` créent chacun leur propre client `new Redis(...)` plutôt que de passer par `api/utils/redis.js` (wrapper *never-throw* réutilisé par les 11 autres fichiers Redis). Les deux gèrent leur propre `try/catch` (vérifié dans `commodities.js:29-38,58-61`), donc pas de risque de crash immédiat, mais c'est une deuxième implémentation à maintenir en parallèle du wrapper partagé.
- **`vercel.json` `headers`** : une seule règle CDN globale sur `/api/(.*)` — `Access-Control-Allow-Origin: *` uniquement (vercel.json headers block). Aucune règle `Cache-Control` au niveau plateforme : tout le caching CDN repose sur ce que chaque handler pose lui-même en code, sans filet de sécurité au niveau `vercel.json` pour les endpoints qui oublieraient l'en-tête.
- **Timeout manquant confirmé** : `intelligence/v1/synthesis.js:167-179`, appel `fetch(GROQ_URL, {...})` sans `signal` — ses deux fichiers voisins (`summarize.js:1`, `france-intel-brief.js`) en ont un. Sur Edge runtime, l'absence de timeout applicatif laisse la fonction dépendre de la limite plateforme (non configurable via `vercel.json` pour Edge) au lieu d'échouer proprement avec un fallback JSON rapide.

---

## 5. Opportunité de snapshot pré-agrégé

`src/App.ts` déclenche au démarrage/à l'affichage des panels une **vingtaine d'appels** distincts (`grep "await fetch" src/App.ts`, ex. lignes 1959, 4266, 4297, 4341, 4629, 4706, 4745, 4876, 4948, 5015, 5060, 5406, 5451, 5597, 5668, 5839, 5916, 6011, 6070, 6280, 6663, 6702), chacun une invocation Vercel + lookup CDN séparés.

**Bons candidats à un snapshot cron unique** (peu/pas personnalisés, cadence de rafraîchissement lente à moyenne, déjà caché plusieurs minutes chacun) :
- Bloc énergie : `ecowatt`, `eolien`, `gas-pir`, `biogas`, `biogas-sites`, `nuclear/rte-unavailability`, `rte-iip` — 7 endpoints, TTL déjà 5-60 min, tous "France entière" sans paramètre utilisateur. Un cron 10-15 min écrivant un seul objet Redis/Blob couvrirait 90 % des besoins du panel énergie en 1 requête au lieu de 7.
- Bloc santé : les 10 endpoints `health/*` sont déjà TTL 15 min-6h et non paramétrés par utilisateur (paramètres = filtres optionnels dept/région consommés côté client après coup) — bon candidat à un snapshot national unique, avec un endpoint de détail à la demande pour les vues filtrées si nécessaire.
- `finance/market.js` + `finance/commodities.js` : même cadence (15 min), même profil "France + indices globaux", pas de paramètre — fusionnables en un seul snapshot.
- `threats.js` + `exposure.js` + `arcep.js` + `internet-outages.js` + `infra-network.js` (bloc cyber/infra) : 5 endpoints, TTL 5-30 min, tous nationaux — bon candidat, sous réserve que `exposure.js` reste isolé si des clés premium (Shodan/Censys payantes) doivent rester appelées à la demande plutôt qu'en cron pour ne pas consommer le quota gratuit en continu (cf. contrainte "paliers gratuits uniquement" du projet).
- `fires.js` + `fire-observations/mtg-frp.js` + `fire-observations/radar-2d.js` : cadences déjà proches (1h/5-10min), mais `radar-2d`/`radar-column` dépendent d'un **worker externe (Railway)** qui a sa propre logique de rafraîchissement (cf. mémoire projet) — snapshot à coordonner avec ce worker plutôt qu'un cron Vercel séparé, pour éviter un troisième point d'écriture sur la même donnée.

**Mauvais candidats / à garder à la demande** :
- `citizen-outages.js` (scrape multi-pages, potentiellement volumineux — bon candidat à un cron mais **pas** à fusionner dans un snapshot générique vu son coût CPU propre, plutôt un cron dédié qui lui est propre).
- `situation-history.js` : store applicatif (POST d'écriture + lecture par plage `days`), pas un simple miroir d'amont — ne rentre pas dans le modèle "snapshot amont".
- `intelligence/v1/*` : dépendent d'un payload construit côté client à partir de l'état courant (scores, headlines) → intrinsèquement dynamiques, non pré-agrégeables sans revoir l'architecture (le payload change à chaque appel).
- `sentinel-ndwi.ts`, `copernicus.js` : paramétrés par AOI/bbox arbitraire → pas pré-agrégeables tels quels, mais bénéficieraient d'un passage à un cache Redis partagé (section 6, item 3) même sans aller jusqu'au snapshot.
- `traffic/tile.js` : tuiles raster paramétrées par z/x/y, cas d'usage CDN classique déjà bien servi par `s-maxage=120`.
- `health-check.js` : doit rester `no-store` par nature (sonde de monitoring).

---

## 6. Top 10 optimisations serveur (impact latence perçue, compatible paliers gratuits)

| # | Problème | Fichier:ligne | Changement proposé | Gain estimé | Effort |
|---|---|---|---|---|---|
| 1 | Démarrage du dashboard = ~20 requêtes Vercel indépendantes (énergie, santé, finance, cyber/infra…), chacune payant son propre aller-retour + lookup CDN | `src/App.ts:4266-6702` (liste des `await fetch`), endpoints listés section 5 | Cron (5-15 min) qui écrit un ou quelques snapshots agrégés (Redis ou Vercel Blob) par grand bloc (énergie, santé, finance, cyber/infra) ; le client charge 3-4 snapshots au lieu de ~20 endpoints | Le plus gros gain de latence perçue du repo : remplace le max(20 round-trips) par max(3-4), directement sur le temps-à-dashboard-complet | L |
| 2 | `api/sentinel-ndwi.ts` cache en mémoire de module (`Map`), perdu à chaque cold start / non partagé entre instances, alors que l'appel chaîne OAuth+STAC+traitement satellite est probablement le plus coûteux du repo | `sentinel-ndwi.ts:76,105,424-440` | Remplacer `ndwiResponseCache` par `redisGet`/`redisSet` (`api/utils/redis.js`, même pattern que `summarize.js`), garder le même TTL 15 min et la même clé de hash | Élimine les cache-miss évitables sur cold start / multi-instance ; gain net sur requêtes répétées (même AOI/date) | S |
| 3 | Même problème sur `api/transport/osm-railways.js` avec un amont (Overpass) réputé pour son rate-limiting public | `osm-railways.js:7-8` | Cache Redis partagé au lieu de `Map()` local, même TTL 10 min | Réduit le risque de 429 Overpass + accélère les cold starts qui retombent en cache-miss inutile | S |
| 4 | `api/intelligence/v1/synthesis.js` appelle Groq sans timeout, contrairement à ses 2 fichiers voisins du même dossier | `synthesis.js:167-179` | Ajouter `signal: AbortSignal.timeout(10_000)` (aligné sur `summarize.js`/`france-intel-brief.js`) | Évite qu'un Groq lent bloque la fonction Edge jusqu'à la limite plateforme au lieu d'un fallback rapide | S |
| 5 | Route `/api/ministers/*` référencée côté client (9 sites d'appel) et dans `vercel.json`, sans aucun handler prod — la logique existe mais n'est câblée qu'au dev (`_shared/ministers.js`, 827 lignes, jamais importée en prod) | `src/services/ministers.ts:114-379`, `vercel.json` (rewrite ministers), `api/_shared/ministers.js`, `src/plugins/ministers-proxy.ts:2` | Créer un handler prod (`api/ministers/[...path].js`) réexportant `handleMinistersRequest`, **+ ajouter du cache** (le module n'en a aucun) avant mise en prod | Fait passer un panel entier de 0% à 100% fonctionnel ; hors périmètre strict "latence" mais c'est le correctif à plus fort impact utilisateur du repo (voir section 0) | S–M |
| 6 | `health/hantavirus.js` fait 3 fetch **séquentiels** (10s chacun, soit jusqu'à 30s cumulés sur cache-miss) pour une donnée de surveillance qui change rarement | `hantavirus.js:613,633,655` | `Promise.all` sur les 3 fetch (déjà indépendants, aucune dépendance entre eux visible), ou basculer en cron+snapshot comme le reste du bloc santé (section 5) | Cache-miss latency ÷3 potentiellement (10s au lieu de ~30s pire cas) | S |
| 7 | `_shared/citizen-outages-handler.js` (1007 lignes, cheerio + turf) scrape potentiellement plusieurs pages villes par requête, avec un cache CDN de 600s seulement pour ce qui ressemble au handler le plus coûteux en CPU du repo | `citizen-outages-handler.js:87,98,107,436-438` | Vérifier la concurrence des fetch de pages villes ; si séquentiel, paralléliser ; sinon (ou en complément) allonger `s-maxage` ou basculer en cron dédié écrivant un snapshot (pas fusionné avec le snapshot générique, vu son profil CPU à part) | Réduit la variance de latence sur cache-miss pour un endpoint déjà identifié comme le plus lourd du repo | M |
| 8 | `osm-datacenters-snapshot.js` (2282 lignes / 52 Ko) est un array JSON littéral importé et reparsé comme module JS à chaque cold start de `infra-network.js`, plutôt qu'une donnée servie/caché | `_shared/osm-datacenters-snapshot.js`, importé par `_shared/infra-network-datacenters.js:1` | Déplacer vers `public/data/*.json` + lecture/format identique à `energy/drom.js:1-2,10` (déjà un précédent dans le repo pour ce pattern), ou pré-charger en Redis via un cron | Réduction marginale mais gratuite du temps de parse au cold start de `infra-network.js` | S |
| 9 | TTL incohérents entre deux datasets GRDF sœurs sans justification documentée | `energy/biogas.js:34` (1h) vs `energy/biogas-sites.js:31` (24h) | Documenter en commentaire pourquoi l'écart (si volontaire), sinon aligner sur la cadence réelle de mise à jour amont | Évite un excès d'appels amont sur celui des deux qui est en réalité aussi statique que l'autre (si c'est un oubli) | S |
| 10 | `finance/market.js` et `finance/commodities.js` dupliquent l'instanciation `@upstash/redis` au lieu du wrapper *never-throw* partagé, malgré une gestion d'erreur manuelle équivalente | `finance/market.js:8-16`, `finance/commodities.js:12,29-38,58-61` | Migrer vers `redisGet`/`redisSet` de `api/utils/redis.js`, comme les 11 autres fichiers Redis | Pas un gain de latence direct, mais réduit la divergence de comportement (retry, logs) entre deux implémentations Redis maintenues en parallèle | S |

Tous ces changements restent dans les paliers gratuits existants (Upstash Redis, Vercel Cron/Blob, Neon) — aucun n'implique de passer un plan payant.
