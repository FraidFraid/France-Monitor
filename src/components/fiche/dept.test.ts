// src/components/fiche/dept.test.ts : fiche département (26/10/2026).
import { describe, expect, it } from 'vitest';
import type { MeteoAlert, NewsEvent } from '../../types/index.ts';
import type { DepartmentPressure } from '../../services/department-pressure.ts';
import { buildDeptFiche, recentDeptEvents, type DeptFicheInput } from './dept.ts';

const NOW = Date.parse('2026-10-18T18:00:00Z');
const event = (id: number, severity: NewsEvent['severity'], hoursAgo: number, title = `Événement ${id}`): NewsEvent =>
  ({ id, title, severity, lastSeen: new Date(NOW - hoursAgo * 3_600_000).toISOString(), lat: 45.19, lon: 5.72 }) as unknown as NewsEvent;
const pressure: DepartmentPressure = {
  code: '38', name: 'Isère', level: 'orange', driver: 'security', badge: null,
  elements: [
    { key: 'event:7', level: 'orange', title: 'Émeutes en centre-ville à Grenoble', theme: 'security', source: 'event', badge: null },
    { key: null, level: 'jaune', title: 'Vigilance orages', theme: 'environment', source: 'meteo', badge: null },
  ],
};
const meteo: MeteoAlert[] = [
  { department: 'Isère', departmentCode: '38', level: 'yellow', risks: ['thunderstorm'] },
  { department: 'Savoie', departmentCode: '73', level: 'orange', risks: ['snow-ice'] },
];
const input = (over: Partial<DeptFicheInput> = {}): DeptFicheInput => ({
  code: '38', name: 'Isère', pressure, meteo, events: [event(7, 'high', 2), event(8, 'medium', 30)], sectionOpen: new Map(), lang: 'fr', now: NOW, ...over,
});
const section = (id: string, over: Partial<DeptFicheInput> = {}) => buildDeptFiche(input(over)).sections.find((s) => s.id === id);

describe('fiche département', () => {
  it('en-tête : clé dept:CODE, nom et code, niveau de la pression, thème qui le tire', () => {
    const f = buildDeptFiche(input());
    expect([f.key, f.kind, f.name, f.level]).toEqual(['dept:38', 'Département', 'Isère (38)', 'orange']);
    expect(f.lead).toBe('Niveau orange, tiré par le thème sécurité et défense : 2 signaux jaune ou plus.');
    expect(f.actions).toEqual([{ id: 'show-dept', label: 'Voir sur la carte' }]);
  });
  it('signaux : ceux qui ont une fiche sont cliquables, les signaux officiels non', () => {
    const html = section('signals')?.html ?? '';
    expect(html).toContain('data-select="event:7"');
    expect(html).toContain('Vigilance orages');
    expect(html.match(/data-select=/g)).toHaveLength(1);
    expect(html).toContain('Météo-France');
  });
  it('vigilance météo du seul département ; phénomènes en clair', () => {
    const s = section('meteo');
    expect(s?.summary).toBe('Jaune');
    expect(s?.html).toContain('Orages');
    expect(s?.html).not.toContain('Neige');
  });
  it('événements : 24 dernières heures seulement, du plus grave au plus récent, cliquables', () => {
    const s = section('events');
    expect(s?.summary).toBe('1');
    expect(s?.html).toContain('data-select="event:7"');
    expect(s?.html).not.toContain('event:8');
    const ordered = recentDeptEvents([event(1, 'medium', 1), event(2, 'high', 5), event(3, 'high', 2)], NOW).map((e) => e.id);
    expect(ordered).toEqual([3, 2, 1]);
  });
  it('département sans pression : vert, dit en clair, jamais vide', () => {
    const f = buildDeptFiche(input({ code: '48', name: 'Lozère', pressure: null, meteo: [], events: [] }));
    expect([f.name, f.level]).toEqual(['Lozère (48)', 'vert']);
    expect(f.lead).toBe('Aucun signal jaune ou plus dans ce département.');
    expect(f.sections.find((s) => s.id === 'events')?.html).toContain('Aucun événement localisé');
  });
});
