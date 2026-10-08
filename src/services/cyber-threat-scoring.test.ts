// src/services/cyber-threat-scoring.test.ts
// Pression cyber sur les entrées nouvelles (spec 2026-10-04 souveraineté § 2.3 ; contrats § 6, arbitrage 12 ; amendement 7, O5, O6,
// S10) : plafonds et poids inchangés, exposition retirée, plus de seuil sur un stock, une partie en retard ne compte pas. Jeu d'essai du
// 04/10 (CYBER_FIXTURE de la tâche A9).
import { describe, expect, it } from 'vitest';
import { CYBER_FIXTURE, SOV_FIXTURE_NOW } from '../components/layer-panel/sovereignty.fixture.ts';
import type { CyberResponse } from '../types/index.ts';
import { computeCyberPressureAssessment } from './cyber-threat-scoring.ts';

const NOW = SOV_FIXTURE_NOW;
const HOUR = 3_600_000;

function cyber(edit: (c: CyberResponse) => void): CyberResponse {
  const c = CYBER_FIXTURE();
  edit(c);
  return c;
}

describe('pression cyber (familles de l’arbitrage 12)', () => {
  it('04/10 : 3 alertes en cours, 3 avis citant une vulnérabilité KEV récente, 7 vulnérabilités exploitées citées, rapport 1,29 ; score 28', () => {
    const a = computeCyberPressureAssessment(CYBER_FIXTURE(), {}, NOW);
    expect(a.inputs).toEqual({
      leaks30d: 0, claimsRatio: 1.29, kevCited30d: 7, openAlerts: 3, kevAdvisories7d: 3, criticalSectorClaims30d: 4,
    });
    expect(a.breakdown.map((b) => [b.label, b.score, b.cap])).toEqual([
      ['Fuites publiées', 0, 20], ['Revendications', 4, 25], ['Vulnérabilités exploitées citées', 20, 20], ['Exposition (retirée)', 0, 20],
      ['Corrélations', 4, 15],
    ]);
    expect(a.score).toBe(28);
    expect(a.dominantFamily).toBe('vulnerabilities');
  });
  it('revendications : nul à la moyenne, plein à 3 fois la moyenne, jamais au-delà du plafond', () => {
    const at = (ratio: number | null): number => computeCyberPressureAssessment(cyber((c) => {
      if (c.ransomware) c.ransomware.ratio = ratio;
    }), {}, NOW).breakdown[1]?.score ?? -1;
    expect(at(1)).toBe(0);
    expect(at(0.6)).toBe(0);
    expect(at(2)).toBe(13);
    expect(at(3)).toBe(25);
    expect(at(4.5)).toBe(25);
    expect(at(null)).toBe(0);
  });
  it('fichier de ransomware.live en retard (plus de 24 h) : revendications et corrélations non retenues, et dites telles', () => {
    const late = computeCyberPressureAssessment(cyber((c) => {
      if (c.ransomware) {
        c.ransomware.ratio = 3.2;
        c.ransomware.lastModified = new Date(NOW - 25 * HOUR).toISOString();
      }
    }), { telecomOutageCount: 2 }, NOW);
    expect(late.inputs.claimsRatio).toBeNull();
    expect(late.inputs.criticalSectorClaims30d).toBe(0);
    expect(late.breakdown[1]).toMatchObject({ score: 0 });
    expect(late.breakdown[1]?.explanation).toContain('fichier de ransomware.live en retard');
    expect(late.breakdown[4]?.score).toBe(0);
  });
  it('fuites (O5, un compte et une date) : 7 points par fuite pondérés par la fraîcheur de la plus récente, plafond 20 ; HIBP en retard : 0', () => {
    const one = computeCyberPressureAssessment(cyber((c) => {
      c.hibp = { readAt: '2026-10-04T14:48:30.000Z', count: 1, newestAddedDate: '2026-10-03T08:00:00Z', url: 'https://haveibeenpwned.com/PwnedWebsites' };
    }), {}, NOW);
    expect(one.inputs.leaks30d).toBe(1);
    expect(one.breakdown[0]?.score).toBe(7);
    const many = computeCyberPressureAssessment(cyber((c) => {
      c.hibp = { readAt: '2026-10-04T14:48:30.000Z', count: 4, newestAddedDate: '2026-10-03T08:00:00Z', url: 'https://haveibeenpwned.com/PwnedWebsites' };
    }), {}, NOW);
    expect(many.breakdown[0]?.score).toBe(20);
    const late = computeCyberPressureAssessment(cyber((c) => {
      c.hibp = { readAt: '2026-10-03T12:00:00.000Z', count: 4, newestAddedDate: '2026-10-03T08:00:00Z', url: 'https://haveibeenpwned.com/PwnedWebsites' };
    }), {}, NOW);
    expect(late.inputs.leaks30d).toBe(0);
    expect(late.breakdown[0]?.score).toBe(0);
    expect(computeCyberPressureAssessment(cyber((c) => { c.hibp = null; }), {}, NOW).breakdown[0]?.score).toBe(0);
  });
  it('vulnérabilités : une vulnérabilité du catalogue non citée par le CERT-FR ne compte pas, ni une citée de plus de 30 jours, ni un catalogue en retard', () => {
    const uncited = computeCyberPressureAssessment(cyber((c) => { c.kev.recent = c.kev.recent.map((k) => ({ ...k, certfrRefs: [] })); }), {}, NOW);
    expect(uncited.inputs.kevCited30d).toBe(0);
    expect(uncited.inputs.kevAdvisories7d).toBe(3);
    expect(uncited.breakdown[2]?.score).toBe(0);
    const old = computeCyberPressureAssessment(cyber((c) => { c.kev.recent = c.kev.recent.map((k) => ({ ...k, dateAdded: '2026-08-01' })); }), {}, NOW);
    expect(old.inputs.kevCited30d).toBe(0);
    expect(old.inputs.kevAdvisories7d).toBe(0);
    const late = computeCyberPressureAssessment(cyber((c) => { c.kev.readAt = new Date(NOW - 27 * HOUR).toISOString(); }), {}, NOW);
    expect(late.inputs.kevCited30d).toBe(0);
    expect(late.inputs.kevAdvisories7d).toBe(0);
    expect(late.breakdown[2]?.score).toBe(0);
  });
  it('alertes (O1, O6) : seules les alertes au statut « en cours » repris du CERT-FR ; une alerte close ou au statut non lu n’entre pas', () => {
    const closed = computeCyberPressureAssessment(cyber((c) => {
      c.certfr.alerts = c.certfr.alerts.map((a) => (a.ref === 'CERTFR-2026-ALE-011' ? { ...a, status: 'cloturee' as const } : a));
    }), {}, NOW);
    expect(closed.inputs.openAlerts).toBe(2);
    const unread = computeCyberPressureAssessment(cyber((c) => {
      c.certfr.alerts = c.certfr.alerts.map((a) => (a.ref === 'CERTFR-2026-ALE-010' ? { ...a, status: null } : a));
    }), {}, NOW);
    expect(unread.inputs.openAlerts).toBe(2);
  });
  it('exposition retirée : toujours 0, dite « retirée » ; corrélations renforcées par des pannes réseau', () => {
    const a = computeCyberPressureAssessment(CYBER_FIXTURE(), { telecomOutageCount: 2 }, NOW);
    expect(a.breakdown[3]).toMatchObject({ family: 'exposure', score: 0, explanation: 'Retirée : aucune mesure gratuite et sourcée.' });
    expect(a.breakdown[4]?.score).toBe(9);
    expect(a.score).toBe(33);
  });
  it('réponse absente : 0, aucune famille dominante ; plus de Shodan, Censys, NVD, FrenchBreaches ni « faille »', () => {
    const a = computeCyberPressureAssessment(null, {}, NOW);
    expect(a.score).toBe(0);
    expect(a.dominantFamily).toBeNull();
    expect(a.inputs).toEqual({
      leaks30d: 0, claimsRatio: null, kevCited30d: 0, openAlerts: 0, kevAdvisories7d: 0, criticalSectorClaims30d: 0,
    });
    const text = JSON.stringify(computeCyberPressureAssessment(CYBER_FIXTURE(), {}, NOW));
    expect(text).not.toMatch(/Shodan|Censys|NVD|FrenchBreaches|legacy|[Ff]aille/);
  });
});
