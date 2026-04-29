import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  mergeFuelPriceSeriesCache,
  readFuelPriceSeriesCache,
  fetchDailyFuelPriceSnapshot,
} from '../api/_lib/fuel-price-series.js';

const outputPath = path.join(process.cwd(), 'public', 'data', 'fuel-price-series.json');

const existing = await readFuelPriceSeriesCache();
const snapshot = await fetchDailyFuelPriceSnapshot();
const payload = mergeFuelPriceSeriesCache(existing, snapshot);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(`fuel-price-series: wrote ${outputPath}`);
console.log(`fuel-price-series: date ${snapshot.date}, updatedAt ${payload.updatedAt}`);
