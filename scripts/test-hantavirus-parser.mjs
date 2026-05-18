import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Buffer } from 'node:buffer';

async function loadHantavirusModule() {
  const result = await build({
    entryPoints: ['/Users/fraid/Desktop/FranceMonitor/src/services/hantavirus.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    target: ['node20'],
  });

  const code = result.outputFiles[0]?.text;
  if (!code) throw new Error('Unable to bundle hantavirus service');

  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return import(dataUrl);
}

const hantavirusModule = await loadHantavirusModule();
const { parseDgsUrgentTextToEvent } = hantavirusModule;

test('detects Andes MV Hondius DGS alert', () => {
  const text = 'Alerte hantavirus Andes liée au navire MV Hondius. Prise en charge Bichat.';
  const event = parseDgsUrgentTextToEvent(text, 'https://sante.gouv.fr/test.pdf');
  assert.ok(event);
  assert.equal(event.souche, 'Andes');
  assert.equal(event.territoire_code, 'SHIP-MV-HONDIUS');
  assert.equal(event.severite, 'crise');
  assert.equal(event.kind, 'ship_cluster');
});

test('ignores non-hantavirus DGS alert', () => {
  const event = parseDgsUrgentTextToEvent('Alerte grippe saisonnière', 'https://sante.gouv.fr/x.pdf');
  assert.equal(event, null);
});
