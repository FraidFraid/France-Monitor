import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import handler, { validateBriefShape, buildPrompt, describeStability } from '../api/_handlers/intelligence/v1/france-intel-brief.js';
import { levelVigilanceWord, scoreLevel } from '../src/services/vigilance.ts';
// @ts-expect-error — module JS sans déclaration de types
import { sanitizeEvents, buildEvidenceIndex } from '../api/_lib/brief-evidence.js';

const EVENTS = [{ id: 'E42', title: 'Gironde : plan ORSEC déclenché après des inondations', category: 'weather', severity: 'high', sources: ['Sud Ouest', 'France Info'], sourceCount: 3, independentCount: 2, lastSeen: '2026-09-23T06:00:00Z', status: 'active' }];
const SITUATIONS = [{ type: 'ENERGY_STRESS', severity: 'high', confidence: 0.8, title: 'Tension énergétique', summary: 'Ecowatt orange', drivers: [], sourceRefs: ['Ecowatt RTE'], affectedZones: [] }];
const index = buildEvidenceIndex(sanitizeEvents(EVENTS), SITUATIONS);
const BLUF = 'Pression concentrée sur la Gironde, sans convergence nationale à ce stade.';

describe('validateBriefShape v14', () => {
  it('déduit les sources des preuves et signale les jugements non étayés', () => {
    const brief = validateBriefShape({
      bluf: BLUF,
      judgments: [
        { priority: 2, text: 'Crue durable en Gironde.', confidence: 'high', evidence: ['E42'], sources: ['Le Progrès'] },
        { priority: 1, text: 'Affirmation sans preuve.', confidence: 'high', evidence: ['E999'] },
      ],
      watch: [],
    }, index);
    expect(brief.judgments).toEqual([
      { priority: 1, text: 'Affirmation sans preuve.', confidence: 'low', evidence: [], sources: [], unsupported: true },
      { priority: 2, text: 'Crue durable en Gironde.', confidence: 'high', evidence: ['E42'], sources: ['Sud Ouest', 'France Info'], unsupported: false },
    ]);
  });

  it('rejette un brief dont aucun jugement n’est étayé alors que des preuves existaient', () => {
    const raw = { bluf: BLUF, judgments: [{ priority: 1, text: 'Rien de cité.', confidence: 'moderate' }], watch: [] };
    expect(validateBriefShape(raw, index)).toBeNull();
    expect(validateBriefShape(raw, new Map())).not.toBeNull();
  });
});

describe('buildPrompt v14', () => {
  it('liste les preuves citables E… et S… et déclare les titres non citables', () => {
    const signals = { criticalNews: 0, highNews: 0, weatherAlerts: 0, floodAlerts: 0, fireDetections: 0, railDisruptions: 0, roadIncidents: 0, telecomOutages: 0, cyberAlerts: 0, militaryFlights: 0, maritimeTrafficFrance: 0, defenseAlerts: 0, jammingSignals: 0, marketStress: 0 };
    const prompt = buildPrompt(72, { continuity: 30, defense: 5, security: 20, signal: 10 }, { social: 0, security: 0, infra: 0 }, 20, 1, ['Un titre'], signals, null, SITUATIONS, sanitizeEvents(EVENTS), 'fr');
    expect(prompt).toContain('S1. [HIGH conf=0.8] Tension énergétique');
    expect(prompt).toContain('E42 [weather/high, 3 source(s), 2 indépendante(s), active] Gironde');
    expect(prompt).toContain('NON citables');
    expect(prompt).toContain('"evidence": ["E123", "S1"]');
  });
  it('souveraineté (arbitrage 25 ; amendement 7, O6, O8, O9, O15) : compte d’aéronefs jamais sans « compte habituel, pas un événement »', () => {
    const signals = { criticalNews: 0, highNews: 0, weatherAlerts: 0, floodAlerts: 0, fireDetections: 0, railDisruptions: 0, roadIncidents: 0, telecomOutages: 0, cyberAlerts: 6, cyberOpenAlerts: 3, cyberKevAdvisories: 3, militaryFlights: 9, maritimeTrafficFrance: 0, defenseAlerts: 1, jammingSignals: 2, marketStress: 0 };
    const fr = buildPrompt(72, { continuity: 30, defense: 5, security: 20, signal: 10 }, { social: 0, security: 0, infra: 0 }, 28, 0, [], signals, null, [], [], 'fr');
    expect(fr).toContain('9 aéronefs militaires ou d’État visibles en ADS-B au-dessus de la métropole (adsb.lol) : compte habituel, pas un événement');
    expect(fr).toContain('1 navire lent confirmé sur un câble, 2 mailles à précision GNSS dégradée, 9 aéronefs militaires ou d’État visibles en ADS-B au-dessus de la métropole (compte habituel, pas un événement)');
    expect(fr).toContain('1 navire lent confirmé sur un câble\n2 mailles à précision GNSS dégradée');
    // m1 : alertes en cours et avis KEV dits à part, même chiffre que la tuile (3).
    expect(fr).toContain('3 alertes CERT-FR en cours ; 3 avis citant une vulnérabilité KEV ajoutée depuis moins de 7 jours');
    expect(fr).not.toContain('6 alertes');
    // Chaque compte d'aéronefs cité est suivi de la mention (O8).
    for (const m of fr.matchAll(/\d+ aéronefs? militaires?[^\n]*/g)) expect(m[0]).toContain('compte habituel, pas un événement');
    expect(fr).not.toMatch(/vols militaires|alertes défense|brouillages? GPS|au-dessus de la France|[Ff]aille|non évalu|\u2014/);
    const en = buildPrompt(72, { continuity: 30, defense: 5, security: 20, signal: 10 }, { social: 0, security: 0, infra: 0 }, 28, 0, [], signals, null, [], [], 'en');
    expect(en).toContain('9 military or state aircraft visible on ADS-B over metropolitan France (adsb.lol): usual count, not an event');
    expect(en).toContain('1 slow vessel confirmed on a cable\n2 cells with degraded GNSS accuracy');
    expect(en).toContain('3 CERT-FR alerts in progress; 3 advisories citing a KEV vulnerability added in the last 7 days');
    for (const m of en.matchAll(/\d+ military[^\n]*/g)) expect(m[0]).toContain('usual count, not an event');
    expect(en).not.toMatch(/military flights|GPS jamming|defense alerts|over France\b/);
  });
  it('accords de l’invite (revue finale M3) : « 1 maille », « 1 titre critique », « 1 feu » ; anglais au pluriel à 0', () => {
    const signals = { criticalNews: 1, highNews: 1, weatherAlerts: 1, floodAlerts: 2, fireDetections: 1, railDisruptions: 1, roadIncidents: 1, telecomOutages: 1, cyberAlerts: 0, cyberOpenAlerts: 0, cyberKevAdvisories: 0, militaryFlights: 1, maritimeTrafficFrance: 0, defenseAlerts: 0, jammingSignals: 1, marketStress: 1 };
    const axes = { continuity: 10, defense: 5, security: 10, signal: 10 };
    const isnr = { social: 0, security: 0, infra: 0 };
    const fr = buildPrompt(80, axes, isnr, 0, 1, [], signals, null, [], [], 'fr');
    for (const text of [
      'Signaux : 1 titre critique / 1 élevé, 1 rail, 1 route, 1 télécom, 0 navire lent confirmé sur un câble, 1 maille à précision GNSS dégradée',
      '1 feu, 1 ligne marché sous tension', '1 alerte météo sévère + 2 alertes crues actives', '1 incident télécom récent',
      '1 détection de feu actif', '1 maille à précision GNSS dégradée\n',
    ]) expect(fr).toContain(text);
    expect(fr).not.toMatch(/\b1 (?:mailles|titres|feux|coupures|lignes|alertes|incidents|détections|perturbations)\b/);
    const en = buildPrompt(80, axes, isnr, 0, 1, [], signals, null, [], [], 'en');
    for (const text of [
      '1 critical / 1 high headline, 1 rail, 1 road, 1 telecom, 0 slow vessels confirmed on a cable, 1 cell with degraded GNSS accuracy',
      '1 fire, 1 stressed market line', '1 severe weather alert + 2 active flood alerts', '1 active fire detection',
    ]) expect(en).toContain(text);
  });
  it('sources Souveraineté non lues (S3) : « non évalué », jamais « 0 » envoyé au modèle ; aucun mot calme permis', () => {
    const signals = { criticalNews: 0, highNews: 0, weatherAlerts: 0, floodAlerts: 0, fireDetections: 0, railDisruptions: 0, roadIncidents: 0, telecomOutages: 0, cyberAlerts: 0, cyberOpenAlerts: 0, cyberKevAdvisories: 0, militaryFlights: 0, maritimeTrafficFrance: 0, defenseAlerts: 0, jammingSignals: 0, marketStress: 0, militaryUnavailable: true, cablesUnavailable: true, gnssUnavailable: true, cyberUnavailable: true, kevUnavailable: true };
    const axes = { continuity: 0, defense: 0, security: 0, signal: 0 };
    const isnr = { social: 0, security: 0, infra: 0 };
    const fr = buildPrompt(95, axes, isnr, null, 0, [], signals, null, [], [], 'fr');
    for (const text of [
      'navires lents sur un câble non évalués, précision GNSS non évaluée, aéronefs militaires ou d’État visibles en ADS-B non évalués',
      'navires lents sur les câbles : non évalué (veille AIS muette ou en retard)', 'précision GNSS : non évaluée (grille absente, en retard, en dégradation générale, ou mesurée depuis moins de 24 h sans maille dégradée)',
      'alertes CERT-FR : non évaluées (CERT-FR indisponible ou en retard)',
      'aéronefs militaires ou d’État visibles en ADS-B : non évalué (relevé adsb.lol indisponible ou en retard)',
    ]) expect(fr).toContain(text);
    expect(fr).not.toMatch(/\b0 (?:alertes câbles|mailles?|aéronefs?|navires?)/);
    expect(fr).toContain('Vocabulaire calme (stable/calme/normal/sous contrôle) : INTERDIT');
    const en = buildPrompt(95, axes, isnr, null, 0, [], signals, null, [], [], 'en');
    expect(en).toContain('slow vessels on a cable not assessed, GNSS accuracy not assessed, military or state aircraft visible on ADS-B not assessed');
    expect(en).not.toMatch(/\b0 (?:confirmed cable|cells?|military)/);
    expect(en).toContain('Calm wording (stable/calm/normal/under control) is FORBIDDEN');
    // Phase B (tâche B28) : la grille GNSS branchée entre dans la règle ; seule non lue (absente, en retard, dégradation générale), elle
    // interdit aussi le calme ; lue et sans maille, le calme redevient permis.
    const read = { ...signals, militaryUnavailable: false, cablesUnavailable: false, cyberUnavailable: false, kevUnavailable: false };
    const gnssOnly = buildPrompt(95, axes, isnr, 0, 0, [], read, null, [], [], 'fr');
    expect(gnssOnly).toContain('0 navire lent confirmé sur un câble, précision GNSS non évaluée, 0 aéronef militaire ou d’État visible en ADS-B au-dessus de la métropole (compte habituel, pas un événement)');
    expect(gnssOnly).toContain('Vocabulaire calme (stable/calme/normal/sous contrôle) : INTERDIT');
    const all = buildPrompt(95, axes, isnr, 0, 0, [], { ...read, gnssUnavailable: false }, null, [], [], 'fr');
    expect(all).toContain('0 navire lent confirmé sur un câble, 0 maille à précision GNSS dégradée');
    expect(all).toContain('Vocabulaire calme (stable/calme/normal/sous contrôle) : autorisé');
  });
  it('signalCounts reçus : drapeaux de sources non lues et comptes cyber séparés repris, jamais inventés', async () => {
    vi.stubEnv('GROQ_API_KEY', 'test-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bluf: 'x', judgments: [], watch: [] }) } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = {
      countryScore: 90, axes: { continuity: 0, defense: 0, security: 0, signal: 0 }, isnrComponents: {}, cyberScore: null, meteoAlertCount: 0, topHeadlines: [],
      signalCounts: { cyberAlerts: 6, cyberOpenAlerts: 3, cyberKevAdvisories: 3, militaryFlights: 0, defenseAlerts: 0, jammingSignals: 0, militaryUnavailable: true, cablesUnavailable: 'oui', gnssUnavailable: true },
      situations: [], events: [], lang: 'fr',
    };
    let sent = '';
    try {
      await handler(new Request('http://localhost/api/intelligence/v1/france-intel-brief', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
      sent = String((JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)) as { messages: Array<{ content: string }> }).messages[0]?.content);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
    expect(sent).toContain('aéronefs militaires ou d’État visibles en ADS-B : non évalué');
    expect(sent).toContain('précision GNSS : non évaluée');
    // Un drapeau mal formé n'est jamais lu comme « non lu » : seul `true` compte.
    expect(sent).toContain('0 navire lent confirmé sur un câble');
    expect(sent).toContain('3 alertes CERT-FR en cours ; 3 avis citant une vulnérabilité KEV ajoutée depuis moins de 7 jours');
    expect(sent).toContain('Pression cyber : non évaluée');
  });
  it('mailles comptées sur une mesure partielle (report 10 de la revue finale) : « (mesure partielle de N h) », lu par le gestionnaire', async () => {
    const signals = { criticalNews: 0, highNews: 0, weatherAlerts: 0, floodAlerts: 0, fireDetections: 0, railDisruptions: 0, roadIncidents: 0, telecomOutages: 0, cyberAlerts: 0, militaryFlights: 0, maritimeTrafficFrance: 0, defenseAlerts: 0, jammingSignals: 3, marketStress: 0, gnssPartialHours: 5 };
    const axes = { continuity: 0, defense: 0, security: 0, signal: 0 };
    const isnr = { social: 0, security: 0, infra: 0 };
    const fr = buildPrompt(80, axes, isnr, 0, 0, [], signals, null, [], [], 'fr');
    expect(fr).toContain('0 navire lent confirmé sur un câble, 3 mailles à précision GNSS dégradée (mesure partielle de 5 h), ');
    expect(fr).toContain('3 mailles à précision GNSS dégradée (mesure partielle de 5 h)\n');
    expect(buildPrompt(80, axes, isnr, 0, 0, [], signals, null, [], [], 'en')).toContain('3 cells with degraded GNSS accuracy (partial measurement, 5 h)');
    // Sur 24 h : aucune mention.
    expect(buildPrompt(80, axes, isnr, 0, 0, [], { ...signals, gnssPartialHours: null }, null, [], [], 'fr')).not.toContain('mesure partielle');
    vi.stubEnv('GROQ_API_KEY', 'test-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bluf: 'x', judgments: [], watch: [] }) } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = {
      countryScore: 80, axes, isnrComponents: {}, cyberScore: 0, meteoAlertCount: 0, topHeadlines: [],
      signalCounts: { jammingSignals: 3, gnssPartialHours: 5 }, situations: [], events: [], lang: 'fr',
    };
    let sent = '';
    try {
      await handler(new Request('http://localhost/api/intelligence/v1/france-intel-brief', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
      sent = String((JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)) as { messages: Array<{ content: string }> }).messages[0]?.content);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
    expect(sent).toContain('3 mailles à précision GNSS dégradée (mesure partielle de 5 h)');
  });
  it('pannes (spec 2026-10-08 § 2.3) : 18 pannes télécom récentes dites « 18 incidents télécom », sans électricité ; un ancien client qui envoie powerOutages n’y change rien', () => {
    const base = { criticalNews: 0, highNews: 0, weatherAlerts: 0, floodAlerts: 0, fireDetections: 0, railDisruptions: 0, roadIncidents: 0, telecomOutages: 18, cyberAlerts: 0, militaryFlights: 0, maritimeTrafficFrance: 0, defenseAlerts: 0, jammingSignals: 0, marketStress: 0 };
    const axes = { continuity: 10, defense: 5, security: 10, signal: 10 };
    const isnr = { social: 0, security: 0, infra: 0 };
    for (const signals of [base, { ...base, powerOutages: 7 }]) {
      const fr = buildPrompt(80, axes, isnr, 0, 0, [], signals, null, [], [], 'fr');
      expect(fr).toContain('18 incidents télécom');
      expect(fr).not.toMatch(/coupure/);
      const en = buildPrompt(80, axes, isnr, 0, 0, [], signals, null, [], [], 'en');
      expect(en).toContain('18 recent telecom incidents');
      expect(en).not.toMatch(/power outage/);
    }
  });
  it('télécom non lu (S3) : « télécom non évalué » / « telecom not assessed », jamais « 0 télécom », et pas un signal calme', () => {
    const signals = { criticalNews: 0, highNews: 0, weatherAlerts: 0, floodAlerts: 0, fireDetections: 0, railDisruptions: 0, roadIncidents: 0, telecomOutages: 0, telecomUnavailable: true, cyberAlerts: 0, militaryFlights: 0, maritimeTrafficFrance: 0, defenseAlerts: 0, jammingSignals: 0, marketStress: 0 };
    const axes = { continuity: 10, defense: 5, security: 10, signal: 10 };
    const isnr = { social: 0, security: 0, infra: 0 };
    const fr = buildPrompt(80, axes, isnr, 0, 0, [], signals, null, [], [], 'fr');
    expect(fr).toContain('télécom non évalué');
    expect(fr).not.toContain('0 télécom');
    const en = buildPrompt(80, axes, isnr, 0, 0, [], signals, null, [], [], 'en');
    expect(en).toContain('telecom not assessed');
    expect(en).not.toMatch(/0 telecom/);
    // Lu à 0 : « 0 télécom » reste dit.
    expect(buildPrompt(80, axes, isnr, 0, 0, [], { ...signals, telecomUnavailable: false }, null, [], [], 'fr')).toContain('0 télécom');
    // Le vocabulaire calme n'est autorisé que si le télécom a été lu à 0.
    const calmAxes = { continuity: 0, defense: 0, security: 0, signal: 0 };
    expect(buildPrompt(95, calmAxes, isnr, 0, 0, [], { ...signals, telecomUnavailable: false }, null, [], [], 'fr')).toContain('autorisé');
    expect(buildPrompt(95, calmAxes, isnr, 0, 0, [], signals, null, [], [], 'fr')).toContain('INTERDIT');
  });
  it('CERT-FR indisponible ou en retard : pression cyber « non évaluée », jamais « faible » (une absence n’est pas un calme)', () => {
    const signals = { criticalNews: 0, highNews: 0, weatherAlerts: 0, floodAlerts: 0, fireDetections: 0, railDisruptions: 0, roadIncidents: 0, telecomOutages: 0, cyberAlerts: 0, militaryFlights: 0, maritimeTrafficFrance: 0, defenseAlerts: 0, jammingSignals: 0, marketStress: 0 };
    const axes = { continuity: 0, defense: 0, security: 0, signal: 0 };
    const isnr = { social: 0, security: 0, infra: 0 };
    expect(buildPrompt(95, axes, isnr, null, 0, [], signals, null, [], [], 'fr')).toContain('Pression cyber : non évaluée (CERT-FR indisponible ou en retard)');
    expect(buildPrompt(95, axes, isnr, null, 0, [], signals, null, [], [], 'en')).toContain('Cyber pressure: not assessed (CERT-FR unavailable or late)');
    expect(buildPrompt(95, axes, isnr, 0, 0, [], signals, null, [], [], 'fr')).toContain('Pression cyber : faible');
  });
});

describe('handler v14 (Groq simulé)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('envoie les événements au modèle et renvoie des sources déduites des preuves', async () => {
    vi.stubEnv('GROQ_API_KEY', 'test');
    const groqReply = { bluf: BLUF, judgments: [{ priority: 1, text: 'Crue durable en Gironde.', confidence: 'high', evidence: ['E42', 'S1'] }], watch: [{ text: 'Vigicrues Garonne', horizon: '6h' }] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(groqReply) } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const res = await handler(new Request('http://localhost/api/intelligence/v1/france-intel-brief', {
      method: 'POST',
      body: JSON.stringify({ countryScore: 72, situations: SITUATIONS, events: EVENTS, lang: 'fr' }),
    }));
    const payload = await res.json() as { brief: { judgments: Array<{ sources: string[]; evidence: string[] }> } };
    expect(payload.brief.judgments[0]).toMatchObject({ evidence: ['E42', 'S1'], sources: ['Sud Ouest', 'France Info', 'Ecowatt RTE'] });
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { messages: Array<{ content: string }> };
    expect(sent.messages[0].content).toContain('E42 [weather/high');
  });
});

describe('describeStability v15 (échelle L1)', () => {
  it('suit scoreLevel pour chaque score de 0 à 100, en français et en anglais', () => {
    for (let s = 0; s <= 100; s += 1) {
      expect(describeStability(s, 'fr')).toBe(levelVigilanceWord(scoreLevel(s), 'fr'));
      expect(describeStability(s, 'en')).toBe(levelVigilanceWord(scoreLevel(s), 'en'));
    }
  });
});
