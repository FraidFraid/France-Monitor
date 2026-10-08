// src/components/layer-panel/defense.test.ts
// Vue Défense (spec 2026-10-04 souveraineté § 2.1 ; contrats § 4.1 ; amendement 7 : O9, O11, O13, O14, S1 à S5 ; décision du 08/10/2026 :
// aucun aéronef masqué) sur la collecte réelle du 04/10 (adsb-lol-mil.json, réponse du serveur) : 9 aéronefs au-dessus de la France, 4 français
// et 5 autres, tous montrés avec leur identité, 3 hors de France, aucune urgence ; urgences construites ; urgences d'appareils français et PIA
// du jeu d'essai ; base curée réelle.
import { describe, expect, it } from 'vitest';
import type { MilitaryAircraft, MilitaryEmergency, MilitaryResponse, VigipiratePageCheck } from '../../types/index.ts';
import { ACTIVE_INSTALLATIONS } from '../../config/military-bases-db.ts';
import type { MilitaryShip } from '../../services/military-ships.ts';
import { MILITARY_FIGURE_LABEL, defenseLevel } from '../../services/sovereignty-levels.ts';
import type { SourceSlot } from '../../services/sovereignty-source.ts';
import {
  MILITARY_EMERGENCY_FIXTURE, MILITARY_FIXTURE, MILITARY_FRENCH_EMERGENCY_FIXTURE, SOV_FIXTURE_NOW, VIGIPIRATE_CHECK_CHANGED_FIXTURE,
  VIGIPIRATE_CHECK_FIXTURE, VIGIPIRATE_FIXTURE,
} from './sovereignty.fixture.ts';
import { NBSP, breakableValue, frNumber, visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { trafficBreakable } from './traffic-format.ts';
import { glueSovUnits, sovBreakable } from './sovereignty-format.ts';
import { shipRow, type NavyLiveInput } from './navy.ts';
import {
  DEFENSE_SOURCES, DEFENSE_TITLE, buildDefenseView, summarizeCuratedSites, vigipirateBadge, type DefenseSitesSummary, type DefenseViewInput,
} from './defense.ts';

const NOW = SOV_FIXTURE_NOW;
const MIN = 60_000;
const open = (_: string, d: boolean): boolean => d;
const slot = (data: VigipiratePageCheck | null, error: string | null = null): SourceSlot<VigipiratePageCheck> => ({ data, error, fetchedAt: NOW });
const ship = (over: Partial<MilitaryShip> & Pick<MilitaryShip, 'id' | 'name'>): MilitaryShip => ({
  type: 'FREMM', role: 'Frégate multi-missions', lat: 43.12, lon: 5.92, isLive: false, port: 'Toulon', speed: 0, ...over,
});
/** Bâtiment reconnu par son propre message AIS (type militaire, MID français, nom de la liste) depuis 16:28, vu à 16:47. */
const LIVE = ship({
  id: 'd651', name: 'Provence', mmsi: '227802000', isLive: true, lastSeen: NOW - MIN, speed: 14.2, lat: 42.9, lon: 6.1, country: 'FR|France',
  mmsiSource: 'message AIS du bâtiment', identifiedAt: NOW - 20 * MIN,
});
const HOME = ship({ id: 'd650', name: 'Aquitaine' });
/** Sous-marin d'une ancienne liste : jamais affiché (O11), même s'il arrivait dans les positions. */
const SUB = ship({ id: 's616', name: 'Le Triomphant', type: 'SNLE', role: 'Dissuasion nucléaire', port: 'Île Longue', lat: 48.3018, lon: -4.5172 });
const NAVY: NavyLiveInput = { status: 'connected', lastMessageAt: NOW - MIN, ships: [SUB, HOME, LIVE] };
const SITES: DefenseSitesSummary = { curated: summarizeCuratedSites(ACTIVE_INSTALLATIONS), osm: { meta: null, error: null, shown: false } };
const BADGE = 'Vigipirate : vigilance renforcée (niveau d’alerte intermédiaire) depuis le 22/06/2026 · Source : site internet du SGDSN';
const input = (over: Partial<DefenseViewInput> = {}): DefenseViewInput => ({
  military: MILITARY_FIXTURE(), militaryError: null, vigipirate: VIGIPIRATE_FIXTURE, vigipirateCheck: slot(VIGIPIRATE_CHECK_FIXTURE()), navy: NAVY,
  aisRelay: { evaluated: true, lastMessageAt: new Date(NOW - MIN).toISOString() }, sites: SITES, canFocus: true, now: NOW, open, ...over,
});
const view = (over: Partial<DefenseViewInput> = {}) => buildDefenseView(input(over));
const html = (over: Partial<DefenseViewInput> = {}): string => renderLayerView('military', view(over));
const sectionOf = (id: string, over: Partial<DefenseViewInput> = {}) => view(over).sections.find((s) => s.id === id);
const military = (edit: (m: MilitaryResponse) => void, base: () => MilitaryResponse = MILITARY_FIXTURE): MilitaryResponse => {
  const m = base();
  edit(m);
  return m;
};

/** 7700 confirmé sur deux lectures au-dessus du Finistère (exemple des contrats § 6), appareil d'une autre nation. */
const E7700: MilitaryEmergency = {
  icao24: 'ae0805', callsign: 'RCH161', registration: null, squawk: '7700', lat: 48.39, lon: -4.49, altitudeM: 7620, firstSeen: '2026-10-04T14:44:00Z',
  lastSeen: '2026-10-04T14:48:24Z', overFrance: true, type: 'C17', country: 'États-Unis', family: 'autres', emergency: 'general', inFrance: true, dept: '29',
};
/** 7500 vu une fois au-dessus de Genève : à 4,4 km de la France, dans les approches de 40 km, hors du territoire (V2). */
const E7500: MilitaryEmergency = {
  icao24: '4b1814', callsign: 'ESSAI75', registration: null, squawk: '7500', lat: 46.204, lon: 6.143, altitudeM: 9140, firstSeen: '2026-10-04T14:48:24Z',
  lastSeen: '2026-10-04T14:48:24Z', overFrance: true, type: 'A400', country: 'Suisse', family: 'autres', emergency: 'unlawful', inFrance: false, dept: null,
};

describe('vue Défense (spec 2026-10-04 souveraineté § 2.1)', () => {
  it('en-tête du 04/10 : 9 aéronefs, libellé O9, coloré par la pastille verte ; relevé daté ; insigne Vigipirate (S1)', () => {
    const v = view();
    expect(defenseLevel(MILITARY_FIXTURE(), NOW).level).toBe('vert');
    expect(v.head).toMatchObject({ theme: 'Souveraineté', title: DEFENSE_TITLE, level: 'vert' });
    expect(v.head.figure).toEqual({ value: '9', caption: `${MILITARY_FIGURE_LABEL} · 4 français · 5 autres · relevé adsb.lol 16:48` });
    expect(v.head.figure?.caption.startsWith('aéronefs militaires ou d’État visibles en ADS-B au-dessus de la métropole')).toBe(true);
    expect(v.head.status).toEqual([glueSovUnits(defenseLevel(MILITARY_FIXTURE(), NOW).reason), `adsb.lol${NBSP}16:48`]);
    expect(v.head.lead).toBe(BADGE);
    expect(vigipirateBadge(VIGIPIRATE_FIXTURE)).toBe(v.head.lead);
    expect(v.bodyHtml).toBeUndefined();
    expect(html()).toContain('<b class="fmk-num lp-lvl lp-lvl--vert">9</b>');
  });
  it('gros chiffre : tous les appareils de la réponse comptés, mer territoriale et adresse non OACI compris', () => {
    const m = military((x) => {
      x.aircraft.push({ ...x.aircraft[0], hex: '3bf005', callsign: 'FICTIF05', dept: null }, { ...x.aircraft[4], hex: '~ab12cd', callsign: null, country: null });
    });
    expect(view({ military: m }).head.figure?.value).toBe('11');
    expect(view({ military: m }).head.figure?.caption).toBe(`${MILITARY_FIGURE_LABEL} · 5 français · 6 autres · relevé adsb.lol 16:48`);
  });
  it('sections dans l’ordre du contrat ; urgences repliées sans urgence ; méthode en ton de référence', () => {
    const v = view();
    expect(v.sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['vigipirate', true], ['aeronefs', true], ['urgences', false], ['gnss', true], ['marine', false], ['sites', false], ['gels', false], ['methode', false],
    ]);
    expect(v.sections.at(-1)?.tone).toBe('reference');
    // Entrées de la phase A (sans grille GNSS ni registre) : les deux sections de la phase B restent en « chargement… ».
    expect(v.sections.filter((s) => s.id === 'gnss' || s.id === 'gels').map((s) => s.summary)).toEqual(['chargement…', 'chargement…']);
  });
});

describe('posture Vigipirate (V4, O14, S1)', () => {
  it('stade dans les mots du SGDSN, date, accents, lien, source ; sans couleur de niveau ; page relue datée', () => {
    const s = sectionOf('vigipirate');
    expect(s?.summary).toBe('vigilance renforcée');
    const h = s?.html ?? '';
    const t = visibleText(h);
    expect(t).toContain('Stadevigilance renforcée (niveau d’alerte intermédiaire)');
    expect(t).not.toMatch(/2 sur 3/);
    expect(t).toContain('Depuis le22/06/2026');
    expect(t).toContain(`Accents${VIGIPIRATE_FIXTURE.accents.join(', ')}`);
    expect(t).toContain('Saisie04/10/2026');
    expect(t).toContain('Page officiellerelue le 04/10 à 16:48');
    expect(h).toContain(`href="${VIGIPIRATE_FIXTURE.lien}"`);
    expect(t).toContain('Source : site internet du SGDSN. Niveau public du plan Vigipirate, repris de sgdsn.gouv.fr le 04/10/2026');
    expect(t).toContain('la note de posture fait foi');
    expect(t).toContain('Hors score : une posture n’est pas un événement.');
    expect(t).not.toContain('Fin des 12');
    expect(h).not.toMatch(/lp-lvl|fmk-dot--/);
  });
  it('aucune mention sous l’insigne quand la page relue n’a pas changé et que la saisie a moins de 4 mois', () => {
    expect(view().bodyHtml).toBeUndefined();
    expect(view({ vigipirateCheck: null }).bodyHtml).toBeUndefined();
  });
  it('page officielle modifiée après la saisie : « niveau à revérifier » sous l’insigne, résumé de la section dit', () => {
    const v = view({ vigipirateCheck: slot(VIGIPIRATE_CHECK_CHANGED_FIXTURE()) });
    expect(v.head.lead).toBe(BADGE);
    expect(v.bodyHtml).toBe('<p class="fmk-callout lp-callout">Niveau à revérifier sur sgdsn.gouv.fr (page modifiée le 05/10).</p>');
    expect(v.sections[0].summary).toBe('vigilance renforcée · à revérifier');
    expect(visibleText(v.sections[0].html)).toContain('Page officiellerelue le 05/10 à 16:48');
  });
  it('alerte attentat : rang sommital dans l’insigne, fin des 12 jours sous l’insigne et dans la section', () => {
    const entry = { ...VIGIPIRATE_FIXTURE, stade: 'alerte-attentat' as const, depuis: '2026-10-03' };
    const v = view({ vigipirate: entry });
    expect(v.head.lead).toBe('Vigipirate : alerte attentat (niveau d’alerte sommital) depuis le 03/10/2026 · Source : site internet du SGDSN');
    expect(vigipirateBadge(entry)).toBe(v.head.lead);
    expect(v.bodyHtml).toBe('<p class="fmk-note">Alerte attentat jusqu’au 15/10, sauf renouvellement par le Premier ministre.</p>');
    expect(visibleText(v.sections[0].html)).toContain(`Fin des 12${NBSP}jours15/10/2026, sauf renouvellement par le Premier ministre`);
    expect(visibleText(v.sections[0].html)).toContain('Stadealerte attentat (niveau d’alerte sommital)');
  });
  it('alerte attentat, échéance des 12 jours : dite jusqu’à minuit de Paris le 15/10, passée le 16/10 à 00:30 de Paris (encore le 15 en UTC)', () => {
    const entry = { ...VIGIPIRATE_FIXTURE, stade: 'alerte-attentat' as const, depuis: '2026-10-03' };
    const lastEvening = view({ vigipirate: entry, vigipirateCheck: null, now: Date.parse('2026-10-15T23:30:00+02:00') });
    expect(lastEvening.bodyHtml).toBe('<p class="fmk-note">Alerte attentat jusqu’au 15/10, sauf renouvellement par le Premier ministre.</p>');
    expect(lastEvening.sections[0].summary).toBe('alerte attentat');
    const afterMs = Date.parse('2026-10-16T00:30:00+02:00');
    expect(new Date(afterMs).toISOString().slice(0, 10)).toBe('2026-10-15');
    const after = view({ vigipirate: entry, vigipirateCheck: null, now: afterMs });
    expect(after.bodyHtml).toBe('<p class="fmk-callout lp-callout">'
      + `Échéance des 12${NBSP}jours de l’alerte attentat passée le 15/10 · niveau à revérifier sur sgdsn.gouv.fr.</p>`);
    expect(after.head.lead).toBe('Vigipirate : alerte attentat (niveau d’alerte sommital) depuis le 03/10/2026 · Source : site internet du SGDSN');
    expect(after.sections[0].summary).toBe('alerte attentat · à revérifier');
    const t = visibleText(after.sections[0].html);
    expect(t).toContain(`Fin des 12${NBSP}jours15/10/2026, échéance passée · niveau à revérifier sur sgdsn.gouv.fr`);
    expect(`${after.bodyHtml ?? ''} ${t}`).not.toMatch(/jusqu’au|sauf renouvellement/);
  });
  it('saisie de plus de 4 mois et vérification en panne : encadrés sous l’insigne, avant la panne adsb.lol nommée', () => {
    const later = Date.parse('2027-02-15T12:00:00+01:00');
    const v = view({ now: later, vigipirateCheck: slot(null, 'SGDSN, page Vigipirate : HTTP 503'), militaryError: 'HTTP 502' });
    const body = visibleText(v.bodyHtml ?? '');
    expect(body).toContain(`Saisie du 04/10/2026, de plus de 4${NBSP}mois : à vérifier sur sgdsn.gouv.fr.`);
    expect(body).toContain('Page officielle jamais relue : SGDSN, page Vigipirate : HTTP 503.');
    expect(body.indexOf('Page officielle jamais relue')).toBeLessThan(body.indexOf('Source adsb.lol injoignable'));
    expect(visibleText(v.sections[0].html)).toContain('Page officiellejamais relue');
    expect(v.head.lead).toBe(BADGE);
  });
});

describe('aéronefs au-dessus de la France (S5)', () => {
  it('français d’abord puis autres pays, tous nommés avec immatriculation, adresse OACI, pays, département, altitude, vitesse, heure vue', () => {
    const s = sectionOf('aeronefs');
    expect(s?.summary).toBe('9 en France · 3 hors de France');
    const h = s?.html ?? '';
    expect([...h.matchAll(/data-aircraft="([^"]+)"/g)].map((x) => x[1])).toEqual(['3bf001', '3bf002', '3bf003', '3bf004', '894081', 'c2b5b7', '44f684', '43c6f6', '43c700']);
    const t = visibleText(h);
    expect(t).toContain('Français : 4');
    expect(t).toContain('Autres pays : 5');
    expect(t.indexOf('Français : 4')).toBeLessThan(t.indexOf('Autres pays : 5'));
    expect(t).toContain(`Par département : Bouches-du-Rhône (13)${NBSP}:${NBSP}3 · Rhône (69)${NBSP}:${NBSP}1.`);
    expect(h).toContain('<div class="lp-row is-link" tabindex="0" role="button" data-aircraft="3bf004">'
      + '<span class="lp-swatch" style="background:var(--cat-mil-francais)" aria-hidden="true"></span><span>FICTIF04 · EC45</span>'
      + `<span class="lp-val fmk-num">Rhône (69)</span><small>F-ZFIC · adresse 3bf004 · France · 525${NBSP}ft · 52${NBSP}nœuds · vu à 16:48</small></div>`);
    expect(h).toContain('<div class="lp-row is-link" tabindex="0" role="button" data-aircraft="43c700">'
      + '<span class="lp-swatch" style="background:var(--cat-mil-autres)" aria-hidden="true"></span><span>RRR2301 · A332</span>'
      + `<span class="lp-val fmk-num">Puy-de-Dôme (63)</span><small>adresse 43c700 · Royaume-Uni · ${frNumber(39000, 0)}${NBSP}ft · 460${NBSP}nœuds · vu à 16:48</small></div>`);
    expect(t).toContain('ZZ999 · adresse 43c6f6 · Royaume-Uni');
    expect(h).toContain('<span class="fmk-dot" aria-hidden="true"></span><span>Hors de France (approches, mer, pays voisins), jamais comptés</span><span class="lp-val fmk-num">3</span>');
    expect(t).not.toMatch(/Identité protégée|jamais montrés|comptés par département/);
    expect(t).toContain('Clic sur un aéronef : sa position au relevé sur la carte.');
    expect(t).toContain('un appareil absent du flux n’est pas absent du ciel');
    const noMap = sectionOf('aeronefs', { canFocus: false })?.html ?? '';
    expect(noMap).not.toContain('data-aircraft');
    expect(visibleText(noMap)).not.toContain('Clic sur un aéronef');
    expect(visibleText(noMap)).toContain('FICTIF04 · EC45');
  });
  it('mer territoriale (S5), adresse non OACI, appareil sans indicatif : une ligne nommée chacun, jamais un simple compte', () => {
    const m = military((x) => {
      x.frenchByDept.push({ dept: null, count: 1 });
      x.aircraft[0] = { ...x.aircraft[0], dept: null };
      x.aircraft[4] = { ...x.aircraft[4], dept: null };
      x.aircraft[5] = { ...x.aircraft[5], hex: '~ab12cd', callsign: null, registration: null, country: null };
      x.aircraft[6] = { ...x.aircraft[6], callsign: null, registration: 'ZZ123' };
    });
    const h = sectionOf('aeronefs', { military: m })?.html ?? '';
    const t = visibleText(h);
    expect(t).toContain(`Par département : Bouches-du-Rhône (13)${NBSP}:${NBSP}3 · Rhône (69)${NBSP}:${NBSP}1 · au-dessus de la mer territoriale (moins de 12${NBSP}milles de la côte)${NBSP}:${NBSP}1.`);
    expect(t).toContain(`BAH11 · B738mer territorialeadresse 894081 · Bahreïn · ${frNumber(38000, 0)}${NBSP}ft · 424${NBSP}nœuds · vu à 16:48 · au-dessus de la mer territoriale`);
    expect(t).toContain(`FICTIF01 · DH8Dmer territorialeadresse 3bf001 · France · ${frNumber(2050, 0)}${NBSP}ft`);
    expect(t).toContain(`adresse ~ab12cd · C30JBouches-du-Rhône (13)adresse ~ab12cd · pays non identifié · ${frNumber(2725, 0)}${NBSP}ft`);
    expect(t).toContain('ZZ123 · A400Pyrénées-Atlantiques (64)ZZ123 · adresse 44f684 · Belgique');
    expect(t).not.toMatch(/eaux françaises|Identité protégée/);
    expect(h.match(/data-aircraft=/g)).toHaveLength(9);
  });
  it('courbe horaire sur 7 jours : français et autres empilés, une heure sans collecte reste un trou ; référence en construction', () => {
    const m = military((x) => {
      x.hourly = { hours: [{ hour: '2026-10-04T12', francais: 3, autres: 4 }, { hour: '2026-10-04T14', francais: 4, autres: 5 }], since: '2026-10-04T12' };
    });
    const h = sectionOf('aeronefs', { military: m })?.html ?? '';
    expect(h).toContain('aria-label="Aéronefs militaires ou d’État au-dessus de la métropole par heure, sur 7 jours"');
    expect(h).toContain(`<title>04/10 16${NBSP}h · français : 4</title>`);
    expect(h).toContain(`<title>04/10 16${NBSP}h · autres : 5</title>`);
    expect(h.match(/<rect /g)).toHaveLength(4);
    expect(h).toContain('fill="var(--cat-mil-francais)"');
    expect(visibleText(h)).toContain('Référence en construction (1\u00a0jour sur 7).');
    expect(sectionOf('aeronefs', { military: military((x) => { x.hourly = { hours: [], since: null }; }) })?.html).not.toContain('<svg');
  });
  it('aucun aéronef : absence dite sans calme inventé ; panne nommée par la réponse', () => {
    const none = military((x) => { x.frenchByDept = []; x.aircraft = []; });
    expect(visibleText(sectionOf('aeronefs', { military: none })?.html ?? '')).toContain('une absence du flux n’est pas une absence d’activité');
    const down = military((x) => { x.frenchByDept = []; x.aircraft = []; x.errors = ['adsb.lol : HTTP 429']; });
    expect(visibleText(sectionOf('aeronefs', { military: down })?.html ?? '')).toContain('Source indisponible : aéronefs adsb.lol.');
  });
  it('aucun aéronef au dernier relevé, relevé en retard : non évalué, adsb.lol muet depuis l’heure du relevé, jamais « aucun » ni « 0 »', () => {
    const none = military((x) => { x.frenchByDept = []; x.aircraft = []; x.errors = ['adsb.lol : HTTP 429']; });
    const s = sectionOf('aeronefs', { military: none, now: NOW + 12 * MIN });
    expect(s?.summary).toBe('non évalué · adsb.lol muet depuis 16:48');
    const t = visibleText(s?.html ?? '');
    expect(t).toContain('Non évalué · adsb.lol muet depuis 16:48.');
    expect(t).not.toMatch(/Aucun aéronef|Source indisponible/);
    expect(sectionOf('aeronefs', { military: none })?.summary).toBe('0 en France · 3 hors de France');
  });
  it('courbe horaire en retard : barres et légende en gris (couleurs retirées), comme les lignes', () => {
    const m = military((x) => {
      x.hourly = { hours: [{ hour: '2026-10-04T12', francais: 3, autres: 4 }, { hour: '2026-10-04T14', francais: 4, autres: 5 }], since: '2026-10-04T12' };
    });
    const h = sectionOf('aeronefs', { military: m, now: NOW + 12 * MIN })?.html ?? '';
    expect(h.match(/<rect [^>]*fill="var\(--cat-mil-etranger\)"/g)).toHaveLength(4);
    expect(h).not.toMatch(/--cat-mil-francais|--cat-mil-autres/);
    expect(visibleText(h)).toContain('français et autres (en retard : couleurs retirées)');
    expect(h).toContain(`<title>04/10 16${NBSP}h · français : 4</title>`);
    const fresh = sectionOf('aeronefs', { military: m })?.html ?? '';
    expect(fresh).toContain('fill="var(--cat-mil-autres)"');
    expect(fresh).not.toContain('--cat-mil-etranger');
  });
});

describe('urgences (T3, S3)', () => {
  it('7500 vu une fois au-dessus de Genève (approches) en jaune, 7700 confirmé au-dessus du Finistère en orange ; pastille orange, gros chiffre inchangé', () => {
    const m = military((x) => { x.emergencies = [E7700, E7500]; });
    const v = view({ military: m });
    expect(v.head.level).toBe('orange');
    expect(v.head.figure?.value).toBe('9');
    const s = v.sections.find((x) => x.id === 'urgences');
    expect(s?.open).toBe(true);
    expect(s?.summary).toBe('2\u00a0urgences');
    const h = s?.html ?? '';
    expect(h.indexOf('ESSAI75')).toBeLessThan(h.indexOf('RCH161'));
    expect(h).toContain('data-emergency="4b1814:7500"><span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span><span>ESSAI75 · 7500 (intervention illicite)</span>'
      + '<span class="lp-val fmk-num">16:48</span>');
    expect(visibleText(h)).toContain(`A400 · Suisse · approches de la France (moins de 40${NBSP}km) · vue une fois à 16:48, à confirmer · `
      + 'code affiché par le transpondeur, non confirmé par les autorités');
    expect(h).toContain('data-emergency="ae0805:7700"><span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>RCH161 · 7700 (urgence)</span>');
    expect(visibleText(h)).toContain('C17 · États-Unis · Finistère (29) · confirmée sur deux lectures, vue de 16:44 à 16:48');
    expect(visibleText(h)).not.toMatch(/détournement/);
  });
  it('7500 au-dessus de Genève : seul et vu une fois, jaune ; confirmé, rouge (approches de 40 km) ; jamais compté dans le gros chiffre', () => {
    const once = view({ military: military((x) => { x.emergencies = [E7500]; }) });
    expect([once.head.level, once.head.figure?.value]).toEqual(['jaune', '9']);
    const confirmed = view({ military: military((x) => { x.emergencies = [{ ...E7500, firstSeen: '2026-10-04T14:46:20Z' }]; }) });
    expect([confirmed.head.level, confirmed.head.figure?.value]).toEqual(['rouge', '9']);
  });
  it('jeu d’essai des urgences (A9) : pastille orange, deux urgences listées, une orange, une jaune ; journal sans doublon', () => {
    const v = view({ military: MILITARY_EMERGENCY_FIXTURE() });
    expect(v.head.level).toBe('orange');
    expect(v.head.figure?.value).toBe('10');
    const h = v.sections.find((x) => x.id === 'urgences')?.html ?? '';
    expect(h.match(/data-emergency=/g)).toHaveLength(2);
    expect(h).toContain('fmk-dot--orange');
    expect(h).toContain('fmk-dot--jaune');
    expect(visibleText(h)).not.toContain('Journal sur 7\u00a0jours');
  });
  it('urgences d’un appareil français et d’un appareil PIA : nommées (indicatif, immatriculation), situées, cliquables vers la carte', () => {
    const v = view({ military: MILITARY_FRENCH_EMERGENCY_FIXTURE() });
    expect(v.head.level).toBe('orange');
    expect(v.head.figure?.value).toBe('9');
    expect(v.head.status[0]).toContain('FICTIF04');
    expect(v.head.status[0]).not.toContain('appareil d’État français');
    const s = v.sections.find((x) => x.id === 'urgences');
    expect(s?.summary).toBe('2\u00a0urgences');
    expect(s?.open).toBe(true);
    const h = s?.html ?? '';
    expect(h).toContain('data-emergency="3bf004:7700"><span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>FICTIF04 · 7700 (urgence)</span>');
    expect(h).toContain('data-emergency="44f684:7500"><span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span><span>GRZLY21 · 7500 (intervention illicite)</span>');
    expect(h).toContain('class="lp-row is-link"');
    const t = visibleText(h);
    expect(t).toContain('EC45 · F-ZFIC · appareil français · Rhône (69) · confirmée sur deux lectures, vue de 16:46 à 16:48');
    expect(t).toContain('A400 · Belgique · Pyrénées-Atlantiques (64) · vue une fois à 16:48, à confirmer · code affiché par le transpondeur, non confirmé par les autorités');
    expect(t).not.toMatch(/appareil à identité protégée|appareil d’État français · Dépt|Dépt\u00a0\d/);
    expect(t).not.toContain('Journal sur 7\u00a0jours');
    const noMap = visibleText(sectionOf('urgences', { military: MILITARY_FRENCH_EMERGENCY_FIXTURE(), canFocus: false })?.html ?? '');
    expect(noMap).toContain('FICTIF04 · 7700 (urgence)');
    expect(sectionOf('urgences', { military: MILITARY_FRENCH_EMERGENCY_FIXTURE(), canFocus: false })?.html).not.toContain('data-emergency');
  });
  it('urgence sans indicatif : nommée par l’immatriculation, sinon par l’adresse OACI', () => {
    const m = military((x) => {
      x.emergencies = [{ ...E7700, callsign: null, registration: 'ZZ123' }, { ...E7500, callsign: null, registration: null }];
    });
    const h = sectionOf('urgences', { military: m })?.html ?? '';
    expect(h).toContain('<span>ZZ123 · 7700 (urgence)</span>');
    expect(h).toContain('<span>adresse 4b1814 · 7500 (intervention illicite)</span>');
    expect(visibleText(h)).toContain('C17 · ZZ123 · États-Unis · Finistère (29)');
  });
  it('journal des urgences : un épisode déjà affiché n’est pas répété, un épisode plus ancien du même appareil l’est (non cliquable)', () => {
    const dup = military((x) => { x.emergencyLog.push({ ...x.emergencyLog[0] }); }, MILITARY_FRENCH_EMERGENCY_FIXTURE);
    expect(visibleText(sectionOf('urgences', { military: dup })?.html ?? '')).not.toContain('Journal sur 7\u00a0jours');
    const m = military((x) => {
      x.emergencyLog.push({ ...x.emergencyLog[0], firstSeen: '2026-10-03T08:00:00Z', lastSeen: '2026-10-03T08:05:00Z', dept: '13' });
    }, MILITARY_FRENCH_EMERGENCY_FIXTURE);
    const h = sectionOf('urgences', { military: m })?.html ?? '';
    expect(visibleText(h)).toContain('Journal sur 7\u00a0jours');
    expect(h).toContain('<span class="fmk-dot" aria-hidden="true"></span><span>FICTIF04 · 7700 (urgence)</span>');
    expect(h.match(/FICTIF04 · 7700/g)).toHaveLength(2);
    expect(h.match(/data-emergency="3bf004:7700"/g)).toHaveLength(1);
  });
  it('aucune urgence : dit sans calme inventé ; journal de 7 jours en gris ; relevé en retard : non évalué', () => {
    expect(sectionOf('urgences')?.summary).toBe('aucune');
    expect(visibleText(sectionOf('urgences')?.html ?? '')).toContain('Aucun code d’urgence (7500, 7600, 7700) dans le flux adsb.lol : un appareil qui n’émet pas n’en déclare pas.');
    const m = military((x) => { x.emergencyLog = [{ ...E7700, firstSeen: '2026-10-02T09:10:00Z', lastSeen: '2026-10-02T09:16:00Z' }]; });
    const h = sectionOf('urgences', { military: m })?.html ?? '';
    expect(visibleText(h)).toContain('Journal sur 7\u00a0jours');
    expect(h).toContain('<span class="fmk-dot" aria-hidden="true"></span><span>RCH161 · 7700 (urgence)</span><span class="lp-val fmk-num">02/10 11:16</span>');
    expect(sectionOf('urgences', { now: NOW + 12 * MIN })?.summary).toBe('non évalué · adsb.lol muet depuis 16:48');
  });
});

describe('Marine nationale (O11, O12, S2)', () => {
  it('vus en AIS d’abord, identifiés par leur propre message et datés ; puis ports base en référence (puce grise) ; aucun sous-marin', () => {
    const s = sectionOf('marine');
    expect(s?.summary).toBe('1 vu en AIS · 1 au port base (référence)');
    const h = s?.html ?? '';
    expect(h.indexOf('data-navy="227802000"')).toBeLessThan(h.indexOf('Port base : position de référence, pas une observation'));
    expect(h).toContain('data-navy="227802000"><span class="fmk-dot fmk-dot--vert" aria-hidden="true"></span><span>Provence</span>'
      + `<span class="lp-val fmk-num">14,2${NBSP}nœuds</span><small>FREMM · Frégate multi-missions · pavillon France · vu à 16:47 · `
      + 'identifié par son propre message AIS depuis 16:28</small>');
    expect(h).toContain('data-navy="d650"><span class="fmk-dot" aria-hidden="true"></span><span>Aquitaine</span><span class="lp-val fmk-num">port base</span>');
    expect(visibleText(h)).not.toMatch(/stationn|port d’attache|Triomphant|SNLE|\bSNA\b|sous-marin/);
    // Le Trafic maritime garde sa ligne inchangée.
    expect(shipRow(LIVE, new Set(), false, NOW)).not.toContain('identifié par son propre message AIS');
  });
  it('flux figé (T3) : non évalué depuis l’heure du dernier message, bâtiments vus en gris', () => {
    const navy: NavyLiveInput = { ...NAVY, lastMessageAt: NOW - 6 * MIN };
    const s = sectionOf('marine', { navy, aisRelay: { evaluated: false, lastMessageAt: new Date(NOW - 6 * MIN).toISOString() } });
    expect(s?.summary).toBe('non évalué · AIS indisponible depuis 16:42');
    expect(s?.html).toContain('<p class="fmk-callout lp-callout">AIS indisponible depuis 16:42 : positions figées, non évaluées.</p>');
    expect(s?.html).toContain('data-navy="227802000"><span class="fmk-dot" aria-hidden="true"></span>');
  });
  it('aucun bâtiment vu : absence dite, références gardées', () => {
    const s = sectionOf('marine', { navy: { ...NAVY, ships: [HOME] } });
    expect(s?.summary).toBe('0 vu en AIS · 1 au port base (référence)');
    expect(visibleText(s?.html ?? '')).toContain('un bâtiment qui n’émet pas ou ne s’identifie pas n’est pas vu');
  });
});

describe('sites de défense (O13)', () => {
  it('base curée par catégorie, outre-mer et étranger dits ; option des ouvrages OpenStreetMap datée et sous licence', () => {
    expect(summarizeCuratedSites(ACTIVE_INSTALLATIONS)).toEqual({
      total: 112, byType: { air: 31, navy: 18, army: 34, joint: 29, fortification: 0, other: 0 }, overseas: 9, abroad: 4,
    });
    const s = sectionOf('sites');
    expect(s?.summary).toBe('112\u00a0sites');
    const t = visibleText(s?.html ?? '');
    for (const row of ['Bases aériennes31', 'Bases navales18', 'Sites de l’armée de terre34', 'Sites interarmées29', 'dont outre-mer9',
      'dont forces françaises à l’étranger4']) expect(t).toContain(row);
    expect(t).not.toContain('Fortifications');
    expect(t).toContain('Liste interne de sites publics (ministère des Armées, Wikipédia, OpenStreetMap), sans date par site.');
    expect(t).toContain('Chaque site : nom, catégorie et lien officiel s’il existe ; ni description, ni unités.');
    // Rectangles « ZIT » retirés par la tâche B27 (remplacés par les zones drones DGAC) : plus aucune note ne les décrit.
    expect(t).not.toMatch(/Zones interdites|tracés approchés/);
    expect(s?.html).toContain('<button type="button" class="lp-toggle" data-osm-works aria-pressed="false">Afficher les ouvrages OpenStreetMap</button>');
    const meta = { generatedAt: '2026-10-04T13:05:00Z', osmBase: '2026-10-04T12:40:00Z', licence: 'ODbL 1.0' as const, source: '© les contributeurs d’OpenStreetMap', count: 1301 };
    const shown = sectionOf('sites', { sites: { ...SITES, osm: { meta, error: null, shown: true } } });
    expect(shown?.summary).toBe('112\u00a0sites · 1\u202F301\u00a0ouvrages OpenStreetMap');
    expect(visibleText(shown?.html ?? '')).toContain('Ouvrages OpenStreetMap : 1\u202F301\u00a0points en France, fichier du 04/10/2026 (base OSM du 04/10 14:40), © les contributeurs d’OpenStreetMap, ODbL 1.0.');
    expect(shown?.html).toContain('data-osm-works aria-pressed="true">Masquer les ouvrages OpenStreetMap</button>');
    expect(visibleText(sectionOf('sites', { sites: { ...SITES, osm: { meta: null, error: 'HTTP 404', shown: true } } })?.html ?? ''))
      .toContain('Fichier des ouvrages OpenStreetMap illisible : HTTP 404.');
  });
});

describe('méthode et sources (S4, S5, O9)', () => {
  it('résumé « N sources » déduit de la liste, phase B comprise (FX2) ; chaque source de la liste est nommée dans la méthode', () => {
    const s = sectionOf('methode');
    const t = visibleText(s?.html ?? '');
    expect(DEFENSE_SOURCES).toHaveLength(8);
    expect(s?.summary).toBe(`${DEFENSE_SOURCES.length}${NBSP}sources`);
    for (const name of DEFENSE_SOURCES) expect(t, name).toContain(name);
  });
  it('adsb.lol sous ODbL, appareils d’État, mer territoriale, bloc OACI, identité publiée de tous les appareils, réponse ministérielle du JO, retard', () => {
    const h = sectionOf('methode')?.html ?? '';
    const t = visibleText(h);
    expect(t).toContain('Données adsb.lol, ODbL 1.0');
    expect(t).toContain('relevé du serveur 16:48');
    expect(t).toContain('classe aussi des appareils d’État non militaires');
    expect(t).toContain('n’est pas l’activité militaire');
    expect(t).toContain(`ou au-dessus de la mer territoriale (moins de 12${NBSP}milles de la côte)`);
    expect(t).not.toMatch(/22.km/);
    expect(t).toContain('bloc d’adresse OACI');
    expect(t).toContain('Tous les appareils sont montrés avec l’identité que publie adsb.lol (indicatif, immatriculation, adresse OACI, type, position)');
    expect(t).toContain('appareils français, appareils marqués PIA ou LADD et adresses non OACI compris');
    expect(t).not.toMatch(/comptés par département|jamais montrés|identité protégée/i);
    expect(t).toContain('Le ministère des Armées modifie l’adresse mode S des avions de la flotte gouvernementale');
    expect(t).toContain('(réponse ministérielle publiée au JO le 25/10/2016).');
    expect(h).toContain('href="https://www.assemblee-nationale.fr/dyn/14/questions/QANR5L14QE93414"');
    expect(t).toContain('VigipirateSource : site internet du SGDSN · saisie du 04/10/2026, page relue chaque jour');
    expect(t).toContain('code affiché par le transpondeur, non confirmé par les autorités');
    expect(t).toContain(`Retard : relevé de plus de 10${NBSP}min`);
  });
});

describe('pannes, retards (S1 à S3, V1)', () => {
  it('relevé en retard (10 min) : pastille suspendue, gros chiffre gardé sans couleur et dit en retard, puces grises', () => {
    const late = NOW + 12 * MIN;
    const v = view({ now: late });
    expect(v.head.level).toBe('nd');
    expect(v.head.status[0]).toBe('niveau suspendu : relevé adsb.lol en retard');
    expect(v.head.status[1]).toBe(`adsb.lol${NBSP}16:48${NBSP}(en retard)`);
    expect(v.head.figure).toMatchObject({ value: '9', level: null });
    expect(v.head.figure?.caption).toContain('(en retard)');
    const s = v.sections.find((x) => x.id === 'aeronefs');
    expect(s?.summary).toContain('(en retard)');
    expect(s?.html).not.toContain('lp-swatch');
  });
  it('adsb.lol injoignable : n.d. nommé, sections en panne, insigne Vigipirate gardé ; chargement avant la première lecture', () => {
    const v = view({ military: null, militaryError: 'HTTP 502' });
    expect(v.head).toMatchObject({ level: 'nd', status: ['adsb.lol injoignable'], lead: BADGE });
    expect(v.head.figure).toEqual({ value: 'n.d.', caption: `${MILITARY_FIGURE_LABEL} : adsb.lol injoignable`, level: null });
    expect(v.bodyHtml).toBe('<p class="fmk-callout lp-callout">Source adsb.lol injoignable. Aucune donnée reçue.</p>');
    expect(visibleText(v.sections.find((s) => s.id === 'aeronefs')?.html ?? '')).toBe('Source indisponible : aéronefs adsb.lol.');
    expect(v.sections.find((s) => s.id === 'urgences')?.summary).toBe('n.d.');
    const loading = view({ military: null, militaryError: null });
    expect(loading.head.status).toEqual(['chargement…']);
    expect(loading.head.lead).toBe(BADGE);
    expect(loading.bodyHtml).toContain('Chargement des données');
  });
  it('relevé jamais lu (502 du serveur) : n.d. ; dernière collecte servie avec une erreur nommée : appel daté, incident dit', () => {
    const never = view({ military: military((x) => { x.readAt = null; x.errors = ['adsb.lol : clé requise']; }) });
    expect(never.head).toMatchObject({ level: 'nd', status: ['adsb.lol indisponible'] });
    expect(never.head.figure?.value).toBe('n.d.');
    const kept = view({ military: military((x) => { x.errors = ['adsb.lol : clé requise']; }), militaryError: 'HTTP 502' });
    expect(kept.bodyHtml).toBe('<p class="fmk-callout lp-callout">Source adsb.lol injoignable. Dernières données : 16:48.</p>');
    expect(visibleText(kept.sections.find((s) => s.id === 'methode')?.html ?? '')).toContain('Incidents de lecture : adsb.lol : clé requise.');
  });
});

describe('hygiène du rendu', () => {
  const variants: Array<Partial<DefenseViewInput>> = [
    {}, { now: SOV_FIXTURE_NOW + 12 * MIN }, { military: null, militaryError: 'HTTP 502' }, { military: null, militaryError: null },
    { military: MILITARY_EMERGENCY_FIXTURE() }, { military: MILITARY_FRENCH_EMERGENCY_FIXTURE() },
    { military: military((x) => { x.frenchByDept.push({ dept: null, count: 2 }); x.aircraft[1] = { ...x.aircraft[1], dept: null }; }) },
    { navy: { ...NAVY, lastMessageAt: SOV_FIXTURE_NOW - 6 * MIN }, aisRelay: { evaluated: false, lastMessageAt: null } },
    { vigipirate: { ...VIGIPIRATE_FIXTURE, stade: 'alerte-attentat', depuis: '2026-10-03' }, vigipirateCheck: slot(VIGIPIRATE_CHECK_CHANGED_FIXTURE()) },
    { now: Date.parse('2027-02-15T12:00:00+01:00'), vigipirateCheck: slot(VIGIPIRATE_CHECK_FIXTURE(), 'SGDSN, page Vigipirate : HTTP 503') },
    { vigipirate: { ...VIGIPIRATE_FIXTURE, stade: 'alerte-attentat', depuis: '2026-10-03' }, now: Date.parse('2026-10-16T00:30:00+02:00') },
    { military: military((x) => { x.frenchByDept = []; x.aircraft = []; }), now: SOV_FIXTURE_NOW + 12 * MIN },
  ];
  it('aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute, jamais « temps réel », « LIVE » ni « Situation normale »', () => {
    for (const over of variants) {
      const h = html(over);
      expect(h).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(visibleText(h)).not.toMatch(/temps réel|TEMPS RÉEL|\bLIVE\b|Situation normale|Aucune activité suspecte|stationn|détournement/i);
    }
  });
  it('O11 : aucun sous-marin dans aucune variante ; aucun masquage : chacun des 9 appareils du relevé a sa ligne cliquable, les 4 français compris', () => {
    for (const over of variants) expect(visibleText(html(over))).not.toMatch(/SNLE|\bSNA\b|Triomphant|sous-marin|Identité protégée ou nationalité inconnue|comptés, jamais montrés/);
    const hexes = [...html().matchAll(/data-aircraft="([^"]+)"/g)].map((x) => x[1]);
    expect(hexes).toHaveLength(9);
    expect(hexes.filter((x) => /^3bf/i.test(x))).toHaveLength(4);
  });
  it('R1 : aucune valeur coupée entre nombre et unité', () => {
    for (const over of variants) {
      const v = view(over);
      const texts = [v.head.figure?.caption ?? '', ...v.head.status, v.head.lead ?? '', visibleText(v.bodyHtml ?? ''),
        ...v.sections.map((s) => visibleText(`${s.summary ?? ''} ${s.html}`))];
      for (const t of texts) {
        expect(breakableValue(t), t.slice(0, 80)).toBeNull();
        expect(trafficBreakable(t), t.slice(0, 80)).toBeNull();
        expect(sovBreakable(t), t.slice(0, 80)).toBeNull();
      }
    }
  });
  it('textes tiers échappés (indicatif et type publiés par adsb.lol)', () => {
    const hostile: MilitaryAircraft = { ...MILITARY_FIXTURE().aircraft[0], callsign: '<img src=x onerror=alert(1)>', registration: '<i>Y</i>', type: '<b>X</b>' };
    const h = html({ military: military((x) => { x.aircraft = [hostile, ...x.aircraft.slice(1)]; }) });
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(h).not.toContain('<b>X</b>');
    expect(h).not.toContain('<i>Y</i>');
  });
});
