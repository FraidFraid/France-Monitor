// Météo des forêts (spec 2026-10-04 environnement § 2.4, E1, S2) : fichier réel 2026 réduit aux publications du 22/09 et du
// 03/10/2026 ; le gzip est construit ici, comme le serveur le reçoit.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import {
  FOREST_DANGER_SEASON, __resetForestDangerForTests, forestDangerSeason, forestDangerTtlSec, loadForestDanger, mdfUrl, parseMdfCsv,
} from '../api/_lib/forest-danger.js';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';
import { type FakeResponse, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T10:10:00+02:00');
const MDF = fx('meteo-des-forets-2026-extrait.csv');

/** Réponse binaire (le fichier est lu en octets, jamais en texte). */
function binary(body: Buffer | string, status = 200): FakeResponse {
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  return { ...respond('', status), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) } as FakeResponse;
}

beforeEach(() => { __resetSwrCacheForTests(); __resetForestDangerForTests(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('parseMdfCsv', () => {
  it('dernier jour publié (03/10 16 h 50) : J1 le 04/10, J2 le 05/10, 96 départements, 10 au niveau 2 en J1', () => {
    const fd = parseMdfCsv(MDF, NOW);
    expect([fd.publishedAt, fd.j1Date, fd.j2Date, fd.season]).toEqual(['2026-10-03T14:50:06Z', '2026-10-04', '2026-10-05', 'en-saison']);
    expect(fd.departments).toHaveLength(96);
    expect(fd.departments.filter((d) => d.j1 === 2).map((d) => d.dept)).toEqual(['04', '06', '13', '2A', '2B', '31', '44', '51', '83', '84']);
    expect(fd.departments.filter((d) => d.j2 === 2).map((d) => d.dept)).toEqual(['06', '2A', '2B', '51', '83']);
    expect(fd.departments.find((d) => d.dept === '13')).toEqual({ dept: '13', name: 'Bouches-du-Rhône', j1: 2, j2: 1 });
    expect(fd.departments.find((d) => d.dept === '2A')?.name).toBe('Corse-du-Sud');
  });
  it('historique de la saison, daté du jour J1 : 77 départements au niveau 2 ou plus pour la publication du 22/09', () => {
    expect(parseMdfCsv(MDF, NOW).history).toEqual([
      { date: '2026-09-23', n1: 19, n2: 75, n3: 2, n4: 0 },
      { date: '2026-10-04', n1: 86, n2: 10, n3: 0, n4: 0 },
    ]);
  });
  it('extrait de six lignes ; niveaux illisibles écartés ; en-tête inattendu ou fichier sans ligne : erreur', () => {
    expect(parseMdfCsv(fx('meteo-des-forets-mdf-extrait.csv'), NOW).departments.map((d) => [d.dept, d.j1])).toEqual([
      ['01', 1], ['02', 1], ['03', 1], ['04', 2], ['06', 2], ['13', 2],
    ]);
    const header = 'date;num_dep;niveau_j1;niveau_j2;nom_dep';
    expect(parseMdfCsv(`${header}\n2026-10-03T14:50:06Z;13;5;1;Bouches-du-Rhône\n2026-10-03T14:50:06Z;84;2;1;Vaucluse\n`, NOW).departments).toEqual([
      { dept: '84', name: 'Vaucluse', j1: 2, j2: 1 },
    ]);
    expect(() => parseMdfCsv('<!DOCTYPE html><html></html>', NOW)).toThrow('CSV météo des forêts illisible');
    expect(() => parseMdfCsv(`${header}\n`, NOW)).toThrow('CSV météo des forêts sans ligne lisible');
  });
});

describe('saison et durée du cache', () => {
  it('en saison de juin à septembre, ou publication de moins de 72 h ; hors saison sinon (jamais « en retard »)', () => {
    expect(FOREST_DANGER_SEASON).toEqual({ fromMonth: 6, toMonth: 9, offSeasonAfterHours: 72 });
    expect(forestDangerSeason('2026-10-03T14:50:06Z', NOW)).toBe('en-saison');
    expect(forestDangerSeason('2026-09-30T14:50:06Z', Date.parse('2026-10-15T10:00:00+02:00'))).toBe('hors-saison');
    expect(forestDangerSeason('2026-10-03T14:50:06Z', Date.parse('2026-10-07T12:00:00+02:00'))).toBe('hors-saison');
    expect(forestDangerSeason(null, Date.parse('2026-08-15T12:00:00+02:00'))).toBe('en-saison');
    expect(parseMdfCsv(MDF, Date.parse('2026-10-15T10:00:00+02:00')).season).toBe('hors-saison');
  });
  it('relue toutes les heures entre 14 h et 18 h UTC en saison, toutes les 6 h sinon', () => {
    expect(forestDangerTtlSec(Date.parse('2026-10-04T14:30:00Z'), '2026-10-03T14:50:06Z')).toBe(3_600);
    expect(forestDangerTtlSec(NOW, '2026-10-03T14:50:06Z')).toBe(21_600);
    expect(forestDangerTtlSec(Date.parse('2026-08-15T15:00:00Z'))).toBe(3_600);
    expect(forestDangerTtlSec(Date.parse('2026-10-15T15:00:00Z'), '2026-09-30T14:50:06Z')).toBe(21_600);
  });
});

describe('loadForestDanger (lecture binaire stricte, cache partagé)', () => {
  it('fichier de l’année lu, User-Agent du projet ; seconde lecture servie par le cache', async () => {
    const log = stubFetch((url) => (url === mdfUrl(2026) ? binary(gzipSync(MDF)) : respond('introuvable', 404)));
    const first = await loadForestDanger(NOW);
    expect(first.errors).toEqual([]);
    expect(first.forestDanger?.publishedAt).toBe('2026-10-03T14:50:06Z');
    expect(log.urls).toEqual(['https://meteofrance.s3.sbg.io.cloud.ovh.net/data/BULLETIN/MDF/mdf_2026.csv.gz']);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
    await loadForestDanger(NOW + 60_000);
    expect(log.urls).toHaveLength(1);
  });
  it('début d’année : fichier de l’année absent (404), celui de l’année précédente lu, hors saison', async () => {
    const old = 'date;num_dep;niveau_j1;niveau_j2;nom_dep\n2025-10-15T14:50:05Z;13;1;1;Bouches-du-Rhône\n';
    const log = stubFetch((url) => (url === mdfUrl(2025) ? binary(gzipSync(old)) : binary('<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>', 404)));
    const { forestDanger, errors } = await loadForestDanger(Date.parse('2026-01-10T12:00:00+01:00'));
    expect(log.urls.map((u) => u.slice(-15))).toEqual(['mdf_2026.csv.gz', 'mdf_2025.csv.gz']);
    expect(errors).toEqual([]);
    expect(forestDanger).toMatchObject({ publishedAt: '2025-10-15T14:50:05Z', j1Date: '2025-10-16', season: 'hors-saison' });
  });
  it('lignes illisibles ou en double : nommées, jamais comptées deux fois, aucun champ de plus servi', async () => {
    const header = 'date;num_dep;niveau_j1;niveau_j2;nom_dep';
    const csv = [
      header,
      '2026-10-03T14:50:06Z;84;2;1;Vaucluse',
      '2026-10-03T14:50:06Z;84;2;1;Vaucluse',
      '2026-10-03T14:50:06Z;13;5;1;Bouches-du-Rhône',
      'pas une date;83;2;2;Var',
      '2026-10-03T14:50:06Z;83;2;2;Var',
    ].join('\n');
    stubFetch(() => binary(gzipSync(csv)));
    const { forestDanger, errors } = await loadForestDanger(NOW);
    expect(errors).toEqual(['Météo des forêts : 2 lignes illisibles', 'Météo des forêts : 1 ligne en double']);
    expect(forestDanger?.departments.map((d) => d.dept)).toEqual(['83', '84']);
    expect(forestDanger?.history).toEqual([{ date: '2026-10-04', n1: 0, n2: 2, n3: 0, n4: 0 }]);
    expect(Object.keys(forestDanger ?? {}).sort()).toEqual(['departments', 'history', 'j1Date', 'j2Date', 'publishedAt', 'season']);
  });
  it.each([
    ['page HTML', () => binary('<!DOCTYPE html><html><body>Maintenance</body></html>'), 'Météo des forêts : page HTML reçue au lieu de données'],
    ['CSV non compressé', () => binary(MDF), 'Météo des forêts : fichier compressé (gzip) attendu'],
    ['gzip tronqué', () => binary(gzipSync(MDF).subarray(0, 40)), 'Météo des forêts : fichier compressé illisible'],
    ['HTTP 503', () => binary('indisponible', 503), 'Météo des forêts : HTTP 503'],
    ['corps vide', () => binary(''), 'Météo des forêts : réponse vide'],
  ])('%s : panne nommée, aucune donnée inventée', async (_name, response, error) => {
    stubFetch(() => response());
    expect(await loadForestDanger(NOW)).toEqual({ forestDanger: null, errors: [error] });
  });
});
