import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { buildSituationReportHtml, type SituationReportData } from './situation-report.ts';

function baseData(overrides: Partial<SituationReportData> = {}): SituationReportData {
  return {
    generatedAtLabel: '5 juillet 2026 à 14:32 (Europe/Paris)',
    periodLabel: 'dernières 24 h',
    permalink: 'https://france-monitor.example/?layers=news&z=6',
    situations: [],
    moreSituationsCount: 0,
    stability: null,
    domainSignals: [],
    events: [],
    newsCacheAvailable: false,
    sources: [],
    version: null,
    ...overrides,
  };
}

describe('buildSituationReportHtml — données complètes', () => {
  const html = buildSituationReportHtml(
    baseData({
      situations: [
        {
          title: 'Tension énergétique nationale',
          severity: 'critical',
          since: 'constatée à 14:30',
          zone: 'PACA',
          summary: 'Signal Écowatt rouge confirmé.',
        },
      ],
      moreSituationsCount: 2,
      stability: {
        nationalScore: 47,
        statusLabel: 'TENSION',
        topDepartments: [{ code: '13', name: 'Bouches-du-Rhône', score: 62 }],
      },
      domainSignals: [
        { domain: 'Vigilance météo', levelLabel: 'Rouge', severity: 'critical', detail: '1 dépt rouge : Var.' },
      ],
      events: [
        { time: '13:58', place: 'Marseille', title: 'Incident majeur en centre-ville', source: 'AFP', severity: 'high' },
      ],
      newsCacheAvailable: true,
      sources: [
        { label: 'Écowatt RTE', state: 'ok', ageLabel: '3 min' },
        { label: 'Vigicrues', state: 'error', ageLabel: '—' },
      ],
      version: '1.2.3',
    }),
  );

  it('produit un document HTML autonome', () => {
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('<title>Note de situation — France Monitor</title>'));
    assert.ok(html.includes('NOTE DE SITUATION — France Monitor'));
    assert.ok(html.includes('Diffusion libre — Sources ouvertes'));
  });

  it('contient les quatre sections attendues', () => {
    assert.ok(html.includes('>Synthèse<'));
    assert.ok(html.includes('>Signaux par domaine<'));
    assert.ok(html.includes('Événements marquants'));
    assert.ok(html.includes('Sources auditables'));
  });

  it('rend la synthèse (situations + indice de stabilité)', () => {
    assert.ok(html.includes('Tension énergétique nationale'));
    assert.ok(html.includes('constatée à 14:30'));
    assert.ok(html.includes('PACA'));
    assert.ok(html.includes('+ 2 situation(s) complémentaire(s)'));
    assert.ok(html.includes('47'));
    assert.ok(html.includes('TENSION'));
    assert.ok(html.includes('Bouches-du-Rhône'));
  });

  it('rend les signaux de domaine, événements et sources', () => {
    assert.ok(html.includes('Vigilance météo'));
    assert.ok(html.includes('Incident majeur en centre-ville'));
    assert.ok(html.includes('Marseille'));
    assert.ok(html.includes('AFP'));
    assert.ok(html.includes('Écowatt RTE'));
    assert.ok(html.includes('Indisponible')); // état 'error' → libellé
    assert.ok(html.includes('Vigicrues'));
  });

  it('affiche le permalien et la version', () => {
    assert.ok(html.includes('Version 1.2.3'));
    assert.ok(html.includes('france-monitor.example'));
  });
});

describe('buildSituationReportHtml — données vides/dégradées', () => {
  const html = buildSituationReportHtml(baseData());

  it('ne lève pas et se génère quand même', () => {
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 0);
    assert.ok(html.includes('NOTE DE SITUATION — France Monitor'));
  });

  it('affiche la mention nominale pour la synthèse sans situation', () => {
    assert.ok(html.includes('Aucune situation critique détectée. Situation nominale.'));
  });

  it('affiche « non disponible » pour les sections sans donnée en cache', () => {
    assert.ok(html.includes('Indice de stabilité nationale : non disponible au moment de la génération.'));
    assert.ok(html.includes('Flux de presse non disponible au moment de la génération.'));
  });

  it('signale un niveau nominal quand aucun domaine n’est en alerte', () => {
    assert.ok(html.includes('sont à un niveau nominal'));
  });

  it('omet la version quand elle est absente', () => {
    assert.ok(!html.includes('Version '));
  });
});

describe('buildSituationReportHtml — échappement HTML', () => {
  it('échappe le contenu externe des événements (titre avec balise script)', () => {
    const html = buildSituationReportHtml(
      baseData({
        newsCacheAvailable: true,
        events: [
          {
            time: '10:00',
            place: '<b>Lyon</b>',
            title: '<script>alert(1)</script>',
            source: '<img src=x onerror=alert(2)>',
            severity: 'high',
          },
        ],
      }),
    );

    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<img src=x onerror=alert(2)>'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(2)&gt;'));
  });

  it('échappe le titre de situation et le permalien', () => {
    const html = buildSituationReportHtml(
      baseData({
        situations: [
          { title: '<script>x</script>', severity: 'high', since: 'constatée à 09:00', zone: '<i>zone</i>' },
        ],
        permalink: 'https://x/?a=1&b="2"<3>',
      }),
    );

    assert.ok(!html.includes('<script>x</script>'));
    assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'));
    assert.ok(html.includes('https://x/?a=1&amp;b=&quot;2&quot;&lt;3&gt;'));
  });
});
