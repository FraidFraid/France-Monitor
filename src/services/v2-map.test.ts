import { describe, it, expect } from 'vitest';
import {
  alertLabel, alertPriority, categoryIcon, categoryLabel, drawnRadius, eventMapPoints, layoutAlertLabels,
  newsLevelHex, newsOffDrawnEvents, NEWS_INFO_HEX, sourcesRadius,
} from './v2-map.ts';
import type { NewsEvent, NewsItem } from '../types/index.ts';
import { buildWorkQueue, viewWorkQueue } from './work-queue.ts';
import type { ThemeId } from './themes.ts';

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  const id = over.id ?? 1;
  return {
    id, evidenceId: `E${id}`, title: 'Grève dans les transports lyonnais', category: 'social', severity: 'medium',
    status: 'active', firstSeen: '2026-09-29T06:00:00Z', lastSeen: '2026-09-29T07:00:00Z', articleCount: 4,
    sourceCount: 4, independentCount: 3, sourceNames: [], lat: 45.76, lon: 4.84, zone: 'france', ...over,
  };
}

describe('eventMapPoints (spec 2026-09-29 § 5)', () => {
  it('un point par événement de la liste : couleur du niveau, taille selon les sources', () => {
    const [p] = eventMapPoints([event()], 'general');
    expect(p).toMatchObject({ id: 1, level: 'jaune', radius: 8, hollow: false, lon: 4.84, lat: 45.76 });
    expect(p.color).toEqual([255, 204, 0]);
  });

  it('ni sans coordonnées, ni à l’étranger, ni clos, ni hors de la liste', () => {
    expect(eventMapPoints([
      event({ id: 2, lat: null, lon: null }),
      event({ id: 3, zone: 'etranger' }),
      event({ id: 4, status: 'closed' }),
      event({ id: 5, independentCount: 1 }), // jaune d'une seule source : hors de la liste
      event({ id: 6, severity: 'low' }),
    ], 'general')).toEqual([]);
  });

  it('« à confirmer » : anneau vide', () => {
    const [p] = eventMapPoints([event({ severity: 'medium', peakSeverity: 'high', independentCount: 1 })], 'general');
    expect(p.hollow).toBe(true);
  });

  it('filtré par le thème choisi', () => {
    expect(eventMapPoints([event({ category: 'energy' })], 'security')).toEqual([]);
    expect(eventMapPoints([event({ category: 'energy' })], 'energy')).toHaveLength(1);
  });

  it('trois tailles : 1 source, 2 à 4, 5 et plus', () => {
    expect([1, 2, 4, 5, 12].map(sourcesRadius)).toEqual([5, 8, 8, 12, 12]);
  });
});


describe('carte et fil : un seul thème, un seul jeu d’événements', () => {
  const events = [
    event({ id: 1, category: 'energy', severity: 'high' }),
    event({ id: 2, category: 'security', severity: 'critical' }),
    event({ id: 3, category: 'social', severity: 'medium' }),
    event({ id: 4, category: 'weather', severity: 'high' }),
    event({ id: 5, category: 'energy', severity: 'high', zone: 'etranger' }),
  ];
  const state = { events, digest: [], totals: {}, anchor: { since: 0, kind: 'last-visit' as const }, fetchedAt: 0, unavailable: false };

  it.each(['general', 'energy', 'security', 'environment', 'transport'] as ThemeId[])('thème %s : les points de la carte sont des lignes du fil', (theme) => {
    const queue = buildWorkQueue({
      situations: [], alerts: [], events: state, ecowatt: null, meteo: [], floods: [], markets: [],
      baseline: null, firstSeen: new Map(), lang: 'fr', now: 0,
    });
    const rowEventIds = new Set(viewWorkQueue(queue, theme, true).rows.flatMap((r) => (r.ref.kind === 'event' ? [r.ref.event.id] : [])));
    for (const p of eventMapPoints(events, theme)) expect(rowEventIds.has(p.id)).toBe(true);
  });
});

describe('alertes rouges et orange (spec 2026-10-14)', () => {
  it('orange et rouge sont des alertes, agrandies de 5 px ; jaune ne l’est pas', () => {
    const [orange] = eventMapPoints([event({ severity: 'high' })], 'general');
    const [jaune] = eventMapPoints([event()], 'general');
    expect(orange).toMatchObject({ alert: true, category: 'social', radius: 8 });
    expect(drawnRadius(orange)).toBe(13);
    expect(jaune.alert).toBe(false);
    expect(drawnRadius(jaune)).toBe(8);
  });

  it('un niveau masqué dans la légende n’est pas dessiné', () => {
    expect(eventMapPoints([event({ severity: 'high' })], 'general', new Set(['orange']))).toEqual([]);
  });

  it('priorité : le plus grave, puis le plus corroboré', () => {
    const pts = eventMapPoints([
      event({ id: 1, severity: 'high', independentCount: 2 }),
      event({ id: 2, severity: 'critical', independentCount: 2 }),
      event({ id: 3, severity: 'high', independentCount: 6 }),
    ], 'general');
    expect([...pts].sort(alertPriority).map((p) => p.id)).toEqual([2, 3, 1]);
  });
});

describe('newsOffDrawnEvents', () => {
  const item = (id: string, eventId?: number): NewsItem => ({ id, source: 's', title: 't', link: 'https://x.fr', pubDate: new Date(0), isAlert: false, eventId });
  it('retire les articles d’un événement dessiné, garde les autres et les non rattachés', () => {
    const out = newsOffDrawnEvents([item('a', 1), item('b', 2), item('c')], new Set([1]));
    expect(out.map((i) => i.id)).toEqual(['b', 'c']);
  });
  it('aucun événement dessiné : rien n’est retiré', () => {
    expect(newsOffDrawnEvents([item('a', 1)], new Set())).toHaveLength(1);
  });
});

describe('étiquettes', () => {
  it('coupe au mot, 40 caractères au plus, sans ponctuation finale', () => {
    expect(alertLabel('Incendie sur un site industriel classé')).toBe('Incendie sur un site industriel classé');
    const long = alertLabel('Explosion dans une usine chimique de Seine-Maritime, plan particulier déclenché');
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toMatch(/[,\s]…$/);
  });

  it('placement sans chevauchement, dans l’ordre de priorité', () => {
    const kept = layoutAlertLabels([
      { id: 1, x: 0, y: 0, w: 100, h: 18 },
      { id: 2, x: 50, y: 5, w: 100, h: 18 },
      { id: 3, x: 0, y: 30, w: 100, h: 18 },
    ]);
    expect([...kept]).toEqual([1, 3]);
  });

  it('picto et libellé par domaine, repli « Général »', () => {
    expect(categoryIcon('security')).toBe('shield');
    expect(categoryIcon('inconnu')).toBe('newspaper');
    expect(categoryLabel('energy')).toBe('Énergie');
    expect(categoryLabel('inconnu')).toBe('Général');
  });
});

describe('palette des actualités', () => {
  it('même couleurs que la vigilance, bleu pour l’information', () => {
    expect(newsLevelHex('critical')).toBe('#ff3b30');
    expect(newsLevelHex('high')).toBe('#ff9500');
    expect(newsLevelHex('medium')).toBe('#ffcc00');
    expect(newsLevelHex('low')).toBe('#34c759');
    expect(newsLevelHex('info')).toBe(NEWS_INFO_HEX);
  });
});
