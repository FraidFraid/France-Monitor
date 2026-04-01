import type { MarketData } from '../types/index.ts';

// Hardcode mapping of symbols to human names
const SYMBOL_NAMES: Record<string, string> = {
    'CAC.INDX': 'CAC 40',
    'DAX.INDX': 'DAX 40',
    'STOXX50.INDX': 'Euro Stoxx 50',
    'SPX.INDX': 'S&P 500',
    'TTE.PA': 'TotalEnergies',
    'AIR.PA': 'Airbus',
    'HO.PA': 'Thales',
    'SAF.PA': 'Safran',
    'DG.PA': 'Vinci',        // Infrastructures / Autoroutes
    'SAN.PA': 'Sanofi',      // Santé / Épidémies
    'ORA.PA': 'Orange',      // Télécoms / Cyber
    'GLE.PA': 'Soc. Générale' // Banques / Stabilité financière
};

// Fonction utilitaire pour générer une fausse courbe (random walk) qui se termine par `currentPrice` et a varié de `changePercent`
function generateMockHistory(currentPrice: number, changePercent: number, points = 20): number[] {
    const openPrice = currentPrice / (1 + (changePercent / 100));
    const history = [openPrice];
    // Génère les points intermédiaires
    for (let i = 1; i < points - 1; i++) {
        // Tendance linéaire vers le prix final + du bruit aléatoire
        const progress = i / (points - 1);
        const targetValue = openPrice + (currentPrice - openPrice) * progress;
        // Bruit de +/- 0.5%
        const noise = targetValue * (Math.random() * 0.01 - 0.005);
        history.push(targetValue + noise);
    }

    // Le dernier point est exactement le prix courant
    history.push(currentPrice);
    return history;
}

const MOCK_MARKET_DATA: MarketData[] = [
    { symbol: 'CAC.INDX',    name: 'CAC 40',       price: 7532.14,  changePercent: -1.24, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(7532.14,  -1.24), category: 'indices' },
    { symbol: 'DAX.INDX',    name: 'DAX 40',       price: 22418.50, changePercent:  0.63, trend: 'up',   lastUpdated: new Date(), history: generateMockHistory(22418.50,  0.63), category: 'indices' },
    { symbol: 'STOXX50.INDX',name: 'Euro Stoxx 50',price: 5328.30,  changePercent: -0.45, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(5328.30,  -0.45), category: 'indices' },
    { symbol: 'SPX.INDX',    name: 'S&P 500',      price: 5667.20,  changePercent: -0.28, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(5667.20,  -0.28), category: 'indices' },
    { symbol: 'TTE.PA', name: 'TotalEnergies', price: 62.45, changePercent: 0.85, trend: 'up', lastUpdated: new Date(), history: generateMockHistory(62.45, 0.85), category: 'defense' },
    { symbol: 'AIR.PA', name: 'Airbus', price: 154.20, changePercent: -0.30, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(154.20, -0.30), category: 'defense' },
    { symbol: 'HO.PA', name: 'Thales', price: 142.60, changePercent: 1.15, trend: 'up', lastUpdated: new Date(), history: generateMockHistory(142.60, 1.15), category: 'defense' },
    { symbol: 'SAF.PA', name: 'Safran', price: 204.30, changePercent: -0.10, trend: 'flat', lastUpdated: new Date(), history: generateMockHistory(204.30, -0.10), category: 'defense' },
    { symbol: 'DG.PA', name: 'Vinci', price: 112.80, changePercent: -2.10, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(112.80, -2.10), category: 'services' },
    { symbol: 'SAN.PA', name: 'Sanofi', price: 89.50, changePercent: 0.40, trend: 'up', lastUpdated: new Date(), history: generateMockHistory(89.50, 0.40), category: 'services' },
    { symbol: 'ORA.PA', name: 'Orange', price: 10.85, changePercent: 0.15, trend: 'up', lastUpdated: new Date(), history: generateMockHistory(10.85, 0.15), category: 'services' },
    { symbol: 'GLE.PA', name: 'Soc. Générale', price: 24.10, changePercent: -1.80, trend: 'down', lastUpdated: new Date(), history: generateMockHistory(24.10, -1.80), category: 'services' },
];

/**
 * Fetch market data from proxy (or vercel edge fn).
 * Returns array of parsed MarketData.
 */
export async function fetchMarketData(): Promise<MarketData[]> {
    try {
        const resp = await fetch('/api/finance/market');
        if (!resp.ok) {
            console.warn('[Finance] API returned', resp.status, 'using fallback mock data');
            return MOCK_MARKET_DATA;
        }

        const data = await resp.json();
        if (!data || !data.data || !Array.isArray(data.data)) {
            console.warn('[Finance] Invalid data structure or missing keys, using fallback mock data');
            return MOCK_MARKET_DATA;
        }

        const results: MarketData[] = [];

        // L'API intraday/latest de Marketstack peut ramener plusieurs records par symbole pour la journée
        // On va garder qu'un seul par symbol (le premier, qui est le latest)
        // et on utilise (last - open) pour un proxy de la pct_change (Marketstack intraday n'inclut pas pct change par defaut sur le plan gratuit)
        const seen = new Set<string>();

        for (const item of data.data) {
            const sym = item.symbol;
            if (seen.has(sym)) continue;
            seen.add(sym);

            const last = item.last || item.close || 0;
            const open = item.open || last; // fallback to last if open missing

            // Avoid division by zero
            let pctChange = 0;
            if (open > 0) {
                pctChange = ((last - open) / open) * 100;
            }

            let trend: 'up' | 'down' | 'flat' = 'flat';
            if (pctChange > 0.1) trend = 'up';
            else if (pctChange < -0.1) trend = 'down';

            results.push({
                symbol: sym,
                name: SYMBOL_NAMES[sym] || sym,
                price: last,
                changePercent: pctChange,
                trend,
                lastUpdated: new Date(item.date || Date.now()),
                history: generateMockHistory(last, pctChange) // On génère un mock visuel basé sur la variation réelle pour afficher la courbe
            });
        }

        const bySymbol = new Map(results.map((item) => [item.symbol, item]));
        return MOCK_MARKET_DATA.map((mock) => {
            const realData = bySymbol.get(mock.symbol);
            if (realData) {
                return { ...realData, category: mock.category };
            }
            return mock;
        });

    } catch (err) {
        console.error('[Finance] Fetch failed', err);
        return MOCK_MARKET_DATA;
    }
}
