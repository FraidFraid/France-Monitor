// src/components/layer-panel/defense-b.test.ts : panneau Défense, phase B (spec 2026-10-04 souveraineté § 3.1, § 3.2, § 3.4 ; contrats
// § 4.1 ; amendement 7 : O15 à O17, S6, S7). Section GNSS (compte glissant sans lieu, jours UTC complets, mailles du seul jour complet
// précédent, dégradation générale, météo spatiale, courbes), section Sanctions (comptes et différences, jamais une fiche nominative),
// zones drones, pastille avec le compte de mailles à précision dégradée ; R1, échappement, aucun tiret cadratin.
import { describe, expect, it } from 'vitest';
import type { GnssResponse } from '../../types/index.ts';
import { DRONES_LEGEND, DRONES_POINTER, DRONES_POINTER_URL, DRONES_TITLE } from '../../services/sovereignty-drones.ts';
import { defenseLevel, gnssDegradedCount } from '../../services/sovereignty-levels.ts';
import { GELS_REGISTRY_URL } from '../../services/sovereignty-sanctions.ts';
import {
  DRONE_ZONES_META_FIXTURE, GNSS_FIXTURE, GNSS_STORM_FIXTURE, MILITARY_FIXTURE, SANCTIONS_FIXTURE, SOV_FIXTURE_NOW, VIGIPIRATE_FIXTURE,
} from './sovereignty.fixture.ts';
import { buildDefenseView, type DefenseViewInput } from './defense.ts';
import { GNSS_ORANGE_PCT } from './defense-b.ts';
import { breakableValue, visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { formatCount, glueSovUnits, sovBreakable } from './sovereignty-format.ts';

const NOW = SOV_FIXTURE_NOW;
const NBSP = ' ';
const H = 3_600_000;

function input(over: Partial<DefenseViewInput> = {}): DefenseViewInput {
  return {
    military: MILITARY_FIXTURE(), militaryError: null, vigipirate: VIGIPIRATE_FIXTURE, vigipirateCheck: null,
    navy: { status: 'connected', lastMessageAt: NOW - 30_000, ships: [] },
    aisRelay: { evaluated: true, lastMessageAt: new Date(NOW - 60_000).toISOString() },
    sites: {
      curated: { total: 112, byType: { air: 30, navy: 20, army: 40, joint: 12, fortification: 5, other: 5 }, overseas: 9, abroad: 4 },
      osm: { meta: null, error: null, shown: false },
      drones: { meta: DRONE_ZONES_META_FIXTURE(), error: null, shown: false },
    },
    gnss: GNSS_FIXTURE(), gnssError: null, sanctions: SANCTIONS_FIXTURE(), sanctionsError: null,
    canFocus: true, now: NOW, open: (_id: string, byDefault: boolean) => byDefault, ...over,
  };
}
const html = (i: DefenseViewInput): string => renderLayerView('military', buildDefenseView(i));
const section = (i: DefenseViewInput, id: string) => buildDefenseView(i).sections.find((s) => s.id === id);
const gnss = (over: Partial<GnssResponse>): GnssResponse => ({ ...GNSS_FIXTURE(), ...over });
const gnssText = (i: DefenseViewInput): string => visibleText(section(i, 'gnss')?.html ?? '');
/** Partie grille de la section (avant la météo spatiale, dont les prévisions G1 portent leur propre couleur). */
const gridHtml = (i: DefenseViewInput): string => (section(i, 'gnss')?.html ?? '').split('Échelles NOAA')[0];

describe('sections de la phase B', () => {
  it('GNSS ouverte juste avant la Marine nationale, Sanctions repliée juste avant la méthode', () => {
    const ids = buildDefenseView(input()).sections.map((s) => s.id);
    expect(ids.indexOf('gnss')).toBe(ids.indexOf('marine') - 1);
    expect(ids.indexOf('gels')).toBe(ids.indexOf('methode') - 1);
    expect([section(input(), 'gnss')?.open, section(input(), 'gels')?.open]).toEqual([true, false]);
    expect(section(input(), 'gnss')?.title).toBe('GNSS : précision de position et météo spatiale');
  });
  it('pastille : le compte glissant (2) la fait jaune ; la raison vient de defenseLevel avec gnssDegradedCount', () => {
    const view = buildDefenseView(input());
    expect(gnssDegradedCount(GNSS_FIXTURE(), NOW)).toBe(2);
    const reason = defenseLevel(MILITARY_FIXTURE(), NOW, 2).reason;
    expect(view.head.level).toBe('jaune');
    expect(view.head.status.some((s) => s === reason || s === glueSovUnits(reason))).toBe(true);
    // Le gros chiffre, sans niveau propre, suit la pastille (R3).
    expect(renderLayerView('military', view)).toContain('lp-lvl lp-lvl--jaune">9</b>');
  });
  it('pastille orange à partir de trois mailles, et rien en dégradation générale ni sans grille', () => {
    const three = input({ gnss: gnss({ degraded: { rolling24h: 3, previousUtcDays: [2, null] } }) });
    expect(buildDefenseView(three).head.level).toBe('orange');
    expect(buildDefenseView(input({ gnss: GNSS_STORM_FIXTURE() })).head.level).toBe('vert');
    expect(buildDefenseView(input({ gnss: null })).head.level).toBe('vert');
  });
  it('chargement initial (aucune lecture adsb.lol) : aucune section ajoutée', () => {
    expect(buildDefenseView(input({ military: null, militaryError: null })).sections).toEqual([]);
  });
});

describe('section GNSS : compte sans lieu et mailles du jour complet (O17)', () => {
  it('en direct : un compte sur 24 h glissantes, sans dénominateur ni lieu ; jours UTC complets, jour non couvert dit n.d.', () => {
    const text = gnssText(input());
    expect(text).toContain(`Mailles françaises à précision dégradée au-delà de 10${NBSP}% sur 24${NBSP}h glissantes2`);
    expect(text).not.toMatch(/2\s+sur\s+14\s+glissantes|à navigation dégradée/);
    expect(text).toContain(`Jours UTC complets (au-delà de 10${NBSP}%)veille 2`);
    expect(text).toContain('veille 2, avant-veille n.d. (jour non couvert)');
    expect(section(input(), 'gnss')?.summary).toBe(`2${NBSP}mailles au-delà de 10${NBSP}% sur 24${NBSP}h · Kp${NBSP}5 à 11:00`);
  });
  it('compte glissant coloré par le niveau de la pastille (jaune pour 2, orange pour 3, vert pour 0)', () => {
    const val = (n: number): string => (section(input({ gnss: gnss({ degraded: { rolling24h: n, previousUtcDays: [null, null] } }) }), 'gnss')?.html ?? '')
      .match(/glissantes<\/span>.*?<span class="lp-val fmk-num( lp-lvl lp-lvl--\w+)?">/s)?.[1]?.trim() ?? '';
    expect(val(2)).toBe('lp-lvl lp-lvl--jaune');
    expect(val(3)).toBe('lp-lvl lp-lvl--orange');
    expect(val(0)).toBe('lp-lvl lp-lvl--vert');
  });
  it('lignes par maille seulement pour cellsDay, de la plus forte à la plus faible, cliquables ; jamais la maille anglaise ni « hier »', () => {
    const h = html(input());
    expect([...h.matchAll(/data-gnss-cell="([^"]+)"/g)].map((m) => m[1])).toEqual(['48:-3.5', '48:-4', '48:-3']);
    expect(h).not.toContain('data-gnss-cell="50.5:-1.5"');
    const text = visibleText(h);
    expect(text).toContain(`Mailles du 03/10 (jour UTC complet) : 3 dégradées (jaune et orange) sur 14 mesurées, dont 2 au-delà de 10${NBSP}%`);
    expect(text).toContain(`12,5${NBSP}%`);
    expect(text).toContain(`24${NBSP}aéronefs au calcul · 4 à précision dégradée · 1 sans précision déclarée`);
    expect(text).not.toMatch(/\bhier\b/i);
    expect(h).toContain('tabindex="0"');
    // Couleur d'après le jour des mailles (days[cellsDay].general), pas d'après la fenêtre glissante.
    expect(gridHtml(input())).toMatch(/fmk-dot--orange/);
  });
  it('veille non couverte (cellsDay null, aucune maille) : dit, jamais un calme', () => {
    const text = gnssText(input({ gnss: gnss({ cells: [], cellsDay: null, frenchCells: 0, degraded: { rolling24h: 2, previousUtcDays: [null, null] } }) }));
    expect(text).toContain('Mailles localisées : publiées pour le jour UTC précédent seulement');
    expect(text).toContain('aucune maille n’est publiée, ce qui n’est pas un calme');
    expect(text).not.toContain('data-gnss-cell');
  });
  it('un jour UTC complet en dégradation générale est dit n.d., pas 0', () => {
    const g = gnss({ degraded: { rolling24h: 2, previousUtcDays: [0, 1] }, days: { since: '2026-10-02', days: [
      { date: '2026-10-02', jaune: 1, orange: 0, general: false }, { date: '2026-10-03', jaune: 2, orange: 2, general: true },
    ] } });
    expect(gnssText(input({ gnss: g }))).toContain('veille n.d. (dégradation générale), avant-veille 1');
  });
  it('orage (dégradation générale en fenêtre glissante) : encadré, compte n.d., lignes du jour général en gris, pastille inchangée', () => {
    const storm = input({ gnss: GNSS_STORM_FIXTURE() });
    const text = gnssText(storm);
    expect(text).toContain(`Dégradation générale, probablement météo spatiale : plus de 30${NBSP}% des mailles françaises mesurées à précision dégradée et Kp${NBSP}5+ sur la fenêtre. Ces mailles ne comptent ni dans la pastille ni au score.`);
    expect(text).toContain('Dégradation générale le 03/10 (météo spatiale) : mailles en gris, hors pastille et hors score.');
    expect(text).toContain(`Mailles françaises à précision dégradée au-delà de 10${NBSP}% sur 24${NBSP}h glissantesn.d.`);
    expect(buildDefenseView(storm).head.level).toBe('vert');
    expect(gridHtml(storm)).not.toMatch(/fmk-dot--(?:jaune|orange)/);
    expect(section(storm, 'gnss')?.summary).toContain('dégradation générale');
  });
  it('mailles du jour : colorées d’après le jour des mailles, pas d’après la fenêtre glissante', () => {
    // Fenêtre glissante en dégradation générale, mais le jour des mailles (03/10) ne l'est pas : couleurs gardées.
    const g = gnss({ generalDegradation: true, days: { since: '2026-10-03', days: [
      { date: '2026-10-03', jaune: 1, orange: 2, general: false }, { date: '2026-10-04', jaune: 1, orange: 2, general: true },
    ] } });
    expect(gridHtml(input({ gnss: g }))).toMatch(/fmk-dot--orange/);
    // Jour des mailles en dégradation générale, fenêtre glissante calme : gris.
    const grey = gnss({ days: { since: '2026-10-03', days: [{ date: '2026-10-03', jaune: 1, orange: 2, general: true }] } });
    expect(gridHtml(input({ gnss: grey }))).not.toMatch(/fmk-dot--(?:jaune|orange)/);
  });
  it('grille de plus de 40 min : « (en retard) », couleurs retirées, pastille sans les mailles ; cumul de 3 h : référence en construction', () => {
    const late = input({ gnss: gnss({ readAt: '2026-10-04T13:50:00.000Z', windowStart: '2026-10-03T13:50:00.000Z' }) });
    expect(section(late, 'gnss')?.html).toContain('(en retard)');
    expect(gridHtml(late)).not.toMatch(/fmk-dot--(?:jaune|orange)/);
    expect(gridHtml(late)).not.toMatch(/lp-lvl--(?:jaune|orange|vert)/);
    expect(buildDefenseView(late).head.level).toBe('vert');
    expect(section(late, 'gnss')?.summary).toContain('(en retard)');
    const building = input({ gnss: gnss({ windowStart: '2026-10-04T11:40:00.000Z' }) });
    expect(gnssText(building)).toContain(`Référence en construction (3${NBSP}h)`);
  });
  it('météo spatiale : échelles du jour, prévisions datées, Kp de la dernière tranche, dernière alerte en français, courbes colorées', () => {
    const h = section(input(), 'gnss')?.html ?? '';
    const text = visibleText(h);
    expect(text).toContain('Échelles NOAA à 16:46');
    expect(text).toContain(`radio R0${NBSP}aucun · radiations S0${NBSP}aucun · géomagnétique G0${NBSP}aucun`);
    expect(text).toContain(`04/10 (prévision)G1${NBSP}mineur`);
    expect(text).toContain(`05/10 (prévision)G0${NBSP}aucun`);
    expect(text).toContain(`Kp${NBSP}5 tranche de 11:00`);
    expect(text).toContain(`alerte : indice K de 5 atteint (G1${NBSP}mineur) · émise 16:03`);
    expect(h).toContain('aria-label="Indice Kp par tranche de 3 h (NOAA), sur 7 jours, couleur de l’échelle G"');
    expect(h).toContain('fill="var(--cat-kp-calme)"');
    expect(h).toContain('fill="var(--sev-yellow)"');
    expect(h).toContain('aria-label="Mailles françaises à précision dégradée, par jour UTC"');
  });
  it('pannes nommées : NOAA en panne, grille jamais complète ; chargement ; panne de la lecture', () => {
    const noNoaa = input({ gnss: gnss({ spaceWeather: { readAt: null, scalesAt: null, today: null, forecast: [], kp: [], lastAlert: null }, errors: ['NOAA SWPC, échelles : HTTP 503'] }) });
    expect(gnssText(noNoaa)).toContain('Source indisponible : météo spatiale (NOAA SWPC) : NOAA SWPC, échelles : HTTP 503.');
    const noGrid = input({ gnss: gnss({ readAt: null, windowStart: null, cells: [], cellsDay: null, errors: ['Grille GNSS, lecture 1 sur 5 : adsb.lol : clé requise <script>alert(1)</script>'] }) });
    const h = section(noGrid, 'gnss')?.html ?? '';
    expect(visibleText(h)).toContain('Source indisponible : grille GNSS (adsb.lol) : Grille GNSS, lecture 1 sur 5 : adsb.lol : clé requise <script>alert(1)</script>.');
    expect(h).not.toContain('<script>');
    expect(section(noGrid, 'gnss')?.summary?.startsWith('mailles n.d.')).toBe(true);
    expect(section(input({ gnss: null, gnssError: null }), 'gnss')?.summary).toBe('chargement…');
    expect(section(input({ gnss: null, gnssError: 'HTTP 502' }), 'gnss')?.summary).toBe('n.d.');
  });
  it('O15 : « précision de position dégradée », jamais « brouillage mesuré » ni « navigation dégradée » ; brouillage qualifié par la DGAC et l’ANFR seulement', () => {
    for (const i of [input(), input({ gnss: GNSS_STORM_FIXTURE() })]) {
      const all = visibleText(html(i));
      expect(all).not.toMatch(/brouillage mesuré|navigation dégradée/i);
      expect(visibleText(section(i, 'gnss')?.html ?? '')).not.toMatch(/brouillage/i);
      expect(all).toContain('Seules la DGAC et l’ANFR qualifient un brouillage');
    }
  });
});

describe('pastille : fraîcheur croisée adsb.lol et GNSS (revue de B25, I1)', () => {
  it('relevé adsb.lol en retard, grille fraîche : la couleur GNSS reste, sa raison passe en premier, le retard adsb.lol est dit', () => {
    const v = buildDefenseView(input({ now: NOW + 12 * 60_000 }));
    expect(v.head.level).toBe('jaune');
    expect(v.head.status[0]).toBe(`${glueSovUnits(defenseLevel(MILITARY_FIXTURE(), NOW, 2).reason)} · relevé adsb.lol en retard`);
    expect(v.head.status.join(' ')).not.toContain('niveau suspendu');
    expect(v.head.status.some((s) => s.includes('(en retard)'))).toBe(true);
    expect(v.head.figure?.level).toBeNull();
  });
  it('relevé adsb.lol en retard, sans compte GNSS : niveau suspendu, n.d.', () => {
    const v = buildDefenseView(input({ now: NOW + 12 * 60_000, gnss: GNSS_STORM_FIXTURE() }));
    expect(v.head.level).toBe('nd');
    expect(v.head.status[0]).toBe('niveau suspendu : relevé adsb.lol en retard');
  });
  it('grille GNSS en retard, relevé militaire frais : la pastille vient du militaire seul', () => {
    const v = buildDefenseView(input({ gnss: gnss({ readAt: '2026-10-04T13:50:00.000Z', windowStart: '2026-10-03T13:50:00.000Z' }) }));
    expect(v.head.level).toBe('vert');
    expect(v.head.status[0]).toBe(glueSovUnits(defenseLevel(MILITARY_FIXTURE(), NOW).reason));
  });
});

describe('seuils et teintes (revue de B25, m1 et m2)', () => {
  it('le seuil « au-delà de 10 % » est celui de la grille serveur', async () => {
    const server = await import('../../../api/_lib/gnss-grid.js');
    expect(GNSS_ORANGE_PCT).toBe((server as { GNSS_ORANGE_PCT: number }).GNSS_ORANGE_PCT);
  });
  it('le titre des mailles du jour dit ce qu’il compte et combien dépassent le seuil', () => {
    const t = gnssText(input());
    expect(t).toContain(`3 dégradées (jaune et orange) sur 14 mesurées, dont 2 au-delà de 10${NBSP}%`);
  });
  it('prévision G0 : jeton calme, pas le vert de niveau', () => {
    const h = section(input(), 'gnss')?.html ?? '';
    const row = h.split('05/10 (prévision)')[0].split('<div class="lp-row').pop() ?? '';
    expect(row).toContain('var(--cat-kp-calme)');
    expect(row).not.toContain('fmk-dot--vert');
  });
});

describe('section Sanctions et zones drones', () => {
  it('publication datée, entrées par nature, différence en vocabulaire S7 ; lien vers la dernière version ; aucune fiche nominative', () => {
    const s = section(input(), 'gels');
    expect(s?.summary).toBe(glueSovUnits(`publication du 02/10 10:36 · ${formatCount(40)} entrées`));
    const text = visibleText(s?.html ?? '');
    expect(text).toContain(`1${NBSP}nouveau gel · 2${NBSP}radiations`);
    expect(text).toContain('Consulter la dernière version du registre');
    expect(text).toContain('Aucune fiche nominative n’est affichée ici');
    expect(text).toContain('Hors score');
    expect(s?.html).toContain(`href="${GELS_REGISTRY_URL}"`);
    expect(s?.html).toContain('background:var(--cat-gels)');
    expect(s?.html).toContain('aria-label="Entrées du registre national des gels, par publication"');
  });
  it('premier relevé : différence n.d. ; date relue il y a plus de 26 h : en retard, barres et courbe retirées', () => {
    const first = SANCTIONS_FIXTURE();
    const firstPass = input({ sanctions: { ...first, current: first.current ? { ...first.current, added: null, removed: null } : null } });
    expect(visibleText(section(firstPass, 'gels')?.html ?? '')).toContain('n.d. (premier relevé : rien à comparer)');
    const late = input({ sanctions: { ...first, dateCheckedAt: new Date(NOW - 27 * H).toISOString() } });
    expect(section(late, 'gels')?.html).toContain('(en retard)');
    expect(section(late, 'gels')?.html).not.toContain('var(--cat-gels)');
  });
  it('registre en panne ou pas encore lu : dit, avec le lien', () => {
    expect(section(input({ sanctions: null, sanctionsError: 'HTTP 502' }), 'gels')?.summary).toBe('n.d.');
    expect(section(input({ sanctions: null, sanctionsError: null }), 'gels')?.summary).toBe('chargement…');
    const none = input({ sanctions: { ...SANCTIONS_FIXTURE(), current: null, errors: ['Registre des gels : HTTP 503'] } });
    expect(visibleText(section(none, 'gels')?.html ?? '')).toContain('Source indisponible : registre des gels (DG Trésor) : Registre des gels : HTTP 503.');
  });
  it('zones drones : compte, titre et légende officiels, un seul lien (SIA), édition, zones temporaires non publiées, option de la carte', () => {
    const sites = section(input(), 'sites')?.html ?? '';
    const text = visibleText(sites);
    expect(text).toContain(`${formatCount(5541)}${NBSP}zones`);
    expect(text).toContain(DRONES_TITLE);
    expect(text).toContain(glueSovUnits(DRONES_LEGEND));
    expect(text).toContain('à jour au 07-2025');
    expect(text).toContain('agglomérations non dessinées');
    expect(text).toContain('Zones permanentes seulement ; les interdictions temporaires (NOTAM) ne sont pas publiées en flux ouvert.');
    expect(text).toContain(DRONES_POINTER);
    const droneLinks = sites.slice(sites.indexOf('Zones drones DGAC')).match(/<a /g) ?? [];
    expect(droneLinks).toHaveLength(1);
    expect(sites).toContain(`href="${DRONES_POINTER_URL}"`);
    expect(sites).toContain('data-drone-zones aria-pressed="false">Zones drones DGAC sur la carte');
    const shown = input();
    shown.sites = { ...shown.sites, drones: { meta: DRONE_ZONES_META_FIXTURE(), error: null, shown: true } };
    expect(section(shown, 'sites')?.html).toContain('aria-pressed="true">Masquer les zones drones');
    const unread = input();
    unread.sites = { ...unread.sites, drones: { meta: null, error: null, shown: false } };
    expect(visibleText(section(unread, 'sites')?.html ?? '')).toContain('lu à l’ouverture du panneau');
    const broken = input();
    broken.sites = { ...broken.sites, drones: { meta: null, error: 'zones drones : HTTP 404 <b>x</b>', shown: false } };
    const bh = section(broken, 'sites')?.html ?? '';
    expect(visibleText(bh)).toContain('Fichier des zones drones illisible : zones drones : HTTP 404 <b>x</b>.');
    expect(bh).not.toContain('<b>x</b>');
  });
  it('sans bloc des zones drones (champ absent) : section des sites inchangée', () => {
    const i = input();
    i.sites = { curated: i.sites.curated, osm: i.sites.osm };
    expect(section(i, 'sites')?.html).not.toContain('data-drone-zones');
  });
});

describe('méthode et règles du cadre', () => {
  it('méthode : formule de gpsjam.org, nac_p 0 à part, mémoire par jour UTC, jour non couvert, limite de l’aviation légère, sources', () => {
    const text = visibleText(section(input(), 'methode')?.html ?? '');
    expect(text).toContain('100 × (dégradés − 1) / (bons + dégradés)');
    expect(text).toContain('nac_p 0 ou absent compté à part');
    expect(text).toContain('compte alors dégradé');
    expect(text).toContain('La mémoire « bonne précision » repart à chaque jour UTC');
    expect(text).toContain('« non couvert » : aucune maille publiée, jamais un calme');
    expect(text).toContain('aviation légère');
    for (const src of ['NOAA SWPC', 'DGAC / IGN, Géoplateforme', 'registre national des gels, DG Trésor', 'gpsjam.org']) expect(text).toContain(src);
  });
  it('R1, aucun tiret cadratin, aucune police à chasse fixe, jamais « temps réel »', () => {
    const lateGrid = input({ gnss: gnss({ readAt: '2026-10-04T13:50:00.000Z' }) });
    for (const i of [input(), input({ gnss: GNSS_STORM_FIXTURE() }), lateGrid, input({ gnss: null }), input({ sanctions: null })]) {
      const v = buildDefenseView(i);
      const h = renderLayerView('military', v);
      const texts = [visibleText(h), ...v.sections.map((s) => visibleText(`${s.summary ?? ''}`)), ...v.head.status];
      for (const text of texts) {
        expect(sovBreakable(text), text.slice(0, 80)).toBeNull();
        expect(breakableValue(text), text.slice(0, 80)).toBeNull();
      }
      expect(h).not.toContain('—');
      expect(h).not.toMatch(/monospace|font-mono|<code/i);
      expect(visibleText(h).toLowerCase()).not.toContain('temps réel');
      expect(visibleText(h)).not.toMatch(/\bLIVE\b/);
    }
  });
});
