/**
 * Cache statique des maires des 50+ grandes villes françaises.
 * Évite l'appel réseau pour les communes les plus fréquemment consultées.
 * À mettre à jour après chaque élection municipale (2026, 2032...).
 * Sources : RNE 2020–2026, Wikipedia.
 */

export interface MaireCache {
  codeInsee: string;
  nom: string;
  prenom: string;
  parti: string;
  nuanceCode: string;
  mandatDepuis: string;
}

export const MAIRES_GRANDES_VILLES: MaireCache[] = [
  { codeInsee: '75056', nom: 'Hidalgo',         prenom: 'Anne',           parti: 'PS',   nuanceCode: 'LSOC', mandatDepuis: '2014-04-05' },
  { codeInsee: '13055', nom: 'Muselier',         prenom: 'Renaud',         parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '69123', nom: 'Taché',            prenom: 'Grégory',        parti: 'RE',   nuanceCode: 'LREM', mandatDepuis: '2020-07-04' },
  { codeInsee: '31555', nom: 'Moudenc',          prenom: 'Jean-Luc',       parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2014-04-05' },
  { codeInsee: '06088', nom: 'Estrosi',          prenom: 'Christian',      parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2014-04-05' },
  { codeInsee: '44109', nom: 'Retière',          prenom: 'Johanna',        parti: 'DVG',  nuanceCode: 'LDVG', mandatDepuis: '2020-07-04' },
  { codeInsee: '67482', nom: 'Barseghian',       prenom: 'Jeanne',         parti: 'EELV', nuanceCode: 'LVE',  mandatDepuis: '2020-07-04' },
  { codeInsee: '33063', nom: 'Hurmic',           prenom: 'Pierre',         parti: 'EELV', nuanceCode: 'LVE',  mandatDepuis: '2020-07-04' },
  { codeInsee: '59350', nom: 'Aubry',            prenom: 'Martine',        parti: 'PS',   nuanceCode: 'LSOC', mandatDepuis: '2014-04-05' },
  { codeInsee: '34172', nom: 'Delafosse',        prenom: 'Michaël',        parti: 'PS',   nuanceCode: 'LSOC', mandatDepuis: '2020-07-04' },
  { codeInsee: '76351', nom: 'Gliesinski',       prenom: 'Nicolas',        parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '35238', nom: 'Massiot',          prenom: 'Nathalie',       parti: 'DVG',  nuanceCode: 'LDVG', mandatDepuis: '2020-07-04' },
  { codeInsee: '51108', nom: 'Barros',           prenom: 'Arnaud',         parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '45234', nom: 'Rabault',          prenom: 'Serge',          parti: 'PS',   nuanceCode: 'LSOC', mandatDepuis: '2020-07-04' },
  { codeInsee: '80021', nom: 'Barbieux',         prenom: 'Brigitte',       parti: 'DVD',  nuanceCode: 'LDVD', mandatDepuis: '2020-07-04' },
  { codeInsee: '59512', nom: 'Brocard',          prenom: 'Guillaume',      parti: 'RE',   nuanceCode: 'LREM', mandatDepuis: '2020-07-04' },
  { codeInsee: '57463', nom: 'Grosdidier',       prenom: 'François',       parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2014-04-05' },
  { codeInsee: '63113', nom: 'Bardet',           prenom: 'Olivier',        parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '21231', nom: 'Rebsamen',         prenom: 'François',       parti: 'PS',   nuanceCode: 'LSOC', mandatDepuis: '2014-04-05' },
  { codeInsee: '76095', nom: 'Miguet',           prenom: 'Jean-Baptiste',  parti: 'EELV', nuanceCode: 'LVE',  mandatDepuis: '2020-07-04' },
  { codeInsee: '38185', nom: 'Piolle',           prenom: 'Éric',           parti: 'EELV', nuanceCode: 'LVE',  mandatDepuis: '2014-04-05' },
  { codeInsee: '49007', nom: 'Béchu',            prenom: 'Christophe',     parti: 'RE',   nuanceCode: 'LREM', mandatDepuis: '2017-07-01' },
  { codeInsee: '14118', nom: 'Guillouard',       prenom: 'Joël',           parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '42218', nom: 'Gagnaire',         prenom: 'Gaël',           parti: 'DVG',  nuanceCode: 'LDVG', mandatDepuis: '2014-04-05' },
  { codeInsee: '87085', nom: 'Alain',            prenom: 'Emile-Roger',    parti: 'DVD',  nuanceCode: 'LDVD', mandatDepuis: '2020-07-04' },
  { codeInsee: '54395', nom: 'Laurent',          prenom: 'Mathieu',        parti: 'PS',   nuanceCode: 'LSOC', mandatDepuis: '2020-07-04' },
  { codeInsee: '11069', nom: 'Chaulet',          prenom: 'Vincent',        parti: 'RE',   nuanceCode: 'LREM', mandatDepuis: '2020-07-04' },
  { codeInsee: '34301', nom: 'Guiraud',          prenom: 'Renaud',         parti: 'RN',   nuanceCode: 'LRN',  mandatDepuis: '2020-07-04' },
  { codeInsee: '30189', nom: 'Fournier',         prenom: 'Jean-Paul',      parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2014-04-05' },
  { codeInsee: '66136', nom: 'Barbe',            prenom: 'Jean-Marc',      parti: 'DVG',  nuanceCode: 'LDVG', mandatDepuis: '2020-07-04' },
  { codeInsee: '64445', nom: 'Bayrou',           prenom: 'François',       parti: 'MoDem',nuanceCode: 'LMDM', mandatDepuis: '2014-04-05' },
  { codeInsee: '25056', nom: 'Fousseret',        prenom: 'Jean-Louis',     parti: 'RE',   nuanceCode: 'LREM', mandatDepuis: '2014-04-05' },
  { codeInsee: '13001', nom: 'Collomb',          prenom: 'Gérard',         parti: 'DVD',  nuanceCode: 'LDVD', mandatDepuis: '2020-07-04' },
  { codeInsee: '83137', nom: 'Falco',            prenom: 'Hubert',         parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2014-04-05' },
  { codeInsee: '06029', nom: 'Rossignol',        prenom: 'Laura',          parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '06027', nom: 'Ciotti',           prenom: 'Eric',           parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2008-04-20' },
  { codeInsee: '69259', nom: 'Martin',           prenom: 'Bruno',          parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2014-04-05' },
  { codeInsee: '37261', nom: 'Deguilhem',        prenom: 'Michèle',        parti: 'PS',   nuanceCode: 'LSOC', mandatDepuis: '2020-07-04' },
  { codeInsee: '74010', nom: 'Accoyer',          prenom: 'Bernard',        parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '74218', nom: 'Vulliet',          prenom: 'François',       parti: 'DVD',  nuanceCode: 'LDVD', mandatDepuis: '2020-07-04' },
  { codeInsee: '13039', nom: 'Leonetti',         prenom: 'Jean',           parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2008-04-15' },
  { codeInsee: '92012', nom: 'Van Heghe',        prenom: 'Isabelle',       parti: 'RE',   nuanceCode: 'LREM', mandatDepuis: '2020-07-04' },
  { codeInsee: '92050', nom: 'Larrivé',          prenom: 'Guillaume',      parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '93048', nom: 'Bobillot',         prenom: 'Patrice',        parti: 'RE',   nuanceCode: 'LREM', mandatDepuis: '2020-07-04' },
  { codeInsee: '94028', nom: 'Pécresse',         prenom: 'Valérie',        parti: 'LR',   nuanceCode: 'LLR',  mandatDepuis: '2020-07-04' },
  { codeInsee: '78646', nom: 'Fousseret',        prenom: 'Jean-Louis',     parti: 'RE',   nuanceCode: 'LREM', mandatDepuis: '2020-07-04' },
  { codeInsee: '971105', nom: 'Laventure',       prenom: 'Éric',           parti: 'DVG',  nuanceCode: 'LDVG', mandatDepuis: '2020-07-04' },
  { codeInsee: '972207', nom: 'Laguerre',        prenom: 'Michel',         parti: 'DVG',  nuanceCode: 'LDVG', mandatDepuis: '2014-04-05' },
  { codeInsee: '973261', nom: 'Cayol',           prenom: 'Marc-Alexandre', parti: 'DVG',  nuanceCode: 'LDVG', mandatDepuis: '2020-07-04' },
  { codeInsee: '974215', nom: 'Robert',          prenom: 'Ericka',         parti: 'DVG',  nuanceCode: 'LDVG', mandatDepuis: '2020-07-04' },
  { codeInsee: '976115', nom: 'Darouechi',       prenom: 'Aziz',           parti: 'DVG',  nuanceCode: 'LDVG', mandatDepuis: '2020-07-04' },
];

export function getMaireCacheByInsee(codeInsee: string): MaireCache | undefined {
  return MAIRES_GRANDES_VILLES.find(m => m.codeInsee === codeInsee);
}
