import { describe, it, expect, vi, afterEach } from 'vitest';
import { settleWithin } from './settle-within.ts';

describe('settleWithin (relecture finale #5)', () => {
  afterEach(() => vi.useRealTimers());

  it('rend la valeur de repli si la promesse ne se règle pas à temps, sans l’annuler', async () => {
    vi.useFakeTimers();
    let resolveLate: (v: string) => void = () => {};
    const late = new Promise<string>((r) => { resolveLate = r; });
    const bounded = settleWithin(late, 8_000, 'repli');
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await bounded).toBe('repli');
    resolveLate('tardif');
    expect(await late).toBe('tardif');
  });

  it('rend la valeur si la promesse se règle avant le délai', async () => {
    expect(await settleWithin(Promise.resolve('à temps'), 8_000, 'repli')).toBe('à temps');
  });

  it('rend la valeur de repli si la promesse échoue', async () => {
    expect(await settleWithin(Promise.reject(new Error('panne')), 8_000, 'repli')).toBe('repli');
  });
});
