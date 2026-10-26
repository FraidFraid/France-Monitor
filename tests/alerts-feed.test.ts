// tests/alerts-feed.test.ts : alertes CAP 1.2 et Atom tirées des relevés de la note (api/_lib/alerts.js, 26/10/2026).
import { describe, expect, it } from 'vitest';
import { alertsFromRecords, atomXml, capXml, levelOf } from '../api/_lib/alerts.js';
import { scoreLevel } from '../src/services/vigilance.ts';

interface Sit { id: string; type?: string; severity: string; title: string; topDriver?: string; affectedZones?: string[] }
let minute = 0;
const T0 = Date.parse('2026-10-17T12:00:00Z');
const NOW = Date.parse('2026-10-18T00:00:00Z');
function rec(score: number, situations: Sit[] = [], read = 14) {
  minute += 15;
  return { capturedAt: new Date(T0 + minute * 60_000).toISOString(), score, situations, coverage: { read, total: 14, missing: [] } };
}
const mob = (severity: string): Sit => ({ id: 'social-mobilisation', type: 'SOCIAL_MOBILISATION', severity, title: 'Mobilisation sociale étendue', topDriver: '111 événements sociaux distincts en 24 h', affectedZones: ['France'] });
const run = (records: ReturnType<typeof rec>[]) => alertsFromRecords(records, NOW);

describe('niveau national', () => {
  it('mêmes seuils que l’interface (85/70/55)', () => {
    for (const s of [100, 85, 84, 70, 69, 55, 54, 0, Number.NaN]) expect(levelOf(s)).toBe(scoreLevel(s));
  });
  it('une nouvelle couleur tenue sur deux relevés : une alerte ; un relevé isolé : rien', () => {
    minute = 0;
    expect(run([rec(78), rec(78), rec(65), rec(78), rec(78)])).toEqual([]);
    minute = 0;
    const a = run([rec(78), rec(78), rec(65), rec(64), rec(63)]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'level', headline: 'Niveau national : jaune → orange', severity: 'Moderate', certainty: 'Observed', category: 'Other' });
    expect(a[0].sent).toBe(new Date(T0 + 60 * 60_000).toISOString());
  });
  it('relevés incomplets (plus d’une source manquante) écartés : une source muette ne déclenche rien', () => {
    minute = 0;
    expect(run([rec(78), rec(78), rec(60, [], 12), rec(60, [], 11), rec(78)])).toEqual([]);
  });
  it('retour à la baisse : alerte aussi, dite « à la baisse »', () => {
    minute = 0;
    const a = run([rec(65), rec(65), rec(80), rec(81)]);
    expect(a.map((x) => x.headline)).toEqual(['Niveau national : orange → jaune']);
    expect(a[0].description).toContain('à la baisse');
  });
});

describe('situations élevées ou critiques', () => {
  it('apparition confirmée sur deux relevés : une alerte ; montée d’élevée à critique : une autre ; aucun doublon', () => {
    minute = 0;
    const a = run([rec(90), rec(90), rec(78, [mob('high')]), rec(78, [mob('high')]), rec(78, [mob('high')]), rec(55, [mob('critical')]), rec(55, [mob('critical')])]);
    const sit = a.filter((x) => x.kind === 'situation');
    expect(sit.map((x) => x.headline)).toEqual(['Mobilisation sociale étendue : élevée', 'Mobilisation sociale étendue : élevée → critique']);
    expect(sit[0]).toMatchObject({ category: 'Security', severity: 'Moderate', certainty: 'Likely', areaDesc: 'France' });
    expect(sit[1].severity).toBe('Severe');
  });
  it('situation qui hésite (élevée, moyenne, élevée) : une seule alerte', () => {
    minute = 0;
    const a = run([rec(90), rec(90), rec(78, [mob('high')]), rec(78, [mob('high')]), rec(80, [mob('medium')]), rec(78, [mob('high')]), rec(78, [mob('high')])]);
    expect(a.filter((x) => x.kind === 'situation')).toHaveLength(1);
  });
  it('situation déjà en cours au début du fichier : pas d’alerte d’apparition', () => {
    minute = 0;
    expect(run([rec(78, [mob('high')]), rec(78, [mob('high')]), rec(78, [mob('high')])]).filter((x) => x.kind === 'situation')).toEqual([]);
  });
  it('situation moyenne : jamais d’alerte', () => {
    minute = 0;
    expect(run([rec(90), rec(90), rec(88, [mob('medium')]), rec(88, [mob('medium')])])).toEqual([]);
  });
});

describe('formats', () => {
  minute = 0;
  const alerts = alertsFromRecords([rec(90), rec(90), rec(78, [mob('high')]), rec(78, [mob('high')]), rec(64), rec(63)], NOW);
  it('CAP 1.2 : espace de noms, urgence inconnue (jamais une prévision), mention bêta, texte échappé', () => {
    const cap = capXml({ ...alerts[0], description: 'A & B < C' });
    expect(cap).toContain('<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">');
    for (const tag of ['identifier', 'sender', 'sent', 'status', 'msgType', 'scope', 'info', 'language', 'category', 'event', 'urgency', 'severity', 'certainty', 'headline', 'area', 'areaDesc']) {
      expect(cap).toContain(`<${tag}>`);
    }
    expect(cap).toContain('<urgency>Unknown</urgency>');
    expect(cap).toContain('<status>Actual</status>');
    expect(cap).toContain('version bêta');
    expect(cap).toContain('Ni prévision, ni évaluation officielle');
    expect(cap).toContain('A &amp; B &lt; C');
    expect(cap).toMatch(/<sent>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00<\/sent>/);
  });
  it('Atom : plus récente d’abord, chaque entrée liée à son CAP', () => {
    const atom = atomXml(alerts, NOW);
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="fr">');
    const titles = [...atom.matchAll(/<entry>\s*<id>[^<]+<\/id>\s*<title>([^<]+)<\/title>/g)].map((m) => m[1]);
    expect(titles).toEqual(['Niveau national : jaune → orange', 'Mobilisation sociale étendue : élevée', 'Niveau national : vert → jaune']);
    expect(atom).toContain('type="application/cap+xml" href="https://www.francemonitor.com/api/alerts/cap?id=');
  });
  it('flux vide : Atom valide sans entrée', () => {
    const atom = atomXml([], NOW);
    expect(atom).toContain('<updated>2026-10-18T00:00:00.000Z</updated>');
    expect(atom).not.toContain('<entry>');
  });
});
