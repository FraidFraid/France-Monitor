import type { FuelPriceHistorySnapshot, FuelPriceSeries } from '../types/index.ts';

export type FuelPriceChartRange = '1m' | '1y';

type NumericPoint = {
  time: number;
  price: number;
};

type RenderFuelPriceChartOptions = {
  width: number;
  height: number;
  showAxes?: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toNumericPoints(series: FuelPriceSeries): NumericPoint[] {
  return series.points
    .map((point) => ({
      time: new Date(point.timestamp).getTime(),
      price: point.price,
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.price))
    .sort((left, right) => left.time - right.time);
}

function getRangeDurationMs(range: FuelPriceChartRange): number {
  return range === '1m' ? 30 * 24 * 60 * 60 * 1000 : 365 * 24 * 60 * 60 * 1000;
}

function getLatestTimestamp(seriesList: FuelPriceSeries[]): number | null {
  let latest = Number.NEGATIVE_INFINITY;

  for (const series of seriesList) {
    for (const point of series.points) {
      const time = new Date(point.timestamp).getTime();
      if (Number.isFinite(time)) latest = Math.max(latest, time);
    }
  }

  return Number.isFinite(latest) ? latest : null;
}

export function filterFuelPriceSeries(
  history: FuelPriceHistorySnapshot | null,
  range: FuelPriceChartRange,
): FuelPriceSeries[] {
  if (!history) return [];

  const latest = getLatestTimestamp(history.series);
  if (latest === null) return history.series.map((series) => ({ ...series, points: [] }));

  const cutoff = latest - getRangeDurationMs(range);
  return history.series.map((series) => ({
    ...series,
    points: series.points
      .filter((point) => {
        const time = new Date(point.timestamp).getTime();
        return Number.isFinite(time) && time >= cutoff;
      })
      .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()),
  }));
}

export function renderFuelPriceChartSvg(
  seriesList: FuelPriceSeries[],
  options: RenderFuelPriceChartOptions,
): string {
  const showAxes = options.showAxes ?? true;
  const numericSeries = seriesList
    .map((series) => ({
      ...series,
      numericPoints: toNumericPoints(series),
    }))
    .filter((series) => series.numericPoints.length > 0);

  if (numericSeries.length === 0) return '';

  const padding = showAxes
    ? { top: 12, right: 16, bottom: 22, left: 42 }
    : { top: 6, right: 6, bottom: 8, left: 6 };

  const innerWidth = Math.max(16, options.width - padding.left - padding.right);
  const innerHeight = Math.max(16, options.height - padding.top - padding.bottom);

  const allPoints = numericSeries.flatMap((series) => series.numericPoints);
  const minTime = Math.min(...allPoints.map((point) => point.time));
  const maxTime = Math.max(...allPoints.map((point) => point.time));
  const minPriceRaw = Math.min(...allPoints.map((point) => point.price));
  const maxPriceRaw = Math.max(...allPoints.map((point) => point.price));
  const pricePadding = Math.max(0.015, (maxPriceRaw - minPriceRaw) * 0.12);
  const minPrice = clamp(minPriceRaw - pricePadding, 0, Number.POSITIVE_INFINITY);
  const maxPrice = maxPriceRaw + pricePadding;

  const scaleX = (value: number): number => {
    if (maxTime === minTime) return padding.left + innerWidth / 2;
    return padding.left + ((value - minTime) / (maxTime - minTime)) * innerWidth;
  };

  const scaleY = (value: number): number => {
    if (maxPrice === minPrice) return padding.top + innerHeight / 2;
    return padding.top + (1 - (value - minPrice) / (maxPrice - minPrice)) * innerHeight;
  };

  const gridLines = showAxes
    ? Array.from({ length: 4 }, (_, index) => {
        const ratio = index / 3;
        const value = maxPrice - (maxPrice - minPrice) * ratio;
        const y = scaleY(value);
        return `
          <line x1="${padding.left}" y1="${y.toFixed(2)}" x2="${(padding.left + innerWidth).toFixed(2)}" y2="${y.toFixed(2)}" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
          <text x="${(padding.left - 8).toFixed(2)}" y="${(y + 4).toFixed(2)}" fill="rgba(255,255,255,0.52)" font-size="10" text-anchor="end">${escapeHtml(value.toFixed(2))}</text>
        `;
      }).join('')
    : '';

  const startLabel = new Date(minTime).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const endLabel = new Date(maxTime).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

  const axisLabels = showAxes
    ? `
      <text x="${padding.left}" y="${options.height - 4}" fill="rgba(255,255,255,0.52)" font-size="10">${escapeHtml(startLabel)}</text>
      <text x="${padding.left + innerWidth}" y="${options.height - 4}" fill="rgba(255,255,255,0.52)" font-size="10" text-anchor="end">${escapeHtml(endLabel)}</text>
    `
    : '';

  const seriesPaths = numericSeries.map((series) => {
    const path = series.numericPoints.map((point, index) => {
      const x = scaleX(point.time).toFixed(2);
      const y = scaleY(point.price).toFixed(2);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    const lastPoint = series.numericPoints[series.numericPoints.length - 1];
    const lastX = scaleX(lastPoint.time).toFixed(2);
    const lastY = scaleY(lastPoint.price).toFixed(2);

    return `
      <path d="${path}" fill="none" stroke="${series.color}" stroke-width="${showAxes ? 2.2 : 2}" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="${lastX}" cy="${lastY}" r="${showAxes ? 2.4 : 2.1}" fill="${series.color}" />
    `;
  }).join('');

  return `
    <svg viewBox="0 0 ${options.width} ${options.height}" width="${options.width}" height="${options.height}" role="img" aria-label="Évolution des prix des carburants">
      ${gridLines}
      ${seriesPaths}
      ${axisLabels}
    </svg>
  `;
}

export function formatFuelPrice(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'n.d.';
  return `${value.toFixed(3).replace('.', ',')} €/L`;
}

export function formatFuelDeltaCents(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'n.d.';
  const rounded = Math.round(value * 10) / 10;
  const prefix = rounded > 0 ? '+' : '';
  return `${prefix}${rounded.toFixed(1).replace('.', ',')} c/L`;
}
