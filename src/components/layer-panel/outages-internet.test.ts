// src/components/layer-panel/outages-internet.test.ts
// Vue pure du panneau Internet (spec 2026-10-08 panneaux pannes § 2.3) sur le jeu d'essai réel du 08/10/2026 : gros chiffre dédoublonné
// (P13), événement IODA ouvert depuis plus de 7 jours à part, Radar sans jeton, sources en retard (couleurs retirées), source muette (n.d.),
// erreurs du serveur nommées, hygiène du rendu.
import { describe, expect, it } from 'vitest';
import type { InternetEvent, InternetOutagesResponse } from '../../types/index.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { formatDuration } from './outages-format.ts';
import { buildInternetView, INTERNET_TITLE, type InternetViewInput } from './outages-internet.ts';
import { INTERNET_FIXTURE_NOW, internetFixtureResponse } from './outages.fixture.ts';

const open = (): boolean => true;
const view = (over: Partial<InternetViewInput> = {}) => buildInternetView({
  internet: internetFixtureResponse(), error: null, canFocus: true, canOpenConnectivity: true, now: INTERNET_FIXTURE_NOW, open, ...over,
});
const html = (over: Partial<InternetViewInput> = {}): string => renderLayerView('outagesInternet', view(over));
const text = (over: Partial<InternetViewInput> = {}): string => visibleText(html(over));
const section = (over: Partial<InternetViewInput>, id: string): string => view(over).sections.find((s) => s.id === id)?.html ?? '';
const sectionText = (over: Partial<InternetViewInput>, id: string): string => visibleText(section(over, id));
const withData = (patch: (r: InternetOutagesResponse) => void): Partial<InternetViewInput> => {
  const r = internetFixtureResponse();
  patch(r);
  return { internet: r };
};
const ongoingEvent = (over: Partial<InternetEvent>): InternetEvent => ({
  id: 'region/1138:1791490000:bgp', scope: 'departement', dept: '23', asn: null, label: 'Creuse', signal: 'bgp', start: '2026-10-08T20:00:00.000Z',
  end: null, durationSec: 1500, ongoing: true, staleOpen: false, score: 10, ...over,
});

describe('vue Internet (jeu d’essai du 08/10)', () => {
  it('en-tête : 1 anomalie en cours (Free, Radar), orange, lectures IODA et Radar datées', () => {
    const v = view();
    expect(v.head.title).toBe(INTERNET_TITLE);
    expect(v.head.figure).toMatchObject({ value: '1', caption: 'anomalies Internet en cours en France' });
    expect(v.head.figure?.level).toBeUndefined();
    expect(v.head.level).toBe('orange');
    expect(v.head.status).toEqual([`IODA lu à 22${NBSP}h${NBSP}26`, `Cloudflare Radar lu à 22${NBSP}h${NBSP}20`]);
    expect(html()).toContain('lp-lvl--orange');
  });
  it('sections dans l’ordre, avec leur contenu', () => {
    expect(view().sections.map((s) => s.id)).toEqual(['encours', 'recents', 'radar', 'departements', 'bgp', 'courbe', 'methode']);
    const live = sectionText({}, 'encours');
    expect(live).toContain('Free (AS12322)');
    expect(live).toContain('Cloudflare Radar');
    expect(live).toContain('Scaleway (AS12876)');
    expect(live).toContain(`ouvert depuis plus de 7${NBSP}jours, probablement un recalage`);
    const depts = sectionText({}, 'departements');
    expect(depts).toContain('Haute-Vienne (87)');
    expect(depts).toContain(`2${NBSP}événements`);
    expect(depts).toContain('Creuse (23)');
    expect(depts).toContain('Guadeloupe (971)');
    const bgp = sectionText({}, 'bgp');
    expect(bgp).toContain('Orange');
    expect(bgp).toContain(`100${NBSP}%`);
    expect(bgp).toContain(`instantané de 18${NBSP}h${NBSP}00`);
    expect(section({}, 'bgp')).toContain('data-open-connectivity');
    expect(text()).not.toMatch(/temps r[ée]el|\u2014/i);
  });
  it('événement ouvert depuis plus de 7 jours : nommé à part, en gris, jamais au gros chiffre', () => {
    const live = section({}, 'encours');
    const idx = live.indexOf('Scaleway');
    expect(idx).toBeGreaterThan(live.indexOf('Free (AS12322)'));
    expect(live.slice(live.lastIndexOf('<div class="lp-row', idx), idx)).not.toContain('fmk-dot--');
    expect(view(withData((r) => { r.radar.items = []; })).head.figure?.value).toBe('0');
  });
  it('événements terminés des 7 derniers jours : Guadeloupe (1 h 25), pas les plus anciens', () => {
    const recents = sectionText({}, 'recents');
    expect(recents).toContain('Guadeloupe (971)');
    expect(recents).toContain(`1${NBSP}h${NBSP}25`);
    expect(recents).not.toContain('Haute-Vienne');
  });
  it('lignes de département et bouton Connectivité commandés chacun par leur propre capacité', () => {
    expect(html()).toContain('data-dept="23"');
    expect(html({ canFocus: false })).not.toContain('data-dept=');
    expect(html({ canFocus: false })).toContain('data-open-connectivity');
    expect(html({ canOpenConnectivity: false })).not.toContain('data-open-connectivity');
    expect(html({ canOpenConnectivity: false })).toContain('data-dept="23"');
  });
  it('P13 : deux signaux (bgp, ping-slash24) sur la Creuse en cours comptent un seul lieu', () => {
    const v = view(withData((r) => {
      r.radar.items = [];
      r.events = [ongoingEvent({}), ongoingEvent({ id: 'region/1138:1791490000:ping-slash24', signal: 'ping-slash24' })];
    }));
    expect(v.head.figure?.value).toBe('1');
    expect(v.head.level).toBe('jaune');
    const live = visibleText(v.sections[0]?.html ?? '');
    expect(live.match(/Creuse \(23\)/g)).toHaveLength(1);
    expect(live).toContain(`signal BGP · sonde ping`);
  });
  it('une anomalie Radar sur un réseau déjà en cours chez IODA ne s’ajoute pas', () => {
    const v = view(withData((r) => { r.events = [ongoingEvent({ scope: 'operateur', dept: null, asn: 12322, label: 'Free (AS12322)' })]; }));
    expect(v.head.figure?.value).toBe('1');
    expect(v.head.level).toBe('orange');
  });
  it('sans jeton : gros chiffre 0, vert, section Radar « non configuré », statut dit non configuré', () => {
    const v = view(withData((r) => { r.radar = { configured: false, readAt: null, items: [] }; }));
    expect(v.head.figure?.value).toBe('0');
    expect(v.head.level).toBe('vert');
    expect(v.head.status).toContain('Cloudflare Radar non configuré');
    expect(visibleText(v.sections.find((s) => s.id === 'radar')?.html ?? '')).toContain('non configuré');
    expect(JSON.stringify(v)).not.toContain('(en retard)');
  });
  it('Radar lu il y a 2 h : son anomalie n’entre ni au gros chiffre ni à la pastille, « (en retard) » dans la section et le statut', () => {
    const over = withData((r) => { r.radar.readAt = '2026-10-08T18:20:00.000Z'; });
    const v = view(over);
    expect(v.head.figure?.value).toBe('0');
    expect(v.head.level).toBe('vert');
    expect(v.head.status[1]).toContain('(en retard)');
    expect(sectionText(over, 'radar')).toContain('(en retard)');
    expect(section(over, 'radar')).not.toMatch(/fmk-dot--(orange|rouge|jaune|vert)/);
  });
  it('Radar configuré mais jamais lu : « n.d. », jamais « aucune anomalie »', () => {
    const over = withData((r) => { r.radar = { configured: true, readAt: null, items: [] }; });
    expect(view(over).head.status[1]).toBe('Cloudflare Radar n.d.');
    expect(sectionText(over, 'radar')).toContain('n.d.');
  });
  it('E3 : Radar configuré, lecture en échec : la section nomme l’erreur Radar (« Cloudflare Radar : HTTP 400 »), anomalies n.d., jamais 0', () => {
    const over = withData((r) => { r.radar = { configured: true, readAt: null, items: [] }; r.errors = ['Cloudflare Radar : HTTP 400']; });
    const t = sectionText(over, 'radar');
    expect(t).toContain('Cloudflare Radar : HTTP 400');
    expect(t).toContain('n.d.');
    expect(t).not.toMatch(/\b0\b/);
    // Données gardées d'une lecture antérieure et relève en échec : l'erreur est aussi nommée dans la section.
    const kept = withData((r) => { r.errors = ['Cloudflare Radar : délai dépassé', 'IODA : HTTP 503']; });
    expect(sectionText(kept, 'radar')).toContain('Cloudflare Radar : délai dépassé');
    expect(sectionText(kept, 'radar')).not.toContain('IODA : HTTP 503');
  });
  it('règle Radar : une anomalie de trafic nationale est listée en orange, jamais en rouge ; pastille orange', () => {
    const over = withData((r) => {
      r.events = [];
      r.radar.items = [{ ...r.radar.items[0], kind: 'anomalie', asn: null, label: 'France', national: true, end: null }];
    });
    expect(section(over, 'encours')).toContain('fmk-dot--orange');
    expect(section(over, 'encours')).not.toContain('fmk-dot--rouge');
    expect(view(over).head.level).toBe('orange');
  });
  it('IODA lu à 18 h UTC, il est 20 h 30 : « (en retard) », n.d., gros chiffre sans couleur, aucune couleur de niveau', () => {
    const over = withData((r) => { r.iodaReadAt = '2026-10-08T18:00:00.000Z'; r.events = [ongoingEvent({})]; });
    const v = view(over);
    expect(v.head.status[0]).toContain('(en retard)');
    expect(v.head.level).toBe('nd');
    expect(v.head.figure).toMatchObject({ value: 'n.d.', level: null });
    expect(visibleText(v.sections[0]?.summary ?? '')).toBe('n.d.');
    // La visibilité RIPEstat est une autre source (instantané de 18 h UTC, pas en retard) : elle garde sa couleur.
    const colored = ['encours', 'recents', 'departements', 'courbe'].map((id) => section(over, id)).join('') + renderLayerView('x', { ...v, sections: [], bodyHtml: '' });
    expect(colored).not.toContain('lp-lvl--');
    expect(colored).not.toMatch(/fmk-dot--(orange|rouge|jaune|vert)/);
    expect(colored).not.toContain('var(--sev-');
    expect(section(over, 'courbe')).toContain('var(--text-muted)');
  });
  it('IODA jamais lu : n.d., erreur nommée, jamais « aucune anomalie »', () => {
    const over = { internet: { ...internetFixtureResponse(), iodaReadAt: null, readAt: null, events: [], errors: ['IODA : HTTP 503'] }, error: null };
    const v = view(over);
    expect(v.head.figure?.value).toBe('n.d.');
    expect(v.head.level).toBe('nd');
    expect(v.sections).toEqual([]);
    expect(text(over)).toContain('IODA : HTTP 503');
    expect(text(over)).not.toMatch(/aucune anomalie/i);
    expect(text({ internet: null, error: 'source injoignable' })).toContain('source injoignable');
  });
  it('collecte en cours (première lecture) : dite, sans encadré de panne', () => {
    const over = { internet: { ...internetFixtureResponse(), iodaReadAt: null, readAt: null, events: [], errors: ['Internet : collecte en cours'] }, error: null };
    const v = view(over);
    expect(v.head.status).toEqual(['IODA : collecte en cours']);
    expect(v.bodyHtml).not.toContain('Source injoignable');
    expect(v.head.figure?.value).toBe('n.d.');
  });
  it('erreurs du serveur nommées sous l’en-tête, sauf la note « collecte en cours »', () => {
    const v = view(withData((r) => { r.errors = ['Cloudflare Radar : HTTP 500', 'Internet : collecte en cours']; }));
    const body = visibleText(v.bodyHtml ?? '');
    expect(body).toContain('Cloudflare Radar : HTTP 500');
    expect(body).not.toContain('collecte en cours');
    expect(v.sections).toHaveLength(7);
  });
  it('relève en échec avec des données gardées : sections gardées, encadré daté de la lecture IODA', () => {
    const v = view({ error: 'IODA : HTTP 503' });
    expect(v.sections).toHaveLength(7);
    expect(visibleText(v.bodyHtml ?? '')).toContain('Source injoignable. Dernières données :');
  });
  it('RIPEstat : instantané de 11 h « (en retard) » sans couleur ; absent : « visibilité n.d. »', () => {
    const late = withData((r) => { if (r.ripe) r.ripe.snapshotAt = '2026-10-08T09:30:00.000Z'; });
    expect(sectionText(late, 'bgp')).toContain('(en retard)');
    expect(section(late, 'bgp')).not.toContain('lp-lvl--');
    expect(section({}, 'bgp')).toContain('lp-lvl--vert');
    expect(sectionText(withData((r) => { r.ripe = null; }), 'bgp')).toContain('RIPEstat : visibilité n.d.');
    expect(section(withData((r) => { r.ripe = null; }), 'bgp')).not.toContain('data-open-connectivity="1">Voir');
  });
  it('région IODA non identifiée en cours : listée à part, non comptée', () => {
    const over = withData((r) => { r.radar.items = []; r.events = [ongoingEvent({ scope: 'inconnu', dept: null, label: 'région non identifiée' })]; });
    expect(view(over).head.figure?.value).toBe('0');
    expect(sectionText(over, 'encours')).toContain('région non identifiée');
    expect(sectionText(over, 'encours')).toContain('non comptée');
  });
  it('courbe : 30 jours, barres empilées en couleurs de niveau', () => {
    const c = section({}, 'courbe');
    expect(c).toContain('<svg');
    expect(c).toContain('var(--sev-');
    expect(c).toContain('09/09');
    expect(c).toContain('08/10');
  });
  it('chargement : corps de chargement, aucune section', () => {
    const v = view({ internet: null, error: null });
    expect(v.sections).toEqual([]);
    expect(v.bodyHtml).toContain('Chargement');
  });
});

describe('formatDuration', () => {
  it('minutes, heures et minutes, jours et heures, illisible', () => {
    expect(formatDuration(900)).toBe(`15${NBSP}min`);
    expect(formatDuration(3900)).toBe(`1${NBSP}h${NBSP}05`);
    expect(formatDuration(6 * 3600)).toBe(`6${NBSP}h${NBSP}00`);
    expect(formatDuration(631_292)).toBe(`7${NBSP}j${NBSP}7${NBSP}h`);
    expect(formatDuration(-1)).toBe('durée n.d.');
    expect(formatDuration(Number.NaN)).toBe('durée n.d.');
  });
});

describe('hygiène du rendu', () => {
  const hostile = (): InternetOutagesResponse => {
    const r = internetFixtureResponse();
    r.radar.items[0] = { ...r.radar.items[0], label: '<script>x</script>', cause: '<img src=x onerror=alert(1)>' };
    r.events[0] = { ...r.events[0], label: '<b>X</b>' };
    r.ripe = { snapshotAt: r.ripe?.snapshotAt ?? null, networks: [{ asn: 1, name: '<u>Z</u>', visibilityPct: 100 }] };
    r.errors = ['<i>Y</i>'];
    return r;
  };
  const variants: Array<Partial<InternetViewInput>> = [
    {}, { canFocus: false }, { canOpenConnectivity: false }, { internet: hostile() }, { error: 'IODA : HTTP 503' }, { internet: null, error: 'IODA : HTTP 503' }, { internet: null },
    { now: Date.parse('2026-10-09T09:00:00Z') }, { now: Date.parse('2026-10-08T22:00:00Z') },
    withData((r) => { r.radar = { configured: false, readAt: null, items: [] }; }),
    withData((r) => { r.ripe = null; }),
    withData((r) => { r.events = []; r.radar.items = []; }),
    withData((r) => { r.iodaReadAt = null; r.errors = ['IODA : HTTP 503']; }),
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
  it('textes tiers échappés (libellé Radar, cause, libellé IODA, réseau RIPEstat, erreur du serveur)', () => {
    const h = html({ internet: hostile() });
    for (const raw of ['<script>', '<img src=x', '<b>X</b>', '<u>Z</u>', '<i>Y</i>']) expect(h).not.toContain(raw);
    expect(h).toContain('&lt;script&gt;x&lt;/script&gt;');
  });
  it('IODA en retard et sans événement : jamais « aucune anomalie », la section dit n.d.', () => {
    const over = withData((r) => { r.iodaReadAt = '2026-10-08T18:00:00.000Z'; r.events = []; r.radar.items = []; });
    expect(view(over).head.figure?.value).toBe('n.d.');
    expect(view(over).sections[0]?.summary).toBe('n.d.');
    expect(sectionText(over, 'encours')).toContain('n.d.');
    expect(sectionText(over, 'encours')).not.toMatch(/aucune anomalie/i);
    expect(sectionText(withData((r) => { r.events = []; r.radar.items = []; }), 'encours')).toContain('Aucune anomalie en cours vue par IODA ni Cloudflare Radar.');
  });
});
