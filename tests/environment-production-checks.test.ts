// tests/environment-production-checks.test.ts
// Contrôles de production des routes Environnement (arbitrage du plan, vague finale, point 4) : chaque gestionnaire de
// api/_handlers/environment/*.js est interrogé par le test de fumée, décrit dans l'OpenAPI et listé dans docs/api.md avec la
// cadence de son vrai cache CDN. Une route ajoutée sans ces trois contrôles fait échouer ce test.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const at = (path: string): URL => new URL(`../${path}`, import.meta.url);
const read = (path: string): string => readFileSync(at(path), 'utf8');
const ROUTES = readdirSync(at('api/_handlers/environment/')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();

interface OpenApiOperation { tags?: string[]; description?: string; responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }
interface OpenApiDoc { paths: Record<string, { get?: OpenApiOperation }>; components: { schemas: Record<string, unknown> } }

/** Cadence lisible d'un s-maxage (« 5 min », « 30 min », « 1 h »). */
function cadence(cacheControl: string): string {
  const sec = Number(/s-maxage=(\d+)/.exec(cacheControl)?.[1]);
  return sec % 3600 === 0 ? `${sec / 3600} h` : `${sec / 60} min`;
}

async function cacheControlOf(route: string): Promise<string> {
  const mod = (await import(`../api/_handlers/environment/${route}.js`)) as { CACHE_CONTROL: string };
  return mod.CACHE_CONTROL;
}

describe('routes /api/environment/* : contrôles de production', () => {
  it('sept gestionnaires (phases A et B)', () => {
    expect(ROUTES).toEqual(['air', 'drought', 'earthquakes', 'fires', 'floods', 'sea-levels', 'vigilance']);
  });

  it('test de fumée : chaque route interrogée, 200 attendu', () => {
    const smoke = read('.github/workflows/smoke.yml');
    for (const r of ROUTES) expect(smoke, r).toContain(`"/api/environment/${r};200"`);
  });

  it('OpenAPI : chaque route décrite (GET, tag Environnement, 200 et 502 sur un schéma décrit, cache CDN du gestionnaire)', async () => {
    const doc = JSON.parse(read('public/openapi.json')) as OpenApiDoc;
    for (const r of ROUTES) {
      const op = doc.paths[`/api/environment/${r}`]?.get;
      expect(op, r).toBeDefined();
      expect(op?.tags, r).toContain('Environnement');
      expect(op?.description, r).toContain(`\`${await cacheControlOf(r)}\``);
      for (const code of ['200', '502']) {
        const ref = op?.responses?.[code]?.content?.['application/json']?.schema?.$ref ?? '';
        expect(ref, `${r} ${code}`).toMatch(/^#\/components\/schemas\//);
        expect(doc.components.schemas[ref.replace('#/components/schemas/', '')], `${r} ${code}`).toBeDefined();
      }
    }
  });

  it('docs/api.md : chaque route listée, avec la cadence de son cache CDN', async () => {
    const doc = read('docs/api.md');
    const cacheRows = doc.split('\n').filter((l) => l.startsWith('| `/api/environment/'));
    for (const r of ROUTES) {
      expect(doc, r).toContain(`| \`GET /api/environment/${r}\` |`);
      const row = cacheRows.find((l) => l.includes(`\`/api/environment/${r}\``));
      expect(row, r).toBeDefined();
      expect(row, r).toContain(cadence(await cacheControlOf(r)));
    }
  });
});
