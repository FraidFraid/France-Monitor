import { describe, expect, it } from 'vitest';
import { isOutagesNowResponse, outageProof } from './outages-now.ts';

const body = () => ({
  generatedAt: '2026-10-21T12:00:00.000Z',
  outages: [{
    id: 'cloud|op:OVHcloud', network: 'cloud', scope: 'operateur', operator: 'OVHcloud', dept: null, label: 'OVHcloud', level: 'rouge',
    since: '2026-10-21T11:00:00Z', national: false, measured: true, rung: 'confirmee',
    evidence: [{ source: 'statut', text: 'Incident RBX', at: '2026-10-21T11:00:00Z', link: 'https://status.ovh' }],
  }],
  journal: [{ at: '2026-10-21T12:00:00.000Z', kind: 'nouvelle', id: 'cloud|op:OVHcloud', network: 'cloud', name: 'OVHcloud', dept: null, level: 'rouge', rung: 'confirmee' }],
  sources: [{ source: 'statut', readAt: '2026-10-21T11:50:00Z', ok: true }],
  errors: [],
});

describe('contrat /api/outages/now', () => {
  it('réponse conforme acceptée ; sans journal, réseau ou source inconnus : refusée', () => {
    expect(isOutagesNowResponse(body())).toBe(true);
    const { journal: _j, ...noJournal } = body();
    expect(isOutagesNowResponse(noJournal)).toBe(false);
    expect(isOutagesNowResponse({ ...body(), sources: [{ source: 'downdetector', readAt: null, ok: true }] })).toBe(false);
    const bad = body();
    bad.outages[0] = { ...bad.outages[0], network: 'eau' } as never;
    expect(isOutagesNowResponse(bad)).toBe(false);
  });
  it('preuve : échelon en mots et sources', () => {
    const [o] = body().outages;
    if (o) expect(outageProof(o as never)).toBe('confirmée : page d’état');
    expect(outageProof({ rung: 'signalee', evidence: [{ source: 'presse', text: '', at: null, link: null }] })).toBe('signalée, non confirmée : presse');
  });
});
