import { describe, expect, it } from 'vitest';
import type { EcowattOfficial, EcowattOfficialDay } from '../types/index.ts';
import {
  ecowattLastPublished,
  ecowattLevelLabel,
  ecowattStatusNote,
  ecowattToday,
  ecowattUpcoming,
  isEcowattOfficial,
  parisDate,
} from './ecowatt-official.ts';

const HOURS = Array.from({ length: 24 }, () => 1 as const);
const day = (date: string, level: EcowattOfficialDay['level']): EcowattOfficialDay => ({ date, level, message: 'Pas d’alerte.', hours: [...HOURS] });
const rte = (days: EcowattOfficialDay[]): EcowattOfficial => ({ source: 'rte', generatedAt: '2026-09-25T06:00:00+02:00', days });

// 25/09/2026 10 h 00 à Paris (CEST, UTC+2).
const NOW = Date.parse('2026-09-25T08:00:00Z');

describe('parisDate — jour calendaire à Paris', () => {
  it('bascule à minuit heure de Paris, été comme hiver', () => {
    expect(parisDate(Date.parse('2026-09-24T21:59:00Z'))).toBe('2026-09-24');
    expect(parisDate(Date.parse('2026-09-24T22:30:00Z'))).toBe('2026-09-25');
    expect(parisDate(Date.parse('2026-01-15T22:59:00Z'))).toBe('2026-01-15');
    expect(parisDate(Date.parse('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });
});

describe('ecowattToday — le signal du jour, jamais un autre', () => {
  it('rend le niveau du jour de Paris', () => {
    const o = rte([day('2026-09-25', 'orange'), day('2026-09-26', 'red')]);
    expect(ecowattToday(o, NOW)).toBe('orange');
  });

  it('null sans jour courant : un signal de la veille (repli open data) n’est pas celui du jour', () => {
    const odre: EcowattOfficial = { source: 'odre', generatedAt: null, days: [day('2026-09-23', 'green'), day('2026-09-24', 'green')] };
    expect(ecowattToday(odre, NOW)).toBeNull();
  });

  it('null sans données', () => {
    expect(ecowattToday(null, NOW)).toBeNull();
    expect(ecowattToday(undefined, NOW)).toBeNull();
    expect(ecowattToday(rte([]), NOW)).toBeNull();
  });
});

describe('ecowattUpcoming — J et les jours suivants, dans l’ordre', () => {
  it('écarte les jours passés et trie', () => {
    const o = rte([day('2026-09-27', 'green'), day('2026-09-24', 'red'), day('2026-09-25', 'green'), day('2026-09-26', 'orange')]);
    expect(ecowattUpcoming(o, NOW).map((d) => d.date)).toEqual(['2026-09-25', '2026-09-26', '2026-09-27']);
  });

  it('vide pour le repli open data (jours passés seulement)', () => {
    const odre: EcowattOfficial = { source: 'odre', generatedAt: null, days: [day('2026-09-24', 'green')] };
    expect(ecowattUpcoming(odre, NOW)).toEqual([]);
  });
});

describe('ecowattLastPublished — dernier jour publié jusqu’à aujourd’hui', () => {
  it('le jour même s’il existe, sinon le plus récent des jours passés', () => {
    expect(ecowattLastPublished(rte([day('2026-09-25', 'green'), day('2026-09-26', 'orange')]), NOW)?.date).toBe('2026-09-25');
    const odre: EcowattOfficial = { source: 'odre', generatedAt: null, days: [day('2026-09-23', 'green'), day('2026-09-24', 'orange')] };
    expect(ecowattLastPublished(odre, NOW)?.date).toBe('2026-09-24');
    expect(ecowattLastPublished(null, NOW)).toBeNull();
  });
});

describe('isEcowattOfficial — la réponse serveur est vérifiée avant usage', () => {
  it('accepte la forme du contrat', () => {
    expect(isEcowattOfficial(rte([day('2026-09-25', 'green')]))).toBe(true);
    expect(isEcowattOfficial({ source: 'odre', generatedAt: null, days: [] })).toBe(true);
  });

  it('rejette une source, un niveau, une date ou des pas horaires invalides', () => {
    expect(isEcowattOfficial(null)).toBe(false);
    expect(isEcowattOfficial({ source: 'autre', generatedAt: null, days: [] })).toBe(false);
    expect(isEcowattOfficial(rte([{ ...day('2026-09-25', 'green'), level: 'yellow' as never }]))).toBe(false);
    expect(isEcowattOfficial(rte([{ ...day('25/09/2026', 'green') }]))).toBe(false);
    expect(isEcowattOfficial(rte([{ ...day('2026-09-25', 'green'), hours: [1, 2] }]))).toBe(false);
    expect(isEcowattOfficial(rte([{ ...day('2026-09-25', 'green'), hours: Array.from({ length: 24 }, () => 4) as never }]))).toBe(false);
  });
});

describe('ecowattLevelLabel — libellés RTE', () => {
  it('reprend la formulation officielle', () => {
    expect(ecowattLevelLabel('green')).toBe('Pas d’alerte');
    expect(ecowattLevelLabel('orange')).toBe('Système électrique tendu');
    expect(ecowattLevelLabel('red')).toBe('Système électrique très tendu');
    expect(ecowattLevelLabel('red', 'en')).toBe('Power system under severe strain');
  });
});

describe('ecowattStatusNote — état du signal dit en clair (légende, sources)', () => {
  it('signal du jour : niveau RTE, temps réel', () => {
    expect(ecowattStatusNote(rte([day('2026-09-25', 'orange')]), NOW)).toBe('Écowatt (RTE, signal national) : Système électrique tendu — TEMPS RÉEL');
  });

  it('repli open data : jamais présenté comme le signal du jour', () => {
    const odre: EcowattOfficial = { source: 'odre', generatedAt: null, days: [day('2026-09-24', 'green')] };
    expect(ecowattStatusNote(odre, NOW)).toBe('Écowatt : signal du jour INDISPONIBLE · dernier publié le 24/09 : Pas d’alerte (open data RTE)');
  });

  it('aucune donnée', () => {
    expect(ecowattStatusNote(null, NOW)).toBe('Écowatt (RTE) : signal officiel INDISPONIBLE');
  });
});
