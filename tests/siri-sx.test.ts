import { describe, expect, it } from 'vitest';
import { PARTICIPANT_SCOPES, classifyCause, extractCause, isNoise, parseSiriSx } from '../api/_lib/siri-sx.js';
import { fixtureText } from './helpers/traffic-fixtures.ts';

const AT = Date.parse('2026-10-03T13:10:28Z');

describe('fonctions pures', () => {
  it('cause lue après « Cause : » ou « Motif : », jusqu’au point ou à la ligne', () => {
    expect(extractCause("Votre train est retardé. Cause : un obstacle a été signalé sur les voies entre AGEN et BORDEAUX. Merci")).toBe('un obstacle a été signalé sur les voies entre AGEN et BORDEAUX');
    expect(extractCause('Interruption.\nMotif : obstacle sur la voie\nDes retards')).toBe('obstacle sur la voie');
    expect(extractCause('Travaux en cours')).toBeNull();
  });
  it.each([
    ["les barrières d'un passage à niveau nécessitent des vérifications", 'passage-a-niveau'],
    ['fortes précipitations pluvieuses ou crues affectant les voies', 'intemperies'],
    ['opération de sûreté à MONTPELLIER-SAINT-ROCH', 'forces-ordre'],
    ["l’état de santé d'un voyageur à bord", 'malaise'],
    ['un obstacle a été signalé sur les voies', 'obstacle'],
    ['travaux inopinés avec ralentissement', 'travaux'],
    ["manque de matériel en raison d'opérations de maintenance", 'panne-train'],
    ['ralentissement en raison d’un dérangement affectant la voie', 'panne-installation'],
    ['le conducteur a dû ralentir pour garantir la distance de sécurité', 'autre'],
  ])('« %s » : %s', (text, kind) => {
    expect(classifyCause(text)).toBe(kind);
  });
  it('information voyageur sans effet sur la circulation : écartée', () => {
    expect(isNoise("Train complet")).toBe(true);
    expect(isNoise('Voitures Hors Quai', '')).toBe(true);
    expect(isNoise('Arrêt déporté Bagnols Chadenet', '')).toBe(true);
    expect(isNoise("🛗Équipement en gare d'Albert hors service", "l'ascenseur voie 1/voie 2 est hors-service")).toBe(true);
    expect(isNoise('Train supprimé', 'Votre train est supprimé.')).toBe(false);
  });
  it('émetteurs rattachés : régions et axes vérifiés, inconnu « Non rattaché »', () => {
    expect([PARTICIPANT_SCOPES.PCA, PARTICIPANT_SCOPES.PAK, PARTICIPANT_SCOPES.EUR, PARTICIPANT_SCOPES.LEX]).toEqual(['Nouvelle-Aquitaine', "Provence-Alpes-Côte d'Azur", 'Centre-Val de Loire', 'Auvergne-Rhône-Alpes']);
    expect(PARTICIPANT_SCOPES['EST,ATL,SUD-EST,NORD,IC,OUI']).toBe('Toutes grandes lignes');
  });
});

describe('flux réel du 03/10/2026, 15 h 10 (31 situations, variantes françaises)', () => {
  const r = parseSiriSx(fixtureText('siri-sx.xml'), AT);
  it('date de réponse ; 26 situations après retrait de 5 messages sans effet ; plus récentes d’abord', () => {
    expect(r.at).toBe('2026-10-03T13:10:28.519Z');
    expect(r.situations).toHaveLength(26);
    expect(r.situations.map((s) => s.title)).not.toContain('Train complet');
    expect(Date.parse(r.situations[0].start)).toBeGreaterThanOrEqual(Date.parse(r.situations[1].start));
  });
  it('situation complète : cause, classement, axe, trains concernés', () => {
    expect(r.situations.find((s) => s.cause?.startsWith('un obstacle a été signalé'))).toEqual({
      id: expect.stringMatching(/^QOM:Broadcast::/), title: 'Reprise progressive du trafic depuis 14 h 45',
      cause: 'un obstacle a été signalé sur les voies entre AGEN et BORDEAUX', causeKind: 'obstacle', scope: 'Axe Atlantique',
      start: '2026-10-03T14:49:00+02:00', end: '2026-10-03T18:35:00+02:00', trains: 1,
    });
  });
  it('sans « Cause : » : classement sur le titre et le texte (caténaire, travaux)', () => {
    expect(r.situations.filter((s) => s.scope === 'Nouvelle-Aquitaine').map((s) => s.causeKind)).toEqual(['obstacle', 'panne-installation', 'panne-installation', 'travaux']);
    expect(r.situations.filter((s) => s.causeKind === 'travaux')).toHaveLength(6);
  });
  it('titre « Plus d’information : » : remplacé par la première phrase du texte détaillé, classé sur ce texte', () => {
    expect(r.situations.find((s) => s.scope === 'Grand Est')).toMatchObject({
      title: 'Une opération de maintenance imprévue sur le train empêche sa mise en circulation.', cause: null, causeKind: 'panne-train',
    });
    expect(r.situations.map((s) => s.title)).not.toContain('Plus d\'information :');
  });
  it('situation qui n’a pas commencé : écartée', () => {
    expect(parseSiriSx(fixtureText('siri-sx.xml'), Date.parse('2026-10-03T13:00:00Z')).situations.some((s) => s.start === '2026-10-03T15:10:00+02:00')).toBe(false);
  });
  it('autre document : SyntaxError', () => {
    expect(() => parseSiriSx('<rss></rss>', AT)).toThrow(SyntaxError);
  });
});
