// tests/environment-floods-handler-guard.test.ts : une exception inattendue de loadFloods donne un 502 nommé (corps
// FloodsResponse, jamais mis en cache), pas le 500 générique du routeur.
import { describe, expect, it, vi } from 'vitest';
import type { FloodsResponse } from '../src/types/index.ts';
import { callHandler } from './helpers/traffic-fixtures.ts';

vi.mock('../api/_lib/vigicrues.js', () => ({ loadFloods: async () => { throw new TypeError('forme inattendue'); } }));

describe('/api/environment/floods : garde du gestionnaire', () => {
  it('exception inattendue : 502 no-store, corps FloodsResponse, panne nommée', async () => {
    const { default: handler } = await import('../api/_handlers/environment/floods.js');
    const { status, body, cache } = await callHandler<FloodsResponse>(handler);
    expect([status, cache, body.readAt, body.sections, body.errors]).toEqual([502, 'no-store', null, [], ['Crues, erreur inattendue : forme inattendue']]);
  });
});
