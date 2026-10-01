import { describe, it, expect } from 'vitest';
import {
  normalizeForMatch, neutralizeMetaphors, isJudicialOrRetrospective, isHypothetical, titleZone,
  titleQualification, minLevel, levelRank, TITLE_REASON_CAP, FRENCH_ANCHOR_FORMS, FOREIGN_FORMS, isTerrorWithoutVictims,
} from '../src/services/classification-guards.ts';

describe('neutralizeMetaphors', () => {
  it('neutralise un terme figuré voisin d’un marqueur non physique', () => {
    expect(neutralizeMetaphors('seisme au senat le rn aura un groupe')).toBe('_ au senat le rn aura un groupe');
    expect(neutralizeMetaphors('une veritable bombe politique')).toBe('une veritable _ politique');
    expect(neutralizeMetaphors('tempete mediatique autour du livre')).toBe('_ mediatique autour du livre');
    expect(neutralizeMetaphors('le tremblement de terre politique')).toBe('le _ _ _ politique');
  });
  it('laisse un phénomène physique intact', () => {
    expect(neutralizeMetaphors('seisme de magnitude 6 en turquie')).toBe('seisme de magnitude 6 en turquie');
    expect(neutralizeMetaphors('vigilance rouge tempete sur la bretagne')).toBe('vigilance rouge tempete sur la bretagne');
  });
});

describe('isJudicialOrRetrospective', () => {
  it.each([
    'Procès de Rachida Dati : le parquet requiert quatre ans',
    'Le chanteur condamné en appel à dix ans de prison',
    'Féminicide dans le Cher : le compagnon mis en examen',
    'Il y a 10 ans, les attentats du 13-Novembre',
    'Hommage aux victimes de l’attentat',
    'Condamné pour terrorisme, un Héraultais écroué',
  ])('vrai : %s', (title) => expect(isJudicialOrRetrospective(title)).toBe(true));
  it.each([
    'Attentat à Paris : plusieurs blessés',
    'Le barrage a été jugé dangereux, la vallée évacuée',
    'Appel à la grève à la SNCF jeudi',
    // « apologie » nomme un délit, pas une étape judiciaire (décision de l’utilisateur, 28/09).
    'Apologie du terrorisme : un Héraultais arrêté',
  ])('faux : %s', (title) => expect(isJudicialOrRetrospective(title)).toBe(false));
});

describe('isHypothetical', () => {
  it.each([
    'Risques climatiques : « On n’est pas à l’abri d’un tsunami »',
    'Et si la Seine débordait ?',
    'Covid : faut-il craindre une nouvelle épidémie ?',
  ])('vrai : %s', (title) => expect(isHypothetical(title)).toBe(true));
  it('« risque de » ne compte pas (annonces de vigilance)', () => {
    expect(isHypothetical('Vigilance orange : risque de crues sur le Var')).toBe(false);
  });
});

describe('exercices et simulations (production du 30/09)', () => {
  it.each([
    'Un attentat va être simulé en pleine nuit dans cette commune près de Nice : 200 personnes mobilisées',
    'Un exercice attentat dans une salle de spectacle à Mougins : un important dispositif de secours déployé ce jeudi soir',
    'Haute-Savoie. Séisme, effondrements glaciaires, routes coupées... un exercice de secours hors-norme se prépare entre Chamonix et Aoste',
    'Coups de feu à Atlantis : un exercice de sécurité dans le centre commercial de Nantes',
    'Nantes : une tuerie de masse simulée cette semaine dans un centre commercial',
    'Les membres du GIGN déployés en masse dans ce centre commercial près d’Angers pour une attaque armée simulée',
    'Incendie dans la sacristie d’une église du Haut-Rhin : les pompiers mobilisés pour un exercice grandeur nature',
    'Ain. Exercice de gestion de crise ce mercredi à la centrale nucléaire, pourquoi il ne faut pas s’inquiéter',
  ])('exercice ou simulation → hypothétique : %s', (title) => expect(isHypothetical(title)).toBe(true));
  it.each([
    'Un policier tué dans l’exercice de ses fonctions à Marseille',
    'Gestion du Département : « nous n’avons pas de leçon à recevoir en matière d’exercice du pouvoir »',
    'Taïwan : la Chine lance des exercices militaires d’ampleur autour de l’île',
    'Russie : exercices nucléaires près de la frontière de l’Otan',
    'Marine Le Pen, le RN et l’antisémitisme : une entreprise de dissimulation',
    'Deux passagers interpellés à l’aéroport de Marseille avec des milliers de paquets de cigarettes dissimulés',
  ])('pas un exercice de sécurité civile : %s', (title) => expect(isHypothetical(title)).toBe(false));
  it('le plafond du titre s’applique : retenue low, motif hypothétique', () => {
    expect(titleQualification('Un exercice attentat dans une salle de spectacle à Mougins')).toMatchObject({
      maxSeverity: 'low', reasons: ['hypothetique'],
    });
  });
});

describe('titleZone', () => {
  it.each([
    'Royaume-Uni : l’antiterrorisme enquête sur un incident près d’une base militaire',
    'Grande-Bretagne : grève des cheminots',
    'Corée du Nord : nouveau tir de missile',
    'L’armée israélienne annonce avoir tué à Gaza le ravisseur',
    'Thaïlande : des pluies exceptionnelles inondent Bangkok',
    'Nouvelle nuit de violence en Afrique du Sud',
    'Ouragan sur La Nouvelle-Orléans',
    'Mort de l’auteur de polar écossais Peter May',
  ])('étranger : %s', (title) => expect(titleZone(title)).toBe('etranger'));
  it.each([
    'Deux Français tués au Mali',
    'Manche : trois personnes sont mortes en tentant de rejoindre le Royaume-Uni',
    'Un touriste américain agressé à Paris',
    'Bretagne : la tempête Ciaran arrive',
    'Monaco : le Grand Prix perturbé',
  ])('France : %s', (title) => expect(titleZone(title)).toBe('france'));
  it.each([
    'Festival de la bande dessinée : une édition record',
    'Incendie à Tours : un immeuble évacué',
  ])('indéterminée : %s', (title) => expect(titleZone(title)).toBe('indeterminee'));
  it('« Kremlin-Bicêtre » n’est pas le Kremlin', () => {
    expect(titleZone('Incendie au Kremlin-Bicêtre : un immeuble évacué')).not.toBe('etranger');
  });
  it('aucune forme étrangère n’est aussi une ancre française', () => {
    const anchors = new Set(FRENCH_ANCHOR_FORMS);
    expect(FOREIGN_FORMS.filter((f) => anchors.has(f))).toEqual([]);
  });
  it('les noms courants ne servent pas d’ancre', () => {
    for (const word of ['nord', 'cher', 'somme', 'lot', 'tours', 'orange', 'nice', 'vienne']) {
      expect(FRENCH_ANCHOR_FORMS).not.toContain(word);
    }
  });
});

describe('titleQualification', () => {
  it('sans garde : critical, en cours', () => {
    expect(titleQualification('Attentat à Paris : plusieurs blessés')).toEqual({
      maxSeverity: 'critical', temporality: 'en_cours', zone: 'france', reasons: [], terrorism: true,
    });
  });
  it('cumule les gardes et garde le plafond le plus bas', () => {
    expect(titleQualification('Royaume-Uni : cinq hommes condamnés pour terrorisme')).toEqual({
      maxSeverity: 'low', temporality: 'passe', zone: 'etranger', reasons: ['passe', 'etranger'], terrorism: true,
    });
    expect(titleQualification('Thaïlande : Bangkok sous les eaux')).toEqual({
      maxSeverity: 'medium', temporality: 'en_cours', zone: 'etranger', reasons: ['etranger'], terrorism: false,
    });
    expect(titleQualification('Et si la Seine débordait ?')).toMatchObject({ maxSeverity: 'low', temporality: 'a_venir', reasons: ['hypothetique'] });
  });
  it('plafonds par motif', () => {
    expect(TITLE_REASON_CAP).toEqual({ passe: 'low', hypothetique: 'low', etranger: 'medium' });
  });
});

describe('outils', () => {
  it('normalise accents, apostrophes et casse', () => {
    expect(normalizeForMatch('Côte d’Ivoire : ÉTAT D’URGENCE')).toBe('cote d ivoire etat d urgence');
  });
  it('ordonne les niveaux', () => {
    expect(minLevel('critical', 'medium')).toBe('medium');
    expect(minLevel('low', 'high')).toBe('low');
    expect(levelRank('info')).toBe(0);
    expect(levelRank('critical')).toBe(4);
  });
});

describe('règles complétées après le rejeu (Tâche 11)', () => {
  it.each([
    'Pourquoi la guerre civile éthiopienne est-elle en train de reprendre ?',
    'Le président soudanais limogé',
    'Des soldats congolais tués dans l’est du pays',
    'Le gouvernement argentin dévalue le peso',
  ])('gentilé étranger → étranger : %s', (title) => expect(titleZone(title)).toBe('etranger'));
  it.each([
    'Covid-19 : doit-on craindre une nouvelle épidémie ?',
    'Grippe aviaire : faut-il s’inquiéter ?',
    'Canicule : peut-on craindre des coupures ?',
  ])('hypothétique : %s', (title) => expect(isHypothetical(title)).toBe(true));
});

describe('prénoms homonymes de gentilés', () => {
  it('« Philippine » (prénom) ne rend pas un titre étranger', () => {
    expect(titleZone('Meurtre de Philippine : le suspect sera jugé')).not.toBe('etranger');
  });
});

describe('isTerrorWithoutVictims (règle ajoutée après l’annotation de l’analyste)', () => {
  it.each([
    'Une maison détruite par un attentat en Haute-Corse, le Parquet national antiterroriste saisi de l’enquête',
    'ATTENTAT DÉJOUÉ À LYON',
    'Royaume-Uni : l’antiterrorisme enquête sur un incident près d’une base militaire',
  ])('sans victime au titre : %s', (title) => expect(isTerrorWithoutVictims(title)).toBe(true));
  it.each([
    'Attentat à Paris : plusieurs blessés',
    'Attentat au marché de Noël : trois morts',
    'Prise d’otages dans une école',
    'Incendie à Tours : un immeuble évacué',
  ])('victimes ou hors terrorisme : %s', (title) => expect(isTerrorWithoutVictims(title)).toBe(false));
});

describe('ancres de sécurité nationale (revue finale I4)', () => {
  it('un plan ou un service de l’État ancre le titre en France', () => {
    expect(titleZone('Menace iranienne : le plan Vigipirate relevé au niveau urgence attentat')).toBe('france');
    expect(titleZone('Projet d’attentat russe déjoué : la DGSI interpelle deux hommes')).toBe('france');
  });
});

describe('titleQualification — terrorisme au titre (règle serveur, 29/09)', () => {
  it.each([
    'Apologie du terrorisme : un Héraultais arrêté',
    'Royaume-Uni : cinq hommes arrêtés pour préparation d’un “acte terroriste” près d’une base aérienne',
    'Ultradroite : l’ex-jardinier radicalisé, condamné pour terrorisme, de nouveau écroué',
  ])('vrai : %s', (title) => expect(titleQualification(title).terrorism).toBe(true));
  it('faux sans terme de terrorisme', () => {
    expect(titleQualification('Incendie à Tours : un immeuble évacué').terrorism).toBe(false);
  });
});
