// @vitest-environment happy-dom
//
// escapeHtml (dans AlertMonitor.ts) échappait via l'astuce DOM textContent→innerHTML,
// qui n'échappe pas les guillemets : une valeur injectée dans un attribut (title, href)
// pouvait en sortir et en ouvrir un autre (ex: onmouseover). Ces tests parsent la sortie
// dans un DOM réel et interrogent sémantiquement les attributs — jamais de recherche de
// sous-chaîne, qui passerait pour de mauvaises raisons sur du texte correctement échappé.

import { afterEach, describe, expect, it } from 'vitest';
import { AlertMonitor } from './AlertMonitor.ts';
import type { DetectedSituation } from '../types/index.ts';

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 's1',
    type: 'NEWS_ALERT',
    severity: 'high',
    confidence: 0.8,
    title: 'Titre',
    summary: 'Résumé',
    affectedZones: [],
    drivers: [],
    recommendedActions: [],
    sourceRefs: [],
    updatedAt: new Date('2026-07-27T08:00:00Z'),
    ...over,
  };
}

/** Ouvre le détail d'une alerte en simulant le clic géré par AlertMonitor. */
function openDetail(container: HTMLElement): void {
  const item = container.querySelector<HTMLElement>('.sit-mon__item');
  if (!item) throw new Error('item introuvable');
  item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('AlertMonitor — échappement des guillemets en attribut', () => {
  it('échappe les guillemets de summary dans l’attribut title de l’item (:328)', () => {
    const container = document.createElement('div');
    const monitor = new AlertMonitor(container);
    const payload = 'Résumé" onmouseover="alert(1)';
    monitor.update([situation({ summary: payload })]);

    const item = container.querySelector('.sit-mon__item');
    expect(item).not.toBeNull();
    // La charge sort de l'attribut title si le guillemet n'est pas échappé.
    expect(item?.getAttribute('onmouseover')).toBeNull();
    expect(item?.getAttribute('title')).toBe(payload);
    monitor.destroy();
  });

  it('échappe les guillemets de sourceRefs dans l’attribut title du détail (:378)', () => {
    const container = document.createElement('div');
    const monitor = new AlertMonitor(container);
    const payload = 'Source AFP" onmouseover="alert(2)';
    monitor.update([situation({ sourceRefs: [payload] })]);
    openDetail(container);

    const sourceSpan = document.querySelector('.sit-mon__detail-source');
    expect(sourceSpan).not.toBeNull();
    expect(sourceSpan?.getAttribute('onmouseover')).toBeNull();
    expect(sourceSpan?.getAttribute('title')).toBe(payload);
    monitor.destroy();
  });

  it('échappe les guillemets de linkUrl dans l’attribut href du lien source (:372)', () => {
    const container = document.createElement('div');
    const monitor = new AlertMonitor(container);
    // Schéma https: valide (isSafeSourceUrl l'accepte) mais contenant un guillemet brut —
    // seul escapeHtml protège ici de la sortie d'attribut.
    const payload = 'https://exemple.fr/article" onmouseover="alert(3)';
    monitor.update([situation({ linkUrl: payload })]);
    openDetail(container);

    const link = document.querySelector('.alert-mon__detail-link');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('onmouseover')).toBeNull();
    expect(link?.getAttribute('href')).toBe(payload);
    monitor.destroy();
  });
});

describe('AlertMonitor — validation du schéma de linkUrl (bonus)', () => {
  it('rejette javascript: et n’affiche aucun lien', () => {
    const container = document.createElement('div');
    const monitor = new AlertMonitor(container);
    monitor.update([situation({ linkUrl: 'javascript:alert(1)' })]);
    openDetail(container);

    expect(document.querySelector('.alert-mon__detail-link')).toBeNull();
    monitor.destroy();
  });

  it('rejette data: et n’affiche aucun lien', () => {
    const container = document.createElement('div');
    const monitor = new AlertMonitor(container);
    monitor.update([situation({ linkUrl: 'data:text/html,<script>alert(1)</script>' })]);
    openDetail(container);

    expect(document.querySelector('.alert-mon__detail-link')).toBeNull();
    monitor.destroy();
  });

  it('rejette une URL relative et n’affiche aucun lien', () => {
    const container = document.createElement('div');
    const monitor = new AlertMonitor(container);
    monitor.update([situation({ linkUrl: '/a/1' })]);
    openDetail(container);

    expect(document.querySelector('.alert-mon__detail-link')).toBeNull();
    monitor.destroy();
  });

  it('rejette une chaîne vide et n’affiche aucun lien', () => {
    const container = document.createElement('div');
    const monitor = new AlertMonitor(container);
    monitor.update([situation({ linkUrl: '' })]);
    openDetail(container);

    expect(document.querySelector('.alert-mon__detail-link')).toBeNull();
    monitor.destroy();
  });

  it('accepte https: et affiche un lien intact', () => {
    const container = document.createElement('div');
    const monitor = new AlertMonitor(container);
    monitor.update([situation({ linkUrl: 'https://exemple.fr/article' })]);
    openDetail(container);

    const link = document.querySelector('.alert-mon__detail-link');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://exemple.fr/article');
    monitor.destroy();
  });
});
