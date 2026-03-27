/**
 * build-maires-politique.mjs
 * Usage: node scripts/build-maires-politique.mjs
 *
 * Télécharge le CSV RNE des maires depuis data.gouv.fr
 * Génère public/data/maires-politique.json
 * Format: [{c: "75056", lat: 48.859, lon: 2.347, n: "LDVG", nom: "Anne Hidalgo"}]
 */

import { mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// RNE Maires — export CSV data.gouv.fr
// https://www.data.gouv.fr/fr/datasets/repertoire-national-des-elus-1/
const RNE_CSV_URL = 'https://www.data.gouv.fr/fr/datasets/r/d5f400de-ae3f-4966-8cb6-a85c70c6c24a';
// Centroides communes — data.gouv.fr
const CENTROIDES_URL = 'https://www.data.gouv.fr/fr/datasets/r/dbe8a621-a9c4-4bc3-9cae-be1699c5ff25';

async function fetchCsv(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, { headers: { 'User-Agent': 'FranceMonitor/1.0' } }, (res) => {
      // Follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchCsv(res.headers.location).then(resolve, reject);
        return;
      }
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseCsv(text, separator = ';') {
  const lines = text.split('\n').filter(l => l.trim());
  const headers = lines[0].split(separator).map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(separator).map(v => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

console.log('Downloading RNE maires CSV...');
const rneCsv = await fetchCsv(RNE_CSV_URL);
const rneRows = parseCsv(rneCsv);

// Filtrer les maires uniquement
const maires = rneRows.filter(r =>
  r['Libellé de la fonction']?.toLowerCase().includes('maire') &&
  !r['Libellé de la fonction']?.toLowerCase().includes('adjoint')
);
console.log(`Found ${maires.length} maires`);

// Index by code INSEE
const mairesByCode = new Map();
for (const maire of maires) {
  const code = maire['Code de la commune'] ?? maire['Code commune'];
  if (code) {
    mairesByCode.set(code, {
      nom: `${maire["Prénom de l'élu"] ?? ''} ${maire["Nom de l'élu"] ?? ''}`.trim(),
      nuance: maire['Code nuance'] ?? maire['Libellé nuance'] ?? '',
    });
  }
}

console.log('Downloading communes centroides...');
const centroCsv = await fetchCsv(CENTROIDES_URL);
const centroRows = parseCsv(centroCsv, ',');

const result = [];
for (const row of centroRows) {
  const code = row['com_code'] ?? row['codgeo'] ?? row['code_commune'];
  const lat = parseFloat(row['lat'] ?? row['latitude'] ?? '');
  const lon = parseFloat(row['lon'] ?? row['longitude'] ?? '');
  if (!code || isNaN(lat) || isNaN(lon)) continue;

  const maire = mairesByCode.get(code);
  result.push({
    c: code,
    lat: Math.round(lat * 1000) / 1000,
    lon: Math.round(lon * 1000) / 1000,
    n: maire?.nuance ?? '',
    nom: maire?.nom ?? '',
  });
}

console.log(`Generated ${result.length} communes`);

mkdirSync(path.join(__dirname, '../public/data'), { recursive: true });
await writeFile(
  path.join(__dirname, '../public/data/maires-politique.json'),
  JSON.stringify(result),
  'utf-8'
);
console.log('Written to public/data/maires-politique.json');
