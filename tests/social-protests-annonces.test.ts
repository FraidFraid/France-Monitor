import { describe, expect, it } from 'vitest';
import {
  announcedDays, announcedHour, announcedPlace, groupAnnouncements, isAnnouncementHeadline,
} from '../api/_lib/protests-press-annonces.js';

// Titres relevés dans la base des articles le lundi 19/10/2026 ; publication à 10 h, heure de Paris.
const PUB = Date.parse('2026-10-19T08:00:00Z');
const days = (title: string, at = PUB) => announcedDays(title, at).map((d) => `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`);

describe('titre d’annonce', () => {
  it.each([
    ["Violences du 17 octobre: le maire d'Avignon appelle au rassemblement devant la mairie ce lundi", true],
    ['Un rassemblement est organisé devant la mairie de Mont-de-Marsan ce lundi midi : voici pourquoi', true],
    ['Après les violences en marge de la manifestation samedi, un rassemblement pacifique ce lundi 19 octobre, à Brest', true],
    ['Gilets jaunes : un « acte II » de mobilisation prévu pour les samedi 24 et 31 octobre', true],
    ['Colère lycéenne: une manifestation prévue demain en centre-ville à Lille sera interdite, annonce le préfet', true],
    // Interdiction générale, conseil aux voyageurs, appel aux dons, direct : pas un rendez-vous.
    ['Violences du 17 octobre : rassemblements et manifestations interdits ce lundi à Marseille', false],
    ['«Évitez les manifestations» : l’Allemagne appelle ses ressortissants à la «prudence» en France après les violences du 17', false],
    ["31% de besoins en plus en 2027 : l'ESF lance un appel à la mobilisation face au manque de dons de plasma en Bretagne", false],
    ['DIRECT. Manifestations du 17 octobre : des rassemblements non autorisés à Toulouse et Paris ce midi', false],
  ])('%s : %s', (title, expected) => {
    expect(isAnnouncementHeadline(title)).toBe(expected);
  });
});

describe('jours annoncés', () => {
  it('« ce lundi » un lundi : aujourd’hui ; « demain » ; dates écrites, plusieurs à la fois', () => {
    expect(days("le maire d'Avignon appelle au rassemblement devant la mairie ce lundi")).toEqual(['2026-10-19']);
    expect(days('une manifestation prévue demain en centre-ville à Lille')).toEqual(['2026-10-20']);
    expect(days('un « acte II » de mobilisation prévu pour les samedi 24 et 31 octobre')).toEqual(['2026-10-24', '2026-10-31']);
    expect(days('une intersyndicale appelle à une grève massive le 5 novembre')).toEqual(['2026-11-05']);
  });
  it('date passée (« Violences du 17 octobre ») et jour nu (« samedi ») jamais lus', () => {
    expect(days('Violences du 17 octobre: plusieurs rassemblements prévus devant les mairies')).toEqual([]);
    expect(days('une adolescente a perdu l’usage d’un oeil samedi, un rassemblement annoncé')).toEqual([]);
  });
  it('« ce samedi » lu un lundi : passé dans un compte rendu, à venir dans une annonce', () => {
    expect(days('500 manifestants à Quimper ce samedi')).toEqual([]);
    expect(days('Maintien de l’ordre à Nice : 28 interpellations et 25 gardes à vue lors de la manifestation ce dimanche')).toEqual([]);
    expect(days('Des Gilets jaunes annoncent un « acte II » dès ce samedi')).toEqual(['2026-10-24']);
    expect(days('rassemblement lundi prochain devant la préfecture')).toEqual(['2026-10-26']);
  });
  it('citations ignorées', () => {
    expect(days('"Demain, je veux des explications" : le maire de Marseille annonce la venue du ministre')).toEqual([]);
  });
});

describe('heure et lieu', () => {
  it('heure : « 18h30 », « midi », rien', () => {
    expect(announcedHour('rassemblement à 18h30 place du Capitole')).toEqual([18, 30]);
    expect(announcedHour('devant la mairie ce lundi midi')).toEqual([12, 0]);
    expect(announcedHour('rassemblement ce lundi')).toBeNull();
  });
  it('lieu : mairie (élision), préfecture, place nommée, rien', () => {
    expect(announcedPlace("le maire d'Avignon appelle au rassemblement devant la mairie ce lundi", 'Avignon')).toBe("Mairie d'Avignon");
    expect(announcedPlace('devant la mairie de Tarbes ce lundi', 'Tarbes')).toBe('Mairie de Tarbes');
    expect(announcedPlace('rassemblement devant la préfecture demain', 'Rennes')).toBe('Préfecture, Rennes');
    expect(announcedPlace('rassemblement place du Capitole ce soir', 'Toulouse')).toBe('Place du Capitole, Toulouse');
    expect(announcedPlace('un rassemblement pacifique ce lundi', 'Brest')).toBeNull();
  });
});

describe('regroupement', () => {
  const PLACES: Record<string, { lat: number; lon: number; locationName: string; source: string }> = {
    Avignon: { lat: 43.9493, lon: 4.8055, locationName: 'Avignon', source: 'communes' },
    Lille: { lat: 50.632, lon: 3.0473, locationName: 'Lille', source: 'communes' },
    Essonne: { lat: 48.63, lon: 2.44, locationName: 'Essonne', source: 'departements' },
  };
  const resolve = async (name: string) => PLACES[name] ?? null;
  const row = (title: string, at = PUB, link = `https://exemple.fr/${encodeURIComponent(title).slice(0, 40)}`) =>
    ({ title, link, feed: 'Exemple', region: null, at });

  it('un rassemblement par lieu et par jour ; dépêche reprise comptée une fois ; interdiction dite ; département gardé comme tel', async () => {
    const r = await groupAnnouncements([
      row("Violences du 17 octobre: le maire d'Avignon appelle au rassemblement devant la mairie ce lundi"),
      row("Vaucluse. Violences du 17 octobre: le maire d'Avignon appelle au rassemblement devant la mairie ce lundi", PUB + 60_000, 'https://autre.fr/a'),
      row('Colère lycéenne: une manifestation prévue demain en centre-ville à Lille sera interdite, annonce le préfet'),
      row('Violences du 17 octobre: plusieurs rassemblements prévus ce lundi devant des mairies en Essonne'),
      row('Gilets jaunes : un « acte II » annoncé partout en France ce samedi'),
    ], PUB, resolve);
    // Datés : les cinq titres (la dépêche reprise compte pour le relevé) ; l'appel national n'a pas de lieu.
    expect(r.matched).toBe(5);
    expect(r.unplaced).toBe(1);
    const avignon = r.items.find((i) => i.city === 'Avignon');
    expect(avignon).toMatchObject({ source: 'presse', status: 'annonce', allDay: true, place: "Mairie d'Avignon", articleCount: 1, precision: 'commune' });
    expect(avignon?.startsAt).toBe('2026-10-18T22:00:00.000Z');
    expect(r.items.find((i) => i.city === 'Lille')).toMatchObject({ title: 'Rassemblement annoncé, interdit par la préfecture', startsAt: '2026-10-19T22:00:00.000Z' });
    expect(r.items.find((i) => i.city === 'Essonne')).toMatchObject({ precision: 'departement', place: null });
  });
  it('hors fenêtre : commencé depuis plus de 6 h ou à plus de 7 jours', async () => {
    const r = await groupAnnouncements([
      row('rassemblement prévu devant la mairie d’Avignon ce lundi à 9h'),
      row('manifestation prévue à Avignon le 30 octobre'),
    ], Date.parse('2026-10-19T16:00:00Z'), resolve);
    expect(r.items).toHaveLength(0);
  });
});
