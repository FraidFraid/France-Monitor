import { describe, it, expect } from 'vitest';
import {
  normalizeForMatch, neutralizeMetaphors, isJudicialOrRetrospective, isHypothetical, titleZone,
  titleQualification, minLevel, levelRank, TITLE_REASON_CAP, FRENCH_ANCHOR_FORMS, FOREIGN_FORMS,
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
    'Apologie du terrorisme : un Héraultais arrêté',
  ])('vrai : %s', (title) => expect(isJudicialOrRetrospective(title)).toBe(true));
  it.each([
    'Attentat à Paris : plusieurs blessés',
    'Le barrage a été jugé dangereux, la vallée évacuée',
    'Appel à la grève à la SNCF jeudi',
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
      maxSeverity: 'critical', temporality: 'en_cours', zone: 'france', reasons: [],
    });
  });
  it('cumule les gardes et garde le plafond le plus bas', () => {
    expect(titleQualification('Royaume-Uni : cinq hommes condamnés pour terrorisme')).toEqual({
      maxSeverity: 'low', temporality: 'passe', zone: 'etranger', reasons: ['passe', 'etranger'],
    });
    expect(titleQualification('Thaïlande : Bangkok sous les eaux')).toEqual({
      maxSeverity: 'medium', temporality: 'en_cours', zone: 'etranger', reasons: ['etranger'],
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
