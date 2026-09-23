import { describe, expect, it, vi } from 'vitest';
import type { FireIncident } from '../types/index.ts';
import { resolveIncidentGeography, cellKey } from './incident-geography.ts';

/** Décode l'URL amont passée en paramètre `url` à `/api/opendata-proxy`. */
function decodedUpstreamUrl(calledUrl: string): string {
  const url = new URL(calledUrl, 'http://localhost');
  return url.searchParams.get('url') ?? '';
}

function incident(id: string, lat: number, lon: number): FireIncident {
  return {
    id, centroidLat: lat, centroidLon: lon,
    bboxMinLat: lat - 0.1, bboxMaxLat: lat + 0.1,
    bboxMinLon: lon - 0.1, bboxMaxLon: lon + 0.1,
    detectionsCount: 650, frpMean: 11, frpMax: 222, frpTotal: 7178,
    confidenceMax: 'high', startDatetime: '2026-07-26T01:32:00Z',
    endDatetime: '2026-07-26T12:55:00Z', durationMinutes: 683,
    satellites: ['SNPP'], hasNightDetection: true, nearUrban: true,
    clusterMethod: 'dbscan', epsKm: 3, minPoints: 2,
    score: { severityScore: 90, impactScore: 80, labels: [] }, detectionIds: [],
  } as FireIncident;
}

function ok(nom: string, dept: string) {
  return new Response(JSON.stringify([{ nom, codeDepartement: dept }]), { status: 200 });
}

describe('resolveIncidentGeography', () => {
  it('résout département et commune depuis geo.api.gouv.fr', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('Lanton', '33'));
    const [located] = await resolveIncidentGeography(
      [incident('a', 44.7794, -0.9253)],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(located.deptCodes).toEqual(['33']);
    expect(located.communes).toEqual(['Lanton']);
    // Appel passé par /api/opendata-proxy (cache CDN, conformité §2.4) —
    // on vérifie l'hôte amont réel en décodant le paramètre `url`.
    const calledUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('/api/opendata-proxy?url=');
    expect(decodedUpstreamUrl(calledUrl)).toContain('geo.api.gouv.fr/communes');
  });

  it('agrège plusieurs départements — un incident peut chevaucher (§3.5)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok('Lanton', '33'))
      .mockResolvedValueOnce(ok('Biscarrosse', '40'))
      .mockResolvedValue(ok('Lanton', '33'));
    const [located] = await resolveIncidentGeography(
      [incident('a', 44.7794, -0.9253)],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(located.deptCodes.sort()).toEqual(['33', '40']);
  });

  it('renvoie des listes vides sans lever si le service échoue', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const [located] = await resolveIncidentGeography(
      [incident('a', 44.7794, -0.9253)],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(located.deptCodes).toEqual([]);
    expect(located.communes).toEqual([]);
    expect(located.id).toBe('a');
  });

  it('réutilise le cache : deux incidents de la même maille = un seul appel', async () => {
    // mockImplementation (et non mockResolvedValue) : une instance Response fraîche
    // à chaque appel, fidèle à un vrai fetch — mockResolvedValue partagerait la même
    // instance partout, ce que clone() tolère mais que ce test n'a pas besoin de masquer.
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(ok('Lanton', '33')));
    const cache = new Map();
    await resolveIncidentGeography([incident('a', 44.7794, -0.9253)],
      { fetchImpl: fetchImpl as unknown as typeof fetch, cache });
    const before = fetchImpl.mock.calls.length;
    await resolveIncidentGeography([incident('b', 44.7794, -0.9253)],
      { fetchImpl: fetchImpl as unknown as typeof fetch, cache });
    expect(fetchImpl.mock.calls.length).toBe(before);
  });

  it('arrondit la maille de cache à 0,05 degré', () => {
    expect(cellKey(44.7794, -0.9253)).toBe(cellKey(44.7801, -0.9249));
    expect(cellKey(44.7794, -0.9253)).not.toBe(cellKey(44.9, -0.9253));
  });

  it('single-flight : 5 échantillons d\'un incident compact dans la même maille = 1 seul appel', async () => {
    const lat = 44.7794, lon = -0.9253;
    // bbox ±0,001° au lieu de ±0,1° : centroïde et 4 coins doivent tous retomber
    // dans la même maille de 0,05°, pour stresser la déduplication intra-lot.
    const compact: FireIncident = {
      ...incident('a', lat, lon),
      bboxMinLat: lat - 0.001, bboxMaxLat: lat + 0.001,
      bboxMinLon: lon - 0.001, bboxMaxLon: lon + 0.001,
    };
    const sampleKeys = new Set([
      cellKey(compact.centroidLat, compact.centroidLon),
      cellKey(compact.bboxMinLat, compact.bboxMinLon),
      cellKey(compact.bboxMinLat, compact.bboxMaxLon),
      cellKey(compact.bboxMaxLat, compact.bboxMinLon),
      cellKey(compact.bboxMaxLat, compact.bboxMaxLon),
    ]);
    // Si cette assertion échoue, le test ne prouve rien : les 5 échantillons
    // doivent partager une seule maille pour que la dédup soit sollicitée.
    expect(sampleKeys.size).toBe(1);

    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(ok('Lanton', '33')));
    await resolveIncidentGeography([compact], { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl.mock.calls.length).toBe(1);
  });
});

describe('resolveIncidentGeography — appel groupé /api/geo/communes', () => {
  it('résout toutes les mailles en un seul appel groupé', async () => {
    const incident = {
      id: 'inc-1', centroidLat: 44.70, centroidLon: -1.05,
      bboxMinLat: 44.60, bboxMinLon: -1.20, bboxMaxLat: 44.80, bboxMaxLon: -0.90,
    } as unknown as FireIncident;
    const fetchImpl = vi.fn(async (url: string) => {
      const points = decodeURIComponent(url.split('points=')[1] ?? '').split(';');
      return new Response(JSON.stringify({ results: points.map((_, i) => ({ nom: `Commune ${i}`, codeDepartement: i % 2 ? '40' : '33' })) }));
    });
    const [located] = await resolveIncidentGeography([incident], { fetchImpl: fetchImpl as unknown as typeof fetch, useBatch: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/api/geo/communes?points=');
    expect(located?.deptCodes.sort()).toEqual(['33', '40']);
  });

  it('retombe sur le chemin point par point si l’appel groupé échoue', async () => {
    const incident = {
      id: 'inc-2', centroidLat: 44.70, centroidLon: -1.05,
      bboxMinLat: 44.70, bboxMinLon: -1.05, bboxMaxLat: 44.70, bboxMaxLon: -1.05,
    } as unknown as FireIncident;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('/api/geo/communes')) return new Response('down', { status: 503 });
      return new Response(JSON.stringify([{ nom: 'Lanton', codeDepartement: '33' }]));
    });
    const [located] = await resolveIncidentGeography([incident], { fetchImpl: fetchImpl as unknown as typeof fetch, useBatch: true });
    expect(located?.communes).toEqual(['Lanton']);
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
