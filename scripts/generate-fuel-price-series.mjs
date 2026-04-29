import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  fetchHistoricalFuelPriceSeries,
} from '../api/_lib/fuel-price-series.js';

const outputPath = path.join(process.cwd(), 'public', 'data', 'fuel-price-series.json');

const payload = await fetchHistoricalFuelPriceSeries();

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(`fuel-price-series: wrote ${outputPath}`);
console.log(`fuel-price-series: updatedAt ${payload.updatedAt}`);
console.log(`fuel-price-series: points ${Object.entries(payload.series).map(([key, series]) => `${key}=${series.length}`).join(', ')}`);
