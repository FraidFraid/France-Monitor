import { describe, it, expect } from 'vitest';
import { adresseNameMatches, departementCenter, extractLocations } from './geocoder.ts';

// Passe « préposition + lieu » réparée le 12/10/2026 (l'ancien motif n'attendait l'espace qu'après « dans ») ; mesure sur 600
// titres de production : 49 lieux justes gagnés, aucune erreur de l'API Adresse conservée.
describe('extractLocations : préposition + lieu', () => {
  it('communes, noms composés, article, élision', () => {
    expect(extractLocations('Incendie à Bourg-Saint-Maurice ce matin')).toContain('Bourg-Saint-Maurice');
    expect(extractLocations('Accident sur Plouhinec hier')).toContain('Plouhinec');
    expect(extractLocations('Fusillade à la Rochelle')).toContain('La Rochelle');
    expect(extractLocations('Usine évacuée à Aix-en-Provence')).toContain('Aix-en-Provence');
    expect(extractLocations('Collision près de Boulogne-sur-Mer')).toContain('Boulogne-sur-Mer');
    expect(extractLocations('Grève à Villeneuve-d’Ascq')).toContain('Villeneuve-d’Ascq');
  });

  it('départements, y compris composés avec « et » ; jamais une région de métropole (son centre tombe dans un département au hasard)', () => {
    expect(extractLocations('Crue dans l’Hérault : alerte')).toContain('Hérault');
    expect(extractLocations('Orages dans le Rhône')).toContain('Rhône');
    expect(extractLocations('Le bus poursuit sa route en Seine-et-Marne')).toContain('Seine-et-Marne');
    expect(extractLocations('Mythes et légendes de Tarn-et-Garonne')).toEqual(['Tarn-et-Garonne']);
    expect(extractLocations('Inondations en Bretagne')).toEqual([]);
  });

  it('« de », « du », « d’ » : seulement un lieu connu, après les autres candidats', () => {
    expect(extractLocations('Le maire de Nantes démissionne')).toEqual(['Nantes']);
    expect(extractLocations('Le préfet du Var alerte')).toEqual(['Var']);
    expect(extractLocations('Le gouvernement de Michel Barnier tombe')).toEqual([]);
    expect(extractLocations('Le Racing Club de Strasbourg veut retrouver des couleurs à Nice')).toEqual(['Nice', 'Strasbourg']);
  });

  it('jamais un lieu étranger connu, une institution, un mois, une compétition', () => {
    expect(extractLocations('Guerre en Ukraine : frappes à Kiev')).toEqual([]);
    expect(extractLocations('Rencontre à Matignon')).toEqual([]);
    expect(extractLocations('Nouvelle hausse en Janvier')).toEqual([]);
    expect(extractLocations('Victoire de la France au Mondial')).toEqual([]);
  });

  it('la ville connue du titre reste en dernier recours quand un autre candidat échoue', () => {
    expect(extractLocations('Lens mène face à l’Olympique Lyonnais grâce à Sotoca')).toEqual(['Sotoca', 'Lens']);
  });

  it('l’opérateur Orange n’est pas la ville d’Orange (panne du 21/10/2026 placée dans le Vaucluse)', () => {
    expect(extractLocations('Orange : panne «au niveau national» de l’opérateur et de sa filiale Sosh')).toEqual([]);
    expect(extractLocations('Le réseau mobile d’Orange touché par une panne ce mercredi')).toEqual([]);
    expect(extractLocations('Panne réseau en cours chez Orange : les abonnés privés d’appels à Auch')).toEqual(['Auch']);
    expect(extractLocations('Orange : un incendie au théâtre antique')).toEqual(['Orange']);
  });
});

describe('géocodage : départements et API Adresse', () => {
  it('département nommé : son point intérieur', () => {
    expect(departementCenter('Var')).toMatchObject({ name: 'Var' });
    expect(departementCenter('Côtes-d’Armor')).not.toBeNull();
    expect(departementCenter('Bretagne')).toBeNull();
  });

  it('résultat de l’API retenu seulement si son nom est celui cherché', () => {
    expect(adresseNameMatches('Challans', { name: 'Challans', city: 'Challans' })).toBe(true);
    expect(adresseNameMatches('La Rochelle', { name: 'La Rochelle' })).toBe(true);
    expect(adresseNameMatches('Los Angeles', { name: 'Los Masos', city: 'Los Masos' })).toBe(false);
    expect(adresseNameMatches('Toscane', { name: 'Tours' })).toBe(false);
  });
});
