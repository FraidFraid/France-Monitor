import { describe, it, expect } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { sanitizeEvents, buildEvidenceIndex, formatEventsBlock, applyEvidence } from '../api/_lib/brief-evidence.js';

const events = sanitizeEvents([
  { id: 'E42', title: 'Gironde : plan ORSEC déclenché après des inondations', category: 'weather', severity: 'high', sources: ['Sud Ouest', 'France Info'], sourceCount: 3, independentCount: 2, lastSeen: '2026-09-23T06:00:00Z', status: 'active' },
  { id: 'E43', title: 'Lyon : incendie d’un entrepôt à Vénissieux', category: 'security', severity: 'medium', sources: ['Le Progrès'], sourceCount: 1, independentCount: 1, lastSeen: '2026-09-23T06:00:00Z', status: 'active' },
  { id: 'X9', title: 'identifiant invalide' },
  { id: 'E7', title: '' },
]);
const index = buildEvidenceIndex(events, [{ title: 'Tension électrique', sourceRefs: ['Écowatt RTE'] }]);

describe('sanitizeEvents', () => {
  it('ne garde que les événements bien formés', () => {
    expect(events.map((e: { id: string }) => e.id)).toEqual(['E42', 'E43']);
  });
});

describe('formatEventsBlock', () => {
  it('liste les identifiants citables avec leur corroboration', () => {
    expect(formatEventsBlock(events.slice(0, 1), 'fr')).toBe('E42 [weather/high, 3 source(s), 2 indépendante(s), active] Gironde : plan ORSEC déclenché après des inondations');
  });
});

describe('applyEvidence', () => {
  it('déduit les sources des preuves citées, jamais du modèle', () => {
    const out = applyEvidence({ evidence: ['e42', 'S1'], confidence: 'high', sources: ['Le Progrès'] }, index);
    expect(out).toEqual({ evidence: ['E42', 'S1'], sources: ['Sud Ouest', 'France Info', 'Écowatt RTE'], unsupported: false, confidence: 'high' });
  });

  it('marque non étayé et ramène la confiance à faible quand aucune preuve n’est connue', () => {
    expect(applyEvidence({ evidence: ['E999'], confidence: 'high' }, index))
      .toEqual({ evidence: [], sources: [], unsupported: true, confidence: 'low' });
    expect(applyEvidence({ confidence: 'moderate' }, index).unsupported).toBe(true);
  });

  it('ramène « high » à « moderate » quand aucune preuve citée n’est corroborée', () => {
    expect(applyEvidence({ evidence: ['E43'], confidence: 'high' }, index).confidence).toBe('moderate');
    expect(applyEvidence({ evidence: ['E43', 'E42'], confidence: 'high' }, index).confidence).toBe('high');
  });
});
