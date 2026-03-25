# CommodityStrip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un module `CommodityStrip` sous la carte affichant les cours des matières premières (énergie, métaux, agro) en temps réel via Yahoo Finance, avec mock fallback.

**Architecture:** Service `commodities.ts` appelle `/api/finance/commodities` (Vite proxy → Yahoo Finance `/v8/finance/spark`). Le composant `CommodityStrip` suit le pattern exact de `MarketStrip` (classe standalone, `under-map-card`). `App.ts` monte le composant dans `underMapGrid` après `MarketStrip` et gère le polling toutes les 15 min.

**Tech Stack:** Vanilla TypeScript, Vite plugin proxy, Yahoo Finance (sans clé API), DOM manipulation directe.

---

## File Map

| Action | Fichier |
|--------|---------|
| Modify | `src/types/index.ts` — ajouter `CommodityData` après ligne 483 |
| Create | `src/services/commodities.ts` |
| Create | `src/plugins/commodities-proxy.ts` |
| Modify | `vite.config.ts` — import + plugin ligne ~24 et ~68 |
| Create | `src/components/CommodityStrip.ts` |
| Modify | `src/styles/main.css` — ajouter CSS sections catégories |
| Modify | `src/App.ts` — imports, champs privés, destroy, init, polling |

---

## Task 1 : Type `CommodityData`

**Files:**
- Modify: `src/types/index.ts:483-484`

- [ ] **Step 1 : Ajouter `CommodityData` après `MarketData`**

Dans `src/types/index.ts`, après la ligne 483 (`}`), insérer :

```typescript
// ═══ Finance (Matières premières) ═══

export interface CommodityData extends Omit<MarketData, 'history'> {
  history: number[];  // Required (Omit+redeclaration — TypeScript strict interdit d'affiner un champ optionnel via extends direct)
  category: 'energy' | 'metals' | 'agro';
  unit: string;       // '$/bbl', '$/oz', '$/MMBtu', '¢/bu', '$/lb'
}
```

- [ ] **Step 2 : Vérifier typecheck**

```bash
npm run typecheck
```

Attendu : aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add CommodityData interface"
```

---

## Task 2 : Service `commodities.ts`

**Files:**
- Create: `src/services/commodities.ts`

- [ ] **Step 1 : Créer le fichier**

`src/services/commodities.ts` — contenu complet :

```typescript
import type { CommodityData } from '../types/index.ts';

// ─── Utilitaire sparkline (identique à finance.ts) ───────────────────────────

function generateMockHistory(currentPrice: number, changePercent: number, points = 20): number[] {
  const openPrice = currentPrice / (1 + changePercent / 100);
  const history = [openPrice];
  for (let i = 1; i < points - 1; i++) {
    const progress = i / (points - 1);
    const targetValue = openPrice + (currentPrice - openPrice) * progress;
    const noise = targetValue * (Math.random() * 0.01 - 0.005);
    history.push(targetValue + noise);
  }
  history.push(currentPrice);
  return history;
}

// ─── Mock data (fallback si API indisponible) ─────────────────────────────────

const MOCK_COMMODITY_DATA: CommodityData[] = [
  { symbol: 'BZ=F', name: 'Brent',       category: 'energy', unit: '$/bbl',   price: 85.40,   changePercent: -0.72, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(85.40,   -0.72) },
  { symbol: 'CL=F', name: 'WTI',         category: 'energy', unit: '$/bbl',   price: 81.20,   changePercent: -0.55, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(81.20,   -0.55) },
  { symbol: 'NG=F', name: 'Gaz Naturel', category: 'energy', unit: '$/MMBtu', price: 2.18,    changePercent:  1.20, trend: 'up',   lastUpdated: new Date(), history: generateMockHistory(2.18,     1.20) },
  { symbol: 'GC=F', name: 'Or',          category: 'metals', unit: '$/oz',    price: 2318.50, changePercent:  0.30, trend: 'up',   lastUpdated: new Date(), history: generateMockHistory(2318.50,  0.30) },
  { symbol: 'SI=F', name: 'Argent',      category: 'metals', unit: '$/oz',    price: 27.45,   changePercent:  0.85, trend: 'up',   lastUpdated: new Date(), history: generateMockHistory(27.45,    0.85) },
  { symbol: 'HG=F', name: 'Cuivre',      category: 'metals', unit: '$/lb',    price: 4.52,    changePercent: -0.40, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(4.52,    -0.40) },
  { symbol: 'ZW=F', name: 'Blé',         category: 'agro',   unit: '¢/bu',    price: 548.00,  changePercent: -1.10, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(548.00,  -1.10) },
  { symbol: 'ZC=F', name: 'Maïs',        category: 'agro',   unit: '¢/bu',    price: 438.25,  changePercent: -0.30, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(438.25,  -0.30) },
  { symbol: 'ZS=F', name: 'Soja',        category: 'agro',   unit: '¢/bu',    price: 1172.00, changePercent:  0.15, trend: 'up',   lastUpdated: new Date(), history: generateMockHistory(1172.00,  0.15) },
];

// ─── Constantes ───────────────────────────────────────────────────────────────

const COMMODITY_META: Record<string, { name: string; category: CommodityData['category']; unit: string }> = {
  'BZ=F': { name: 'Brent',       category: 'energy', unit: '$/bbl'   },
  'CL=F': { name: 'WTI',         category: 'energy', unit: '$/bbl'   },
  'NG=F': { name: 'Gaz Naturel', category: 'energy', unit: '$/MMBtu' },
  'GC=F': { name: 'Or',          category: 'metals', unit: '$/oz'    },
  'SI=F': { name: 'Argent',      category: 'metals', unit: '$/oz'    },
  'HG=F': { name: 'Cuivre',      category: 'metals', unit: '$/lb'    },
  'ZW=F': { name: 'Blé',         category: 'agro',   unit: '¢/bu'    },
  'ZC=F': { name: 'Maïs',        category: 'agro',   unit: '¢/bu'    },
  'ZS=F': { name: 'Soja',        category: 'agro',   unit: '¢/bu'    },
};

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchCommodityData(): Promise<CommodityData[]> {
  try {
    const resp = await fetch('/api/finance/commodities');
    if (!resp.ok) {
      console.warn('[Commodities] API returned', resp.status, '— using mock data');
      return MOCK_COMMODITY_DATA;
    }

    const json = await resp.json();
    const results = json?.spark?.result;
    if (!Array.isArray(results)) {
      console.warn('[Commodities] Unexpected response shape — using mock data');
      return MOCK_COMMODITY_DATA;
    }

    const parsed: CommodityData[] = [];

    for (const item of results) {
      const symbol: string = item?.symbol;
      const meta = COMMODITY_META[symbol];
      if (!meta) continue;

      const response = item?.response?.[0];
      if (!response) continue;

      const price: number = response.meta?.regularMarketPrice ?? 0;
      const previousClose: number = response.meta?.previousClose ?? price;
      const changePercent = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0;

      let trend: CommodityData['trend'] = 'flat';
      if (changePercent > 0.1) trend = 'up';
      else if (changePercent < -0.1) trend = 'down';

      // Sparkline — filtrer les null, fallback si insuffisant
      const rawClose: (number | null)[] = response.indicators?.quote?.[0]?.close ?? [];
      const filteredClose = rawClose.filter((v): v is number => v !== null);
      const history = filteredClose.length >= 2
        ? filteredClose
        : generateMockHistory(price, changePercent);

      parsed.push({
        symbol,
        name: meta.name,
        category: meta.category,
        unit: meta.unit,
        price,
        changePercent,
        trend,
        lastUpdated: new Date(),
        history,
      });
    }

    return parsed.length > 0 ? parsed : MOCK_COMMODITY_DATA;

  } catch (err) {
    console.error('[Commodities] Fetch failed', err);
    return MOCK_COMMODITY_DATA;
  }
}
```

- [ ] **Step 2 : Vérifier typecheck**

```bash
npm run typecheck
```

Attendu : aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add src/services/commodities.ts
git commit -m "feat(service): add commodities.ts — Yahoo Finance spark endpoint"
```

---

## Task 3 : Proxy Vite + `vite.config.ts`

**Files:**
- Create: `src/plugins/commodities-proxy.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1 : Créer le plugin proxy**

`src/plugins/commodities-proxy.ts` — contenu complet :

```typescript
import type { Plugin } from 'vite';

export function commoditiesProxyPlugin(): Plugin {
  return {
    name: 'commodities-proxy',
    configureServer(server) {
      server.middlewares.use('/api/finance/commodities', async (_req, res) => {
        // Symboles URL-encodés (= → %3D) pour compatibilité maximale
        const SYMBOLS = 'BZ%3DF,CL%3DF,NG%3DF,GC%3DF,SI%3DF,HG%3DF,ZW%3DF,ZC%3DF,ZS%3DF';
        const URL = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${SYMBOLS}&range=1d&interval=5m`;

        try {
          const resp = await fetch(URL, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
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

- [ ] **Step 2 : Enregistrer dans `vite.config.ts`**

Ajouter l'import après la ligne `import { financeProxyPlugin } ...` (ligne 12) :

```typescript
import { commoditiesProxyPlugin } from './src/plugins/commodities-proxy.ts';
```

Ajouter l'appel dans le tableau `plugins[]` après `financeProxyPlugin()` (ligne 56) :

```typescript
commoditiesProxyPlugin(),
```

- [ ] **Step 3 : Vérifier typecheck**

```bash
npm run typecheck
```

Attendu : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add src/plugins/commodities-proxy.ts vite.config.ts
git commit -m "feat(proxy): add commodities-proxy — Yahoo Finance /v8/finance/spark"
```

---

## Task 4 : Composant `CommodityStrip` + CSS

**Files:**
- Create: `src/components/CommodityStrip.ts`
- Modify: `src/styles/main.css`

- [ ] **Step 1 : Créer le composant**

`src/components/CommodityStrip.ts` — contenu complet :

```typescript
import type { CommodityData } from '../types/index.ts';

// ─── Utilitaires (identiques à MarketStrip) ───────────────────────────────────

function escapeHtml(value: string): string {
  const el = document.createElement('div');
  el.textContent = value;
  return el.innerHTML;
}

function formatPrice(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 100)  return value.toFixed(2);
  return value.toFixed(2);
}

function formatPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function buildSparkline(history: number[], trend: CommodityData['trend']): string {
  if (history.length < 2) return '';

  const width = 112;
  const height = 28;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const points = history.map((value, index) => {
    const x = (index / (history.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const stroke =
    trend === 'up'   ? 'var(--threat-low)' :
    trend === 'down' ? 'var(--threat-high)' :
    'var(--text-muted)';

  return `
    <svg class="market-strip__sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
    </svg>
  `;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export class CommodityStrip {
  private container: HTMLElement;
  private listEls: Record<'energy' | 'metals' | 'agro', HTMLElement | null> = {
    energy: null,
    metals: null,
    agro: null,
  };
  private stampEl: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const root = document.createElement('section');
    root.className = 'under-map-card under-map-card--commodities';
    root.innerHTML = `
      <div class="under-map-card__header">
        <div class="under-map-card__title">Matières premières</div>
        <div class="under-map-card__meta" id="commodity-strip-stamp">Chargement...</div>
      </div>
      <div class="under-map-card__body">
        <div class="commodity-strip__section commodity-strip__section--energy">
          <div class="commodity-strip__section-label">ENERGIE</div>
          <div class="commodity-strip__list" id="commodity-list-energy"></div>
        </div>
        <div class="commodity-strip__section commodity-strip__section--metals">
          <div class="commodity-strip__section-label">METAUX</div>
          <div class="commodity-strip__list" id="commodity-list-metals"></div>
        </div>
        <div class="commodity-strip__section commodity-strip__section--agro">
          <div class="commodity-strip__section-label">AGRO</div>
          <div class="commodity-strip__list" id="commodity-list-agro"></div>
        </div>
      </div>
    `;

    this.container.appendChild(root);
    this.listEls.energy = root.querySelector('#commodity-list-energy');
    this.listEls.metals = root.querySelector('#commodity-list-metals');
    this.listEls.agro   = root.querySelector('#commodity-list-agro');
    this.stampEl = root.querySelector('#commodity-strip-stamp');
    this.renderLoading();
  }

  update(items: CommodityData[]): void {
    if (!items.length) {
      this.renderEmpty();
      return;
    }

    // Vider les listes
    for (const cat of ['energy', 'metals', 'agro'] as const) {
      const el = this.listEls[cat];
      if (el) el.innerHTML = '';
    }

    let latestTs = 0;

    for (const item of items) {
      const listEl = this.listEls[item.category];
      if (!listEl) continue;

      const trendClass =
        item.trend === 'up'   ? 'is-up' :
        item.trend === 'down' ? 'is-down' :
        'is-flat';

      const card = document.createElement('article');
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
      listEl.appendChild(card);

      const ts = item.lastUpdated instanceof Date
        ? item.lastUpdated.getTime()
        : new Date(item.lastUpdated).getTime();
      latestTs = Math.max(latestTs, ts);
    }

    if (this.stampEl) {
      this.stampEl.textContent = latestTs > 0
        ? `MàJ ${new Date(latestTs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
        : 'MàJ indisponible';
    }
  }

  private renderLoading(): void {
    for (const cat of ['energy', 'metals', 'agro'] as const) {
      const el = this.listEls[cat];
      if (el) el.innerHTML = `<div class="under-map-card__empty"><div class="under-map-card__empty-title">Chargement...</div></div>`;
    }
  }

  private renderEmpty(): void {
    if (this.stampEl) this.stampEl.textContent = 'Source indisponible';
    for (const cat of ['energy', 'metals', 'agro'] as const) {
      const el = this.listEls[cat];
      if (el) el.innerHTML = `<div class="under-map-card__empty"><div class="under-map-card__empty-title">Indisponible</div></div>`;
    }
  }
}
```

- [ ] **Step 2 : Ajouter le CSS dans `src/styles/main.css`**

Ajouter à la fin du fichier (ou dans la section sous-carte si elle existe) :

```css
/* ── CommodityStrip — sections par catégorie ── */
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

- [ ] **Step 3 : Vérifier typecheck**

```bash
npm run typecheck
```

Attendu : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add src/components/CommodityStrip.ts src/styles/main.css
git commit -m "feat(ui): add CommodityStrip component with energy/metals/agro sections"
```

---

## Task 5 : Intégration `App.ts`

**Files:**
- Modify: `src/App.ts`

- [ ] **Step 1 : Ajouter les imports**

En tête de `src/App.ts`, ajouter après l'import de `MarketStrip` (ligne ~21) :

```typescript
import { CommodityStrip } from './components/CommodityStrip.ts';
import { fetchCommodityData } from './services/commodities.ts';
```

- [ ] **Step 2 : Ajouter les champs privés**

Dans la classe `App`, avec les autres champs privés (ligne ~793-794, près de `marketStrip`) :

```typescript
private commodityStrip: CommodityStrip | null = null;
private _intervalCommodities: ReturnType<typeof setInterval> | null = null;
```

- [ ] **Step 3 : Ajouter le `clearInterval` dans `destroy()`**

Dans `destroy()`, avec les autres `clearInterval` (ligne ~848) :

```typescript
if (this._intervalCommodities !== null) { clearInterval(this._intervalCommodities); this._intervalCommodities = null; }
```

- [ ] **Step 4 : Monter le composant dans `init()`**

Dans `init()`, après `this.marketStrip.mount()` (ligne ~1291), ajouter :

```typescript
const commodityStripContainer = document.createElement('div');
underMapGrid.appendChild(commodityStripContainer);
this.commodityStrip = new CommodityStrip(commodityStripContainer);
this.commodityStrip.mount();
```

`underMapGrid` est déclaré à la ligne ~1287 : `const underMapGrid = document.getElementById('under-map-grid')!;` — pas besoin de le redéclarer.

- [ ] **Step 5 : Ajouter `startCommodityPolling()`**

Ajouter la méthode dans la classe `App`, après `startFinancePolling()` (ligne ~2341) :

```typescript
private startCommodityPolling(): void {
  const fetchCommodities = async () => {
    try {
      const data = await fetchCommodityData();
      this.commodityStrip?.update(data);
    } catch (err) {
      console.error('[Commodities] Polling failed', err);
    }
  };
  fetchCommodities();
  this._intervalCommodities = setInterval(
    () => fetchCommodities().catch(err => console.error('[App] Commodities poll error', err)),
    15 * 60_000,
  );
}
```

- [ ] **Step 6 : Appeler `startCommodityPolling()` dans `init()`**

Dans `init()`, après `this.startFinancePolling()` (ligne ~1111) :

```typescript
this.startCommodityPolling();
```

- [ ] **Step 7 : Vérifier typecheck et build**

```bash
npm run typecheck && npm run build
```

Attendu : aucune erreur TypeScript, build réussi.

- [ ] **Step 8 : Vérification visuelle en dev**

```bash
npm run dev:vite
```

Ouvrir `http://localhost:3001`. Vérifier :
- Le module "Matières premières" apparaît sous "Flux boursier" dans le grid sous la carte
- 3 sections visibles : ENERGIE (orange), METAUX (jaune), AGRO (vert)
- 9 items affichés avec prix, delta %, sparkline
- Si Yahoo Finance répond (en dev) : données réelles ; sinon mock data (latence ~3h pour certains futurs)
- Horodatage "MàJ HH:MM" mis à jour

- [ ] **Step 9 : Commit final**

```bash
git add src/App.ts
git commit -m "feat(app): integrate CommodityStrip — polling 15min, mount in underMapGrid"
```
