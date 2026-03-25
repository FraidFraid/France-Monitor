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
