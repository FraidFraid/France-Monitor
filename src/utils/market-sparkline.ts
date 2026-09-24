import type { MarketTone } from '../services/vigilance.ts';

/** Courbe neutre ; jaune seulement pour un mouvement exceptionnel (spec refonte UI §4.4). */
export function buildMarketSparkline(history: number[] | undefined, tone: MarketTone): string {
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

  const stroke = tone === 'alert' ? 'var(--sev-yellow)' : 'var(--text-muted)';

  return `
    <svg class="market-strip__sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
    </svg>
  `;
}
