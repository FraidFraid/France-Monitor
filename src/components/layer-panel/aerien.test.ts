// src/components/layer-panel/aerien.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AirEmergency, AirOverviewResponse } from '../../types/index.ts';
import { airLevel } from '../../services/traffic-levels.ts';
import { TRAFFIC_NOW, airOverviewFixture, paris } from './traffic.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { glueUnits, trafficBreakable } from './traffic-format.ts';
import { buildAerienView, type AerienViewInput } from './aerien.ts';

const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<AerienViewInput> = {}): AerienViewInput => ({ overview: airOverviewFixture(), error: null, now: TRAFFIC_NOW, open, ...over });
const view = (over: Partial<AerienViewInput> = {}) => buildAerienView(input(over));
const html = (over: Partial<AerienViewInput> = {}): string => renderLayerView('trafficAir', view(over));
const sectionOf = (id: string, over: Partial<AerienViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withOverview(edit: (o: AirOverviewResponse) => void): AirOverviewResponse {
  const o = airOverviewFixture();
  edit(o);
  return o;
}
const emergency = (over: Partial<AirEmergency> = {}): AirEmergency => ({
  icao24: '3c6444', callsign: 'DLH4AB', squawk: '7700', lat: 47.2, lon: 2.1, altitudeM: 3200, firstSeen: paris('15:02'), lastSeen: paris('15:09'),
  overFrance: true, ...over,
});

describe('vue Trafic aérien (spec 2026-10-03 trafics § 3.2)', () => {
  it('en-tête du 03/10 : 0 aéronef en urgence en vert, pastille Vert, OpenSky daté, synthèse', () => {
    const v = view();
    expect(airLevel(airOverviewFixture()).level).toBe('vert');
    expect(v.head).toMatchObject({ theme: 'Trafics', title: 'Trafic aérien', level: 'vert' });
    expect(v.head.figure).toEqual({ value: '0', caption: 'aéronef en urgence · 1\u202F301 en vol dans la zone suivie · OpenSky, 15:09', level: undefined });
    expect(v.head.status).toEqual([glueUnits(airLevel(airOverviewFixture()).reason), 'OpenSky\u00A015:09']);
    expect(v.head.lead).toBe(`Aucun code d’urgence en vol. Paris-CDG : 71 départs en 2${NBSP}h.`);
    expect(html()).toContain('<b class="fmk-num lp-lvl lp-lvl--vert">0</b>');
  });
  it('sections, ordre, ouverture', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['emergencies', true], ['airports', true], ['volume', true], ['anomalies', false], ['method', false],
    ]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('urgences : aucune en cours, codes nommés, journal de 7 jours vide dit', () => {
    const s = sectionOf('emergencies');
    expect(s?.summary).toBe('aucune en cours');
    const h = s?.html ?? '';
    expect(h).toContain('<span class="fmk-dot fmk-dot--vert" aria-hidden="true"></span><span>Aucun aéronef en urgence</span><span class="lp-val fmk-num">15:09</span>'
      + '<small>7500\u00a0détournement\u00a0·\u00a07600\u00a0panne\u00a0radio\u00a0·\u00a07700\u00a0urgence</small>');
    expect(visibleText(h)).toContain('7 derniers jours');
    expect(visibleText(h)).toContain('Aucune urgence dans le journal des 7 derniers jours.');
  });
  it('un 7700 au-dessus du territoire : chiffre et pastille orange, ligne datée, journal ; un 7500 : rouge', () => {
    const overview = withOverview((o) => {
      o.emergencies = [emergency()];
      o.emergencyLog = [emergency(), emergency({ icao24: '4ca7b2', callsign: 'RYR8LK', squawk: '7600', firstSeen: paris('22:10', '2026-09-30'),
        lastSeen: paris('22:31', '2026-09-30'), overFrance: false, altitudeM: null })];
    });
    const v = view({ overview });
    expect(airLevel(overview).level).toBe('orange');
    expect(v.head.level).toBe('orange');
    expect(v.head.figure?.value).toBe('1');
    expect(v.head.lead).toBe(`1 aéronef en urgence : DLH4AB (7700, urgence). Paris-CDG : 71 départs en 2${NBSP}h.`);
    const s = v.sections.find((x) => x.id === 'emergencies');
    expect(s?.summary).toBe('1 en cours (7700)');
    expect(s?.html).toContain(`<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>DLH4AB · 7700 (urgence)</span><span class="lp-val fmk-num">15:09</span>`
      + `<small>47,200${NBSP}N${NBSP}2,100${NBSP}E · 3\u202F200${NBSP}m · au-dessus du territoire ou de ses approches · vu depuis 15:02</small>`);
    expect(s?.html).toMatch(/<span class="fmk-dot" aria-hidden="true"><\/span><span>RYR8LK · 7600 \(panne radio\)<\/span><span class="lp-val fmk-num">30\/09 22:10<\/span><small>[^<]*altitude n\.d\. · hors du territoire : ne colore pas la pastille · vu jusqu’à 30\/09 22:31/);
    const hijack = withOverview((o) => { o.emergencies = [emergency({ squawk: '7500' })]; });
    expect(view({ overview: hijack }).head.level).toBe('rouge');
    expect(renderLayerView('trafficAir', view({ overview: hijack }))).toContain('<b class="fmk-num lp-lvl lp-lvl--rouge">1</b>');
  });
  it('aéroports : départs détectés en jauges de catégorie, au sol et en approche, fenêtre datée, retards de Beauvais et Bordeaux', () => {
    const s = sectionOf('airports');
    expect(s?.summary).toBe(`CDG 71 départs en 2${NBSP}h`);
    const h = s?.html ?? '';
    expect(h.match(/class="lp-bar-row"/g)).toHaveLength(8);
    expect(h).toContain('<div class="lp-bar-row"><span aria-hidden="true"></span><span class="lp-bar-label">Paris-CDG</span><span class="fmk-bar">'
      + '<i style="width:100%;background:var(--cat-airport)"></i></span><span class="lp-val fmk-num">71</span><small>au sol 3 · en approche 23</small></div>');
    expect(h).toContain('<span class="lp-bar-label">Paris-Orly</span><span class="fmk-bar"><i style="width:47.9%;background:var(--cat-airport)"></i>');
    const names = ['Paris-CDG', 'Paris-Orly', 'Nice', 'Lyon', 'Marseille', 'Nantes', 'Toulouse', 'Bordeaux'].map((n) => h.indexOf(`>${n}<`));
    expect([...names].sort((a, b) => a - b)).toEqual(names);
    // Beauvais (annuaire seulement, départs non relevés) : au sol et en approche dits quand même, après les jauges.
    expect(h).toContain('<div class="lp-row"><span aria-hidden="true"></span><span>Beauvais-Tillé</span><span class="lp-val fmk-num">n.d.</span>'
      + '<small>au sol 2 · en approche 1 · départs non relevés</small></div>');
    expect(h.indexOf('<span>Beauvais-Tillé</span><span class="lp-val fmk-num">n.d.</span><small>au sol')).toBeGreaterThan(names[names.length - 1]);
    const t = visibleText(h);
    expect(t).toContain(`Départs détectés de 13:09 à 15:09 (fenêtre de 2${NBSP}h, relue toutes les 4${NBSP}h).`);
    expect(t).toContain('Les arrivées ne sont publiées par la source qu’en différé : elles ne sont pas reprises.');
    expect(h).toMatch(/<span>Beauvais-Tillé<\/span><span class="lp-val fmk-num">14:55<\/span><small>3 vols retardés · 1 vol annulé<\/small>/);
    expect(h).toMatch(/<span>Bordeaux<\/span><span class="lp-val fmk-num">15:00<\/span><small>2 vols retardés · 0 vol annulé<\/small>/);
  });
  it('volume de vols : zone suivie, territoire, au sol, référence en construction, courbe en couleur de catégorie', () => {
    const s = sectionOf('volume');
    expect(s?.summary).toBe('1\u202F301 en vol');
    const h = s?.html ?? '';
    expect(h).toContain('<span class="fmk-kv-k">dont au-dessus du territoire</span><span class="fmk-kv-v fmk-num"><span class="lp-val fmk-num">612</span></span>');
    expect(h).toContain('<span class="lp-val fmk-num lp-faint">référence en construction</span>');
    expect(visibleText(h)).toContain('0 jour de collecte sur 7 : la comparaison commence au septième jour.');
    expect(h).toMatch(/<svg class="lp-chart"[^>]*role="img"[^]*stroke="var\(--cat-airport\)"/);
    const week = withOverview((o) => { o.volume.sameHourPrevDays = [1250, 1240, 1260, 1230, 1270, 1255, 1245]; });
    expect(view({ overview: week }).sections.find((x) => x.id === 'volume')?.html)
      .toContain(`<span class="fmk-kv-k">Même heure, moyenne des 7 jours précédents</span><span class="fmk-kv-v fmk-num"><span class="lp-val fmk-num">1\u202F250</span> <span class="lp-val fmk-num">+4${NBSP}%</span></span>`);
  });
  it('trajectoires inhabituelles : détection automatique en information grise, jamais une alerte', () => {
    const s = sectionOf('anomalies');
    expect(s?.summary).toBe('3 détections automatiques');
    const h = s?.html ?? '';
    expect(h).toContain('<span class="fmk-dot" aria-hidden="true"></span><span>EZY45HD · circuit d’attente</span><span class="lp-val fmk-num">14:52</span><small>près de ORY</small>');
    expect(h).toContain('<span>indicatif inconnu · circuit d’attente</span>');
    expect(visibleText(h)).toContain('une information, jamais une alerte');
    expect(h).not.toMatch(/fmk-dot--/);
  });
  it('méthode et sources : sources datées, zone suivie (T1), règle de la pastille, retards, crédits', () => {
    const t = visibleText(sectionOf('method')?.html ?? '');
    for (const part of ['états de 15:09', 'fenêtre de 13:09 à 15:09', 'Beauvais-Tillé 14:55', 'Bordeaux 15:00', '2\u202F140 restants',
      'déborde sur les pays voisins', `sur les urgences au-dessus du territoire ou de ses approches (moins de 40${NBSP}km) vues sur au moins deux relevés des états`,
      'rouge si un 7500', 'orange si un 7700', 'jaune si un 7600', 'un aéronef au sol n’est jamais compté',
      `au-delà de 10${NBSP}min`, `au-delà de 4${NBSP}h`, 'sous 500', 'sans libellé d’indicatif']) expect(t).toContain(part);
    expect(sectionOf('method')?.summary).toBe('OpenSky (ADS-B)');
    const low = withOverview((o) => { o.credits = { remaining: 320 }; });
    expect(visibleText(view({ overview: low }).sections.find((x) => x.id === 'airports')?.html ?? ''))
      .toContain('Départs suspendus : crédits OpenSky du jour sous 500.');
  });
  it('en retard (état OpenSky de plus de 10 min) : pastille n.d., « (en retard) », aucune couleur de niveau', () => {
    const now = Date.parse('2026-10-03T13:20:00Z');
    const v = view({ now });
    expect(v.head.level).toBe('nd');
    expect(v.head.figure?.level).toBeNull();
    expect(v.head.figure?.caption).toMatch(/OpenSky, 15:09 \(en retard\)$/);
    expect(v.head.status[0]).toBe('niveau suspendu : données OpenSky en retard');
    expect(v.head.lead).toBeNull();
    const h = renderLayerView('trafficAir', v);
    expect(h).not.toMatch(/lp-lvl--|fm-vig--(?:rouge|orange|jaune|vert)/);
    expect(v.sections.find((s) => s.id === 'emergencies')?.html).not.toMatch(/fmk-dot--/);
  });
  it('panne partielle : départs non lus, erreur nommée, jamais « aucun départ » ; annuaires gardés', () => {
    const overview = withOverview((o) => {
      for (const a of o.airports) { a.departures = null; a.departuresWindow = null; }
      o.errors = ['OpenSky, départs : HTTP 429'];
    });
    const s = view({ overview }).sections.find((x) => x.id === 'airports');
    expect(s?.html).toContain('Source indisponible : départs par aéroport (OpenSky).');
    expect(s?.html).toContain('Beauvais-Tillé');
    expect(visibleText(s?.html ?? '')).not.toMatch(/Aucun départ/);
    expect(visibleText(view({ overview }).sections.find((x) => x.id === 'method')?.html ?? '')).toContain('Incidents de lecture : OpenSky, départs : HTTP 429.');
  });
  it('départs et tableaux non relevés (tâche de fond du serveur) : dit tel quel, sans erreur ni zéro, jamais une panne de la source', () => {
    const overview = withOverview((o) => {
      for (const a of o.airports) { a.departures = null; a.departuresWindow = null; a.board = null; }
    });
    const v = view({ overview });
    const a = v.sections.find((x) => x.id === 'airports');
    const t = visibleText(a?.html ?? '');
    expect(t).toContain('Départs non relevés : le serveur ne les a pas encore lus.');
    expect(t).not.toMatch(/Source indisponible|Aucun départ/);
    expect(a?.html).not.toContain('lp-bar-row');
    // Au sol et en approche (états OpenSky) restent dits pour chaque aéroport, départs non relevés.
    expect(a?.html).toContain('<span>Paris-CDG</span><span class="lp-val fmk-num">n.d.</span><small>au sol 3 · en approche 23 · départs non relevés</small>');
    expect(a?.html?.match(/départs non relevés<\/small>/g)).toHaveLength(9);
    expect(t).toContain(`Au sol : à moins de 4${NBSP}km ; en approche : à moins de 40${NBSP}km et sous 3\u202F000${NBSP}m.`);
    expect(a?.summary).toBe('n.d.');
    expect(a?.html).toMatch(/<span>Beauvais-Tillé<\/span><span class="lp-val fmk-num">n\.d\.<\/span><small>tableau non relevé<\/small>/);
    expect(a?.html).toMatch(/<span>Bordeaux<\/span><span class="lp-val fmk-num">n\.d\.<\/span><small>tableau non relevé<\/small>/);
    const method = visibleText(v.sections.find((x) => x.id === 'method')?.html ?? '');
    expect(method).toContain('départs non relevés');
    expect(method).toContain('Retards et annulationstableau non relevé');
    expect(method).not.toMatch(/source indisponible|Incidents de lecture/);
    expect(v.head.level).toBe('vert');
    expect(v.head.lead).toBe('Aucun code d’urgence en vol.');
    const text = visibleText(renderLayerView('trafficAir', v));
    expect(breakableValue(text)).toBeNull();
    expect(trafficBreakable(text)).toBeNull();
  });
  it('serveur de développement : départs volontairement non lus = « Départs non relevés », avis dans la méthode, jamais « Source indisponible »', () => {
    const overview = withOverview((o) => {
      for (const a of o.airports) { a.departures = null; a.departuresWindow = null; }
      o.errors = ['OpenSky : départs non lus sur le serveur de dev (AIR_DEV_DEPARTURES=1 pour les lire)'];
    });
    const v = view({ overview });
    const t = visibleText(v.sections.find((x) => x.id === 'airports')?.html ?? '');
    expect(t).toContain('Départs non relevés');
    expect(t).not.toMatch(/Source indisponible/);
    const method = visibleText(v.sections.find((x) => x.id === 'method')?.html ?? '');
    expect(method).toContain('départs non relevés');
    expect(method).toContain('Serveur de développement : les départs ne sont pas lus');
    expect(method).not.toMatch(/Incidents de lecture|source indisponible/);
  });
  it('crédits OpenSky illisibles : erreur nommée, départs non lus restent une panne nommée', () => {
    const overview = withOverview((o) => {
      for (const a of o.airports) { a.departures = null; a.departuresWindow = null; }
      o.errors = ['crédits OpenSky illisibles'];
    });
    const v = view({ overview });
    expect(v.sections.find((x) => x.id === 'airports')?.html).toContain('Source indisponible : départs par aéroport (OpenSky).');
    expect(visibleText(v.sections.find((x) => x.id === 'method')?.html ?? '')).toContain('Incidents de lecture : crédits OpenSky illisibles.');
  });
  it('retard des départs : la fenêtre la plus récente décide, même si l’aéroport en tête n’est pas le plus récent', () => {
    const old = { begin: paris('06:00'), end: paris('08:00') };
    const mixed = withOverview((o) => { o.airports[0].departuresWindow = old; });
    const v = view({ overview: mixed });
    const h = v.sections.find((x) => x.id === 'airports')?.html ?? '';
    expect(h.match(/class="lp-bar-row"/g)).toHaveLength(8);
    expect(visibleText(h)).toContain('Les fenêtres ne sont pas les mêmes pour tous les aéroports : la plus récente est indiquée.');
    expect(visibleText(h)).toContain('Départs détectés de 13:09 à 15:09');
    expect(visibleText(h)).not.toContain('(en retard)');
    expect(v.head.lead).toBe(`Aucun code d’urgence en vol. Paris-CDG : 71 départs en 2${NBSP}h.`);
  });
  it('départs en retard (fenêtre finie depuis plus de 4 h) : lignes grises, en-tête dit « (en retard) », pastille de l’état inchangée', () => {
    const stale = withOverview((o) => { for (const a of o.airports) if (a.departuresWindow) a.departuresWindow = { begin: paris('06:00'), end: paris('08:00') }; });
    const v = view({ overview: stale });
    expect(v.head.level).toBe('vert');
    expect(v.head.lead).toBe(`Aucun code d’urgence en vol. Paris-CDG : 71 départs en 2${NBSP}h (en retard).`);
    const h = v.sections.find((x) => x.id === 'airports')?.html ?? '';
    expect(h).not.toContain('lp-bar-row');
    expect(visibleText(h)).toContain('Départs détectés de 06:00 à 08:00');
    expect(visibleText(h)).toContain('(en retard)');
    expect(visibleText(v.sections.find((x) => x.id === 'method')?.html ?? '')).toContain('fenêtre de 06:00 à 08:00 (en retard)');
  });
  it('un 7700 en cours hors du territoire : listé, puce grise, pastille et chiffre au niveau de la France', () => {
    const overview = withOverview((o) => { o.emergencies = [emergency({ overFrance: false })]; });
    expect(airLevel(overview).level).toBe('vert');
    const v = view({ overview });
    expect(v.head.level).toBe('vert');
    expect(v.head.figure?.value).toBe('1');
    expect(v.head.figure?.caption).toBe('aéronef en urgence · dont 1 hors territoire · 1\u202F301 en vol dans la zone suivie · OpenSky, 15:09');
    expect(v.head.status[0]).toBe(glueUnits(airLevel(overview).reason));
    expect(v.head.status[0]).toBe('aucune urgence confirmée au-dessus du territoire ou de ses approches');
    expect(v.head.lead).toBe(`1 aéronef en urgence : DLH4AB (7700, urgence, hors territoire). Paris-CDG : 71 départs en 2${NBSP}h.`);
    const h = v.sections.find((x) => x.id === 'emergencies')?.html ?? '';
    expect(h).toContain('<span class="fmk-dot" aria-hidden="true"></span><span>DLH4AB · 7700 (urgence)</span>');
    expect(h).not.toMatch(/fmk-dot--(?:orange|rouge|jaune)/);
    expect(visibleText(h)).toContain('hors territoire et approches : ne colore pas la pastille');
    expect(renderLayerView('trafficAir', v)).toContain('<b class="fmk-num lp-lvl lp-lvl--vert">1</b>');
  });
  it('I2 : un 7500 ou un 7600 hors du territoire ne colore ni la pastille ni le chiffre, comme sa ligne, la carte et la légende', () => {
    for (const squawk of ['7500', '7600'] as const) {
      const overview = withOverview((o) => { o.emergencies = [emergency({ squawk, callsign: 'AWAY1', lat: 50.9, lon: 4.4, overFrance: false })]; });
      const v = view({ overview });
      expect(v.head.level).toBe('vert');
      expect(v.head.status[0]).toBe('aucune urgence confirmée au-dessus du territoire ou de ses approches');
      expect(v.head.figure?.caption).toContain('dont 1 hors territoire');
      const all = renderLayerView('trafficAir', v);
      expect(all).toContain('<b class="fmk-num lp-lvl lp-lvl--vert">1</b>');
      expect(all).not.toMatch(/fm-vig--(?:rouge|jaune)|lp-lvl--(?:rouge|jaune)|fmk-dot--(?:rouge|jaune)/);
      expect(visibleText(v.sections[0].html)).toContain('hors territoire et approches : ne colore pas la pastille');
    }
  });
  it('I3 : un code vu sur une seule lecture des états est listé en gris, « vu une fois, à confirmer », sans colorer ; confirmé : coloré', () => {
    const once = withOverview((o) => { o.emergencies = [emergency({ squawk: '7500', firstSeen: paris('15:09'), lastSeen: paris('15:09') })]; });
    const v = view({ overview: once });
    expect(v.head.level).toBe('vert');
    expect(v.head.status[0]).toBe('aucune urgence confirmée au-dessus du territoire ou de ses approches');
    expect(v.head.figure?.caption).toBe('aéronef en urgence · dont 1 à confirmer · 1\u202F301 en vol dans la zone suivie · OpenSky, 15:09');
    expect(v.head.lead).toBe(`1 aéronef en urgence : DLH4AB (7500, intervention illicite, à confirmer). Paris-CDG : 71 départs en 2${NBSP}h.`);
    const h = v.sections[0].html;
    expect(h).toContain('<span class="fmk-dot" aria-hidden="true"></span><span>DLH4AB · 7500 (intervention illicite)</span><span class="lp-val fmk-num">15:09</span>'
      + `<small>47,200${NBSP}N${NBSP}2,100${NBSP}E · 3\u202F200${NBSP}m · au-dessus du territoire ou de ses approches · vu une fois, à confirmer</small>`);
    expect(renderLayerView('trafficAir', v)).not.toMatch(/lp-lvl--rouge|fm-vig--rouge|fmk-dot--rouge/);
    expect(visibleText(h)).toContain('vu sur au moins deux relevés');
    // Deuxième lecture (15:11) : confirmé, rouge.
    const twice = withOverview((o) => { o.emergencies = [emergency({ squawk: '7500', firstSeen: paris('15:09'), lastSeen: paris('15:11') })]; });
    const w = view({ overview: twice, now: Date.parse(paris('15:12')) });
    expect(w.head.level).toBe('rouge');
    expect(w.head.figure?.caption).toBe('aéronef en urgence · 1\u202F301 en vol dans la zone suivie · OpenSky, 15:09');
    expect(renderLayerView('trafficAir', w)).toContain('<b class="fmk-num lp-lvl lp-lvl--rouge">1</b>');
    expect(w.sections[0].html).toContain('fmk-dot--rouge');
    // Journal : une vue unique y reste dite.
    const logged = withOverview((o) => { o.emergencyLog = [emergency({ firstSeen: paris('11:00'), lastSeen: paris('11:00') })]; });
    expect(visibleText(view({ overview: logged }).sections[0].html)).toContain('vu une fois, non confirmé');
  });
  it('erreur sans donnée, erreur avec données, vide, chargement', () => {
    const failed = view({ overview: null, error: 'HTTP 502' });
    expect(failed.head).toMatchObject({ level: 'nd', figure: { value: 'n.d.' }, status: ['OpenSky injoignable'] });
    expect(failed.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(failed.sections.find((s) => s.id === 'emergencies')?.html).toContain('Source indisponible : OpenSky.');
    expect(view({ error: 'HTTP 502' }).bodyHtml).toContain('Source injoignable. Dernières données : 15:09.');
    const empty = withOverview((o) => { o.airports = []; o.anomalies = []; });
    expect(view({ overview: empty }).sections.find((s) => s.id === 'airports')?.html).toContain('Aucun départ détecté sur la fenêtre affichée.');
    expect(view({ overview: empty }).sections.find((s) => s.id === 'anomalies')?.html).toContain('Aucune trajectoire inhabituelle détectée.');
    expect(view({ overview: null }).bodyHtml).toContain('Chargement des données…');
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute', () => {
    const overview = withOverview((o) => {
      o.emergencies = [emergency({ callsign: '<img src=x>' })];
      o.anomalies[0].callsign = '<script>a</script>';
      o.airports[0].name = '"><svg onload=1>';
    });
    const h = html({ overview });
    expect(h).not.toMatch(/<img|<script|<svg onload/);
    for (const over of [{}, { overview }, { now: Date.parse('2026-10-03T13:20:00Z') }]) {
      const all = html(over);
      const text = visibleText(all);
      expect(breakableValue(text)).toBeNull();
      expect(trafficBreakable(text)).toBeNull();
      expect(all).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(text.toLowerCase()).not.toContain('temps réel');
    }
  });
  it('jeton de catégorie des aéroports défini dans :root', () => {
    const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
    expect(css).toMatch(/:root \{[^}]*--cat-airport: #5ac8fa;/);
  });
});
