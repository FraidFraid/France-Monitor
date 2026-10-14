// @vitest-environment happy-dom
// Aperçu au clic (spec 2026-10-14) : extrait, articles, « Lire l'article complet », liens sûrs, états de chargement.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildArticlePreviewHtml, buildEventPreviewHtml, MapPreviewCard, relativeAge, safeLink } from './MapPreviewCard.ts';
import type { NewsEvent, NewsEventDetail, NewsItem } from '../types/index.ts';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const EVENT: NewsEvent = {
  id: 7, evidenceId: 'E7', title: 'Incendie sur un site industriel classé', category: 'security', severity: 'critical',
  status: 'active', firstSeen: '2026-10-14T09:00:00Z', lastSeen: '2026-10-14T11:40:00Z', articleCount: 6, sourceCount: 6,
  independentCount: 5, sourceNames: ['Paris-Normandie'], lat: 49.44, lon: 1.09, zone: 'france',
};
const DETAIL: NewsEventDetail = {
  event: EVENT,
  articles: [
    { id: 1, title: 'Premier article', link: 'https://a.fr/1', feedName: 'France 3', publishedAt: '2026-10-14T09:10:00Z', summary: 'Ancien résumé.' },
    { id: 2, title: 'Dernier article', link: 'https://b.fr/2', feedName: 'Paris-Normandie', publishedAt: '2026-10-14T11:40:00Z', summary: 'Le feu est fixé.' },
  ],
  log: [],
};
const parse = (html: string): HTMLElement => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('aides', () => {
  it('safeLink : http(s) seulement', () => {
    expect(safeLink('https://a.fr/x')).toBe('https://a.fr/x');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('/relatif')).toBeNull();
    expect(safeLink('')).toBeNull();
  });
  it('relativeAge : minutes, heures, jours, espace insécable', () => {
    expect(relativeAge(NOW - 20 * 60_000, NOW)).toBe('il y a 20 min');
    expect(relativeAge(NOW - 3 * 3_600_000, NOW)).toBe('il y a 3 h');
    expect(relativeAge(NOW - 3 * 86_400_000, NOW)).toBe('il y a 3 j');
  });
});

describe('aperçu d’événement', () => {
  it('chargé : extrait et lien du dernier article, 3 articles au plus, bouton fiche', () => {
    const el = parse(buildEventPreviewHtml(EVENT, DETAIL, NOW));
    expect(el.textContent).toContain('Le feu est fixé.');
    const primary = el.querySelector<HTMLAnchorElement>('a.mpc__primary');
    expect(primary?.getAttribute('href')).toBe('https://b.fr/2');
    expect(primary?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(primary?.textContent).toContain('Lire l’article complet');
    expect(el.querySelectorAll('.mpc__articles li')).toHaveLength(2);
    expect(el.querySelector('[data-action="open-fiche"]')?.textContent).toContain('6 articles');
    expect(el.textContent).not.toContain('—');
  });
  it('chargement puis indisponible : message, pas de lien, fiche gardée', () => {
    expect(parse(buildEventPreviewHtml(EVENT, 'loading', NOW)).textContent).toContain('Chargement des articles…');
    const err = parse(buildEventPreviewHtml(EVENT, 'error', NOW));
    expect(err.textContent).toContain('Articles indisponibles pour le moment.');
    expect(err.querySelector('a.mpc__primary')).toBeNull();
    expect(err.querySelector('[data-action="open-fiche"]')).not.toBeNull();
  });
  it('lien dangereux jamais cliquable, titre échappé', () => {
    const bad: NewsEventDetail = { ...DETAIL, articles: [{ ...DETAIL.articles[1], link: 'javascript:alert(1)', title: '<b>x</b>' }] };
    const el = parse(buildEventPreviewHtml(EVENT, bad, NOW));
    expect(el.querySelector('a[href^="javascript"]')).toBeNull();
    expect(el.querySelector('.mpc__articles b')).toBeNull();
  });
});

describe('aperçu d’article', () => {
  const item: NewsItem = {
    id: 'rss-1', source: 'Le Télégramme', title: 'Coupure sur la RN 165', link: 'https://t.fr/a', pubDate: new Date(NOW - 40 * 60_000),
    isAlert: false, summary: 'La circulation est coupée.', eventId: 7,
    threat: { level: 'high', category: 'transport', confidence: 0.8, source: 'keyword' },
  };
  it('extrait, source et âge, lien complet, « Voir l’événement » s’il est rattaché', () => {
    const el = parse(buildArticlePreviewHtml(item, EVENT, NOW));
    expect(el.textContent).toContain('La circulation est coupée.');
    expect(el.textContent).toContain('Le Télégramme · il y a 40 min');
    expect(el.querySelector<HTMLAnchorElement>('a.mpc__primary')?.getAttribute('href')).toBe('https://t.fr/a');
    expect(el.querySelector('[data-action="open-event"]')).not.toBeNull();
  });
  it('sans événement : pas de bouton événement', () => {
    expect(parse(buildArticlePreviewHtml(item, null, NOW)).querySelector('[data-action="open-event"]')).toBeNull();
  });
});

describe('MapPreviewCard', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  it('s’ouvre, Échap la ferme ; le bouton d’action rappelle et ferme', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const card = new MapPreviewCard(parent);
    const onAction = vi.fn();
    card.setOnAction(onAction);
    card.show(buildEventPreviewHtml(EVENT, 'error', NOW), 100, 100);
    expect(card.isOpen()).toBe(true);
    parent.querySelector<HTMLButtonElement>('[data-action="open-fiche"]')?.click();
    expect(onAction).toHaveBeenCalledWith('open-fiche');
    expect(card.isOpen()).toBe(false);
    card.show(buildEventPreviewHtml(EVENT, 'error', NOW), 100, 100);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(card.isOpen()).toBe(false);
    card.destroy();
  });
});
