// src/services/sovereignty-alerts.test.ts : moniteur d'alertes de la phase B (contrats § 6 ; amendement 7, O7, O15, O17, S15) : une seule
// entrée GNSS, sans lieu, tirée des comptes (24 h glissantes) ; moyenne, élevée par la règle de la situation (isGnssDegradationSustained :
// GNSS_SITUATION_CELLS mailles sur 24 h et sur chacun des deux derniers jours UTC complets), jamais critique ; texte prudent. Review Focus
// 3 : l'orage, une grille en retard, jamais lue ou sans maille dégradée ne donnent rien, et l'entrée gardée en cache disparaît aussitôt.
import { describe, expect, it } from 'vitest';
import type { GnssResponse } from '../types/index.ts';
import { GNSS_FIXTURE, GNSS_STORM_FIXTURE, SOV_FIXTURE_NOW } from '../components/layer-panel/sovereignty.fixture.ts';
import { GNSS_SITUATION_CELLS } from './sovereignty-levels.ts';
import { GNSS_MONITOR_ID, gnssJammingSituations, pruneStaleGnssAlert } from './sovereignty-alerts.ts';

const NOW = SOV_FIXTURE_NOW;
const NBSP = '\u00a0';
function counts(rolling24h: number, previousUtcDays: [number | null, number | null]): GnssResponse {
  return { ...GNSS_FIXTURE(), degraded: { rolling24h, previousUtcDays } };
}

describe('moniteur d’alertes : une entrée GNSS sans lieu (O17)', () => {
  it('grille du 04/10 : une entrée, 2 mailles sur 24 h glissantes, moyenne (avant-veille non couverte) ; renvoie au panneau Défense', () => {
    const alerts = gnssJammingSituations(GNSS_FIXTURE(), NOW);
    expect(alerts).toHaveLength(1);
    const [a] = alerts;
    expect([a.id, a.type, a.severity, a.confidence]).toEqual(['gnss-degraded-24h', 'GPS_JAMMING_ALERT', 'medium', 0.6]);
    expect(a.title).toBe(`Précision de position GNSS dégradée : 2${NBSP}mailles françaises au-delà de 10${NBSP}% sur 24${NBSP}h glissantes`);
    expect(a.summary).toBe('À vérifier : seules la DGAC et l’ANFR qualifient un brouillage. Mailles localisées du jour UTC précédent dans le panneau Défense.');
    expect(a.drivers).toEqual([
      'Jours UTC complets (au-delà de 10\u00a0%) : veille 2, avant-veille n.d. (jour non couvert)',
      'Hors dégradation générale (météo spatiale)',
      'Compte sans lieu : aucune maille localisée en direct',
    ]);
    expect(a.recommendedActions.map((x) => x.label)).toEqual([
      'Signaler à la DGAC et à l’ANFR, seules à qualifier un brouillage', 'Suivre le compte à la prochaine collecte',
    ]);
    expect([a.affectedZones, a.activateLayers, a.sourceRefs]).toEqual([['France'], ['military'], ['Grille GNSS (adsb.lol)', 'NOAA SWPC']]);
    expect([a.lat, a.lon, a.entityId]).toEqual([undefined, undefined, undefined]);
    expect(a.updatedAt.toISOString()).toBe('2026-10-04T14:45:24.000Z');
    // O15 : jamais « brouillage » affirmé ; O17 : aucune coordonnée de maille ; aucun tiret cadratin.
    expect(JSON.stringify(alerts)).not.toMatch(/\u2014|brouillage mesuré|navigation dégradée|Brouillage|48[,.]|"lat"|"lon"/);
  });
  it('une maille : singulier', () => {
    expect(gnssJammingSituations(counts(1, [0, 0]), NOW)[0]?.title)
      .toBe(`Précision de position GNSS dégradée : 1${NBSP}maille française au-delà de 10${NBSP}% sur 24${NBSP}h glissantes`);
  });
  it('O7 : élevée seulement à GNSS_SITUATION_CELLS mailles sur 24 h et sur chacun des deux jours UTC complets (règle de la situation) ; jamais critique', () => {
    const severity = (rolling: number, days: [number | null, number | null]) => gnssJammingSituations(counts(rolling, days), NOW)[0]?.severity;
    const n = GNSS_SITUATION_CELLS;
    expect(severity(n, [n, n])).toBe('high');
    expect(severity(9, [9, 12])).toBe('high');
    // Une maille chaque jour ne suffit plus (arbitrage du contrôleur, revue de B28).
    expect(severity(1, [1, 1])).toBe('medium');
    expect(severity(n - 1, [n, n])).toBe('medium');
    expect(severity(n, [n, n - 1])).toBe('medium');
    expect(severity(n, [n - 1, n])).toBe('medium');
    expect(severity(n, [null, n])).toBe('medium');
    expect(severity(n, [n, null])).toBe('medium');
  });
  it('jour UTC complet en dégradation générale : « n.d. (dégradation générale) », jamais un 0 calme', () => {
    const g = counts(2, [0, 1]);
    g.days.days = g.days.days.map((d) => (d.date === '2026-10-03' ? { ...d, general: true } : d));
    expect(gnssJammingSituations(g, NOW)[0]?.drivers[0]).toBe('Jours UTC complets (au-delà de 10\u00a0%) : veille n.d. (dégradation générale), avant-veille 1');
  });
  it('Review Focus 3 : orage avec dégradation générale, grille en retard, jamais lue, absente ou sans maille sur 24 h : aucune entrée', () => {
    expect(gnssJammingSituations(GNSS_STORM_FIXTURE(), NOW)).toEqual([]);
    expect(gnssJammingSituations({ ...GNSS_FIXTURE(), readAt: '2026-10-04T14:05:00.000Z' }, NOW)).toEqual([]);
    expect(gnssJammingSituations({ ...GNSS_FIXTURE(), readAt: null }, NOW)).toEqual([]);
    expect(gnssJammingSituations(null, NOW)).toEqual([]);
    expect(gnssJammingSituations(counts(0, [2, 2]), NOW)).toEqual([]);
  });
});

describe('moniteur d’alertes : entrée GNSS retirée du cache dès qu’elle n’a plus lieu d’être (revue de B28, m1)', () => {
  const cache = (): Map<string, string> => new Map([[GNSS_MONITOR_ID, 'gnss'], ['military-emergency-3b7f21-7700', 'urgence'], ['news-alert-1', 'presse']]);
  it('grille en retard, en dégradation générale, jamais lue ou sans maille : l’entrée GNSS part tout de suite, les autres restent', () => {
    for (const g of [{ ...GNSS_FIXTURE(), readAt: '2026-10-04T14:05:00.000Z' }, GNSS_STORM_FIXTURE(), null, counts(0, [2, 2])]) {
      const c = cache();
      pruneStaleGnssAlert(c, gnssJammingSituations(g, NOW));
      expect([...c.keys()]).toEqual(['military-emergency-3b7f21-7700', 'news-alert-1']);
    }
  });
  it('grille exploitable avec des mailles : l’entrée reste (elle sera remplacée par la lecture courante)', () => {
    const c = cache();
    pruneStaleGnssAlert(c, gnssJammingSituations(GNSS_FIXTURE(), NOW));
    expect(c.has(GNSS_MONITOR_ID)).toBe(true);
    expect(c.size).toBe(3);
  });
});
