// src/components/layer-panel/qualite-air.test.ts
import { describe, expect, it } from 'vitest';
import type { AirEpisode, AirQualityResponse } from '../../types/index.ts';
import { AIR_FIXTURE, ENV_FIXTURE_NOW } from './environment.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { envBreakable, parisDayWord } from './environment-format.ts';
import { buildQualiteAirView, type QualiteAirViewInput } from './qualite-air.ts';

const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<QualiteAirViewInput> = {}): QualiteAirViewInput => ({ air: structuredClone(AIR_FIXTURE), airError: null, now: ENV_FIXTURE_NOW, open, ...over });
const view = (over: Partial<QualiteAirViewInput> = {}) => buildQualiteAirView(input(over));
const html = (over: Partial<QualiteAirViewInput> = {}): string => renderLayerView('airQuality', view(over));
const section = (id: string, over: Partial<QualiteAirViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withAir(edit: (a: AirQualityResponse) => void): AirQualityResponse {
  const a = structuredClone(AIR_FIXTURE);
  edit(a);
  return a;
}
function ep(over: Partial<AirEpisode>): AirEpisode {
  return { zoneCode: '13', zone: 'BOUCHES-DU-RHONE', pollutantCode: 'O3', pollutant: 'ozone', date: '2026-10-05', state: 'alerte', stateRaw: 'ALERTE SUR PERSISTANCE', updatedAt: '2026-10-03T13:20:00.000Z', ...over };
}
/** Épisodes construits : information en J (Var), alerte en J+1 (Bouches-du-Rhône), état non reconnu en J+2 ; trois jours publiés. */
const EPISODES = withAir((a) => {
  a.episodes = [
    ep({ zoneCode: '83', zone: 'VAR', date: '2026-10-04', state: 'information', stateRaw: 'PROCEDURE D’INFORMATION-RECOMMANDATION' }),
    ep({}),
    ep({ zoneCode: '06', zone: 'ALPES-MARITIMES', pollutantCode: 'NO2', pollutant: 'dioxyde d’azote', date: '2026-10-06', state: 'inconnu', stateRaw: 'VIGILANCE' }),
  ];
  a.perPollutant = [
    { pollutantCode: 'O3', pollutant: 'ozone', days: [{ date: '2026-10-04', information: 1, alerte: 0 }, { date: '2026-10-05', information: 0, alerte: 1 }, { date: '2026-10-06', information: 0, alerte: 0 }] },
    { pollutantCode: 'NO2', pollutant: 'dioxyde d’azote', days: [{ date: '2026-10-04', information: 0, alerte: 0 }, { date: '2026-10-05', information: 0, alerte: 0 }, { date: '2026-10-06', information: 0, alerte: 0 }] },
  ];
});

describe('vue Qualité de l’air (spec 2026-10-04 environnement § 3.2)', () => {
  it('en-tête du 04/10 : 0 épisode en vert, pastille Verte, épisodes et indice datés, synthèse', () => {
    const v = view();
    expect(v.head).toMatchObject({ theme: 'Environnement', title: 'Qualité de l’air', level: 'vert' });
    expect(v.head.figure).toEqual({ value: '0', caption: 'épisodes de pollution en cours ou prévus, J à J+2 · Atmo France, 03/10 20:05', level: 'vert' });
    expect(v.head.status).toEqual(['aucun épisode de pollution prévu', `Atmo${NBSP}03/10${NBSP}20:05 · indice${NBSP}03/10${NBSP}15:36`]);
    expect(v.head.lead).toBe('Aucun épisode de pollution en cours ni prévu jusqu’au 6 octobre (101 zones suivies). Indice ATMO du 4 octobre : '
      + '4\u202F920 communes en indice dégradé sur 26\u202F663 couvertes, aucune en indice mauvais ou pire.');
  });
  it('sections, ordre et ouverture', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([['episodes', true], ['indice', false], ['methode', false]]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('épisodes du 04/10 : aucun ; jours non publiés dits (jamais « aucun épisode » pour un jour absent)', () => {
    const s = section('episodes');
    expect(s?.summary).toBe('aucun');
    const t = visibleText(s?.html ?? '');
    expect(t).toContain('Aucun épisode de pollution en cours ni prévu le 4 octobre (101 zones suivies).');
    expect(t).toContain(`Prévision non encore publiée pour le 5 octobre et le 6 octobre (publication vers 14${NBSP}h, heure de Paris).`);
    expect(s?.html).not.toContain('<svg');
  });
  it('épisodes construits : alerte rouge, information orange, état non reconnu gris (texte publié), barres par polluant ; pastille Rouge', () => {
    const v = view({ air: EPISODES });
    expect(v.head.level).toBe('rouge');
    expect(v.head.figure).toMatchObject({ value: '3', level: 'rouge' });
    expect(v.head.status[0]).toBe('seuil d’alerte : ozone, BOUCHES-DU-RHONE');
    const h = v.sections.find((s) => s.id === 'episodes')?.html ?? '';
    expect(h).toContain(`<div class="lp-row"><span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>Ozone · VAR</span><span class="lp-val fmk-num">04/10</span><small>information-recommandation · ${parisDayWord('2026-10-04', ENV_FIXTURE_NOW).replace(/'/g, '&#39;')}</small></div>`);
    expect(h).toContain('<span class="fmk-dot fmk-dot--rouge" aria-hidden="true"></span><span>Ozone · BOUCHES-DU-RHONE</span><span class="lp-val fmk-num">05/10</span>');
    expect(h).toMatch(/<span class="fmk-dot" aria-hidden="true"><\/span><span>Dioxyde d’azote · ALPES-MARITIMES<\/span>[^]*état non reconnu · [^<]* · état publié : VIGILANCE/);
    expect(h).toMatch(/<svg[^>]*aria-label="Épisodes par jour, ozone"/);
    expect(h).not.toMatch(/aria-label="Épisodes par jour, dioxyde d’azote"/);
    expect(v.sections[0].summary).toBe('3 épisodes');
  });
  it('indice par département : jauges colorées par l’indice le plus haut, douze premiers, reste résumé, départements non couverts nommés', () => {
    const s = section('indice');
    expect(s?.summary).toBe('4\u202F920 communes en indice dégradé ou pire');
    const h = s?.html ?? '';
    expect(h.match(/class="lp-bar-row"/g)).toHaveLength(12);
    expect(h).toContain(`<span class="lp-bar-label">Alpes-de-Haute-Provence (04)</span><span class="fmk-bar"><i style="width:100%;background:var(--sev-yellow)"></i></span><span class="lp-val fmk-num">100${NBSP}%</span><small>198 communes sur 198 en indice dégradé ou pire · indice le plus haut : dégradé</small>`);
    expect(h).toContain('<span class="lp-bar-label">Alpes-Maritimes (06)</span><span class="fmk-bar"><i style="width:98.2%;background:var(--sev-yellow)"></i>');
    const order = ['(04)', '(13)', '(83)', '(84)', '(06)', '(05)', '(21)', '(71)', '(02)', '(87)', '(58)', '(16)'].map((c) => h.indexOf(c));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h).not.toContain('(24)</span>');
    const t = visibleText(h);
    expect(t).toContain('66 autres départements couverts, indice le plus haut au plus dégradé.');
    expect(t).toContain('Départements de métropole sans indice ce jour (23) : Ariège, Aude, Aveyron, Cher, Côtes-d’Armor, Eure-et-Loir, Finistère, Gard, '
      + 'Haute-Garonne, Gers, Hérault, Ille-et-Vilaine, Indre, Indre-et-Loire, Loir-et-Cher, Loiret, Lot, Lozère, Morbihan, Hautes-Pyrénées, '
      + 'Pyrénées-Orientales, Tarn, Tarn-et-Garonne.');
    expect(t).toContain('pas la palette officielle ATMO');
  });
  it('une commune en indice mauvais : pastille Jaune, jauge orange pour son département', () => {
    const air = withAir((a) => { a.index.departments[5] = { ...a.index.departments[5], mauvais: 2, maxIndex: 4 }; });
    const v = view({ air });
    expect(v.head.level).toBe('jaune');
    expect(v.head.status[0]).toBe(`2${NBSP}communes en indice mauvais ou pire`);
    expect(v.sections.find((s) => s.id === 'indice')?.html).toContain('<span class="lp-bar-label">Alpes-Maritimes (06)</span><span class="fmk-bar"><i style="width:99.4%;background:var(--sev-orange)"></i>');
  });
  it('méthode et sources : arrêtés préfectoraux hors du flux, périmètre AASQA, couleurs, situation, retard, relève filtrée', () => {
    const t = visibleText(section('methode')?.html ?? '');
    for (const part of ['Les textes des arrêtés préfectoraux ne sont pas dans ce flux', 'communes couvertes par les AASQA', 'zones intercommunales',
      'pas la palette officielle ATMO', 'seuil d’alerte en J ou J+1 crée une situation', `36${NBSP}h`, `toutes les heures de 13${NBSP}h à 19${NBSP}h`,
      'toujours filtrées par date']) expect(t).toContain(part);
    expect(section('methode')?.summary).toBe('Atmo France');
  });
  it('en retard (épisodes de plus de 36 h) : n.d., « (en retard) », aucune couleur ; indice en retard : lignes sans jauge', () => {
    const now = Date.parse('2026-10-05T07:00:00Z');
    const v = view({ now });
    expect(v.head.level).toBe('nd');
    expect(v.head.figure?.level).toBeNull();
    expect(v.head.status[0]).toBe('niveau suspendu : épisodes Atmo France en retard');
    expect(v.head.lead).toBeNull();
    for (const id of ['episodes', 'indice']) {
      expect(v.sections.find((s) => s.id === id)?.html).not.toMatch(/lp-lvl--|fmk-dot--(?:rouge|orange|jaune|vert)|class="fmk-bar"><i/);
    }
  });
  it('pannes : épisodes illisibles (indice servi), indice non publié, rien de lu, chargement', () => {
    const noEpisodes = view({ air: withAir((a) => { a.episodesUpdatedAt = null; a.zonesCovered = 0; a.perPollutant = []; a.errors = ['Atmo France, épisodes : HTTP 500']; }) });
    expect(noEpisodes.sections[0].html).toContain('Source indisponible : épisodes de pollution (Atmo France).');
    expect(noEpisodes.head.level).toBe('vert');
    const noIndex = view({ air: withAir((a) => { a.index = { date: null, updatedAt: null, communes: 0, departments: [] }; }) });
    expect(noIndex.sections.find((s) => s.id === 'indice')?.html).toContain('Indice ATMO du 4 octobre non encore publié.');
    const failed = view({ air: null, airError: 'HTTP 502' });
    expect(failed.head).toMatchObject({ level: 'nd', figure: { value: 'n.d.' }, status: ['Atmo France injoignable'] });
    expect(failed.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(view({ air: null }).bodyHtml).toContain('Chargement des données…');
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute ; jamais « temps réel »', () => {
    const air = withAir((a) => { a.episodes = [ep({ zone: '<img src=x onerror=1>', stateRaw: '<script>x</script>', state: 'inconnu' })]; a.index.departments[0].name = '<b>x</b>'; });
    const h = html({ air });
    expect(h).not.toMatch(/<img|<script|<b>x/);
    for (const over of [{}, { air: EPISODES }, { now: Date.parse('2026-10-05T07:00:00Z') }, { air: null, airError: 'HTTP 502' }]) {
      const all = html(over);
      const text = visibleText(all);
      expect(breakableValue(text)).toBeNull();
      expect(envBreakable(text)).toBeNull();
      expect(all).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(text.toLowerCase()).not.toContain('temps réel');
    }
  });
});
