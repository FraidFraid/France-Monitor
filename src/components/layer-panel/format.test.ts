// src/components/layer-panel/format.test.ts
import { describe, expect, it } from 'vitest';
import {
  NBSP, breakableValue, dayMonth, formatCents, formatDays, formatEuro, formatGw, formatGwhDay, formatMtYear, formatMw,
  formatPct, formatSignedPct, formatTons, formatTwh, localClock, visibleText, weekdayOf, zoneDayBounds, zoneMidnight,
} from './format.ts';

describe('formateurs des panneaux de couches (R1)', () => {
  it('espace insécable entre le nombre et l’unité, et avant %', () => {
    expect(formatGw(30871)).toBe(`30,9${NBSP}GW`);
    expect(formatMw(336.4)).toBe(`336${NBSP}MW`);
    expect(formatMw(-0.23, 1)).toBe(`−0,2${NBSP}MW`);
    expect(formatPct(93.44, 1)).toBe(`93,4${NBSP}%`);
    expect(formatEuro(1.689)).toBe(`1,689${NBSP}€`);
    expect(formatDays(46)).toBe(`46${NBSP}j`);
    expect(formatTwh(123.06)).toBe(`123,1${NBSP}TWh`);
    expect(formatMtYear(10.9)).toBe(`10,9${NBSP}Mt/an`);
  });
  it('signes : plus explicite, moins typographique, zéro sans signe', () => {
    expect(formatGwhDay(412, { signed: true })).toBe(`+412${NBSP}GWh/j`);
    expect(formatGwhDay(-120, { signed: true })).toBe(`−120${NBSP}GWh/j`);
    expect(formatGwhDay(25.3, { digits: 1 })).toBe(`25,3${NBSP}GWh/j`);
    expect(formatCents(-1.24)).toBe(`−1,2${NBSP}c`);
    expect(formatSignedPct(4.2)).toBe(`+4${NBSP}%`);
    expect(formatSignedPct(0)).toBe(`0${NBSP}%`);
  });
  it('milliers : espace fine insécable de fr-FR, jamais une espace sécable', () => {
    expect(formatGwhDay(1020)).toBe(`1\u202F020${NBSP}GWh/j`);
    expect(breakableValue(formatGwhDay(1020))).toBeNull();
  });
  it('jamais « −0 » : arrondi d’abord, zéro sans signe', () => {
    expect(formatGw(-40)).toBe(`0,0${NBSP}GW`);
    expect(formatMw(-0.2)).toBe(`0${NBSP}MW`);
    expect(formatSignedPct(-0.3)).toBe(`0${NBSP}%`);
    expect(formatMw(-0.6)).toBe(`−1${NBSP}MW`);
  });
  it('tonnes : t, kt, Mt', () => {
    expect(formatTons(820)).toBe(`820${NBSP}t`);
    expect(formatTons(154_300)).toBe(`154${NBSP}kt`);
    expect(formatTons(1_230_000)).toBe(`1,2${NBSP}Mt`);
  });
  it('valeur absente : « n.d. », jamais 0 ni NaN', () => {
    for (const f of [formatGw, formatMw, formatPct, formatEuro, formatDays, formatTwh, formatTons, formatCents, formatGwhDay]) {
      expect(f(null)).toBe('n.d.');
      expect(f(Number.NaN)).toBe('n.d.');
    }
  });
  it('jours et dates', () => {
    expect(weekdayOf('2026-10-04', 'long')).toBe('dimanche');
    expect(weekdayOf('2026-10-03', 'short')).toBe('sam.');
    expect(dayMonth('2026-10-02')).toBe('02/10');
  });
  it('bornes du jour local : 25 h le 25/10/2026 et 23 h le 29/03/2026 à Paris, 24 h ailleurs', () => {
    const h = 3_600_000;
    const len = (iso: string, tz: string): number => { const b = zoneDayBounds(Date.parse(iso), tz); return (b.to - b.from) / h; };
    expect(len('2026-10-25T12:00:00Z', 'Europe/Paris')).toBe(25);
    expect(zoneDayBounds(Date.parse('2026-10-25T12:00:00Z'), 'Europe/Paris').to).toBe(Date.parse('2026-10-25T23:00:00Z'));
    expect(len('2026-03-29T12:00:00Z', 'Europe/Paris')).toBe(23);
    expect(len('2026-10-02T12:00:00Z', 'Europe/Paris')).toBe(24);
    expect(len('2026-10-25T12:00:00Z', 'Indian/Reunion')).toBe(24);
  });
  it('heure locale et minuit local des territoires (fuseaux sans heure d’été et Paris avec)', () => {
    expect(localClock(Date.parse('2026-10-02T10:55:00+04:00'), 'Indian/Reunion')).toBe('10:55');
    expect(localClock(Date.parse('2026-10-02T10:55:00+04:00'), 'Europe/Paris')).toBe('08:55');
    expect(zoneMidnight(Date.parse('2026-10-02T05:00:00Z'), 'Europe/Paris')).toBe(Date.parse('2026-10-01T22:00:00Z'));
    expect(zoneMidnight(Date.parse('2026-10-02T21:00:00Z'), 'Indian/Reunion')).toBe(Date.parse('2026-10-02T20:00:00Z'));
    expect(zoneMidnight(Date.parse('2026-10-03T03:58:00Z'), 'America/Guadeloupe')).toBe(Date.parse('2026-10-02T04:00:00Z'));
    expect(zoneMidnight(Date.parse('2026-10-25T12:00:00Z'), 'Europe/Paris')).toBe(Date.parse('2026-10-24T22:00:00Z'));
    expect(zoneMidnight(Date.parse('2026-03-29T12:00:00Z'), 'Europe/Paris')).toBe(Date.parse('2026-03-28T23:00:00Z'));
  });
  it('contrôle R1 : repère une valeur sécable', () => {
    expect(breakableValue('Production de 30,9 GW')).toBe('0,9 GW');
    expect(breakableValue('écart de 2 %')).toBe('2 %');
    expect(breakableValue(`Production de 30,9${NBSP}GW, 91${NBSP}%`)).toBeNull();
    expect(breakableValue('3 tranches · 18 sites · 2 ouvrages en stress')).toBeNull();
  });
  it('texte visible : balises retirées, entités décodées', () => {
    expect(visibleText('<b class="x">30,9</b>&nbsp;<i>GW</i> &amp; &lt;b&gt;')).toBe(`30,9${NBSP}GW & <b>`);
  });
});
