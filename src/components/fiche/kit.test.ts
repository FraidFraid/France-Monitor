import { describe, it, expect } from 'vitest';
import { CHEVRON_SVG, kvRow, levelCounts, levelDot, meterRow } from './kit.ts';

describe('kit fmk (spec 2026-10-01 § 5)', () => {
  it('ligne de mesure : libellé échappé, barre à la valeur, colonnes en plus', () => {
    const html = meterRow({ label: 'Continuité <b>', value: 51, level: 'jaune', extra: ['—', '−14,7'] });
    expect(html).toContain('<span class="fmk-meter-label">Continuité &lt;b&gt;</span>');
    expect(html).toContain('width:51%;background:var(--sev-yellow)');
    expect(html).toContain('>51</span>');
    expect(html).toContain('<span class="fmk-meter-x fmk-num">−14,7</span>');
  });

  it('ligne de mesure indisponible : « — », sans barre remplie', () => {
    const html = meterRow({ label: 'Nucléaire (RTE)', value: null, level: null });
    expect(html).toContain('>—</span>');
    expect(html).not.toContain('<i style');
  });

  it('valeur bornée à 0–100 et texte de valeur imposé', () => {
    expect(meterRow({ label: 'x', value: 140, level: 'vert', display: '140 / 100' })).toContain('width:100%');
    expect(meterRow({ label: 'x', value: 140, level: 'vert', display: '140 / 100' })).toContain('>140 / 100</span>');
  });

  it('note sous la ligne passée telle quelle (HTML déjà échappé)', () => {
    expect(meterRow({ label: 'x', value: 43, level: 'rouge', noteHtml: '<button data-action="open-cyber">National 51/100</button>' }))
      .toContain('<div class="fmk-meter-note"><button data-action="open-cyber">National 51/100</button></div>');
  });

  it('point de niveau, clé · valeur, chevron', () => {
    expect(levelDot('orange')).toBe('<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span>');
    expect(levelDot(null)).toBe('<span class="fmk-dot" aria-hidden="true"></span>');
    expect(kvRow('Stocks <nationaux>', '<b>46 j</b>')).toBe('<div class="fmk-kv"><span class="fmk-kv-k">Stocks &lt;nationaux&gt;</span><span class="fmk-kv-v fmk-num"><b>46 j</b></span></div>');
    expect(CHEVRON_SVG).toContain('class="fmk-chev"');
    expect(CHEVRON_SVG).toContain('aria-hidden="true"');
  });

  it('comptes par niveau : ordre rouge → vert, zéros omis, mot lisible par lecteur d’écran', () => {
    const html = levelCounts(['vert', 'orange', 'orange', 'jaune'], 'fr');
    expect(html.indexOf('fmk-dot--orange')).toBeLessThan(html.indexOf('fmk-dot--jaune'));
    expect(html.indexOf('fmk-dot--jaune')).toBeLessThan(html.indexOf('fmk-dot--vert'));
    expect(html).not.toContain('fmk-dot--rouge');
    expect(html).toContain('<span class="fmk-sr">Orange</span><span class="fmk-num">2</span>');
    expect(levelCounts([], 'fr')).toBe('');
  });
});
