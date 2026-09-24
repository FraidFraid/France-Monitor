import { describe, it, expect } from 'vitest';
import { beginIntelVisit, recordIntelVisitSeen, resolveVisitAnchor, type VisitStorage } from './intel-last-visit.ts';

const H = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-23T06:00:00Z');

function memory(): VisitStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('resolveVisitAnchor', () => {
  it('24 h sans visite connue, valeur invalide ou future ; borne à 7 jours', () => {
    expect(resolveVisitAnchor(null, NOW)).toEqual({ since: NOW - 24 * H, kind: 'default' });
    expect(resolveVisitAnchor('abc', NOW).kind).toBe('default');
    expect(resolveVisitAnchor(String(NOW + H), NOW).kind).toBe('default');
    expect(resolveVisitAnchor(String(NOW - 3 * H), NOW)).toEqual({ since: NOW - 3 * H, kind: 'last-visit' });
    expect(resolveVisitAnchor(String(NOW - 30 * 24 * H), NOW).since).toBe(NOW - 7 * 24 * H);
  });
});

describe('beginIntelVisit', () => {
  it('fige l’ancre pour l’onglet et la retrouve à la visite suivante', () => {
    const local = memory();
    const firstTab = { local, session: memory() };
    expect(beginIntelVisit(NOW, firstTab).kind).toBe('default');
    // Rafraîchissement dans le même onglet : même ancre.
    expect(beginIntelVisit(NOW + H, firstTab).kind).toBe('default');
    recordIntelVisitSeen(NOW + 2 * H, firstTab);
    // Nouvel onglet le lendemain : l'ancre est la dernière consultation.
    expect(beginIntelVisit(NOW + 20 * H, { local, session: memory() })).toEqual({ since: NOW + 2 * H, kind: 'last-visit' });
  });

  it('fonctionne sans stockage (navigation privée bloquée)', () => {
    expect(beginIntelVisit(NOW, { local: null, session: null })).toEqual({ since: NOW - 24 * H, kind: 'default' });
  });
});
