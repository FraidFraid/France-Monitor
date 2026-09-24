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
    const signals = { criticalNews: 0, highNews: 0, weatherAlerts: 0, floodAlerts: 0, fireDetections: 0, railDisruptions: 0, roadIncidents: 0, powerOutages: 0, telecomOutages: 0, cyberAlerts: 0, militaryFlights: 0, maritimeTrafficFrance: 0, defenseAlerts: 0, jammingSignals: 0, marketStress: 0 };
    const prompt = buildPrompt(72, { continuity: 30, defense: 5, security: 20, signal: 10 }, { social: 0, security: 0, infra: 0 }, 20, 1, ['Un titre'], signals, null, SITUATIONS, sanitizeEvents(EVENTS), 'fr');
    expect(prompt).toContain('S1. [HIGH conf=0.8] Tension énergétique');
    expect(prompt).toContain('E42 [weather/high, 3 source(s), 2 indépendante(s), active] Gironde');
    expect(prompt).toContain('NON citables');
    expect(prompt).toContain('"evidence": ["E123", "S1"]');
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
