import { describe, it, expect } from 'vitest';
import { digestChangeText, nothingToHandleText, renderChangeRows, renderFiche, renderSourceChips, severityWord, type FicheModel, type FicheScore } from './parts.ts';
import type { ChangeDigestItem, NewsEvent } from '../../types/index.ts';

function model(over: Partial<FicheModel> = {}): FicheModel {
  return {
    key: 'event:42', kind: 'Événement', name: 'Explosion', level: 'rouge', driver: '3 sources indépendantes',
    freshness: 'Dernier article il y a 10 min', sections: [{ title: 'Facteurs', html: '<ul><li>f</li></ul>' }],
    actions: [{ id: 'map', label: 'Voir sur la carte' }], ...over,
  };
}

describe('renderFiche (gabarit réduit)', () => {
  it('rend l’en-tête, les sections puis les actions, dans cet ordre', () => {
    const html = renderFiche(model(), 'fr');
    const positions = ['fiche-head', 'fiche-extra', 'fiche-actions'].map((cls) => html.indexOf(cls));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('omet les actions et les sections vides', () => {
    const html = renderFiche(model({ actions: [], sections: [] }), 'fr');
    for (const cls of ['fiche-actions', 'fiche-extra']) expect(html).not.toContain(cls);
  });

  it('échappe le texte tiers, n’ouvre que les liens http(s) et garde les attributs fermés (revue)', () => {
    const html = renderFiche(model({
      name: '<img src=x onerror=alert(1)>',
      sections: [{
        id: 'sources', title: 'Sources', html: renderSourceChips([
          { label: 'piège', href: 'javascript:alert(1)', select: null },
          { label: 'ok', href: 'https://example.org/a?b="c"', select: null },
          { label: 'sit', href: null, select: 'situation:x" onfocus="alert(1)' },
        ]),
      }],
    }), 'fr');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.org/a?b=&quot;c&quot;" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('data-select="situation:x&quot; onfocus=&quot;alert(1)"');
  });
});

describe('textes communs', () => {
  const ev = (over: Partial<NewsEvent> = {}): NewsEvent => ({
    id: 42, evidenceId: 'E42', title: 'Explosion', category: 'security', severity: 'high', status: 'active',
    firstSeen: '2026-09-24T07:00:00Z', lastSeen: '2026-09-24T07:30:00Z', articleCount: 3, sourceCount: 3,
    independentCount: 3, sourceNames: [], lat: null, lon: null, ...over,
  });
  const item = (kinds: ChangeDigestItem['kinds'], over: Partial<ChangeDigestItem> = {}): ChangeDigestItem => ({
    event: ev(), kinds, latestAt: '2026-09-24T07:30:00Z', severityFrom: 'medium', independentFrom: 1, ...over,
  });

  it('dit un changement d’événement en mots, sans flèche entre deux niveaux verts', () => {
    expect(digestChangeText(item(['created']), 'fr')).toBe('Nouveau : Explosion');
    expect(digestChangeText(item(['escalated']), 'fr')).toBe('Aggravé (jaune → orange) : Explosion');
    expect(digestChangeText(item(['escalated'], { severityFrom: 'info', event: ev({ severity: 'low' }) }), 'fr')).toBe('Aggravé : Explosion');
    expect(digestChangeText(item(['corroborated']), 'en')).toBe('Corroborated (1 → 3 independent sources): Explosion');
    expect(severityWord('bogus', 'fr')).toBeNull();
  });

  it('« Rien à traiter » accorde le nombre d’éléments suivis', () => {
    expect(nothingToHandleText(1, 'fr')).toBe('Rien à traiter. 1 élément suivi est au vert.');
    expect(nothingToHandleText(14, 'fr')).toBe('Rien à traiter. 14 éléments suivis sont au vert.');
    expect(nothingToHandleText(0, 'en')).toBe('Nothing to handle. 0 tracked items are green.');
  });
});

describe('kit fmk dans la fiche (spec 2026-10-01)', () => {
  const score: FicheScore = {
    value: 55, level: 'orange', baseline: 95, delta24h: '—', sparkline: '<svg class="frintel-spark"></svg>',
    pillars: [
      { label: 'Continuité', value: 51, level: 'jaune', delta: '—', deduction: '−14,7' },
      { label: 'Sécurité', value: 34, level: 'vert', delta: '+2 ▲', deduction: '−6,8' },
    ],
    factor: 'Continuité — Carburants &amp; pétrole 100', cap: 55,
  };

  it('section repliable fermée : <details> sans open, titre, résumé et chevron', () => {
    const html = renderFiche(model({ key: 'france', sections: [{ id: 'infra', title: 'Infrastructures', summary: '96/100', html: '<p>x</p>', collapsible: true }] }), 'fr');
    expect(html).toContain('<details class="fiche-part fmk-sec" data-section="france:infra"><summary class="fmk-sec-h">');
    expect(html).toContain('<h3 class="fiche-part-title fmk-eyebrow">Infrastructures</h3><span class="fmk-sum">96/100</span>');
    expect(html).toContain('class="fmk-chev"');
    expect(html).toContain('<div class="fmk-sec-body"><p>x</p></div></details>');
  });

  it('section repliable ouverte : attribut open', () => {
    const html = renderFiche(model({ key: 'france', sections: [{ id: 'note', title: 'Note', html: '', collapsible: true, open: true }] }), 'fr');
    expect(html).toContain('data-section="france:note" open>');
  });

  it('section non repliable : même titre, pas de <details> ni de chevron', () => {
    const html = renderFiche(model({ key: 'france', sections: [{ id: 'situations', title: 'Situations actives', summary: '5', html: '<ul></ul>' }] }), 'fr');
    expect(html).toContain('<section class="fiche-part fmk-sec" data-section="france:situations"><div class="fmk-sec-h">');
    expect(html).not.toContain('<details class="fiche-part fmk-sec"');
    expect(html).not.toContain('fmk-chev');
  });

  it('section sans id : rendu historique inchangé', () => {
    const html = renderFiche(model({ sections: [{ title: 'Facteurs', html: '<ul><li>f</li></ul>' }] }), 'fr');
    expect(html).toContain('<section class="fiche-part fiche-extra"><h3 class="fiche-part-title">Facteurs</h3><ul><li>f</li></ul></section>');
    expect(html).toContain('<article class="fiche fmk" data-fiche="event:42">');
  });

  it('en-tête Instrument : score coloré, pastille, échelle, piliers, facteur, plafond', () => {
    const html = renderFiche(model({ key: 'france', kind: 'État de la France', driver: 'tirée par l’énergie', freshness: '5 situations actives · MAJ 16:23', score }), 'fr');
    expect(html).toContain('<article class="fiche fmk" data-fiche="france">');
    expect(html).toContain('<h2 class="fiche-name fmk-eyebrow" tabindex="-1">État de la France</h2>');
    expect(html).toContain('<span class="fmk-score-value fmk-num" style="color:var(--sev-orange)">55</span>');
    expect(html).toContain('fm-vig--orange');
    expect(html).toContain('tirée par l’énergie');
    expect(html).toContain('class="fmk-scale-marker" style="left:55%"');
    for (const tick of ['>0<', '>55<', '>70<', '>85<', '>100<']) expect(html).toContain(tick);
    expect(html).toContain('5 situations actives · MAJ 16:23 · 24 h : —');
    expect(html).toContain('<svg class="frintel-spark"></svg>');
    expect(html).toContain('Ce qui retire des points (base 95)');
    expect(html.match(/class="fmk-meter"/g)).toHaveLength(2);
    expect(html).toContain('<span class="fmk-meter-x fmk-num">−14,7</span>');
    expect(html).toContain('Continuité — Carburants &amp; pétrole 100');
    expect(html).toContain('Plafonné à <b>55</b> tant qu’une situation corrélée est active.');
    expect(html).not.toContain('fiche-why');
  });

  it('en-tête Instrument sans plafond ni facteur : ni encart ni ligne', () => {
    const html = renderFiche(model({ key: 'france', score: { ...score, cap: null, factor: null } }), 'fr');
    expect(html).not.toContain('fmk-callout');
    expect(html).not.toContain('fmk-factor');
  });

  it('avant le calcul : « Calcul du niveau national… », ni score ni échelle', () => {
    const html = renderFiche(model({ key: 'france', kind: 'État de la France', score: 'pending' }), 'fr');
    expect(html).toContain('Calcul du niveau national…');
    expect(html).not.toContain('fmk-scale');
    expect(html).not.toContain('fmk-score-value');
  });
});

describe('en-tête kit des fiches sans score (spec 2026-10-01 fiches § 2)', () => {
  it('sur-titre, titre, pastille et contexte séparés, synthèse', () => {
    const html = renderFiche(model({ kind: 'Événement · Sécurité', name: 'Titre <b>', level: 'orange', context: ['Haut-Rhin (68)', 'depuis 30/09 19:11'], lead: 'Repris par 8 sources.' }), 'fr');
    expect(html).toContain('<article class="fiche fmk" data-fiche="event:42">');
    expect(html).toContain('<div class="fmk-eyebrow">Événement · Sécurité</div>');
    expect(html).toContain('<h2 class="fiche-name fmk-title" tabindex="-1">Titre &lt;b&gt;</h2>');
    expect(html).toContain('fm-vig--orange');
    expect(html).toContain('<span class="fmk-ctx">Haut-Rhin (68)</span><span class="fmk-ctx">depuis 30/09 19:11</span>');
    expect(html).toContain('<p class="fmk-lead">Repris par 8 sources.</p>');
  });

  it('section au ton « référence »', () => {
    const html = renderFiche(model({ sections: [{ id: 'articles', title: 'Articles', html: '', collapsible: true, tone: 'reference' }] }), 'fr');
    expect(html).toContain('<details class="fiche-part fmk-sec fmk-sec--ref" data-section="event:42:articles">');
  });

  it('changements : heures absolues, « n.d. », dernier mis en avant', () => {
    const now = Date.parse('2026-10-01T08:30:00Z');
    const rows = renderChangeRows([
      { at: Date.parse('2026-10-01T08:00:00Z'), text: 'corroboré 4 → 5', select: null },
      { at: Date.parse('2026-09-30T21:00:00Z'), text: 'corroboré 1 → 2', select: null },
      { at: null, text: 'créé', select: null },
    ], 'fr', now);
    expect(rows).toContain('<li class="fiche-change is-latest"><span class="fiche-time">10:00</span>');
    expect(rows).toContain('<span class="fiche-time">30/09 23:00</span>');
    expect(rows).toContain('<span class="fiche-time">n.d.</span>');
  });
});
