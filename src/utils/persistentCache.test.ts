import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readPersisted, writePersisted, clearPersisted } from './persistentCache.ts';

/** Stub minimal de localStorage — l'environnement de test vitest est 'node'. */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, value); }
}

describe('persistentCache', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.useRealTimers();
  });

  it('écrit puis relit une valeur fraîche', () => {
    writePersisted('ecowatt', { signals: { A: 'green' } });
    const value = readPersisted<{ signals: Record<string, string> }>('ecowatt', 10 * 60_000);
    expect(value).toEqual({ signals: { A: 'green' } });
  });

  it('renvoie null si rien n\'a été écrit', () => {
    expect(readPersisted('absent', 10_000)).toBeNull();
  });

  it('renvoie null et purge l\'entrée si elle dépasse maxAgeMs', () => {
    const realNow = Date.now;
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    writePersisted('vigilance', { alerts: [] });
    now += 11 * 60_000; // 11 min plus tard, TTL 10 min
    expect(readPersisted('vigilance', 10 * 60_000)).toBeNull();

    // L'entrée périmée a été supprimée — un second appel reste null sans effet de bord.
    expect(readPersisted('vigilance', 10 * 60_000)).toBeNull();

    Date.now = realNow;
  });

  it('rejette (et purge) une valeur qui ne passe pas `validate`', () => {
    writePersisted('vigicrues', { unexpected: true });
    const isSegmentArray = (v: unknown): v is Array<{ id: string }> => Array.isArray(v);

    expect(readPersisted('vigicrues', 60_000, isSegmentArray)).toBeNull();
    // Purgé : même sans validate, l'entrée corrompue a été retirée.
    expect(readPersisted('vigicrues', 60_000)).toBeNull();
  });

  it('accepte une valeur qui passe `validate`', () => {
    writePersisted('vigicrues', [{ id: 'a' }]);
    const isSegmentArray = (v: unknown): v is Array<{ id: string }> => Array.isArray(v);
    expect(readPersisted('vigicrues', 60_000, isSegmentArray)).toEqual([{ id: 'a' }]);
  });

  it('ignore silencieusement une valeur trop volumineuse (> 300 Ko)', () => {
    const huge = { blob: 'x'.repeat(400_000) };
    writePersisted('huge', huge);
    expect(readPersisted('huge', 60_000)).toBeNull();
  });

  it('clearPersisted supprime une entrée existante', () => {
    writePersisted('nuclear', { items: [] });
    clearPersisted('nuclear');
    expect(readPersisted('nuclear', 60_000)).toBeNull();
  });

  it('ne lève jamais même si localStorage explose (quota, mode privé)', () => {
    const throwingStorage: Storage = {
      length: 0,
      clear: () => {},
      getItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
      key: () => null,
      removeItem: () => { throw new Error('boom'); },
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    };
    vi.stubGlobal('localStorage', throwingStorage);

    expect(() => writePersisted('k', { a: 1 })).not.toThrow();
    expect(() => readPersisted('k', 1000)).not.toThrow();
    expect(readPersisted('k', 1000)).toBeNull();
  });

  it('ne lève pas quand localStorage est totalement absent (SSR)', () => {
    vi.unstubAllGlobals();
    expect(() => readPersisted('k', 1000)).not.toThrow();
    expect(readPersisted('k', 1000)).toBeNull();
    expect(() => writePersisted('k', { a: 1 })).not.toThrow();
  });

  it('ignore une entrée d\'une version de schéma différente', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem('fm:pc:v1:legacy', JSON.stringify({ v: 0, savedAt: Date.now(), value: 'old-shape' }));
    expect(readPersisted('legacy', 60_000)).toBeNull();
  });
});
