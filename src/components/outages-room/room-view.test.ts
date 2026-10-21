import { describe, expect, it } from 'vitest';
import type { OutageNow, OutagesNowResponse } from '../../types/index.ts';
import { NBSP } from '../layer-panel/format.ts';
import { detailHtml, feedHtml, nationalBox, networkStrip } from './room-view.ts';

const NOW = Date.parse('2026-10-21T12:30:00Z');
const outage = (over: Partial<OutageNow>): OutageNow => ({
  id: 'mobile|op:Orange', network: 'mobile', scope: 'operateur', operator: 'Orange', dept: null, label: 'Orange', level: 'orange',
  since: '2026-10-21T10:00:00Z', national: true, measured: false, rung: 'signalee',
  evidence: [{ source: 'presse', text: '19 articles', at: '2026-10-21T10:00:00Z', link: 'https://ex.fr/a' }], ...over,
});
const body = (over: Partial<OutagesNowResponse> = {}): OutagesNowResponse => ({
  generatedAt: '2026-10-21T12:30:00Z',
  outages: [
    outage({}),
    outage({ id: 'internet|dept:60', network: 'internet', scope: 'departement', operator: null, dept: '60', label: 'Oise', level: 'jaune', national: false, measured: true, rung: 'mesuree',
      evidence: [{ source: 'ioda', text: 'coupure', at: null, link: null }] }),
  ],
  journal: [
    { at: '2026-10-21T12:20:00Z', kind: 'nouvelle', id: 'internet|dept:60', network: 'internet', name: 'Oise', dept: '60', level: 'jaune', rung: 'mesuree' },
    { at: '2026-10-21T12:01:00Z', kind: 'aggravee', id: 'mobile|op:Orange', network: 'mobile', name: 'Orange', dept: null, level: 'orange', rung: 'signalee' },
  ],
  sources: [
    { source: 'presse', readAt: null, ok: true }, { source: 'arcep', readAt: null, ok: false }, { source: 'ioda', readAt: '2026-10-21T12:25:00Z', ok: true },
    { source: 'radar', readAt: null, ok: false }, { source: 'rte', readAt: null, ok: false }, { source: 'edf', readAt: null, ok: false }, { source: 'statut', readAt: '2026-10-21T12:00:00Z', ok: true },
  ],
  errors: [],
  ...over,
});
/** HTML de la seule case d'un réseau. */
const cell = (html: string, net: string): string => html.match(new RegExp(`<button[^>]*data-net="${net}"[\\s\\S]*?</button>`))?.[0] ?? '';
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/[ \t\n]+/g, ' ');

describe('salle des pannes : barre des réseaux', () => {
  it('neuf cases dans l’ordre ; les réseaux suivis par la seule presse le disent et ne sont jamais verts', () => {
    const html = networkStrip(body({ sources: [...body().sources, { source: 'presse', readAt: null, ok: true }] }), null, NOW);
    const t = text(html);
    const order = ['Téléphone mobile', 'Internet', 'Électricité', 'Cloud', 'Gaz', 'Eau', 'Numéros d’urgence', 'Paiement', 'Télévision'].map((n) => t.indexOf(n));
    expect(order.every((i, k) => i >= 0 && (k === 0 || i > (order[k - 1] ?? -1)))).toBe(true);
    expect(t.match(/presse seule/g)).toHaveLength(5);
    for (const n of ['gaz', 'eau', 'urgence', 'paiement', 'tv']) expect(cell(html, n)).toContain('orm-dot--nd');
  });
  it('panne de gaz signalée par la presse : la case Gaz compte 1, au niveau du signalement', () => {
    const gaz = { ...body().outages[0], id: 'gaz|op:GRDF', network: 'gaz' as const, operator: 'GRDF', label: 'GRDF', level: 'jaune' as const };
    const html = networkStrip(body({ outages: [gaz] }), null, NOW);
    expect(cell(html, 'gaz')).toContain('orm-dot--jaune');
    expect(text(cell(html, 'gaz'))).toContain(' 1 ');
  });
  it('voyant : niveau de la panne la plus grave ; sans panne, vert seulement avec une source fraîche, sinon n.d.', () => {
    const html = networkStrip(body(), null, NOW);
    expect(cell(html, 'mobile')).toContain('orm-dot--orange');
    expect(cell(html, 'cloud')).toContain('orm-dot--vert');
    expect(cell(html, 'electricite')).toContain('orm-dot--nd');
    expect(networkStrip(body(), 'internet', NOW)).toContain('data-net="internet" aria-pressed="true"');
    // La presse ne mesure rien : ARCEP en retard, téléphone mobile sans panne = n.d., jamais vert (spec § 3).
    expect(cell(networkStrip(body({ outages: [] }), null, NOW), 'mobile')).toContain('orm-dot--nd');
  });
});

describe('salle des pannes : encart national, fil, détail', () => {
  it('encart : pannes sans département ; vide : « aucune »', () => {
    expect(text(nationalBox(body(), null, NOW))).toContain('Téléphone mobile · Orange, panne nationale');
    expect(text(nationalBox(body(), 'internet', NOW))).toContain('aucune');
  });
  it('fil : verbes, heure, filtre ; vide : aucun changement', () => {
    const t = text(feedHtml(body().journal, null, NOW));
    expect(t).toContain(`14${NBSP}h${NBSP}20 · nouvelle panne`);
    expect(t).toContain('Oise (60)');
    expect(t).toContain('aggravée');
    expect(text(feedHtml(body().journal, 'mobile', NOW))).not.toContain('Oise');
    expect(text(feedHtml([], null, NOW))).toContain(`Aucun changement enregistré sur 7${NBSP}jours`);
  });
  it('détail : preuves avec lien, chronologie de la panne, texte des sources échappé', () => {
    const o = outage({ evidence: [{ source: 'presse', text: '<img src=x onerror=alert(1)>', at: null, link: 'https://ex.fr/a' }] });
    const html = detailHtml(o, body().journal, NOW);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('href="https://ex.fr/a"');
    expect(text(html)).toContain('signalée, non confirmée');
    expect(text(html)).toContain('aggravée');
  });
  it('lien de preuve : http(s) seulement, jamais javascript:', () => {
    const o = outage({ evidence: [{ source: 'presse', text: 'piège', at: null, link: 'javascript:alert(1)' }] });
    const html = detailHtml(o, [], NOW);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('piège');
  });
});
