// src/components/layer-panel/nuclear-asnr.test.ts
// Section « Sûreté (ASNR) » du panneau Nucléaire (spec 2026-10-13) : trois groupes du plus fort au plus discret, badge INES ou « INES n.d. »,
// relevé indisponible avec l'heure du dernier bon relevé, relevé en retard, aucun tiret cadratin.
import { describe, expect, it } from 'vitest';
import type { AsnrEvent, AsnrResponse } from '../../types/index.ts';
import { asnrSection } from './nuclear.ts';

const NOW = Date.parse('2026-10-13T08:00:00Z');
const open = (): boolean => true;
const ev = (over: Partial<AsnrEvent>): AsnrEvent => ({
  id: 'asnr-a', url: 'https://www.asnr.fr/actualites/a', title: 'Incident à la centrale nucléaire de Flamanville (Manche)', date: '2026-10-01',
  kind: 'installation', ines: null, plantId: 'nuc-flamanville', site: 'Flamanville', ...over,
});
const resp = (events: AsnrEvent[], over: Partial<AsnrResponse> = {}): AsnrResponse => ({ readAt: '2026-10-13T07:30:00.000Z', events, errors: [], ...over });

describe('asnrSection', () => {
  it('groupes dans l’ordre crise, installation, radioprotection ; groupe vide masqué', () => {
    const s = asnrSection({ data: resp([
      ev({ id: 'r', kind: 'radioprotection', ines: 2, title: '[Hospices civils de Lyon] Contamination externe', plantId: null, site: null, date: '2026-07-22' }),
      ev({ id: 'c', kind: 'crise', title: 'L’ASNR active son centre de crise (Chooz)', date: '2026-06-30' }),
    ]), error: null, fetchedAt: NOW }, NOW, open);
    expect(s.title).toBe('Sûreté (ASNR)');
    const html = s.html;
    expect(html.indexOf('Centre de crise activé')).toBeLessThan(html.indexOf('Radioprotection'));
    expect(html).not.toContain('Installations nucléaires');
    expect(html).toContain('INES 2');
    expect(html).toContain('le 30 juin');
    expect(html).not.toContain('—');
  });
  it('INES absent : « INES n.d. » ; lien vers l’avis', () => {
    const html = asnrSection({ data: resp([ev({})]), error: null, fetchedAt: NOW }, NOW, open).html;
    expect(html).toContain('INES n.d.');
    expect(html).toContain('href="https://www.asnr.fr/actualites/a"');
  });
  it('journal vide : « Aucun événement publié sur 12 mois »', () => {
    expect(asnrSection({ data: resp([]), error: null, fetchedAt: NOW }, NOW, open).html).toContain('Aucun événement publié sur 12 mois');
  });
  it('route en panne : « Relevé ASNR indisponible » avec l’heure du dernier bon relevé ; jamais lu : sans heure', () => {
    const down = asnrSection({ data: resp([ev({})]), error: 'HTTP 502', fetchedAt: NOW - 3_600_000 }, NOW, open).html;
    expect(down).toMatch(/Relevé ASNR indisponible, dernier relevé à \d{2}:\d{2}/);
    expect(asnrSection({ data: null, error: 'HTTP 502', fetchedAt: null }, NOW, open).html).toContain('Relevé ASNR indisponible');
  });
  it('relevé du serveur de plus de 3 h : « relevé en retard »', () => {
    const late = asnrSection({ data: resp([ev({})], { readAt: '2026-10-13T03:00:00.000Z' }), error: null, fetchedAt: NOW }, NOW, open);
    expect(late.summary).toContain('relevé en retard');
  });
  it('chargement : section « chargement… »', () => {
    expect(asnrSection(null, NOW, open).summary).toBe('chargement…');
  });
});
