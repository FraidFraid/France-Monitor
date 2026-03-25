# Spec : CommodityStrip — Cours des matières premières

**Date** : 2026-03-25
**Statut** : Approuvé

---

## Contexte

France Monitor dispose déjà d'un module `MarketStrip` sous la carte affichant le flux boursier (CAC40, actions françaises) via Marketstack. L'objectif est d'ajouter un second module `CommodityStrip` juste en dessous, affichant les cours des matières premières en temps réel, groupés par catégorie (énergie, métaux, agro).

---

## Architecture

### Fichiers nouveaux

| Fichier | Rôle |
|---------|------|
| `src/services/commodities.ts` | Fetch Yahoo Finance + mock fallback, expose `fetchCommodityData()` |
| `src/plugins/commodities-proxy.ts` | Vite dev proxy → `/api/finance/commodities` |
| `src/components/CommodityStrip.ts` | Composant `under-map-card` avec sections par catégorie |

### Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `src/types/index.ts` | Ajouter l'interface `CommodityData` |
| `src/App.ts` | Import, instanciation `CommodityStrip`, `startCommodityPolling()`, `clearInterval` dans `destroy()` |
| `vite.config.ts` | Import + enregistrement `commoditiesProxyPlugin()` après `financeProxyPlugin()` |
| `src/styles/main.css` | Classes CSS sections catégories |

---

## Type de données — `src/types/index.ts`

Ajouter après l'interface `MarketData` :

```typescript
export interface CommodityData extends Omit<MarketData, 'history'> {
  history: number[];       // Required (non-optional) — Omit+redeclaration car extends seul ne peut pas rendre obligatoire un champ optionnel parent
  category: 'energy' | 'metals' | 'agro';
  unit: string;            // '$/bbl', '$/oz', '$/MMBtu', '¢/bu', '$/lb'
}
```

`Omit<MarketData, 'history'>` est obligatoire : TypeScript strict interdit de rendre non-optionnel un champ optionnel via un `extends` direct. Le service doit toujours renseigner `history` via `generateMockHistory()`.

---

## Symboles couverts (9)

`TTF=F` n'existe pas sur Yahoo Finance (TTF trade sur ICE). Remplacé par `NG=F` (Henry Hub, USD/MMBtu).

| Catégorie | Nom | Symbole Yahoo | Unité |
|-----------|-----|---------------|-------|
| energy | Brent | `BZ=F` | $/bbl |
| energy | WTI | `CL=F` | $/bbl |
| energy | Gaz Naturel | `NG=F` | $/MMBtu |
| metals | Or | `GC=F` | $/oz |
| metals | Argent | `SI=F` | $/oz |
| metals | Cuivre | `HG=F` | $/lb |
| agro | Blé | `ZW=F` | ¢/bu |
| agro | Maïs | `ZC=F` | ¢/bu |
| agro | Soja | `ZS=F` | ¢/bu |

---

## Service `commodities.ts`

### Endpoint Yahoo Finance

```
GET https://query1.finance.yahoo.com/v8/finance/spark
  ?symbols=BZ=F,CL=F,NG=F,GC=F,SI=F,HG=F,ZW=F,ZC=F,ZS=F
  &range=1d
  &interval=5m
```

Pas de clé API requise.

### Structure de réponse Yahoo `/v8/finance/spark`

```json
{
  "spark": {
    "result": [
      {
        "symbol": "BZ=F",
        "response": [
          {
            "meta": {
              "regularMarketPrice": 85.4,
              "previousClose": 86.0,
              "currency": "USD"
            },
            "timestamp": [1234567890],
            "indicators": {
              "quote": [{ "close": [85.1, 85.3, null, 85.4] }]
            }
          }
        ]
      }
    ]
  }
}
```

Champs à extraire :
- Prix courant : `spark.result[i].response[0].meta.regularMarketPrice`
- Prix veille : `spark.result[i].response[0].meta.previousClose`
- Delta % : `((regularMarketPrice - previousClose) / previousClose) * 100`
- Sparkline : extraire et filtrer les `null` du tableau `close`, avec fallback si < 2 points :

```typescript
const rawClose = response.indicators?.quote?.[0]?.close ?? [];
const history = (rawClose as (number | null)[]).filter((v): v is number => v !== null);
// Si history.length < 2 → fallback :
const safeHistory = history.length >= 2 ? history : generateMockHistory(price, changePercent);
```

### Gestion des erreurs

- `!resp.ok` → `console.warn` + retour `MOCK_COMMODITY_DATA`
- `catch` → `console.error` + retour `MOCK_COMMODITY_DATA` (jamais de tableau vide — le mock est toujours le fallback)

---

## Proxy `commodities-proxy.ts`

Pattern identique à `finance-proxy.ts` — copier la structure complète en changeant la route et l'URL cible :

```typescript
import type { Plugin } from 'vite';

export function commoditiesProxyPlugin(): Plugin {
  return {
    name: 'commodities-proxy',
    configureServer(server) {
      server.middlewares.use('/api/finance/commodities', async (_req, res) => {
        const SYMBOLS = 'BZ%3DF,CL%3DF,NG%3DF,GC%3DF,SI%3DF,HG%3DF,ZW%3DF,ZC%3DF,ZS%3DF';
        const URL = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${SYMBOLS}&range=1d&interval=5m`;

        try {
          const resp = await fetch(URL, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          if (!resp.ok) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Upstream error: ${resp.status}` }));
            return;
          }
          const json = await resp.json();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=900');
          res.end(JSON.stringify(json));
        } catch (err) {
          console.error('[commodities-proxy]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Fetch failed' }));
        }
      });
    },
  };
}
```

Note : les symboles `=F` doivent être URL-encodés (`%3D`) dans certains contextes — tester les deux formes.

---

## Composant `CommodityStrip`

Classe standalone (pas d'héritage `Panel`) — pattern identique à `MarketStrip`.

### Structure HTML

```html
<section class="under-map-card under-map-card--commodities">
  <div class="under-map-card__header">
    <div class="under-map-card__title">Matières premières</div>
    <div class="under-map-card__meta" id="commodity-strip-stamp">Chargement...</div>
  </div>
  <div class="under-map-card__body">
    <div class="commodity-strip__section commodity-strip__section--energy">
      <div class="commodity-strip__section-label">ENERGIE</div>
      <!-- items market-strip__item -->
    </div>
    <div class="commodity-strip__section commodity-strip__section--metals">
      <div class="commodity-strip__section-label">METAUX</div>
    </div>
    <div class="commodity-strip__section commodity-strip__section--agro">
      <div class="commodity-strip__section-label">AGRO</div>
    </div>
  </div>
</section>
```

### Méthodes

- `mount()` — crée la section et l'insère dans le container
- `update(items: CommodityData[])` — re-rend le contenu ; si `items.length === 0`, appelle `renderEmpty()` (même pattern que `MarketStrip.update()`)
- `renderLoading()` — état initial
- `renderEmpty()` — état erreur/vide

### Classes CSS à ajouter dans `main.css`

```css
.commodity-strip__section {
  margin-bottom: 8px;
}
.commodity-strip__section-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--text-muted);
  padding: 4px 0 4px 4px;
  text-transform: uppercase;
}
.commodity-strip__section--energy .commodity-strip__section-label { color: #fb923c; }
.commodity-strip__section--metals .commodity-strip__section-label { color: #fbbf24; }
.commodity-strip__section--agro   .commodity-strip__section-label { color: #4ade80; }
```

Les items réutilisent les classes `market-strip__item` existantes. Template HTML exact d'un item commodité (l'unité remplace le ticker dans `.market-strip__symbol`, l'ordre `[nom / unité / prix / delta / sparkline]` est fixe par section) :

```typescript
card.className = `market-strip__item ${trendClass}`;
card.innerHTML = `
  <div class="market-strip__topline">
    <span class="market-strip__name">${escapeHtml(item.name)}</span>
    <span class="market-strip__symbol">${escapeHtml(item.unit)}</span>
  </div>
  <div class="market-strip__price">${escapeHtml(formatPrice(item.price))}</div>
  <div class="market-strip__delta">${escapeHtml(formatPct(item.changePercent))}</div>
  ${buildSparkline(item.history, item.trend)}
`;
```

Les items sont affichés dans l'ordre fixe du tableau par section (pas de tri par `changePercent`).

---

## Intégration `App.ts`

### Imports à ajouter en tête de fichier

```typescript
import { CommodityStrip } from './components/CommodityStrip.ts';
import { fetchCommodityData } from './services/commodities.ts';
```

### Champs privés (avec les autres intervals, ligne ~838)

```typescript
private commodityStrip: CommodityStrip | null = null;
private _intervalCommodities: ReturnType<typeof setInterval> | null = null;
```

### Dans `destroy()` (avec les autres clearInterval)

```typescript
if (this._intervalCommodities !== null) { clearInterval(this._intervalCommodities); this._intervalCommodities = null; }
```

### Dans `init()` — monter après `this.marketStrip.mount()` (ligne ~1291), en suivant le même pattern `underMapGrid`

```typescript
// Après : this.marketStrip.mount();
const commodityStripContainer = document.createElement('div');
underMapGrid.appendChild(commodityStripContainer);
this.commodityStrip = new CommodityStrip(commodityStripContainer);
this.commodityStrip.mount();
```

`underMapGrid` est déjà déclaré à ligne ~1287 : `const underMapGrid = document.getElementById('under-map-grid')!;`

### `startCommodityPolling()` — pattern identique à `startFinancePolling()`

```typescript
private startCommodityPolling(): void {
  const fetchCommodities = async () => {
    try {
      const data = await fetchCommodityData();
      this.commodityStrip?.update(data);  // Pas de guard if(data.length > 0) — update() gère l'état vide
    } catch (err) {
      console.error('[Commodities] Polling failed', err);
    }
  };
  fetchCommodities();
  this._intervalCommodities = setInterval(
    () => fetchCommodities().catch(err => console.error('[App] Commodities poll error', err)),
    15 * 60_000
  );
}
```

Appeler `this.startCommodityPolling()` dans `init()` après `this.startFinancePolling()`.

---

## `vite.config.ts`

### Import à ajouter (après l'import `financeProxyPlugin`)

```typescript
import { commoditiesProxyPlugin } from './src/plugins/commodities-proxy.ts';
```

### Dans le tableau `plugins` (après `financeProxyPlugin()`)

```typescript
commoditiesProxyPlugin(),
```

---

## Polling

- Intervalle : **15 minutes** (`15 * 60_000` ms)
- Premier appel : immédiat au démarrage
- Nettoyage : `clearInterval` dans `destroy()`

---

## Mock data (fallback)

```typescript
const MOCK_COMMODITY_DATA: CommodityData[] = [
  { symbol: 'BZ=F', name: 'Brent',       category: 'energy', unit: '$/bbl',    price: 85.40,   changePercent: -0.72, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(85.40,   -0.72) },
  { symbol: 'CL=F', name: 'WTI',         category: 'energy', unit: '$/bbl',    price: 81.20,   changePercent: -0.55, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(81.20,   -0.55) },
  { symbol: 'NG=F', name: 'Gaz Naturel', category: 'energy', unit: '$/MMBtu',  price: 2.18,    changePercent:  1.20, trend: 'up',   lastUpdated: new Date(), history: generateMockHistory(2.18,     1.20) },
  { symbol: 'GC=F', name: 'Or',          category: 'metals', unit: '$/oz',     price: 2318.50, changePercent:  0.30, trend: 'up',   lastUpdated: new Date(), history: generateMockHistory(2318.50,  0.30) },
  { symbol: 'SI=F', name: 'Argent',      category: 'metals', unit: '$/oz',     price: 27.45,   changePercent:  0.85, trend: 'up',   lastUpdated: new Date(), history: generateMockHistory(27.45,    0.85) },
  { symbol: 'HG=F', name: 'Cuivre',      category: 'metals', unit: '$/lb',     price: 4.52,    changePercent: -0.40, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(4.52,    -0.40) },
  { symbol: 'ZW=F', name: 'Blé',         category: 'agro',   unit: '¢/bu',     price: 548.00,  changePercent: -1.10, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(548.00,  -1.10) },
  { symbol: 'ZC=F', name: 'Maïs',        category: 'agro',   unit: '¢/bu',     price: 438.25,  changePercent: -0.30, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(438.25,  -0.30) },
  { symbol: 'ZS=F', name: 'Soja',        category: 'agro',   unit: '¢/bu',     price: 1172.00, changePercent:  0.15, trend: 'up',   lastUpdated: new Date(), history: generateMockHistory(1172.00,  0.15) },
];
```

---

## Hors périmètre

- Électricité spot EPEX (API distincte, complexe, phase ultérieure)
- Conversion devise (tout reste en devise native Yahoo)
- Alertes prix / seuils critiques
- Layer carte pour les commodités
