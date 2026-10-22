// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { OutagesNowResponse } from '../types/index.ts';
import { NBSP } from './layer-panel/format.ts';
import { OutagesNowBanner, outageName, renderOutagesNow } from './OutagesNowBanner.ts';

const NOW = Date.parse('2026-10-21T12:30:00Z');
const body = (): OutagesNowResponse => ({
  generatedAt: '2026-10-21T12:30:00Z',
  outages: [
    { id: 'mobile|op:Orange', network: 'mobile', rung: 'signalee', scope: 'operateur', operator: 'Orange', dept: null, label: 'Orange', level: 'orange', since: '2026-10-21T10:00:00Z', national: true, measured: false,
      evidence: [{ source: 'presse', text: '19 articles : Orange en panne', at: '2026-10-21T10:00:00Z', link: 'https://ex.fr/a' }] },
    { id: 'internet|dept:32', network: 'internet', rung: 'mesuree', scope: 'departement', operator: null, dept: '32', label: null, level: 'jaune', since: '2026-10-21T09:02:00Z', national: false, measured: true,
      evidence: [{ source: 'arcep', text: '25 antennes', at: null, link: null }, { source: 'ioda', text: 'coupure <b>', at: null, link: null }] },
  ],
  journal: [],
  sources: [{ source: 'presse', readAt: null, ok: true }, { source: 'radar', readAt: null, ok: false }],
  errors: [],
});

describe('bandeau Pannes en cours', () => {
  it('fermé : la plus grave, depuis quand, presse seule dite non confirmée, « + 1 autre »', () => {
    const text = renderOutagesNow(body(), false, NOW).replace(/<[^>]+>/g, '');
    expect(text).toContain(`Panne en cours${NBSP}: Téléphone mobile · Orange, panne nationale`);
    expect(text).toContain(`depuis 12${NBSP}h${NBSP}00`);
    expect(text).toContain('signalée, non confirmée : presse');
    expect(text).toContain(`+${NBSP}1${NBSP}autre`);
  });
  it('ouvert : chaque panne avec ses preuves, texte échappé, département cliquable, sources en défaut', () => {
    const html = renderOutagesNow(body(), true, NOW);
    expect(html).toContain('Gers (32)');
    expect(html).toContain('mesurée : ARCEP, IODA');
    expect(html).toContain('Internet · Gers (32)');
    expect(html).toContain('data-dept="32"');
    expect(html).toContain('coupure &lt;b&gt;');
    expect(html).toContain(`Indisponibles ou en retard${NBSP}: Cloudflare Radar`);
    expect(html).toContain('Téléphone mobile, internet, électricité et cloud');
    const [first] = body().outages;
    if (first) expect(outageName({ ...first, national: false })).toBe('Orange');
  });
  it('lien de preuve : http(s) seulement, jamais javascript:', () => {
    const b = body();
    const [first] = b.outages;
    if (first) first.evidence = [{ source: 'presse', text: 'piège', at: null, link: 'javascript:alert(1)' }];
    expect(renderOutagesNow(b, true, NOW)).not.toContain('javascript:');
  });
  it('aucune panne : bandeau masqué ; clic sur la tête : déplié ; clic sur un département : recentrage', () => {
    const host = document.createElement('div');
    const banner = new OutagesNowBanner(host);
    const el = host.firstElementChild as HTMLElement;
    banner.update({ ...body(), outages: [] });
    expect(el.hidden).toBe(true);
    const flown: number[] = [];
    banner.setOnFlyTo((lon, lat, zoom) => { flown.push(lon, lat, zoom); });
    banner.update(body());
    expect(el.hidden).toBe(false);
    (el.querySelector('.onb-head') as HTMLElement).click();
    expect(el.querySelector('.onb-list')).not.toBeNull();
    (el.querySelector('[data-dept="32"]') as HTMLElement).click();
    expect(flown).toHaveLength(3);
    expect(flown[2]).toBe(8);
  });
});
