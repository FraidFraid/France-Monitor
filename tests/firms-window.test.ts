import { describe, expect, it, vi } from 'vitest';
import { detectionTimestamp, filterRecentDetections } from '../api/_lib/firms-window.js';

// 2026-07-27T11:00:00Z
const NOW = Date.UTC(2026, 6, 27, 11, 0, 0);

function row(acq_date: string, acq_time: string): Record<string, unknown> {
  return { acq_date, acq_time, latitude: 44.8, longitude: -0.9, frp: 12 };
}

describe('detectionTimestamp', () => {
  it('interprète acq_time en HHMM UTC, avec ou sans zéro de tête', () => {
    // FIRMS omet le zéro de tête : « 109 » signifie 01 h 09.
    expect(detectionTimestamp(row('2026-07-27', '109'))).toBe(Date.UTC(2026, 6, 27, 1, 9));
    expect(detectionTimestamp(row('2026-07-27', '0109'))).toBe(Date.UTC(2026, 6, 27, 1, 9));
    expect(detectionTimestamp(row('2026-07-27', '1255'))).toBe(Date.UTC(2026, 6, 27, 12, 55));
    // Cas limite : minuit pile, écrit « 0 » par FIRMS.
    expect(detectionTimestamp(row('2026-07-27', '0'))).toBe(Date.UTC(2026, 6, 27, 0, 0));
  });

  it('renvoie null sur un horodatage illisible plutôt qu\'une date fausse', () => {
    expect(detectionTimestamp(row('hier', '1200'))).toBeNull();
    expect(detectionTimestamp(row('2026-07-27', 'midi'))).toBeNull();
    expect(detectionTimestamp(row('2026-07-27', '2599'))).toBeNull();
    expect(detectionTimestamp({ latitude: 44.8 })).toBeNull();
  });
});

describe('filterRecentDetections', () => {
  it('garde les détections de la fenêtre et écarte les plus anciennes', () => {
    const rows = [
      row('2026-07-27', '1030'), // il y a 30 min
      row('2026-07-26', '1200'), // il y a 23 h
      row('2026-07-26', '1000'), // il y a 25 h : hors fenêtre
      row('2026-07-25', '1200'), // il y a 47 h : hors fenêtre
    ];
    const kept = filterRecentDetections(rows, 24, NOW);
    expect(kept).toHaveLength(2);
    expect(kept.map(r => `${r['acq_date']} ${r['acq_time']}`))
      .toEqual(['2026-07-27 1030', '2026-07-26 1200']);
  });

  it('couvre bien 24 h glissantes et non « depuis minuit UTC »', () => {
    // C'est le défaut corrigé : à 11 h UTC, une plage « aujourd'hui » perdait
    // les 13 h précédentes. La fenêtre doit remonter à la veille.
    const veille = row('2026-07-26', '2300');
    expect(filterRecentDetections([veille], 24, NOW)).toHaveLength(1);
  });

  it('écarte une détection illisible et journalise ce qui est perdu', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const kept = filterRecentDetections(
        [row('2026-07-27', '1030'), row('2026-07-27', 'midi')],
        24,
        NOW,
      );
      expect(kept).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('1'));
    } finally {
      warn.mockRestore();
    }
  });

  it('tolère une légère avance d\'horloge mais rejette une date franchement future', () => {
    expect(filterRecentDetections([row('2026-07-27', '1130')], 24, NOW)).toHaveLength(1);
    expect(filterRecentDetections([row('2026-07-28', '1200')], 24, NOW)).toHaveLength(0);
  });

  it('ne journalise rien quand tout est lisible', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      filterRecentDetections([row('2026-07-27', '1030')], 24, NOW);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
