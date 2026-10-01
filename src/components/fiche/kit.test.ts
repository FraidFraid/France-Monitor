import { describe, it, expect } from 'vitest';
import { CHEVRON_SVG, absoluteTime, intensityLevel, kvRow, levelCounts, levelDot, meterRow, stepCurve } from './kit.ts';

describe('kit fmk (spec 2026-10-01 § 5)', () => {
  it('ligne de mesure : libellé échappé, barre à la valeur, colonnes en plus', () => {
    const html = meterRow({ label: 'Continuité <b>', value: 51, level: 'jaune', extra: ['—', '−14,7'] });
    expect(html).toContain('<span class="fmk-meter-label">Continuité &lt;b&gt;</span>');
    expect(html).toContain('width:51%;background:var(--sev-yellow)');
    expect(html).toContain('>51</span>');
    expect(html).toContain('<span class="fmk-meter-x fmk-num">−14,7</span>');
  });

  it('ligne de mesure indisponible : « n.d. », sans barre remplie', () => {
    const html = meterRow({ label: 'Nucléaire (RTE)', value: null, level: null });
    expect(html).toContain('>n.d.</span>');
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

describe('heure absolue (spec 2026-10-01 fiches § 3)', () => {
  const NOW = Date.parse('2026-10-01T08:30:00Z'); // 10:30 à Paris
  it('le jour même : hh:mm, heure de Paris', () => {
    expect(absoluteTime(Date.parse('2026-10-01T06:05:00Z'), NOW, 'fr')).toBe('08:05');
  });
  it('un autre jour : jj/mm hh:mm', () => {
    expect(absoluteTime(Date.parse('2026-09-30T17:11:00Z'), NOW, 'fr')).toBe('30/09 19:11');
  });
  it('juste avant minuit à Paris, la veille : date affichée', () => {
    expect(absoluteTime(Date.parse('2026-09-30T21:59:00Z'), NOW, 'fr')).toBe('30/09 23:59');
  });
  it('date forcée et anglais', () => {
    expect(absoluteTime(Date.parse('2026-10-01T06:05:00Z'), NOW, 'fr', { withDate: true })).toBe('01/10 08:05');
    expect(absoluteTime(Date.parse('2026-09-30T17:11:00Z'), NOW, 'en')).toBe('30/09 19:11');
  });
});

describe('intensité d’un sous-score', () => {
  it('seuils 85, 70, 55 % de la valeur maximale', () => {
    expect(intensityLevel(25, 25)).toBe('rouge');
    expect(intensityLevel(14, 20)).toBe('orange');
    expect(intensityLevel(65, 100)).toBe('jaune');
    expect(intensityLevel(54, 100)).toBe('vert');
  });
  it('maximum nul ou valeur non finie : aucun niveau', () => {
    expect(intensityLevel(3, 0)).toBeNull();
    expect(intensityLevel(Number.NaN, 10)).toBeNull();
  });
});

describe('courbe en escalier', () => {
  const label = (ms: number): string => `t${ms}`;
  it('moins de deux points : rien', () => {
    expect(stepCurve([], { label: 'x', timeLabel: label })).toBe('');
    expect(stepCurve([{ at: 0, value: 1 }], { label: 'x', timeLabel: label })).toBe('');
  });
  it('marches, libellé accessible, axes hors de la zone tracée', () => {
    const svg = stepCurve([{ at: 0, value: 1 }, { at: 100, value: 3 }, { at: 200, value: 5 }], { label: 'Groupes <indép>', timeLabel: label });
    expect(svg).toContain('role="img" aria-label="Groupes &lt;indép&gt;"');
    expect(svg).toContain('class="fmk-curve-line"');
    // Les libellés d'axe sont sous la ligne de base (y 78 > 60) ou à gauche du tracé (x 12 < 18).
    expect(svg).toContain('<text x="18" y="78">t0</text>');
    expect(svg).toContain('<text x="384" y="78" text-anchor="end">t200</text>');
    expect(svg).toContain('<text x="12" y="12" text-anchor="end">5</text>');
    expect(svg).toContain('<text x="12" y="63" text-anchor="end">1</text>');
    // Escalier : deux sommets par changement.
    expect(svg).toMatch(/points="18\.0,60\.0 201\.0,60\.0 201\.0,34\.0 384\.0,34\.0 384\.0,8\.0"/);
  });
});

describe('barre neutre', () => {
  it('niveau absent mais neutre : barre grise', () => {
    expect(meterRow({ label: 'Confiance', value: 80, level: null, neutral: true, display: '80 %' }))
      .toContain('width:80%;background:var(--text-secondary)');
  });
});
