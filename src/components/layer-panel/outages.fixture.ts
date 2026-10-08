// src/components/layer-panel/outages.fixture.ts : réponses des panneaux Pannes réseau construites par les fonctions pures des
// collecteurs sur les jeux d'essai réels du 08/10/2026 (tests/fixtures/outages/). Copie neuve à chaque appel. Jamais importé par
// l'application (l'import de node:fs n'atteint pas le paquet du navigateur).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyTelecom, dedupeSites, normalizeArcepFeature, summarizeTelecom } from '../../../api/_lib/outages-telecom.js';
import type { TelecomOutagesResponse, TelecomSite } from '../../types/index.ts';

const fx = (name: string): string => readFileSync(resolve(import.meta.dirname, '../../../tests/fixtures/outages', name), 'utf8');

/** Heure des vues : 08/10/2026 22 h à Paris. */
export const OUTAGES_FIXTURE_NOW = Date.parse('2026-10-08T20:00:00Z');

export function telecomFixtureResponse(): TelecomOutagesResponse {
  const read = (name: string): TelecomSite[] => dedupeSites((JSON.parse(fx(name)) as { features: unknown[] }).features
    .map((f) => normalizeArcepFeature(f) as TelecomSite | null).filter((s): s is TelecomSite => s !== null));
  const sites = classifyTelecom(read('arcep-2026-10-08.geojson'), Date.parse('2026-10-08T09:02:20Z')) as TelecomSite[];
  const prev = new Set(read('arcep-2026-10-07.geojson').map((s) => s.id));
  const { summary, byOperator, byDept } = summarizeTelecom(sites, prev) as Pick<TelecomOutagesResponse, 'summary' | 'byOperator' | 'byDept'>;
  return {
    readAt: '2026-10-08T19:40:00.000Z', file: { day: '2026-10-08', publishedAt: '2026-10-08T09:02:20.000Z' },
    previousFile: { day: '2026-10-07', publishedAt: '2026-10-07T09:02:12.000Z' }, summary, byOperator, byDept, sites,
    history: [{ day: '2026-10-07', recent: 12 }, { day: '2026-10-08', recent: 18 }], errors: [],
  };
}
