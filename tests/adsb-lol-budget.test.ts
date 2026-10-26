// Garde-fou du quota adsb.lol : 500 appels par jour et par adresse IP (en-tête x-ratelimit-limit « 500;w=86400 », relevé le
// 26/10/2026). Toutes les collectes de la VM passent par la même IP : leur total journalier doit laisser de la marge (nouvelles
// tentatives après un 429, redémarrages du serveur). À 2 min et 10 min, on en faisait ~1 440 : HTTP 429 en continu.
import { describe, expect, it } from 'vitest';
import { MIL_INTERVAL_MS } from '../api/_lib/military-collect.js';
import { GNSS_INTERVAL_MS, GNSS_POINTS } from '../api/_lib/gnss-collect.js';

const DAY_MS = 86_400_000;
const ADSB_DAILY_BUDGET = 450;

describe('quota adsb.lol', () => {
  it('collectes militaire et GNSS sous 450 appels par jour', () => {
    const military = DAY_MS / MIL_INTERVAL_MS;
    const gnss = GNSS_POINTS.length * (DAY_MS / GNSS_INTERVAL_MS);
    expect(military + gnss).toBeLessThanOrEqual(ADSB_DAILY_BUDGET);
  });
});
