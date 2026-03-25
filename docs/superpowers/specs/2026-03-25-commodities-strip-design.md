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
| `src/App.ts` | Instancier `CommodityStrip`, appeler `startCommodityPolling()` |
| `vite.config.ts` | Enregistrer `commoditiesProxyPlugin()` |

---

## Type de données

```typescript
interface CommodityData extends MarketData {
  category: 'energy' | 'metals' | 'agro';
  unit: string; // '$/bbl', '$/oz', '¢/bu', etc.
}
```

Le type `MarketData` existant (`symbol`, `name`, `price`, `changePercent`, `trend`, `history`) est réutilisé tel quel. `CommodityData` l'étend avec `category` et `unit`.

---

## Symboles couverts (9)

| Catégorie | Nom | Symbole Yahoo | Unité |
|-----------|-----|---------------|-------|
| energy | Brent | `BZ=F` | $/bbl |
| energy | WTI | `CL=F` | $/bbl |
| energy | TTF Gaz | `TTF=F` | €/MWh |
| metals | Or | `GC=F` | $/oz |
| metals | Argent | `SI=F` | $/oz |
| metals | Cuivre | `HG=F` | $/lb |
| agro | Blé | `ZW=F` | ¢/bu |
| agro | Maïs | `ZC=F` | ¢/bu |
| agro | Soja | `ZS=F` | ¢/bu |

---

## Service `commodities.ts`

- Appelle le proxy `/api/finance/commodities` qui relaie Yahoo Finance `/v8/finance/spark`
- Endpoint Yahoo : `https://query1.finance.yahoo.com/v8/finance/spark?symbols=BZ=F,CL=F,...&range=1d&interval=5m`
- Parse la réponse : extrait `close[]` pour sparkline, `previousClose` et `regularMarketPrice` pour le delta %
- Mock data réaliste en fallback (Brent ~85$, Or ~2300$, Blé ~550¢, etc.) avec `generateMockHistory()` identique à `finance.ts`
- Même pattern circuit-breaker que les autres services : `console.warn` + retour mock si `!resp.ok`

---

## Proxy `commodities-proxy.ts`

- Route : `/api/finance/commodities`
- Relais vers Yahoo Finance `/v8/finance/spark` avec les 9 symboles
- Cache `max-age=900` (15 min, identique au proxy finance existant)
- Pas de clé API requise

---

## Composant `CommodityStrip`

- Classe standalone (pas d'héritage `Panel`) — même pattern que `MarketStrip`
- Conteneur : `section.under-map-card.under-map-card--commodities`
- Header : titre "Matières premières" + horodatage MàJ
- Body : 3 sections séparées par mini-titre catégorie
  - `ENERGIE` (fond subtil orange/ambre)
  - `METAUX` (fond subtil jaune/or)
  - `AGRO` (fond subtil vert)
- Chaque item : même `market-strip__item` card (nom, prix + unité, delta %, sparkline SVG)
- États : chargement, vide/erreur, données OK

---

## Intégration `App.ts`

```typescript
private commodityStrip: CommodityStrip | null = null;
private _intervalCommodities: ReturnType<typeof setInterval> | null = null;

// Dans init() — après MarketStrip.mount()
this.commodityStrip = new CommodityStrip(underMapContainer);
this.commodityStrip.mount();

// startCommodityPolling() — polling 15 min
```

---

## Polling

- Intervalle : **15 minutes** (cours moins volatils que les actions intraday)
- Premier appel : immédiat au démarrage
- Nettoyage : `clearInterval` dans `destroy()`

---

## Mock data (fallback)

Prix de référence réalistes :

| Symbole | Prix mock | Delta mock |
|---------|-----------|------------|
| BZ=F | 85.40 | -0.72% |
| CL=F | 81.20 | -0.55% |
| TTF=F | 34.80 | +1.20% |
| GC=F | 2318.50 | +0.30% |
| SI=F | 27.45 | +0.85% |
| HG=F | 4.52 | -0.40% |
| ZW=F | 548.00 | -1.10% |
| ZC=F | 438.25 | -0.30% |
| ZS=F | 1172.00 | +0.15% |

---

## Hors périmètre

- Électricité spot EPEX (API distincte, complexe, phase ultérieure)
- Conversion devise (tout reste en devise native Yahoo)
- Alertes prix / seuils critiques
- Layer carte pour les commodités
