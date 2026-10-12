import type { CommodityData } from '../types/index.ts';

// ─── Utilitaire sparkline (identique à finance.ts) ───────────────────────────



// ─── Constantes ───────────────────────────────────────────────────────────────

interface YahooSparkLegacyResponse {
  timestamp?: number[];
  meta?: {
    regularMarketPrice?: number;
    previousClose?: number;
  };
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
    }>;
  };
}

interface YahooSparkLegacyResult {
  symbol?: string;
  response?: YahooSparkLegacyResponse[];
}

interface YahooSparkFlatResult {
  symbol?: string;
  previousClose?: number;
  close?: Array<number | null>;
  timestamp?: number[];
  end?: number;
}

/**
 * Heure du dernier cours relevé (secondes Unix) : dernier horodatage dont la clôture n'est pas vide. Jamais `end`, qui est la fin
 * de la séance en cours (dans le futur : « MàJ 05:59 » affiché le soir, constat du 12/10/2026).
 */
function lastQuoteTime(timestamps: readonly number[] | undefined, closes: ReadonlyArray<number | null>): number | null {
  if (!timestamps) return null;
  for (let i = Math.min(timestamps.length, closes.length) - 1; i >= 0; i -= 1) {
    const t = timestamps[i];
    if (closes[i] !== null && typeof t === 'number') return t;
  }
  return null;
}

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

function extractCommodityResults(json: unknown): Array<YahooSparkLegacyResult | YahooSparkFlatResult> {
  if (!json || typeof json !== 'object') return [];

  const legacyResults = (json as { spark?: { result?: unknown } }).spark?.result;
  if (Array.isArray(legacyResults)) {
    return legacyResults as YahooSparkLegacyResult[];
  }

  const flatEntries = Object.values(json as Record<string, unknown>).filter((entry) => {
    return !!entry && typeof entry === 'object' && 'symbol' in (entry as Record<string, unknown>);
  });

  return flatEntries as YahooSparkFlatResult[];
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchCommodityData(): Promise<CommodityData[]> {
  try {
    const resp = await fetch('/api/finance/commodities');
    if (!resp.ok) {
      console.warn('[Commodities] API returned', resp.status);
      return [];
    }

    const json = await resp.json();
    const results = extractCommodityResults(json);
    if (results.length === 0) {
      console.warn('[Commodities] Unexpected response shape');
      return [];
    }

    const parsed: CommodityData[] = [];

    for (const item of results) {
      const symbol = item.symbol;
      if (!symbol) continue;
      const meta = COMMODITY_META[symbol];
      if (!meta) continue;

      const legacyResponse = 'response' in item ? item.response?.[0] : undefined;
      const price: number = legacyResponse?.meta?.regularMarketPrice
        ?? ('close' in item ? item.close?.filter((v): v is number => v !== null).at(-1) : undefined)
        ?? 0;
      const previousClose: number = legacyResponse?.meta?.previousClose
        ?? ('previousClose' in item ? item.previousClose : undefined)
        ?? price;
      const changePercent = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0;

      let trend: CommodityData['trend'] = 'flat';
      if (changePercent > 0.1) trend = 'up';
      else if (changePercent < -0.1) trend = 'down';

      // Sparkline — filtrer les null, fallback si insuffisant
      const rawClose: (number | null)[] = legacyResponse?.indicators?.quote?.[0]?.close
        ?? ('close' in item ? item.close ?? [] : []);
      const filteredClose = rawClose.filter((v): v is number => v !== null);
      const history = filteredClose.length >= 2
        ? filteredClose
        : [];

      parsed.push({
        symbol,
        name: meta.name,
        category: meta.category,
        unit: meta.unit,
        price,
        changePercent,
        trend,
        lastUpdated: new Date((lastQuoteTime(legacyResponse?.timestamp ?? ('timestamp' in item ? item.timestamp : undefined), rawClose) ?? Date.now() / 1000) * 1000),
        history,
      });
    }

    return parsed;

  } catch (err) {
    console.error('[Commodities] Fetch failed', err);
    return [];
  }
}
