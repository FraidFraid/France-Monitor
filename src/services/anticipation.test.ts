// anticipation.test.ts : service client de l'anticipation (04/11/2026).
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAnticipationBilan,
  fetchAnticipationNote,
  fetchAnticipationNow,
  readAnticipationVote,
  resetAnticipationCache,
  sendAnticipationFeedback,
} from './anticipation.ts';
import { resetBreakerState } from '../utils/fetch-with-breaker.ts';
import { ALL_WORDS, V1_WORDS, WORD_COLOR_VAR, WORD_LABEL, WORD_RANGE } from './anticipation-words.ts';
import * as server from '../../api/_lib/anticipation/probability.js';

const NOW = {
  generatedAt: '2026-11-04T08:00:00.000Z',
  beta: true,
  scenarios: [],
  agenda: [],
  signals: {},
  unknown: [],
  errors: [],
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  resetBreakerState();
  resetAnticipationCache();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('words mirror server', () => {
  it('étiquettes, fourchettes et ordre identiques au serveur', () => {
    expect([...ALL_WORDS]).toEqual([...server.WORDS]);
    expect([...V1_WORDS]).toEqual([...server.V1_WORDS]);
    expect(WORD_LABEL).toEqual(server.WORD_LABEL);
    expect(WORD_RANGE).toEqual(server.WORD_RANGE);
  });
  it('une couleur par mot v1', () => {
    expect(Object.keys(WORD_COLOR_VAR).sort()).toEqual([...V1_WORDS].sort());
  });
});

describe('fetch', () => {
  it('lit /api/anticipation/now', async () => {
    const f = vi.fn().mockResolvedValue(json(NOW));
    vi.stubGlobal('fetch', f);
    expect((await fetchAnticipationNow()).generatedAt).toBe(NOW.generatedAt);
    expect(f.mock.calls[0][0]).toBe('/api/anticipation/now');
  });

  it('breaker serves last good after 3 failures', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(NOW)).mockRejectedValue(new Error('réseau'));
    vi.stubGlobal('fetch', f);
    await fetchAnticipationNow();
    for (let i = 0; i < 3; i++) {
      const r = await fetchAnticipationNow();
      expect(r.generatedAt).toBe(NOW.generatedAt);
    }
    const calls = f.mock.calls.length;
    const r = await fetchAnticipationNow(); // circuit ouvert : plus d'appel réseau
    expect(r.generatedAt).toBe(NOW.generatedAt);
    expect(f.mock.calls.length).toBe(calls);
  });

  it('lève sans réponse mémorisée', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau')));
    await expect(fetchAnticipationNow()).rejects.toThrow();
  });

  it('note et bilan passent le jour et le mois ; note absente donne null', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ error: 'note absente' }, 404)).mockResolvedValueOnce(json({ month: '2026-10' }));
    vi.stubGlobal('fetch', f);
    expect(await fetchAnticipationNote('2026-11-04')).toBeNull();
    expect(f.mock.calls[0][0]).toBe('/api/anticipation/note?day=2026-11-04');
    await fetchAnticipationBilan('2026-10');
    expect(f.mock.calls[1][0]).toBe('/api/anticipation/bilan?month=2026-10');
  });
});

describe('feedback', () => {
  it('second vote returns deja', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);
    expect(await sendAnticipationFeedback('s1', 'utile')).toBe('ok');
    expect(readAnticipationVote('s1')).toBe('utile');
    expect(await sendAnticipationFeedback('s1', 'faux')).toBe('deja');
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(f.mock.calls[0][1].body))).toEqual({ scenarioId: 's1', vote: 'utile' });
  });

  it('429 donne deja et mémorise le vote', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429 })));
    expect(await sendAnticipationFeedback('s2', 'deja_su')).toBe('deja');
    expect(readAnticipationVote('s2')).toBe('deja_su');
  });

  it('400 et panne réseau donnent erreur sans mémoriser', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    expect(await sendAnticipationFeedback('s3', 'utile')).toBe('erreur');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau')));
    expect(await sendAnticipationFeedback('s3', 'utile')).toBe('erreur');
    expect(readAnticipationVote('s3')).toBeNull();
  });

  it('localStorage indisponible : ne lève pas', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(readAnticipationVote('s4')).toBeNull();
    expect(await sendAnticipationFeedback('s4', 'utile')).toBe('ok');
  });
});
