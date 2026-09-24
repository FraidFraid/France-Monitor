import { describe, it, expect } from 'vitest';
import {
  beginIntelVisit,
  beginVisitBaseline,
  parseVisitBaseline,
  recordIntelVisitSeen,
  recordVisitBaseline,
  resolveVisitAnchor,
  type VisitStorage,
} from './intel-last-visit.ts';

const H = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-23T06:00:00Z');

function memory(): VisitStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('resolveVisitAnchor', () => {
  it('24 h sans visite connue, valeur invalide ou future ; borne a 7 jours', () => {
    expect(resolveVisitAnchor(null, NOW)).toEqual({ since: NOW - 24 * H, kind: 'default' });
    expect(resolveVisitAnchor('abc', NOW).kind).toBe('default');
    expect(resolveVisitAnchor(String(NOW + H), NOW).kind).toBe('default');
    expect(resolveVisitAnchor(String(NOW - 3 * H), NOW)).toEqual({ since: NOW - 3 * H, kind: 'last-visit' });
    expect(resolveVisitAnchor(String(NOW - 30 * 24 * H), NOW).since).toBe(NOW - 7 * 24 * H);
  });
});

describe('beginIntelVisit', () => {
  it('fige l ancre pour l onglet et la retrouve a la visite suivante', () => {
    const local = memory();
    const firstTab = { local, session: memory() };
    expect(beginIntelVisit(NOW, firstTab).kind).toBe('default');
    // Rafraichissement dans le meme onglet : meme ancre.
    expect(beginIntelVisit(NOW + H, firstTab).kind).toBe('default');
    recordIntelVisitSeen(NOW + 2 * H, firstTab);
    // Nouvel onglet le lendemain : l ancre est la derniere consultation.
    expect(beginIntelVisit(NOW + 20 * H, { local, session: memory() })).toEqual({ since: NOW + 2 * H, kind: 'last-visit' });
  });

  it('fonctionne sans stockage (navigation privee bloquee)', () => {
    expect(beginIntelVisit(NOW, { local: null, session: null })).toEqual({ since: NOW - 24 * H, kind: 'default' });
  });
});

describe('visite pendant une panne (relecture finale #6)', () => {
  it("ouvrir l onglet sans voir l etat courant ne consomme pas la fenetre de la visite suivante", () => {
    const local = memory();
    local.setItem('fm:intel:last-seen', String(NOW - 5 * H));
    // Historique indisponible : l application n appelle pas recordIntelVisitSeen.
    beginIntelVisit(NOW, { local, session: memory() });
    expect(beginIntelVisit(NOW + H, { local, session: memory() })).toEqual({ since: NOW - 5 * H, kind: 'last-visit' });
  });
});

describe('ligne de base des niveaux (badges nouveau/aggrave, refonte UI etape 2)', () => {
  it("fige pour l onglet les niveaux de la visite precedente, meme apres un nouvel enregistrement", () => {
    const local = memory();
    const tab = { local, session: memory() };
    expect(beginVisitBaseline(tab)).toBeNull(); // premiere visite : aucun badge de situation
    recordVisitBaseline({ 'situation:energy-stress': 'orange' }, tab);
    // Revue : si l enregistrement remplacait la ligne de base de l onglet, aucun badge n apparaitrait jamais.
    expect(beginVisitBaseline(tab)).toBeNull();
    expect(beginVisitBaseline({ local, session: memory() })).toEqual({ 'situation:energy-stress': 'orange' });
  });

  it("ignore une valeur illisible et les niveaux inconnus", () => {
    expect(parseVisitBaseline('{')).toBeNull();
    expect(parseVisitBaseline('[1]')).toBeNull();
    expect(parseVisitBaseline('null')).toBeNull();
    expect(parseVisitBaseline('{"a":"rouge","b":"violet","c":3}')).toEqual({ a: 'rouge' });
  });

  it("borne le nombre de cles enregistrees et fonctionne sans stockage", () => {
    const local = memory();
    const levels = Object.fromEntries(Array.from({ length: 400 }, (_, i): [string, 'jaune'] => [`k${i}`, 'jaune']));
    recordVisitBaseline(levels, { local, session: memory() });
    expect(Object.keys(JSON.parse(local.data.get('fm:intel:last-seen-levels') ?? '{}')).length).toBe(300);
    expect(beginVisitBaseline({ local: null, session: null })).toBeNull();
  });
});
