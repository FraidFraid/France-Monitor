// src/components/anticipation/fixture.test-data.ts : réponse fictive de /api/anticipation/now pour les tests de l'onglet Anticipation.
// Mercredi 4 novembre 2026, heure de Paris = UTC+1.
import type { AnticipationNowResponse, AnticipationScenario } from '../../types/index.ts';

export const LYON: AnticipationScenario = {
  id: 'sc-lyon',
  ruleId: 'mobilisation-transports',
  ruleVersion: 1,
  zone: { dept: ['69'], communes: ['Lyon'] },
  window: { from: '2026-11-04T13:00:00Z', to: '2026-11-04T21:00:00Z' },
  title: 'Foule bloquée ou débordements en fin de cortège',
  chain: [
    { text: '3 rassemblements annoncés ou signalés dans le Rhône, cet après-midi', signalIds: ['s-cgt', 's-demo'] },
    { text: '1 perturbation de transport relevée dans le même département, même demi-journée', signalIds: ['s-sncf'] },
    { text: 'Hypothèse : foule bloquée si les transports restent perturbés', signalIds: [] },
  ],
  word: 'probable',
  peakWord: 'probable',
  why: '3 sources indépendantes, précédent du 12/10',
  unknowns: ['Effectifs réels engagés : aucune donnée publique', 'Arrêté préfectoral : pas encore publié'],
  bascules: [
    { id: 'affluence', label: 'Plus de 15\u00a0000 participants signalés', state: 'atteint', at: '2026-11-04T12:10:00Z' },
    { id: 'arrete', label: 'Arrêté préfectoral publié', state: 'surveille', at: null },
  ],
  disconfirmers: ['Préavis de grève levé'],
  verify: ['Effectifs auprès de la DDPN du Rhône'],
  openedAt: '2026-11-04T08:40:00Z',
  revisedAt: '2026-11-04T12:10:00Z',
  status: 'ouvert',
  closedAt: null,
  outcomeNote: null,
  feedback: { utile: 0, deja_su: 0, faux: 0 },
};

export const CARBURANT: AnticipationScenario = {
  ...LYON,
  id: 'sc-carburant',
  ruleId: 'greve-carburant',
  zone: { dept: [], communes: [] },
  window: { from: '2026-11-05T06:00:00Z', to: '2026-11-05T20:00:00Z' },
  title: 'Tensions sur le carburant',
  chain: [{ text: 'Grève dans deux raffineries', signalIds: ['s-fuel'] }],
  word: 'peu_probable',
  peakWord: 'peu_probable',
  why: '2 sources indépendantes',
  unknowns: [],
  bascules: [],
  openedAt: '2026-11-03T08:00:00Z',
  revisedAt: '2026-11-03T08:00:00Z',
};

export const FIXTURE: AnticipationNowResponse = {
  generatedAt: '2026-11-04T12:30:00Z',
  beta: true,
  scenarios: [LYON, CARBURANT],
  agenda: [
    {
      day: '2026-11-04',
      halves: [
        { half: 'matin', scenarioIds: [] },
        { half: 'apres-midi', scenarioIds: ['sc-lyon'] },
        { half: 'soir', scenarioIds: [] },
      ],
      scenarioIds: ['sc-lyon'],
      deadlines: [],
    },
    { day: '2026-11-05', scenarioIds: ['sc-carburant'], deadlines: [] },
    { day: '2026-11-06', scenarioIds: [], deadlines: [{ day: '2026-11-06', level: 'vert', title: 'Écowatt vert', detail: null, source: 'RTE' }] },
    { day: '2026-11-07', scenarioIds: [], deadlines: [] },
    { day: '2026-11-08', scenarioIds: [], deadlines: [] },
    { day: '2026-11-09', scenarioIds: [], deadlines: [] },
    { day: '2026-11-10', scenarioIds: [], deadlines: [] },
  ],
  signals: {
    's-cgt': { id: 's-cgt', domain: 'social', kind: 'rassemblement_annonce', source: 'cgt', origin: 'cgt', official: false, dept: ['69'], communes: ['Lyon'], level: null, value: null, window: null, publishedAt: '2026-11-04T07:55:00Z', observedAt: '2026-11-04T07:55:00Z', checkedAt: '2026-11-04T12:00:00Z', ref: 'x' },
    's-demo': { id: 's-demo', domain: 'social', kind: 'rassemblement_annonce', source: 'demosphere', origin: 'demosphere', official: false, dept: ['69'], communes: ['Lyon'], level: null, value: null, window: null, publishedAt: '2026-11-04T07:50:00Z', observedAt: '2026-11-04T07:50:00Z', checkedAt: '2026-11-04T12:00:00Z', ref: 'y' },
    's-sncf': { id: 's-sncf', domain: 'transport', kind: 'perturbation_sncf', source: 'sncf', origin: 'sncf', official: true, dept: ['69'], communes: [], level: null, value: null, window: null, publishedAt: '2026-11-04T06:30:00Z', observedAt: '2026-11-04T06:30:00Z', checkedAt: '2026-11-04T12:00:00Z', ref: 'z' },
    's-fuel': { id: 's-fuel', domain: 'fuel', kind: 'tension_carburant', source: 'prix-carburants', origin: 'prix-carburants', official: true, dept: [], communes: [], level: null, value: 0.08, window: null, publishedAt: null, observedAt: '2026-11-03T07:00:00Z', checkedAt: '2026-11-04T12:00:00Z', ref: 'national' },
  },
  unknown: [],
  errors: [],
};
