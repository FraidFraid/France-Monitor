// src/services/sovereignty-inputs.test.ts
// Entrées Souveraineté du score et des situations (spec 2026-10-04 souveraineté § 2.4 ; contrats § 6 ; amendement 7, O6, O7, O10) :
// adaptateurs purs, une source jamais lue ou en retard donne des listes vides et se dit indisponible. Jeux d'essai du 04/10 (tâche A9).
import { describe, expect, it } from 'vitest';
import {
  CABLES_WATCH_ALERTS_FIXTURE, CABLES_WATCH_FIXTURE, CABLES_WATCH_FROZEN_FIXTURE, CABLES_WATCH_ZONE_MUTED_FIXTURE, CYBER_FIXTURE,
  MILITARY_EMERGENCY_FIXTURE, MILITARY_FIXTURE, MILITARY_MASKED_EMERGENCY_FIXTURE, SOV_FIXTURE_NOW,
} from '../components/layer-panel/sovereignty.fixture.ts';
import { certfrKevAdvisories, isKevAddedRecently } from './sovereignty-levels.ts';
import { buildSovereigntyInputs, monitoredMilitaryEmergencies, servedCyber } from './sovereignty-inputs.ts';

const NOW = SOV_FIXTURE_NOW;
const MIN = 60_000;

describe('entrées Souveraineté (adaptateurs purs)', () => {
  it('04/10 : 9 aéronefs au-dessus de la métropole dont 4 français, aucune urgence ni alerte câble, cyber lu ; pastilles des panneaux', () => {
    const s = buildSovereigntyInputs(MILITARY_FIXTURE(), CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), NOW);
    expect(s.militaryFlightsCount).toBe(9);
    expect(s.militaryFrenchCount).toBe(4);
    expect(s.militaryEmergencies).toEqual([]);
    expect(s.cableAlerts).toEqual([]);
    // Phase A : aucune grille GNSS (B28 remplit ce compte sans lieu).
    expect(s.gnssDegraded).toBeNull();
    expect(s.cyber).not.toBeNull();
    expect(s.sovereigntyAvailable).toEqual({ military: true, cables: true, cyber: true });
    expect([s.defensePillLevel, s.cyberPillLevel]).toEqual(['vert', 'orange']);
  });
  it('urgences : seules les colorantes (7700 affiché sur deux relevés au-dessus du Finistère) ; le 7500 vu une fois à Genève reste au moniteur', () => {
    const s = buildSovereigntyInputs(MILITARY_EMERGENCY_FIXTURE(), CABLES_WATCH_FIXTURE(), CYBER_FIXTURE(), NOW);
    expect(s.militaryEmergencies.map((e) => [e.masked, e.squawk, e.dept])).toEqual([[false, '7700', '29']]);
    expect(s.militaryFlightsCount).toBe(10);
    expect(s.defensePillLevel).toBe('orange');
    expect(monitoredMilitaryEmergencies(MILITARY_EMERGENCY_FIXTURE(), NOW).map((e) => e.squawk)).toEqual(['7700', '7500']);
  });
  it('urgences masquées (O10) : comptées et suivies sans adresse, indicatif ni position', () => {
    const s = buildSovereigntyInputs(MILITARY_MASKED_EMERGENCY_FIXTURE(), null, null, NOW);
    expect(s.militaryEmergencies.map((e) => [e.masked, e.family, e.squawk, e.dept])).toEqual([[true, 'francais', '7700', '69']]);
    expect(s.militaryFlightsCount).toBe(9);
    const monitored = monitoredMilitaryEmergencies(MILITARY_MASKED_EMERGENCY_FIXTURE(), NOW);
    expect(monitored.map((e) => e.squawk)).toEqual(['7500', '7700']);
    expect(JSON.stringify(monitored)).not.toMatch(/icao24|callsign|"lat"|"lon"/);
  });
  it('relevé adsb.lol en retard (plus de 10 min) ou jamais lu : 0 aéronef, aucune urgence, indisponible, pastille n.d.', () => {
    const late = buildSovereigntyInputs(MILITARY_EMERGENCY_FIXTURE(), null, null, NOW + 11 * MIN);
    expect(late).toMatchObject({ militaryFlightsCount: 0, militaryFrenchCount: 0, militaryEmergencies: [], defensePillLevel: 'nd' });
    expect(late.sovereigntyAvailable.military).toBe(false);
    expect(monitoredMilitaryEmergencies(MILITARY_EMERGENCY_FIXTURE(), NOW + 11 * MIN)).toEqual([]);
    const never = buildSovereigntyInputs({ ...MILITARY_FIXTURE(), readAt: null }, null, null, NOW);
    expect(never.militaryFlightsCount).toBe(0);
    expect(never.sovereigntyAvailable).toEqual({ military: false, cables: false, cyber: false });
    expect([never.defensePillLevel, never.cyberPillLevel]).toEqual(['nd', 'nd']);
  });
  it('alertes câbles : seules les confirmées et évaluées entrent ; AIS muet, relevé de plus de 15 min ou zone muette : aucune', () => {
    const fresh = buildSovereigntyInputs(null, CABLES_WATCH_ALERTS_FIXTURE(), null, NOW);
    expect(fresh.cableAlerts.map((a) => a.id)).toEqual(['229000001:way/761201757']);
    expect(fresh.sovereigntyAvailable.cables).toBe(true);
    const frozen = buildSovereigntyInputs(null, CABLES_WATCH_FROZEN_FIXTURE(), null, NOW);
    expect(CABLES_WATCH_FROZEN_FIXTURE().alerts.some((a) => a.confirmed)).toBe(true);
    expect(frozen.cableAlerts).toEqual([]);
    expect(frozen.sovereigntyAvailable.cables).toBe(false);
    const stale = buildSovereigntyInputs(null, CABLES_WATCH_ALERTS_FIXTURE(), null, NOW + 16 * MIN);
    expect(stale.cableAlerts).toEqual([]);
    expect(buildSovereigntyInputs(null, CABLES_WATCH_ZONE_MUTED_FIXTURE(), null, NOW).cableAlerts).toEqual([]);
    const muted = CABLES_WATCH_ALERTS_FIXTURE();
    muted.alerts = muted.alerts.map((a) => ({ ...a, zoneMuted: true }));
    expect(buildSovereigntyInputs(null, muted, null, NOW).cableAlerts).toEqual([]);
  });
  it('CERT-FR en retard (plus de 6 h) : aucune entrée cyber, pastille n.d. ; statut d’une alerte non lu : réponse gardée, pastille n.d.', () => {
    const s = buildSovereigntyInputs(null, null, CYBER_FIXTURE(), NOW + 7 * 60 * MIN);
    expect(s.cyber).toBeNull();
    expect(s.cyberPillLevel).toBe('nd');
    expect(s.sovereigntyAvailable.cyber).toBe(false);
    const unread = CYBER_FIXTURE();
    unread.certfr.alerts = unread.certfr.alerts.map((a) => (a.ref === 'CERTFR-2026-ALE-011' ? { ...a, status: null } : a));
    const u = buildSovereigntyInputs(null, null, unread, NOW);
    expect(u.cyber).not.toBeNull();
    expect(u.cyberPillLevel).toBe('nd');
    expect(servedCyber(unread, NOW)).not.toBeNull();
    expect(servedCyber({ ...unread, certfr: { ...unread.certfr, readAt: null } }, NOW)).toBeNull();
  });
});

describe('avis comptés par le score (O6) : vulnérabilité ajoutée au catalogue KEV depuis moins de 7 jours de Paris', () => {
  it('04/10 : AVI-1257, AVI-1246 et AVI-1236 ; AVI-1242 (ajout du 11/09) et AVI-1220 (ajout du 22/09) n’entrent pas', () => {
    expect(certfrKevAdvisories(CYBER_FIXTURE(), NOW).map((a) => a.ref)).toEqual([
      'CERTFR-2026-AVI-1257', 'CERTFR-2026-AVI-1246', 'CERTFR-2026-AVI-1236',
    ]);
  });
  it('jours de Paris : six jours révolus comptent, sept non ; un ajout futur de plus d’une heure jamais', () => {
    expect(isKevAddedRecently({ dateAdded: '2026-09-28' }, NOW)).toBe(true);
    expect(isKevAddedRecently({ dateAdded: '2026-09-27' }, NOW)).toBe(false);
    expect(isKevAddedRecently({ dateAdded: '2026-10-06' }, NOW)).toBe(false);
    expect(isKevAddedRecently({ dateAdded: 'n.d.' }, NOW)).toBe(false);
  });
});
