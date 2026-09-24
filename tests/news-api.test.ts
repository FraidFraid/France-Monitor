// tests/news-api.test.ts
// Tests des fonctions pures de api/_handlers/news.js (pas de connexion Neon :
// `queryNews` appelle `neon(databaseUrl)` directement, donc on teste ici la
// dérivation de `scoredBy` et le mapping ligne SQL → item de réponse, qui
// portent toute la logique des nouveaux champs Jev).

import { describe, it, expect } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { scoredByFromVersion, mapNewsRow, parseDateParam } from '../api/_handlers/news.js';

describe('scoredByFromVersion', () => {
  it('kw-1 → keywords', () => expect(scoredByFromVersion('kw-1')).toBe('keywords'));
  it('groq-1 → groq', () => expect(scoredByFromVersion('groq-1')).toBe('groq'));
  it('jev-1 → jev', () => expect(scoredByFromVersion('jev-1')).toBe('jev'));
  it('version inconnue → null', () => expect(scoredByFromVersion('error')).toBeNull());
  it('null/undefined/vide → null', () => {
    expect(scoredByFromVersion(null)).toBeNull();
    expect(scoredByFromVersion(undefined)).toBeNull();
    expect(scoredByFromVersion('')).toBeNull();
  });
});

describe('mapNewsRow', () => {
  const BASE_ROW = {
    id: 42,
    feed_id: 'le-monde',
    feed_name: 'Le Monde',
    feed_region: null,
    tier: 1,
    title: 'Titre',
    link: 'https://example.fr/a',
    description: 'Résumé',
    published_at: '2026-09-22T06:00:00Z',
    collected_at: '2026-09-22T06:05:00Z',
    category: 'security',
    severity: 'high',
    confidence: 0.85,
    lat: 48.85,
    lon: 2.35,
    classifier_version: 'kw-1',
  };

  it('ligne sans colonnes Jev (avant migration) → champs Jev à null, scoredBy dérivé de classifier_version', () => {
    const item = mapNewsRow(BASE_ROW);
    expect(item.scoredBy).toBe('keywords');
    expect(item.relevance).toBeNull();
    expect(item.noise).toBeNull();
    expect(item.alertable).toBeNull();
    expect(item.scope).toBeNull();
    expect(item.id).toBe(42);
    expect(item.category).toBe('security');
  });

  it('ligne scorée par Jev (colonnes to_jsonb en texte) → champs Jev typés', () => {
    const item = mapNewsRow({
      ...BASE_ROW,
      classifier_version: 'jev-1',
      relevance: '0.75', // to_jsonb(n)->>'relevance' renvoie du texte
      is_noise: 'false',
      alertable: 'true',
      scope: 'departement',
    });
    expect(item.scoredBy).toBe('jev');
    expect(item.relevance).toBe(0.75);
    expect(item.noise).toBe(false);
    expect(item.alertable).toBe(true);
    expect(item.scope).toBe('departement');
  });

  it('is_noise=true exclut logiquement l\'item (le champ est bien porté, le filtrage est côté SQL)', () => {
    const item = mapNewsRow({ ...BASE_ROW, classifier_version: 'jev-1', is_noise: 'true' });
    expect(item.noise).toBe(true);
  });

  it('scoredBy=groq quand classifier_version=groq-1', () => {
    const item = mapNewsRow({ ...BASE_ROW, classifier_version: 'groq-1' });
    expect(item.scoredBy).toBe('groq');
  });

  it('id/lat/lon numériques même transmis en texte (driver SQL)', () => {
    const item = mapNewsRow({ ...BASE_ROW, id: '42', lat: '48.85', lon: '2.35' });
    expect(item.id).toBe(42);
    expect(item.lat).toBe(48.85);
    expect(item.lon).toBe(2.35);
  });
});

describe('mapNewsRow — entités restées dans les lignes déjà stockées', () => {
  it('décode le titre et le résumé', () => {
    const item = mapNewsRow({
      id: 1, feed_id: 'la-depeche', feed_name: 'La Dépêche', feed_region: null, tier: 3,
      title: 'Proc&#xE8;s en appel', link: 'https://example.fr/a',
      description: 'la famille et d&#039;anciennes petites amies',
      published_at: '2026-09-22T06:00:00Z', collected_at: '2026-09-22T06:05:00Z',
      category: 'security', severity: 'high', confidence: 0.9, lat: null, lon: null, classifier_version: 'kw-1',
    });
    expect(item.title).toBe('Procès en appel');
    expect(item.description).toBe("la famille et d'anciennes petites amies");
  });
});

describe('parseDateParam (repère de non-régression)', () => {
  it('accepte un ISO 8601 arrondi à 5 min (cf. src/services/rss.ts fetchFromIngestApi)', () => {
    const date = parseDateParam('2026-09-22T06:00:00.000Z', new Date());
    expect(date?.toISOString()).toBe('2026-09-22T06:00:00.000Z');
  });
});
