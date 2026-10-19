import { describe, expect, it } from 'vitest';
import {
  actCommunes, actDays, actHours, actKind, actPlace, analyseRecueil, nextPages, publishedDay, recueilLinks, splitActs,
} from '../api/_lib/arretes-prefectoraux.js';
import { prefectureItems } from '../api/_lib/protests-prefectures.js';
import { indexCommunes } from '../api/_lib/protests-demosphere.js';

// Extraits de recueils réels (Loiret, Gironde, octobre 2026), raccourcis.
const FOOT = (id: string, n: number) => `Préfecture de la région Centre-Val de Loire et du Loiret - ${id} - Arrêté préfectoral du 14 octobre 2026 autorisant la
captation, l'enregistrement et la transmission d'images au moyen de caméras installées sur des aéronefs ${n}`;
const DRONE_PAGES = [
  'LOIRET\nRECUEIL DES ACTES\nADMINISTRATIFS SPÉCIAL\nN°45-2026-349\nPUBLIÉ LE 14 OCTOBRE 2026',
  'Sommaire\n45-2026-10-14-00001 - Arrêté préfectoral du 14 octobre 2026 autorisant la captation (5 pages) Page 3',
  `Arrêté préfectoral du 14 octobre 2026\nautorisant la captation, l’enregistrement et la transmission d’images\nau moyen de caméras installées sur des aéronefs
Vu les nombreuses exactions commises depuis le 28 septembre 2026 par des petits groupes de manifestants très mobiles ;
Considérant que les journées de mobilisation et de contestation lycéenne attendues les jeudi 15 octobre et vendredi 16 octobre 2026 sont susceptibles de troubler l’ordre public ;
${FOOT('45-2026-10-14-00001', 4)}`,
  `Article 1er : La captation, l’enregistrement et la transmission d’images par la direction interdépartementale de la police nationale sont autorisés dans
l’agglomération orléanaise, les jeudi 15 octobre 2026 et vendredi 16 octobre 2026 de 07h00 à
18h00, sur le territoire de la commune d’Orléans au niveau du périmètre tel que défini en annexe.
Fait à Orléans, le 14 octobre 2026
${FOOT('45-2026-10-14-00001', 5)}`,
];
const PM_PAGE = `ARRÊTÉ
de mise en commun des moyens des polices municipales des communes de Ingré, La Chapelle-Saint-Mesmin et Ormes à l’occasion de la mobilisation lycéenne le 13 octobre 2026
Article 1er : Les polices municipales des communes de Ingré, La Chapelle-Saint-Mesmin et Ormes sont mises en commun le 13 octobre 2026, pour sécuriser tout débordement en lien avec la
manifestation lycéenne organisée devant le lycée Maurice Genevoix à Ingré le mardi 13 octobre 2026 de 8h00 à 18h00.
Fait à Orléans, le 12 octobre 2026
Préfecture de la région Centre-Val de Loire et du Loiret - 45-2026-10-12-00002 - Arrêté de mise en commun PM 3`;

describe('arrêtés : nature, jours, heures, communes', () => {
  it('pages regroupées par l’identifiant du pied de page ; sommaire écarté', () => {
    const acts = splitActs(DRONE_PAGES);
    expect(acts.map((a) => a.id)).toEqual(['45-2026-10-14-00001']);
  });
  it('drone pour des manifestations : jours des articles seulement (ni considérants passés, ni date de signature)', () => {
    const [a] = analyseRecueil(DRONE_PAGES, publishedDay(DRONE_PAGES[0] ?? ''));
    expect(a).toMatchObject({ act: '45-2026-10-14-00001', kind: 'drone', days: ['2026-10-15', '2026-10-16'], hours: ['07:00', '18:00'], communes: ['Orléans'] });
  });
  it('polices municipales mises en commun : mesures, trois communes, lieu de rendez-vous', () => {
    const [a] = analyseRecueil([PM_PAGE], '2026-10-12');
    expect(a).toMatchObject({ kind: 'mesures', days: ['2026-10-13'], hours: ['08:00', '18:00'] });
    expect(a?.communes).toEqual(expect.arrayContaining(['Ingré', 'La Chapelle-Saint-Mesmin', 'Ormes']));
    expect(a?.place).toBe('lycée Maurice Genevoix');
  });
  it('rassemblement festif, épreuve sportive : écartés ; interdiction de manifester reconnue', () => {
    expect(actKind('ARRÊTÉ PORTANT INTERDICTION TEMPORAIRE DE RASSEMBLEMENTS FESTIFS À CARACTÈRE MUSICAL (TEKNIVAL)')).toBeNull();
    expect(actKind('Arrêté autorisant une manifestation sportive comportant la participation de véhicules terrestres à moteur')).toBeNull();
    expect(actKind('Arrêté portant interdiction de manifestation sur la voie publique le samedi 24 octobre 2026')).toBe('interdiction');
    expect(actKind('Situation grave : caméras installées sur des aéronefs pour la sécurité des rassemblements')).toBe('drone');
  });
  it('dates : « du 12 au 14 octobre », « les 8 et 9 octobre 2026 », « 1er » ; heures ; « à Paris le »', () => {
    expect(actDays('autorisée du 12 au 14 octobre 2026', 2026)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(actDays('les 8 et 9 octobre 2026', 2026)).toEqual(['2026-10-08', '2026-10-09']);
    expect(actDays('le 1er novembre', 2026)).toEqual(['2026-11-01']);
    expect(actHours('de 6h30 à 20h00')).toEqual(['06:30', '20:00']);
    expect(actHours('toute la journée')).toBeNull();
    expect(actCommunes('Article 1er : sont autorisés à Paris le 14 octobre 2026')).toEqual(['Paris']);
    expect(actPlace(null)).toBeNull();
  });
});

describe('pages des recueils', () => {
  const site = 'https://www.loiret.gouv.fr';
  it('liens de téléchargement PDF du site, sans doublon', () => {
    const html = '<a href="/contenu/telechargement/1/2/file/recueil-45.pdf" target="_blank">Télécharger RAA</a><a href="/contenu/telechargement/1/2/file/recueil-45.pdf">bis</a><a href="https://ailleurs.fr/x.pdf">x</a>';
    expect(recueilLinks(html, site).map((l) => l.href)).toEqual(['https://www.loiret.gouv.fr/contenu/telechargement/1/2/file/recueil-45.pdf']);
  });
  it('mois en cours et précédent, sinon l’année', () => {
    const now = Date.parse('2026-10-19T12:00:00Z');
    const months = '<a href="/P/Novembre-2026">Novembre 2026</a><a href="/P/Octobre-2026">Octobre 2026</a><a href="/P/Septembre-2026">Septembre 2026</a><a href="/P/Aout-2026">Août 2026</a>';
    expect(nextPages(months, site, now)).toEqual(['https://www.loiret.gouv.fr/P/Octobre-2026', 'https://www.loiret.gouv.fr/P/Septembre-2026']);
    const years = '<a href="/P/annee-2026">Recueil des Actes Administratifs de l\'année 2026</a><a href="/P/annee-2025">Recueil des Actes Administratifs de l\'année 2025</a>';
    expect(nextPages(years, site, now)).toEqual(['https://www.loiret.gouv.fr/P/annee-2026']);
  });
});

describe('rendez-vous de la couche Manifestations', () => {
  const commune = (nom: string, lon: number, lat: number) => ({ nom, codeDepartement: '45', codesPostaux: [], centre: { type: 'Point', coordinates: [lon, lat] } });
  const index = async () => indexCommunes([commune('Orléans', 1.9, 47.9), commune('Ingré', 1.82, 47.92)]);
  const releve = {
    recueils: [{
      url: 'https://www.loiret.gouv.fr/contenu/telechargement/1/2/file/r.pdf', dept: '45', prefecture: 'Loiret', publishedOn: '2026-10-14',
      acts: [{ act: '45-2026-10-14-00001', kind: 'drone', days: ['2026-10-15', '2026-10-16'], hours: ['07:00', '18:00'], communes: ['Orléans', 'Inconnue'], excerpt: 'manifestations non déclarées', place: null }],
    }],
  };
  it('un par jour et par commune retrouvée ; heure de Paris ; fenêtre', async () => {
    const r = await prefectureItems(releve, Date.parse('2026-10-15T06:00:00Z'), index);
    expect(r.items.map((i) => [i.city, i.startsAt])).toEqual([['Orléans', '2026-10-15T05:00:00.000Z'], ['Orléans', '2026-10-16T05:00:00.000Z']]);
    expect(r.items[0]).toMatchObject({ source: 'prefecture', status: 'annonce', precision: 'commune', edition: 'Préfecture du Loiret', title: 'Drones de surveillance autorisés par la préfecture' });
    expect(r.items[0]?.arrete).toMatchObject({ kind: 'drone', hours: ['07:00', '18:00'] });
    const later = await prefectureItems(releve, Date.parse('2026-10-17T06:00:00Z'), index);
    expect(later.items).toHaveLength(0);
  });
  it('aucune commune lisible : gardé sans position', async () => {
    const r = await prefectureItems({ recueils: [{ ...releve.recueils[0], acts: [{ ...releve.recueils[0]!.acts[0]!, communes: [] }] }] }, Date.parse('2026-10-15T06:00:00Z'), index);
    expect(r.unplaced).toBe(1);
    expect(r.items[0]).toMatchObject({ city: null, lat: null, precision: null, dept: '45' });
  });
});
