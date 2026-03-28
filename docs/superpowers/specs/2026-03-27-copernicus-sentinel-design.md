---
name: Copernicus / Sentinel satellite imagery — MVP
description: Intégration imagerie satellite Sentinel-2 (avant/après) et Sentinel-1 SAR (crues) via AWS Earth Search STAC public, avec fallback EO Browser deep-link systématique.
type: spec
date: 2026-03-27
status: approved
---

# Spec — Imagerie satellite Copernicus / Sentinel (MVP)

> Mise à jour du 28 mars 2026 :
> le flux `Sentinel-1 SAR` a été gelé côté viewer in-app tant qu'un backend raster dédié n'est pas branché.
> Le chemin produit court terme est désormais : `Vigicrues -> Sentinel-2 avant / apres`, avec `Sentinel-1` documenté comme dépendance de Phase 2 et non comme preview catalogue.

## Contexte

France Monitor dispose d'une couche Vigicrues (tronçons crues) et de news géolocalisées. L'objectif est d'ajouter un CTA « Voir satellite » sur ces deux sources d'événements, ouvrant un panneau léger qui affiche une preview d'imagerie Sentinel-2 (avant/après visible si 2 scènes pertinentes) ou Sentinel-1 SAR (crues, nuages, nuit). Le fallback systématique est un deep-link EO Browser / Copernicus Browser centré sur la bbox de l'événement.

Aucun secret (credentials Copernicus) n'est requis pour la feature par défaut. L'architecture est préparée pour activer un overlay raster WMS SentinelHub quand `COPERNICUS_CLIENT_ID` + `COPERNICUS_CLIENT_SECRET` seront fournis (Approche C, hors scope MVP).

---

## Périmètre MVP

| Inclus | Exclus |
|---|---|
| Bouton « Voir satellite » sur popups crues + news géolocalisées | Overlay raster in-map (SentinelHub WMS) |
| Preview thumbnail Sentinel-2 (avant/après) via STAC public | SatellitePanel mobile |
| Preview thumbnail Sentinel-1 SAR via STAC public | Téléchargement scènes haute-résolution |
| Fallback EO Browser deep-link systématique | Comparateur split-screen |
| Proxy Vercel + plugin Vite sans auth | Gestion de compte Copernicus |

---

## Architecture

### Vue d'ensemble du flux

```
[User clicks "🛰️ Voir satellite"]
     │
     ├─ source: flood popup (DeckGLMap.ts)
     │    bbox ← extent(geometry) + 0.02° padding
     │    preferredCollection: 'sentinel-1-grd'
     │
     └─ source: news popup (MapPopup.ts)
          bbox ← point ± 0.08° (~8 km)
          preferredCollection: 'sentinel-2-l2a'
     │
     ▼
 SatelliteViewRequest {
   bbox, sourceType, title?, point?, geometry?, preferredCollection?
 }
     │
     ▼  (callback onSatelliteView — passé par App.ts)
 SatellitePanel.show(req)
     │
     ├─ GET /api/copernicus?collection=sentinel-2-l2a&bbox=...  ─► AWS Earth Search STAC v1
     ├─ GET /api/copernicus?collection=sentinel-1-grd&bbox=...  ─► AWS Earth Search STAC v1
     │   └─ Thumbnails : URLs S3 publiques (aucune auth)
     │
     └─ EO Browser URL (toujours calculé, toujours affiché)
```

### Ownership des composants

- **`App.ts`** : instancie `SatellitePanel`, fournit le callback `onSatelliteView` à `DeckGLMap` et `MapPopup`
- **`MapContainer.ts`** : wrapper carte uniquement — relaye `onSatelliteView` si nécessaire, mais n'instancie rien
- **`DeckGLMap.ts`** : flood popup inline, ajoute bouton + compute bbox, appelle callback
- **`MapPopup.ts`** : news popup, ajoute bouton pour items géolocalisés, appelle callback

---

## Fichiers créés

| Fichier | Rôle |
|---|---|
| `src/services/copernicus.ts` | STAC search, bbox helpers, EO Browser URL builder |
| `src/plugins/copernicus-proxy.ts` | Vite dev proxy `/api/copernicus` |
| `api/copernicus.js` | Vercel serverless function → AWS Earth Search |
| `src/components/SatellitePanel.ts` | Floating overlay léger, DOM natif |

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `src/types/index.ts` | +4 types Copernicus |
| `src/components/DeckGLMap.ts` | Bouton flood popup + compute bbox + callback property |
| `src/components/MapPopup.ts` | Bouton item popup (items géolocalisés seulement) |
| `src/components/MapContainer.ts` | Relaye `onSatelliteView` si besoin |
| `src/App.ts` | Instancie `SatellitePanel`, câblage callbacks |
| `src/styles/main.css` | Styles `.satellite-panel` |

---

## Types (`src/types/index.ts`)

```typescript
import type { LineString, MultiLineString } from 'geojson';
// (LineString et MultiLineString sont déjà importés dans types/index.ts — ne pas dupliquer l'import)

// ═══ Copernicus / Satellite ═══

export type SatelliteCollection = 'sentinel-2-l2a' | 'sentinel-1-grd';
export type SatelliteSourceType = 'news' | 'flood';

export interface CopernicusScene {
  id: string;
  datetime: string;              // ISO 8601
  cloudCover?: number;           // 0–100; undefined pour SAR
  thumbnailUrl?: string;         // URL S3 publique — optionnel car absent sur certains items S1 GRD
  bbox: [number, number, number, number];  // [minLng, minLat, maxLng, maxLat]
  collection: SatelliteCollection;
}

export interface SatelliteViewRequest {
  bbox: [number, number, number, number];
  sourceType: SatelliteSourceType;
  title?: string;
  point?: [number, number];              // [lng, lat] si source news
  geometry?: LineString | MultiLineString;  // si source flood — types nommés, pas namespace GeoJSON
  preferredCollection?: SatelliteCollection;
}

// État interne de SatellitePanel — utilisé comme type de `private state` dans le composant
export interface SatelliteViewState {
  visible: boolean;
  request: SatelliteViewRequest | null;
  activeCollection: SatelliteCollection;
  s2Scenes: CopernicusScene[];
  s1Scenes: CopernicusScene[];
  activeSceneIndex: number;  // index dans la collection active
  loading: boolean;
  error: string | null;
  eoBrowserUrl: string;
}
```

**Règles d'import** :
- `LineString` et `MultiLineString` sont déjà importés via `import type { LineString, MultiLineString } from 'geojson'` en tête de `types/index.ts`. Ne pas utiliser la forme namespace `GeoJSON.LineString`.
- Aucun `any`. Pas de nouvel import de package.

---

## Backend : `api/copernicus.js`

### Contrat

```
GET /api/copernicus
  ?collection=sentinel-2-l2a|sentinel-1-grd  (obligatoire)
  &bbox=minLng,minLat,maxLng,maxLat           (obligatoire)
  &limit=5                                    (optionnel, défaut 5)
  &cloud_max=30                               (optionnel, S2 seulement, défaut 30)
```

### Réponse succès

```json
{
  "scenes": [
    {
      "id": "S2B_32ULD_20240315_0_L2A",
      "datetime": "2024-03-15T10:22:00Z",
      "cloudCover": 8.3,
      "thumbnailUrl": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/.../thumbnail.jpg",
      "bbox": [2.2, 48.8, 2.4, 49.0],
      "collection": "sentinel-2-l2a"
    }
  ],
  "eoBrowserUrl": "https://browser.dataspace.copernicus.eu/?...",
  "mode": "thumbnail"
}
```

Pour les items STAC où `assets.thumbnail` est absent (fréquent pour S1 GRD) : inclure l'item dans la réponse **sans** `thumbnailUrl` (champ omis). Le client gère l'absence via le fallback icône satellite.
```

Si `COPERNICUS_CLIENT_ID` + `COPERNICUS_CLIENT_SECRET` sont définis → ajouter `"mode": "wms"` et `"wmsUrl": "..."` dans la réponse (upgrade path C). Aujourd'hui : `mode` est toujours `"thumbnail"`.

### Réponse STAC vide / erreur upstream

```json
{
  "scenes": [],
  "eoBrowserUrl": "https://browser.dataspace.copernicus.eu/?...",
  "mode": "thumbnail",
  "fallbackReason": "stac_empty"  // ou "stac_error", "invalid_bbox"
}
```

**Jamais de 5xx pour le client** : le backend absorbe les erreurs STAC et retourne toujours un objet valide avec `eoBrowserUrl` utilisable.

### Validation

- `bbox` : 4 floats, `minLng` ∈ [-180,180], `minLat` ∈ [-90,90], extent max 5° (protection)
- `collection` : whitelist stricte `['sentinel-2-l2a', 'sentinel-1-grd']`
- `limit` : entier, max 10
- Paramètres manquants ou invalides → `400` avec message clair

### Cache

```
Cache-Control: s-maxage=600, stale-while-revalidate=120
```

### Upstream STAC

**Approche primaire — GET simple** (moins de support CQL2 mais plus robuste) :
```
GET https://earth-search.aws.element84.com/v1/collections/{collection}/items
  ?bbox={bbox}
  &datetime={dateRange}
  &limit={limit}
  &sortby=-datetime
```
Filtrage `cloud_cover` appliqué **côté serveur** (après fetch) si le filtre CQL2 GET est capricieux.

**Approche alternative — POST /search** (si filtres GET insuffisants) :
```
POST https://earth-search.aws.element84.com/v1/search
Content-Type: application/json

{
  "collections": ["{collection}"],
  "bbox": [minLng, minLat, maxLng, maxLat],
  "datetime": "{dateRange}",
  "limit": {limit},
  "sortby": [{ "field": "datetime", "direction": "desc" }],
  "filter": { "op": "<=", "args": [{ "property": "eo:cloud_cover" }, {cloud_max}] },
  "filter-lang": "cql2-json"
}
```

**Règle d'implémentation** : commencer par le GET simple. Si le filtre cloud_cover CQL2 GET ne fonctionne pas en test, basculer sur POST /search. Filtrer le cloud cover côté backend (`api/copernicus.js`) si nécessaire.

Timeout : `AbortSignal.timeout(10000)`. En cas d'erreur réseau : `scenes: []`, pas de throw.

---

## Service frontend : `src/services/copernicus.ts`

### API publique

```typescript
// Fetch scènes Sentinel-2 (retourne [] en cas d'erreur)
export async function fetchSentinel2Scenes(
  bbox: [number, number, number, number],
  eventDate?: Date
): Promise<CopernicusScene[]>

// Fetch scènes Sentinel-1 SAR (retourne [] en cas d'erreur)
export async function fetchSentinel1Scenes(
  bbox: [number, number, number, number]
): Promise<CopernicusScene[]>

// Construit l'URL EO Browser (aucun fetch, pur calcul)
export function buildEoBrowserUrl(
  bbox: [number, number, number, number],
  collection: SatelliteCollection,
  date?: Date
): string

// Calcule la bbox autour d'un point news
export function computeNewsItemBbox(
  lat: number,
  lon: number
): [number, number, number, number]

// Calcule la bbox à partir d'une géométrie Vigicrues
// Utiliser les types nommés importés depuis 'geojson', pas la forme namespace GeoJSON.*
export function computeFloodSegmentBbox(
  geometry: LineString | MultiLineString,
  paddingDeg?: number  // défaut 0.02
): [number, number, number, number]
```

### Heuristiques de sélection des scènes

#### Sentinel-2 — sélection "après" (référence récente post-événement)
1. Trier par `datetime` décroissant
2. Prendre la scène la plus récente avec `cloudCover ≤ 30`
3. Si aucune avec cloudCover ≤ 30 → prendre la moins nuageuse disponible (avec note dans l'UI)
4. Si aucune scène → `null` (deep-link only)

#### Sentinel-2 — sélection "avant" (référence antérieure)
1. Sur les scènes disponibles (retournées par STAC avec fenêtre étendue), exclure les 30 derniers jours
2. Prendre la scène la moins nuageuse dans cette fenêtre
3. Si aucune → pas de toggle Avant/Après (scène unique affichée)
4. Fenêtre de recherche "avant" : `[date_événement - 12 mois, date_événement - 30 jours]`

#### Sentinel-1 SAR — sélection scène unique
1. Trier par `datetime` décroissant
2. Prendre la scène la plus récente sur la bbox
3. Pas de toggle Avant/Après pour S1 dans ce MVP
4. Si aucune scène → `null` (deep-link only)

#### Fenêtres temporelles par défaut
- `eventDate` non fourni → `now` est utilisé comme date de référence
- Fenêtre "après" : `[eventDate - 7 jours, now]`
- Fenêtre "avant" : `[eventDate - 12 mois, eventDate - 30 jours]`
- S1 : `[now - 60 jours, now]` (S1 a une répétitivité ~6j)

### URL EO Browser

```
Sentinel-2 :
https://browser.dataspace.copernicus.eu/?zoom=12&lat={centerLat}&lng={centerLng}&datasetId=S2L2A&toTime={date}T23:59:59.000Z&cloudCoverage=30

Sentinel-1 SAR :
https://browser.dataspace.copernicus.eu/?zoom=12&lat={centerLat}&lng={centerLng}&datasetId=S1GRD
```

**Paramètre `date`** : si `date` est omis à l'appel, `buildEoBrowserUrl` utilise `new Date()` (aujourd'hui) comme valeur de `toTime`. Cette valeur doit toujours être présente dans l'URL S2 pour éviter un landing sur une date indéterminée. Pour S1, `toTime` est omis car EO Browser sélectionne la dernière scène disponible par défaut.

Zoom calculé en fonction de la taille de la bbox (bbox < 0.2° → zoom 13 ; < 1° → zoom 11 ; < 3° → zoom 9).

---

## Plugin Vite : `src/plugins/copernicus-proxy.ts`

Pattern identique aux autres plugins du projet. Dupliquer la logique de validation et de proxy depuis `api/copernicus.js` (pas de helper partagé dans ce projet — chaque plugin est autonome, comme les Vercel functions).

```typescript
import type { Plugin } from 'vite';

export function copernicusProxy(): Plugin {
  return {
    name: 'copernicus-proxy',
    configureServer(server) {
      server.middlewares.use('/api/copernicus', async (req, res) => {
        const url = new URL(req.url!, 'http://localhost');
        const collection = url.searchParams.get('collection');
        const bboxStr = url.searchParams.get('bbox');
        const limit = parseInt(url.searchParams.get('limit') ?? '5', 10);
        const cloudMax = parseInt(url.searchParams.get('cloud_max') ?? '30', 10);

        // Validation identique à api/copernicus.js
        const ALLOWED = ['sentinel-2-l2a', 'sentinel-1-grd'];
        if (!collection || !ALLOWED.includes(collection) || !bboxStr) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid parameters' }));
          return;
        }

        // Proxy vers AWS Earth Search STAC v1
        // (même logique que api/copernicus.js)
        try {
          const stacUrl = buildStacUrl(collection, bboxStr, limit, cloudMax);
          const upstream = await fetch(stacUrl, { signal: AbortSignal.timeout(10000) });
          const json = await upstream.json();
          const scenes = mapStacFeatures(json.features ?? [], collection);
          const eoBrowserUrl = buildEoBrowserUrlFromParams(bboxStr, collection);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ scenes, eoBrowserUrl, mode: 'thumbnail' }));
        } catch {
          const eoBrowserUrl = buildEoBrowserUrlFromParams(bboxStr ?? '', collection);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ scenes: [], eoBrowserUrl, mode: 'thumbnail', fallbackReason: 'stac_error' }));
        }
      });
    },
  };
}
```

Les fonctions helpers `buildStacUrl`, `mapStacFeatures`, `buildEoBrowserUrlFromParams` sont définies dans le même fichier plugin (duplication intentionnelle, consistante avec les autres plugins du projet).

---

## Composant : `src/components/SatellitePanel.ts`

### Responsabilité

Floating overlay DOM natif positionné en haut à droite du container carte. Indépendant de `MapContainer` et `DeckGLMap`. Cycle de vie géré par `App.ts`.

### API publique

```typescript
class SatellitePanel {
  // État interne — type SatelliteViewState (défini dans types/index.ts)
  private state: SatelliteViewState;
  private abortController: AbortController | null = null;

  constructor(parentEl: HTMLElement)
  show(req: SatelliteViewRequest): void   // démarre le fetch + affiche le panel
  hide(): void
  destroy(): void                         // cleanup DOM + listeners

  // Callback pour upgrade Approche C (set depuis App.ts)
  onWmsRequested?: (wmsUrl: string, bbox: [number, number, number, number]) => void
}
```

`SatelliteViewState` est utilisé comme type du champ `private state` dans `SatellitePanel`. C'est le seul consommateur de ce type dans ce MVP.

### États d'affichage

1. **loading** : spinner + "Recherche scènes Sentinel…"
2. **loaded-with-scenes** : thumbnail + métadonnées + toggle éventuel
3. **loaded-empty** : "Aucune scène disponible pour cette zone" + bouton EO Browser uniquement
4. **error** : "Erreur de chargement" + bouton EO Browser uniquement

### Layout

```
┌────────────────────────────────┐  width: 320px
│ 🛰️ Vue satellite        [✕]   │  padding: 12px
├────────────────────────────────┤
│  {title de l'événement}        │  texte gris, max 2 lignes
├────────────────────────────────┤
│  [Sentinel-2 ▼]  [SAR S-1 ▼]  │  ← toggle collection (boutons)
├────────────────────────────────┤
│                                │
│  [ <img> 296×200 object-fit ]  │  lazy + fallback icône si 404
│  🗓️ 15 mars 2024 · ☁️ 8%       │  métadonnées scène
│                                │
│  [◀ Avant]      [Après ▶]      │  seulement si 2 scènes S2 dispo
│                                │
├────────────────────────────────┤
│  ↗ Ouvrir dans EO Browser      │  lien external, toujours visible
└────────────────────────────────┘
```

### Mobile

Sur écran `< 768px` : le panneau ne s'affiche pas. Le callback `onSatelliteView` ouvre directement `window.open(eoBrowserUrl, '_blank')`. Aucun code SatellitePanel mobile n'est implémenté dans ce MVP.

### Cleanup

```typescript
destroy(): void {
  // Annuler fetch en cours (AbortController)
  // Supprimer tous les event listeners (boutons, clavier, outside-click si applicable)
  // Retirer l'élément du DOM
  // Mettre les refs à null
}
```

Pas de listener orphelin entre deux appels `show()`. Chaque `show()` annule le fetch précédent si encore en cours.

---

## Intégration `DeckGLMap.ts` (flood popup)

### Propriété publique ajoutée

```typescript
onSatelliteView: ((req: SatelliteViewRequest) => void) | null = null;
```

### Modification du flood click handler (ligne ~4514)

1. **Null-guard + type-guard sur la géométrie** avant tout calcul :
   ```typescript
   const geom = feat.geometry;
   const hasLineGeom = geom !== null &&
     (geom.type === 'LineString' || geom.type === 'MultiLineString');
   ```
2. Calculer la bbox :
   - Si `hasLineGeom` : `computeFloodSegmentBbox(geom as LineString | MultiLineString)` depuis `copernicus.ts`
   - Sinon (fallback) : `[e.lngLat.lng - 0.05, e.lngLat.lat - 0.05, e.lngLat.lng + 0.05, e.lngLat.lat + 0.05] as [number, number, number, number]`
3. Ajouter dans le HTML du popup **si `this.onSatelliteView !== null`** :
   ```html
   <button class="satellite-cta-btn" data-action="satellite">
     🛰️ Voir satellite
   </button>
   ```
4. Après `.addTo(this.map)`, sélectionner le bouton **via `popupInst.getElement()`** (ciblage scoped, pas `document.querySelector`) :
   ```typescript
   const popupInst = new maplibregl.Popup(...)
     .setLngLat(e.lngLat)
     .setHTML(html)
     .addTo(this.map);

   // Cibler via getElement() pour éviter de matcher d'autres instances ouvertes
   const btnEl = popupInst.getElement().querySelector('[data-action="satellite"]');
   btnEl?.addEventListener('click', (ev) => {
     ev.stopPropagation();
     this.onSatelliteView?.({
       bbox,
       sourceType: 'flood',
       title: p.name || 'Tronçon Vigicrues',
       geometry: hasLineGeom ? (geom as LineString | MultiLineString) : undefined,
       preferredCollection: 'sentinel-1-grd',
     });
   }, { once: true });
   ```
   Utiliser `{ once: true }` pour éviter les listeners orphelins si le popup est réaffiché.
5. Pas de refactor du popup crues vers `MapPopup.ts` dans ce MVP.

**Import à ajouter dans `DeckGLMap.ts`** :
```typescript
import type { LineString, MultiLineString } from 'geojson';
import { computeFloodSegmentBbox, buildEoBrowserUrl } from '../services/copernicus.ts';
import type { SatelliteViewRequest } from '../types/index.ts';
```
(Vérifier si `LineString`/`MultiLineString` sont déjà importés avant d'ajouter.)

---

## Intégration `MapPopup.ts` (news items)

### Propriété et setter ajoutés

Utiliser un **setter method** pour être cohérent avec le pattern existant de `MapPopup` (`setOnItemClick`, `setOnClusterItemClick`, `setOnClusterExpand`) :

```typescript
private onSatelliteView: ((req: SatelliteViewRequest) => void) | null = null;
setOnSatelliteView(handler: (req: SatelliteViewRequest) => void): void {
  this.onSatelliteView = handler;
}
```

`App.ts` appelle `mapPopup.setOnSatelliteView(openSatelliteView)` (pas d'assignation directe de propriété publique).

### Modification de `show(item, x, y)`

- Condition : `item.lat != null && item.lon != null`
- Ajouter `<button class="satellite-inline-btn" data-action="satellite">🛰️ Satellite</button>` dans `.map-popup-action`

### Modification du handler `click` existant dans le constructeur

Le handler existant en mode `item` est :
```typescript
if (this.mode === 'item') {
  if (this.currentItem && this.onItemClick) {
    this.onItemClick(this.currentItem);
    this.hideNow();
  }
  return;
}
```

**Remplacer** cette branche par :
```typescript
if (this.mode === 'item') {
  // Satellite button takes priority over article open
  if (target.closest('[data-action="satellite"]')) {
    e.stopPropagation();
    if (this.currentItem?.lat != null && this.currentItem?.lon != null && this.onSatelliteView) {
      const bbox = computeNewsItemBbox(this.currentItem.lat, this.currentItem.lon);
      this.onSatelliteView({
        bbox,
        sourceType: 'news',
        title: this.currentItem.title,
        point: [this.currentItem.lon, this.currentItem.lat],
        preferredCollection: 'sentinel-2-l2a',
      });
    }
    return;  // Do NOT call onItemClick or hideNow
  }
  // Default: open article
  if (this.currentItem && this.onItemClick) {
    this.onItemClick(this.currentItem);
    this.hideNow();
  }
  return;
}
```

**Import à ajouter dans `MapPopup.ts`** :
```typescript
import { computeNewsItemBbox } from '../services/copernicus.ts';
import type { SatelliteViewRequest } from '../types/index.ts';
```

---

## Intégration `App.ts`

```typescript
// Après init de la carte (mapReady callback ou équivalent) :
const satellitePanel = new SatellitePanel(document.getElementById('app')!);

const openSatelliteView = (req: SatelliteViewRequest): void => {
  // Mobile guard — deep-link direct, pas de panel
  if (window.innerWidth < 768) {
    const eoBrowserUrl = buildEoBrowserUrl(
      req.bbox,
      req.preferredCollection ?? 'sentinel-2-l2a',
      new Date()   // ← date explicite : évite un toTime manquant dans l'URL S2
    );
    window.open(eoBrowserUrl, '_blank', 'noopener');
    return;
  }
  satellitePanel.show(req);
};

// Wiring — App.ts ne manipule pas deckGLMap directement, il passe par mapContainer
// mapContainer délègue à deckGLMap.onSatelliteView en interne (cf. section MapContainer.ts)
mapContainer.onSatelliteView = openSatelliteView;
mapPopup.setOnSatelliteView(openSatelliteView);
```

`satellitePanel.destroy()` est appelé dans le `destroy()` global de l'app si existant.

---

## Intégration `MapContainer.ts`

`MapContainer` ne touche pas `SatellitePanel`. Il expose une propriété publique qu'il délègue à `DeckGLMap` **à l'intérieur de `init()`, après que `deckMap` a été créé** — ceci évite la race condition où `App.ts` assigne le callback avant que `deckMap` existe :

```typescript
// Dans MapContainer :
onSatelliteView: ((req: SatelliteViewRequest) => void) | null = null;

async init(): Promise<void> {
  this.deckMap = new DeckGLMap(this.container);
  await this.deckMap.init();
  // Propager le callback s'il a été assigné avant init()
  if (this.onSatelliteView) {
    this.deckMap.onSatelliteView = this.onSatelliteView;
  }
}
```

Ou, si `App.ts` assigne `mapContainer.onSatelliteView` **après** `await mapContainer.init()`, l'implémentation peut être un simple setter qui délègue directement :

```typescript
set onSatelliteView(handler: ((req: SatelliteViewRequest) => void) | null) {
  this._onSatelliteView = handler;
  if (this.deckMap) this.deckMap.onSatelliteView = handler;
}
```

**Règle** : la délégation vers `deckMap.onSatelliteView` doit être garantie, que l'assignation se fasse avant ou après `init()`. Choisir l'une des deux approches ci-dessus selon le flux réel de `App.ts`.

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| Aucune | — | MVP fonctionnel sans aucun secret |
| `COPERNICUS_CLIENT_ID` | Non | OAuth2 CDSE — active le mode WMS (Approche C future) |
| `COPERNICUS_CLIENT_SECRET` | Non | OAuth2 CDSE — activate le mode WMS (Approche C future) |

Si les deux variables sont absentes : `api/copernicus.js` ne tente aucune auth et retourne `mode: 'thumbnail'`.

---

## Upgrade path vers Approche C (hors scope MVP)

Quand les deux secrets sont fournis :

1. `api/copernicus.js` récupère un access token via `POST https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token`
2. Construit un WMS URL template SentinelHub avec le token
3. Ajoute `{ mode: 'wms', wmsUrl: '...' }` dans la réponse
4. `SatellitePanel` détecte `mode === 'wms'` et appelle `onWmsRequested(wmsUrl, bbox)`
5. `App.ts` délègue à une méthode `DeckGLMap.addSentinelOverlay(wmsUrl, bbox)` (à implémenter lors de l'Approche C)

Aujourd'hui : le client ignore simplement `wmsUrl` si absent.

---

## Robustesse et dégradations

| Scénario | Comportement |
|---|---|
| AWS Earth Search timeout | `scenes: []`, EO Browser uniquement |
| S3 thumbnail 404 | `<img>` remplacé par icône satellite + EO Browser |
| bbox trop grande | `api/copernicus.js` rejette avec 400 (> 5° d'extent) |
| Géométrie tronçon vide | Fallback bbox autour de `e.lngLat` |
| Aucune scène S2 pertinente | Afficher meilleure scène disponible quelle que soit cloudCover + indication |
| Sentinel-1 thumbnails absents | Si tous les items S1 ont `thumbnailUrl` absent/inutilisable : désactiver l'onglet SAR et afficher EO Browser deep-link S1 uniquement |
| Mobile | `window.open(eoBrowserUrl)` direct, pas de panel |
| Fetch annulé (panel refermé) | `AbortController.abort()`, pas de setState post-unmount |

**Note sur Sentinel-1** : Si lors de l'implémentation les thumbnails S1 dans AWS Earth Search s'avèrent systématiquement absents ou inutilisables, l'onglet SAR devient "deep-link uniquement" avec un message explicatif. Ce choix doit être documenté dans le code avec un commentaire `// STAC-S1-THUMBNAIL-RELIABILITY:` précisant la raison.

---

## CSS

Nouvelles classes dans `src/styles/main.css` :
- `.satellite-panel` — container principal (position fixed, z-index au-dessus de la carte)
- `.satellite-panel__header`, `__body`, `__footer`
- `.satellite-panel__thumb` — `<img>` avec fallback
- `.satellite-panel__toggle` — boutons Avant/Après
- `.satellite-panel__eo-btn` — bouton EO Browser
- `.satellite-cta-btn` — bouton dans flood popup
- `.satellite-inline-btn` — lien dans news popup

Utiliser les CSS variables existantes du projet (`--bg-panel`, `--text-primary`, `--accent`, etc.).

---

## Critères d'acceptation

1. Un utilisateur peut cliquer « Voir satellite » depuis un tronçon Vigicrues → `SatellitePanel` s'ouvre avec une scène Sentinel-1 SAR (ou fallback EO Browser si aucune scène)
2. Un utilisateur peut cliquer « Voir satellite » depuis une news géolocalisée → `SatellitePanel` s'ouvre avec Sentinel-2 (ou fallback)
3. Le bouton « Ouvrir dans EO Browser » est toujours visible et fonctionnel
4. Si AWS Earth Search est indisponible : le panel affiche un message clair + EO Browser — aucun crash
5. L'intégration Vigicrues existante (popup, couleurs, carte) est inchangée
6. L'intégration MapPopup existante (cluster, item, military) est inchangée
7. `npm run typecheck` passe sans erreur
8. `npm run build` passe sans erreur

---

## Checklist d'implémentation

- [ ] Types dans `src/types/index.ts`
- [ ] `src/services/copernicus.ts` — helpers bbox, STAC fetch, EO Browser URL builder
- [ ] `api/copernicus.js` — Vercel function, validation, proxy STAC, cache
- [ ] `src/plugins/copernicus-proxy.ts` — Vite dev proxy
- [ ] `src/components/SatellitePanel.ts` — DOM natif, états loading/empty/error, toggle Avant/Après, cleanup
- [ ] `src/styles/main.css` — styles SatellitePanel + CTA buttons
- [ ] `src/components/DeckGLMap.ts` — `onSatelliteView` property + bouton flood popup + bbox calculation
- [ ] `src/components/MapPopup.ts` — `onSatelliteView` property + bouton news items géolocalisés
- [ ] `src/components/MapContainer.ts` — relai `onSatelliteView` si applicable
- [ ] `src/App.ts` — instanciation SatellitePanel, `openSatelliteView()`, wiring, mobile guard
- [ ] `npm run typecheck` — zéro erreur
- [ ] `npm run build` — zéro erreur
