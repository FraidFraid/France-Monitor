import { describe, expect, it } from 'vitest';
import { translateDisease, translateEcdcTitle, translateOutbreakTitle, translatePlace, translateTopic } from '../api/_lib/health-terms.js';

describe('dictionnaire de traduction (OMS, ECDC)', () => {
  it('titres OMS réels du 03/10/2026', () => {
    expect(translateOutbreakTitle('Ebola disease caused by Bundibugyo virus - Democratic Republic of the Congo'))
      .toBe('Maladie à virus Ebola (souche Bundibugyo) : République démocratique du Congo');
    expect(translateOutbreakTitle('Ebola disease caused by Bundibugyo virus, Democratic Republic of the Congo & Uganda'))
      .toBe('Maladie à virus Ebola (souche Bundibugyo) : République démocratique du Congo et Ouganda');
    expect(translateOutbreakTitle('Hantavirus outbreak linked to cruise ship travel, Multi-locations'))
      .toBe('Foyer d’hantavirus lié à une croisière : plusieurs pays');
    expect(translateOutbreakTitle('Nipah virus disease - India')).toBe('Infection à virus Nipah : Inde');
    expect(translateOutbreakTitle('Yellow fever - Global')).toBe('Fièvre jaune : situation mondiale');
  });
  it('grippe A(HxNy) reconnue ; plusieurs pays joints par « et »', () => {
    expect(translateOutbreakTitle('Avian Influenza A(H5N1) - Cambodia')).toBe('Grippe aviaire A(H5N1) : Cambodge');
    expect(translateOutbreakTitle('Cholera - Angola, Zambia and Malawi')).toBe('Choléra : Angola, Zambie et Malawi');
  });
  it('terme inconnu (maladie ou pays) : null, l’appelant garde le titre original', () => {
    expect(translateOutbreakTitle('Unknown fever - India')).toBeNull();
    expect(translateOutbreakTitle('Cholera - Atlantis')).toBeNull();
    expect(translateDisease('mystery disease')).toBeNull();
    expect(translatePlace('Atlantis')).toBeNull();
  });
  it('ECDC : titre par numéro de semaine, sujets traduits ou laissés tels quels', () => {
    expect(translateEcdcTitle('Communicable disease threats report, 26 September - 2 October, week 40'))
      .toBe('Rapport hebdomadaire des menaces sanitaires, semaine 40');
    expect(translateEcdcTitle('Special report')).toBe('Special report');
    expect(translateTopic('Crimean Congo haemorrhagic fever')).toBe('Fièvre hémorragique de Crimée-Congo');
    expect(translateTopic('avian influenza A(H9N2)')).toBe('Grippe aviaire A(H9N2)');
    expect(translateTopic('ECDC expert deployment')).toBe('ECDC expert deployment');
  });
  it('aucun tiret cadratin produit, même depuis une entité', () => {
    expect(translateTopic('A &#8212; B')).toBe('A : B');
  });
});
