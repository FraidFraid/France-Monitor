// src/config/vigipirate.test.ts : saisie datée de la posture Vigipirate (spec 2026-10-04 souveraineté § 2.1, V4 ; contrats § 3.5,
// arbitrage 18 ; amendement 7, O14 et S1) : libellés officiels du plan 2026, rang du stade dans les mots du SGDSN, date d'effet, date
// de saisie, lien vers le SGDSN, mention de la source, aucune couleur de niveau.
import { describe, expect, it } from 'vitest';
import * as vigipirate from './vigipirate.ts';
import { VIGIPIRATE, VIGIPIRATE_LABEL, VIGIPIRATE_RANK_LABEL, VIGIPIRATE_SOURCE_LABEL, VIGIPIRATE_STADES } from './vigipirate.ts';
import { VIGIPIRATE_FIXTURE } from '../components/layer-panel/sovereignty.fixture.ts';

describe('posture Vigipirate', () => {
  it('stades du plan VIGIPIRATE 2026, libellés du SGDSN (lus le 04/10/2026)', () => {
    expect(VIGIPIRATE_STADES).toEqual(['vigilance', 'vigilance-renforcee', 'alerte-attentat']);
    expect(VIGIPIRATE_STADES.map((s) => VIGIPIRATE_LABEL[s])).toEqual(['vigilance', 'vigilance renforcée', 'alerte attentat']);
  });
  it('S1 : rang du stade dans les mots du SGDSN, jamais « 2 sur 3 » ; « Source : site internet du SGDSN »', () => {
    expect(VIGIPIRATE_STADES.map((s) => VIGIPIRATE_RANK_LABEL[s])).toEqual([
      'niveau d’alerte initial', 'niveau d’alerte intermédiaire', 'niveau d’alerte sommital',
    ]);
    expect(VIGIPIRATE_RANK_LABEL[VIGIPIRATE.stade]).toBe('niveau d’alerte intermédiaire');
    expect(JSON.stringify(vigipirate)).not.toMatch(/\d sur \d/);
    expect(VIGIPIRATE_SOURCE_LABEL).toBe('Source : site internet du SGDSN');
  });
  it('saisie datée : vigilance renforcée depuis le 22/06/2026, saisie le 04/10/2026, lien sur sgdsn.gouv.fr', () => {
    expect(VIGIPIRATE).toMatchObject({ stade: 'vigilance-renforcee', depuis: '2026-06-22', posture: 'été-automne 2026', saisiLe: '2026-10-04' });
    expect(new URL(VIGIPIRATE.lien).hostname).toBe('www.sgdsn.gouv.fr');
    expect(VIGIPIRATE.depuis <= VIGIPIRATE.saisiLe).toBe(true);
    expect([VIGIPIRATE.depuis, VIGIPIRATE.saisiLe].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)))).toBe(true);
    expect(VIGIPIRATE.accents.length).toBeGreaterThan(0);
  });
  it('aucune couleur de niveau exportée : c’est une posture, hors score', () => {
    expect(Object.keys(vigipirate).sort()).toEqual(['VIGIPIRATE', 'VIGIPIRATE_LABEL', 'VIGIPIRATE_RANK_LABEL', 'VIGIPIRATE_SOURCE_LABEL', 'VIGIPIRATE_STADES']);
    expect(JSON.stringify(vigipirate)).not.toMatch(/var\(--|#[0-9a-f]{3,6}\b|rouge|orange|jaune|vert/i);
  });
  it('le jeu d’essai des vues reprend la saisie', () => {
    expect(VIGIPIRATE_FIXTURE).toEqual(VIGIPIRATE);
  });
});
