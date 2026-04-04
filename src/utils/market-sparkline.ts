import type { CommodityData, MarketData } from '../types/index.ts';

type Trend = MarketData['trend'] | CommodityData['trend'];

export function buildMarketSparkline(history: number[] | undefined, trend: Trend): string {
  if (!history || history.length < 2) return '';

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
    trend === 'up' ? 'var(--threat-low)' :
    trend === 'down' ? 'var(--threat-high)' :
    'var(--text-muted)';

  return `
    <svg class="market-strip__sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
    </svg>
  `;
}
