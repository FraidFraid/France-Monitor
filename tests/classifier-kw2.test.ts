import { describe, it, expect } from 'vitest';
import { classifyByKeywords, qualifyByKeywords } from '../src/services/classifier.ts';

describe('qualifyByKeywords — règles kw-2', () => {
  it('déclencheur dans la description seule : medium, confiance 0,5, motif', () => {
    const q = qualifyByKeywords(
      '« Un Opéra pour un empire » : comment Napoléon III a offert à Paris le Palais Garnier',
      "Au lendemain de l'attentat manqué d'Orsini en 1858, l'empereur lance le chantier.",
    );
    expect(q.classification).toMatchObject({ level: 'medium', category: 'security', confidence: 0.5 });
    expect(q).toMatchObject({ reportedLevel: 'medium', zone: 'france', temporality: 'en_cours', reasons: ['declencheur_hors_titre'] });
  });
  it('métaphore : rien ne se déclenche, motif conservé', () => {
    expect(qualifyByKeywords('Séisme au Sénat : le RN aura un groupe, du jamais-vu')).toMatchObject({
      classification: undefined, reportedLevel: 'info', reasons: ['metaphore'],
    });
    expect(classifyByKeywords('Tempête médiatique autour du nouveau livre de l’écrivain')).toBeUndefined();
  });
  it('judiciaire : gravité signalée critical, retenue low, passé', () => {
    const q = qualifyByKeywords('Condamné pour terrorisme, un Héraultais de nouveau écroué');
    expect(q.classification?.level).toBe('low');
    expect(q).toMatchObject({ reportedLevel: 'high', temporality: 'passe', reasons: ['passe'] });
  });
  it('hypothétique : retenue low, à venir', () => {
    expect(qualifyByKeywords('Covid : les consultations en hausse de 76 %, faut-il craindre une nouvelle épidémie ?'))
      .toMatchObject({ classification: { level: 'low' }, temporality: 'a_venir', reasons: ['hypothetique'] });
    expect(classifyByKeywords('Risques climatiques : « On n’est pas à l’abri d’un tsunami »')?.level).toBe('low');
  });
  it('exercice de secours : gravité signalée critical, retenue low (production du 30/09)', () => {
    expect(qualifyByKeywords('Haute-Savoie. Séisme, effondrements glaciaires, routes coupées... un exercice de secours hors-norme se prépare entre Chamonix et Aoste'))
      .toMatchObject({ classification: { level: 'low' }, reportedLevel: 'critical', reasons: ['hypothetique'] });
  });
  it('étranger : retenue medium, zone étranger', () => {
    expect(qualifyByKeywords('Royaume-Uni : l’antiterrorisme enquête sur un incident près d’une base militaire'))
      .toMatchObject({ classification: { level: 'medium' }, reportedLevel: 'high', zone: 'etranger', reasons: ['etranger'] });
  });
  it('un motif n’est inscrit que s’il abaisse la gravité', () => {
    // Peter May : déclencheur « tempête » dans le résumé → medium ; « étranger » (plafond medium) n'abaisse rien de plus.
    expect(qualifyByKeywords('Mort de l’auteur de polar écossais Peter May', 'Ses romans se déroulent aux Hébrides, balayées par la tempête.'))
      .toMatchObject({ classification: { level: 'medium', confidence: 0.5 }, zone: 'etranger', reasons: ['declencheur_hors_titre'] });
  });
  it('les vrais événements graves restent critical, sans motif', () => {
    expect(qualifyByKeywords('Attentat à Paris : plusieurs blessés')).toMatchObject({ classification: { level: 'critical' }, zone: 'france', reasons: [] });
    expect(classifyByKeywords('Séisme de magnitude 5,2 ressenti dans les Pyrénées-Orientales')?.level).toBe('critical');
    expect(classifyByKeywords('Vigilance rouge tempête sur la Bretagne')?.level).toBe('critical');
  });
  it('« apologie » est une action de police en cours, pas un procès : high', () => {
    expect(qualifyByKeywords('Apologie du terrorisme : un Héraultais arrêté pour avoir publié des vidéos'))
      .toMatchObject({ classification: { level: 'high' }, temporality: 'en_cours', reasons: [] });
  });
  it('titre high, description critical : ramené au niveau du titre', () => {
    expect(classifyByKeywords('Fusillade devant un bar à Marseille', 'La piste d’un attentat est écartée.')?.level).toBe('high');
  });
  it('terrorisme sans victime au titre : high, pas critical (annotation de l’analyste)', () => {
    expect(classifyByKeywords('ATTENTAT DÉJOUÉ À LYON')?.level).toBe('high');
    expect(classifyByKeywords('Une maison détruite par un attentat en Haute-Corse, le Parquet national antiterroriste saisi')?.level).toBe('high');
    expect(classifyByKeywords('Attentat au marché de Noël : trois morts')?.level).toBe('critical');
  });
  it('panne télécom : nationale high, locale medium, panne d’ascenseur ignorée (panne Orange du 21/10/2026)', () => {
    expect(classifyByKeywords('Orange : panne «au niveau national» de l’opérateur et de sa filiale Sosh')).toMatchObject({ level: 'high', category: 'infrastructure' });
    expect(classifyByKeywords('Des milliers de signalements dans toute la France : grosse panne de réseau chez l’opérateur Orange et sa filiale Sosh'))
      .toMatchObject({ level: 'medium', category: 'infrastructure' });
    expect(classifyByKeywords('Panne Orange : le réseau mobile perturbé ce mercredi, de nombreux abonnés privés d’appels et de données')?.category).toBe('infrastructure');
    expect(classifyByKeywords('Orange : l\'opérateur est victime d\'une panne réseau ce mercredi')?.category).toBe('infrastructure');
    expect(classifyByKeywords('Besançon. « Nous vivons dans une situation indigne » : ascenseur en panne, couloirs dégradés')).toBeUndefined();
  });
  it('pannes des autres réseaux : électricité, gaz, eau, urgences, paiement, télévision (21/10/2026)', () => {
    const lvl = (t: string) => classifyByKeywords(t)?.level ?? 'info';
    expect(lvl('Panne de courant géante dans le Var : des milliers de foyers privés d’électricité')).not.toBe('info');
    expect(lvl('Coupure de gaz dans tout un quartier de Lyon après une fuite')).not.toBe('info');
    expect(lvl('Coupure d\'eau : 20 000 habitants privés d\'eau potable à Nîmes')).not.toBe('info');
    expect(lvl('L\'eau du robinet impropre à la consommation dans 12 communes')).not.toBe('info');
    expect(lvl('Le 112 injoignable pendant plusieurs heures, les numéros d\'urgence perturbés')).toBe('high');
    expect(lvl('Panne de la TNT : des milliers de téléspectateurs privés de télévision')).not.toBe('info');
    expect(lvl('Le gaz de schiste fait débat à l’Assemblée')).toBe('info');
  });
});

