// src/components/layer-panel/outages-power.test.ts
// Vue pure du panneau Électricité (spec 2026-10-08 panneaux pannes § 2.2) sur le jeu d'essai réel du 08/10/2026 : gros chiffre, sections,
// EDF muet (R32), EDF en retard (R20), signaux des îles (R14), listes coupées, hygiène du rendu (R12).
import { describe, expect, it } from 'vitest';
import type { EcowattOfficial, EcowattSignal, PowerOutagesResponse, PowerUnitOutage } from '../../types/index.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { POWER_TITLE, buildPowerView, type PowerViewInput } from './outages-power.ts';
import { OUTAGES_FIXTURE_NOW, powerFixtureResponse } from './outages.fixture.ts';

const open = (): boolean => true;
/** Signal Écowatt de RTE, J à J+3 (forme d'EcowattOfficial). */
const official = (today: EcowattSignal): EcowattOfficial => ({
  source: 'rte', generatedAt: '2026-10-08T15:00:00Z',
  days: [['2026-10-08', today], ['2026-10-09', 'green'], ['2026-10-10', 'green'], ['2026-10-11', 'orange']]
    .map(([date, level]) => ({ date, level: level as EcowattSignal, message: 'Pas d’alerte.', hours: [] })),
});
const view = (over: Partial<PowerViewInput> = {}) => buildPowerView({
  power: powerFixtureResponse(), error: null, ecowatt: official('green'), canFocus: true, now: OUTAGES_FIXTURE_NOW, open, ...over,
});
const html = (over: Partial<PowerViewInput> = {}): string => renderLayerView('outagesElec', view(over));
const text = (over: Partial<PowerViewInput> = {}): string => visibleText(html(over));
const section = (over: Partial<PowerViewInput>, id: string): string => view(over).sections.find((s) => s.id === id)?.html ?? '';
const withPower = (patch: Partial<PowerOutagesResponse>): Partial<PowerViewInput> => ({ power: { ...powerFixtureResponse(), ...patch } });
/** Résultat d'une relève dont la partie EDF a échoué : lignes IIP seules, jamais lue (edfReadAt null). */
const edfNeverRead = (): PowerOutagesResponse => {
  const p = powerFixtureResponse();
  const iipOnly = p.unplanned.filter((u) => u.source === 'rte');
  return {
    ...p, edfReadAt: null, edfUpdatedAt: null, unplanned: iipOnly.length > 0 ? iipOnly : [{ ...p.unplanned[0], source: 'rte' }],
    planned: p.planned.filter((u) => u.source === 'rte'), upcoming: [], history: [], errors: ['EDF OpenData : HTTP 503'],
  };
};

describe('vue Électricité (jeu d’essai du 08/10)', () => {
  it('gros chiffre : 2,8 GW perdus en arrêts imprévus, jaune (paliers du parc), relevé par Écowatt', () => {
    const v = view();
    expect(v.head.title).toBe(POWER_TITLE);
    expect(v.head.figure).toMatchObject({ value: `2,8${NBSP}GW`, caption: 'de production perdus en arrêts imprévus en ce moment' });
    expect(v.head.level).toBe('jaune');
    expect(view({ ecowatt: official('red') }).head.level).toBe('rouge');
    expect(view({ ecowatt: null }).head.level).toBe('jaune');
  });
  it('sections dans l’ordre ; unités, lignes, maintenances, annonces, îles, ligne fixe Enedis', () => {
    expect(view().sections.map((s) => s.id)).toEqual(['imprevus', 'transport', 'maintenances', 'annonces', 'ecowatt', 'iles', 'particuliers', 'courbe', 'methode']);
    const t = text();
    expect(t).toContain('PALUEL 1');
    expect(t).toContain(`1\u202F330${NBSP}MW`);
    expect(t).toContain('Mandarins-Sellindge 1');
    expect(t).toContain('Royaume-Uni → France');
    expect(t).toContain('Enedis ne publie pas de données ouvertes sur les coupures en cours');
    expect(t).toContain('11/10');   // Écowatt J à J+3
    expect(t).toContain('système tendu');
    expect(t).not.toMatch(/Seraing|SERAING|temps r[ée]el|\u2014/);
  });
  it('une tranche nucléaire renvoie au panneau Parc nucléaire (bouton et ligne de tranche)', () => {
    const h = section({}, 'imprevus');
    expect(h).toContain('data-open-nuclear="panneau"');
    expect(h).toContain('data-open-nuclear="PALUEL 1"');
    expect(h).not.toContain('data-open-nuclear="BLENOD 5"');
  });
  it('lignes d’unités non nucléaires cliquables seulement avec un gestionnaire de carte', () => {
    expect(section({}, 'imprevus')).toContain('data-unit="BLENOD 5"');
    expect(section({ canFocus: false }, 'imprevus')).not.toContain('data-unit=');
  });
  it('Écowatt : jour courant marqué, jours suivants datés ; signal absent : n.d.', () => {
    const t = visibleText(section({}, 'ecowatt'));
    expect(t).toContain('08/10 (aujourd’hui)');
    expect(t).toContain('10/10');
    expect(visibleText(section({ ecowatt: null }, 'ecowatt'))).toContain('Signal Écowatt n.d. (RTE)');
  });
  it('un arrêt imprévu compte une fois : la somme des lignes servies égale le gros chiffre', () => {
    const p = powerFixtureResponse();
    expect(p.unplanned.reduce((s, u) => s + u.lostMw, 0)).toBe(2834);
    expect(view().head.figure?.value).toBe(`2,8${NBSP}GW`);
  });
  it('listes coupées : « et n autres » nommé, jamais une troncature silencieuse', () => {
    const base = powerFixtureResponse().planned[0];
    const many = (n: number): PowerUnitOutage[] => Array.from({ length: n }, (_, i) => ({ ...base, id: `m${i}`, name: `UNITE ${i}` }));
    expect(visibleText(section(withPower({ planned: many(35) }), 'maintenances'))).toContain(`et 5${NBSP}autres.`);
    expect(visibleText(section(withPower({ planned: many(30) }), 'maintenances'))).not.toContain('autres');
    const up = powerFixtureResponse().upcoming[0];
    const ups = Array.from({ length: 23 }, (_, i) => ({ ...up, id: `u${i}`, name: `PROCHAIN ${i}` }));
    expect(visibleText(section(withPower({ upcoming: ups }), 'annonces'))).toContain(`et 3${NBSP}autres.`);
  });
});

describe('fraîcheur d’EDF', () => {
  it('EDF en retard (dernière lecture réussie à 10 h, il est 22 h) : « (en retard) », chiffre et pastille n.d., couleurs retirées', () => {
    const over = withPower({ edfReadAt: '2026-10-08T10:00:17.798Z' });
    const v = view(over);
    expect(v.head.level).toBe('nd');
    expect(v.head.figure?.value).toBe('n.d.');
    expect(v.head.status.join(' ')).toContain('(en retard)');
    const h = section(over, 'imprevus');
    expect(h).toContain('PALUEL 1');
    expect(h).not.toContain('var(--cat-out-');
    expect(h).toContain('background:var(--text-muted)');
    expect(html(over).split('<div class="lp-body')[0]).not.toMatch(/lp-lvl--/);
  });
  it('R20 : le retard se mesure sur la lecture, pas sur la date du jeu : jeu vieux de 12 h mais lu il y a 20 min : pas en retard', () => {
    const v = view(withPower({ edfUpdatedAt: '2026-10-08T08:00:00.000Z', edfReadAt: '2026-10-08T19:40:00.000Z' }));
    expect(v.head.status.join(' ')).not.toContain('(en retard)');
    expect(v.head.level).toBe('jaune');
    expect(v.head.status[0]).toContain('EDF 10:00');
  });
  it('R32 : EDF jamais lu, seules des lignes IIP : gros chiffre « n.d. » et pastille n.d., jamais le total partiel', () => {
    const p = edfNeverRead();
    const partial = p.unplanned.reduce((s, u) => s + u.lostMw, 0);
    expect(partial).toBeGreaterThan(0);
    const v = view({ power: p });
    expect(v.head.figure?.value).toBe('n.d.');
    expect(v.head.level).toBe('nd');
    // En-tête (chiffre, pastille) et section des arrêts : aucune couleur de niveau (la section Écowatt a sa propre source).
    expect(html({ power: p }).split('<div class="lp-body')[0]).not.toMatch(/lp-lvl--/);
    expect(section({ power: p }, 'imprevus')).not.toMatch(/lp-lvl--|var\(--cat-out-/);
    expect(v.head.status[0]).toContain('EDF injoignable');
    const t = text({ power: p });
    expect(t).toContain('EDF OpenData injoignable : arrêts imprévus n.d.');
    expect(t).toContain('EDF OpenData injoignable : maintenances n.d.');
    expect(t).not.toContain(`${frFmt(partial)}${NBSP}MW`);
  });
  it('R32 : relève EDF en échec, données gardées lues il y a 20 min : chiffre, pastille et couleurs gardés, erreur nommée', () => {
    const over = withPower({ errors: ['EDF OpenData : HTTP 503'] });
    const v = view(over);
    expect(v.head.figure?.value).toBe(`2,8${NBSP}GW`);
    expect(v.head.level).toBe('jaune');
    expect(v.head.status.join(' ')).not.toContain('(en retard)');
    expect(section(over, 'imprevus')).toContain('var(--cat-out-recent)');
    expect(visibleText(v.bodyHtml ?? '')).toContain('EDF OpenData : HTTP 503');
  });
  it('R32 : relève EDF en échec et dernière lecture réussie au-delà du seuil (2 h) : chiffre et pastille n.d., erreur nommée', () => {
    const over = withPower({ errors: ['EDF OpenData : HTTP 503'], edfReadAt: '2026-10-08T17:59:00.000Z' });
    const v = view(over);
    expect(v.head.figure?.value).toBe('n.d.');
    expect(v.head.level).toBe('nd');
    expect(visibleText(v.bodyHtml ?? '')).toContain('EDF OpenData : HTTP 503');
    expect(view(withPower({ edfReadAt: '2026-10-08T18:01:00.000Z' })).head.figure?.value).toBe(`2,8${NBSP}GW`);
  });
  it('seul RTE IIP en échec : EDF garde sa couleur, lignes du transport n.d.', () => {
    const over = withPower({ transmission: null, iipPublishedAt: null, errors: ['RTE IIP : HTTP 503'] });
    const v = view(over);
    expect(v.head.figure?.value).toBe(`2,8${NBSP}GW`);
    expect(v.head.level).toBe('jaune');
    expect(v.head.status[1]).toBe('RTE IIP n.d.');
    expect(visibleText(section(over, 'transport'))).toContain('RTE IIP injoignable : lignes du transport n.d.');
  });
  it('IIP en retard (publié à 17 h UTC) : « (en retard) » sur sa ligne d’état, lignes du transport sans couleur de catégorie', () => {
    const over = withPower({ iipPublishedAt: '2026-10-08T17:00:00.000Z' });
    expect(view(over).head.status[1]).toContain('(en retard)');
    expect(section(over, 'transport')).not.toContain('var(--cat-out-');
    expect(view(over).head.level).toBe('jaune');
  });
  it('jamais lu : n.d., panne nommée', () => {
    const v = view({ power: null, error: 'Électricité : HTTP 502', ecowatt: null });
    expect(v.head.figure?.value).toBe('n.d.');
    expect(v.head.level).toBe('nd');
    expect(v.sections).toEqual([]);
    expect(visibleText(v.bodyHtml ?? '')).toContain('Électricité : HTTP 502');
  });
  it('réponse vide du serveur (ni EDF ni IIP lus) : n.d. et erreurs du serveur nommées', () => {
    const empty: PowerOutagesResponse = {
      readAt: null, edfUpdatedAt: null, edfReadAt: null, iipPublishedAt: null, unplanned: [], planned: [], upcoming: [], transmission: null,
      islands: [], history: [], errors: ['EDF OpenData : HTTP 503', 'RTE IIP : HTTP 503'],
    };
    const v = view({ power: empty });
    expect(v.head.figure?.value).toBe('n.d.');
    expect(visibleText(v.bodyHtml ?? '')).toContain('EDF OpenData : HTTP 503');
    expect(text({ power: empty })).not.toMatch(/aucun arrêt/i);
  });
  it('relève en échec côté client avec données gardées : sections gardées, encadré daté', () => {
    const v = view({ error: 'Électricité : HTTP 502' });
    expect(v.sections).toHaveLength(9);
    expect(visibleText(v.bodyHtml ?? '')).toContain('Source injoignable. Dernières données :');
  });
  it('chargement : corps de chargement, aucune section', () => {
    const v = view({ power: null, error: null });
    expect(v.sections).toEqual([]);
    expect(v.bodyHtml).toContain('Chargement');
  });
});

/** Nombre fr-FR du total partiel, pour chercher sa trace dans le rendu. */
function frFmt(n: number): string {
  return Math.round(n).toLocaleString('fr-FR');
}

describe('signaux des îles (R14, R32)', () => {
  const island = (zone: 'reunion' | 'corse', color: string, text: string, at = '2026-10-08T20:00:00.000Z') => ({ zone, at, color, text, cyclone: false });
  it('vert, jaune, orange, rouge : pastille de niveau ; heure du signal affichée', () => {
    const h = section(withPower({ islands: [island('reunion', 'vert', 'Optimal'), island('corse', 'rouge', 'Pointe')] }), 'iles');
    expect(h).toContain('fmk-dot--vert');
    expect(h).toContain('fmk-dot--rouge');
    expect(visibleText(h)).toContain(`signal de 22${NBSP}h${NBSP}00`);
    expect(visibleText(h)).toContain('Optimal');
  });
  it('mot inconnu (bleu, gris, ou piège) : aucune pastille, jamais la couleur brute injectée en style', () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    for (const color of ['bleu', 'gris', 'red;position:fixed', hostile]) {
      const h = section(withPower({ islands: [island('reunion', color, 'Heures de pointe')] }), 'iles');
      expect(h).not.toContain(color.slice(0, 12));
      expect(h).not.toContain('style="background');
      expect(h).not.toMatch(/fmk-dot--|lp-swatch/);
      expect(visibleText(h)).toContain('Heures de pointe');
    }
  });
  it('un signal gardé après échec date d’une heure révolue : son heure est affichée, il est « en retard » et sans pastille', () => {
    const h = section(withPower({ islands: [island('corse', 'vert', 'Optimal', '2026-10-07T12:00:00.000Z')] }), 'iles');
    expect(visibleText(h)).toContain(`signal de 07/10 à 14${NBSP}h${NBSP}00`);
    expect(visibleText(h)).toContain('(en retard)');
    expect(h).not.toMatch(/fmk-dot--/);
  });
  it('cyclone en cours nommé ; aucune île : n.d.', () => {
    expect(visibleText(section(withPower({ islands: [{ ...island('reunion', 'rouge', 'Alerte'), cyclone: true }] }), 'iles'))).toContain('cyclone en cours');
    expect(visibleText(section(withPower({ islands: [] }), 'iles'))).toContain('Signaux des îles n.d.');
  });
});

describe('hygiène du rendu', () => {
  const hostile = (): PowerOutagesResponse => {
    const p = powerFixtureResponse();
    p.unplanned[2] = { ...p.unplanned[2], name: '<img src=x onerror=alert(1)>', sector: '<b>S</b>', cause: '<i>C</i>', id: '"><script>x</script>' };
    if (p.transmission) p.transmission.unplanned[0] = { ...p.transmission.unplanned[0], asset: '<u>L</u>', reason: '<s>R</s>' };
    p.islands[0] = { ...p.islands[0], text: '<em>T</em>' };
    return p;
  };
  const oneDay = (): PowerOutagesResponse => ({ ...powerFixtureResponse(), history: [{ day: '2026-10-08', unplannedMw: 2834 }] });
  const variants: Array<Partial<PowerViewInput>> = [
    {}, { canFocus: false }, { ecowatt: null }, { ecowatt: official('red') }, { error: 'Électricité : HTTP 502' }, { power: null, error: 'Électricité : HTTP 502' },
    { power: null }, withPower({ edfReadAt: '2026-10-08T10:00:17.798Z' }), { power: edfNeverRead() }, withPower({ errors: ['EDF OpenData : HTTP 503'] }),
    withPower({ transmission: null, iipPublishedAt: null }), withPower({ iipPublishedAt: '2026-10-08T17:00:00.000Z' }),
    { power: hostile() }, { power: oneDay() }, withPower({ islands: [] }),
  ];
  it('aucun tiret cadratin, aucune couleur brute, jamais « temps réel » ni « LIVE »', () => {
    for (const over of variants) {
      const h = html(over);
      expect(h).not.toMatch(/\u2014|&mdash;|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(visibleText(h)).not.toMatch(/temps réel|TEMPS RÉEL|\bLIVE\b/i);
    }
  });
  it('R1 : aucune valeur coupée entre nombre et unité', () => {
    for (const over of variants) {
      const v = view(over);
      const texts = [v.head.figure?.caption ?? '', ...v.head.status, v.head.lead ?? '', visibleText(v.bodyHtml ?? ''),
        ...v.sections.map((s) => visibleText(`${s.summary ?? ''} ${s.html}`))];
      for (const t of texts) expect(breakableValue(t), t.slice(0, 80)).toBeNull();
    }
  });
  it('textes tiers échappés (unité, secteur, cause, identifiant, ouvrage, signal des îles)', () => {
    const h = html({ power: hostile() });
    for (const raw of ['<img src=x', '<b>S</b>', '<i>C</i>', '<u>L</u>', '<s>R</s>', '<em>T</em>', '<script>']) expect(h).not.toContain(raw);
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
