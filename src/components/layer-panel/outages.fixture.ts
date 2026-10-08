// src/components/layer-panel/outages.fixture.ts : réponses des panneaux Pannes réseau construites par les fonctions pures des
// collecteurs sur les jeux d'essai réels du 08/10/2026 (tests/fixtures/outages/). Copie neuve à chaque appel. Jamais importé par
// l'application (l'import de node:fs n'atteint pas le paquet du navigateur).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyTelecom, dedupeSites, normalizeArcepFeature, summarizeTelecom } from '../../../api/_lib/outages-telecom.js';
import {
  buildPower, iipTransmission, iipUnits, latestVersions, mergeUnits, normalizeEdfLine, parseIipFeed, seiSignal,
} from '../../../api/_lib/outages-power.js';
import type { PowerOutagesResponse, PowerUnitOutage, TelecomOutagesResponse, TelecomSite } from '../../types/index.ts';

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

/**
 * Réponse Électricité du 08/10/2026 à 22 h (jeux EDF, IIP production et transport, SEI Réunion et Corse). Dates posées pour que la vue de
 * référence ne soit pas « en retard » : jeu EDF à 19 h UTC, dernière lecture EDF à 19 h 40 UTC (le retard se mesure dessus, R20).
 */
export function powerFixtureResponse(): PowerOutagesResponse {
  const now = OUTAGES_FIXTURE_NOW;
  const edf = (JSON.parse(fx('edf-indispo-2026-10-08.json')) as { results: unknown[] }).results
    .map((l) => normalizeEdfLine(l) as PowerUnitOutage | null).filter((u): u is PowerUnitOutage => u !== null);
  const iip = iipUnits(latestVersions(parseIipFeed(fx('iip-production-2026-10-08.xml'))), now) as PowerUnitOutage[];
  const transmission = iipTransmission(latestVersions(parseIipFeed(fx('iip-transmission-2026-10-08.xml'))), now) as NonNullable<PowerOutagesResponse['transmission']>;
  const islands = [seiSignal(JSON.parse(fx('sei-meteo-reseau-reunion-2026-10-08.json')), 'reunion', now), seiSignal(JSON.parse(fx('sei-ecorsicawatt-2026-10-08.json')), 'corse', now)]
    .filter((s): s is PowerOutagesResponse['islands'][number] => s !== null);
  // Les dates d'état sont posées après coup : le typage déduit des valeurs par défaut de buildPower (null) refuserait des chaînes.
  const built = buildPower({
    edf: mergeUnits(edf, iip), iip: { transmission }, sei: islands,
    history: [{ day: '2026-10-03', unplannedMw: 6340 }, { day: '2026-10-08', unplannedMw: 2985 }], errors: [],
  }, now) as PowerOutagesResponse;
  return { ...built, edfUpdatedAt: '2026-10-08T19:00:00.000Z', edfReadAt: '2026-10-08T19:40:00.000Z', iipPublishedAt: '2026-10-08T19:24:36.000Z' };
}
