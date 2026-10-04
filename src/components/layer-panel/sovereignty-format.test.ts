// src/components/layer-panel/sovereignty-format.test.ts
// Formats, mots et couleurs des panneaux Souveraineté (spec 2026-10-04 souveraineté § 1, § 2 ; contrats § 3.6).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CertFrItem } from '../../types/index.ts';
import { NBSP } from './format.ts';
import {
  BASE_TYPE_WORD, CABLES_FILE_ERROR_TEXT, EMERGENCY_WORD, FAMILY_COLOR, FAMILY_WORD, SECTOR_WORD, SOVEREIGNTY_THEME, SQUAWK_CAVEAT, SQUAWK_WORD, aircraftLabel, cablesAisDown,
  cablesUnevaluatedWhy, certfrProductText, formatAsn, formatFeet, glueSovUnits, sectorWord, sovBreakable,
} from './sovereignty-format.ts';

const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');

function certfr(over: Partial<CertFrItem> = {}): CertFrItem {
  return {
    ref: 'CERTFR-2026-ALE-011', kind: 'alerte', title: 'Multiples vulnérabilités dans Citrix NetScaler ADC et Gateway',
    product: 'Citrix NetScaler ADC et Gateway', updatedMark: false, url: 'https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-011/',
    firstVersion: '2026-09-28', lastVersion: '2026-09-30', cves: ['CVE-2026-88771', 'CVE-2026-88772'], kevCves: ['CVE-2026-88771', 'CVE-2026-88772'],
    pageReadAt: '2026-10-04T14:47:00Z', status: 'en-cours', closedAt: null, exploited: true,
    exploitedQuote: null, ...over,
  };
}

describe('mots de la souveraineté (S3, S10)', () => {
  it('code 7500 : « intervention illicite » et réserve sur le transpondeur ; « vulnérabilité » collée à son nombre', () => {
    expect(SQUAWK_WORD['7500']).toBe('intervention illicite');
    expect(SQUAWK_CAVEAT).toBe('code affiché par le transpondeur, non confirmé par les autorités');
    expect(glueSovUnits('3 vulnérabilités, 1 vulnérabilité')).toBe(`3${NBSP}vulnérabilités, 1${NBSP}vulnérabilité`);
  });
});

describe('formats Souveraineté (R1)', () => {
  it('thème, altitude en pieds insécable, « n.d. » pour une valeur absente', () => {
    expect(SOVEREIGNTY_THEME).toBe('Souveraineté');
    expect(formatFeet(38000)).toBe(`38\u202F000${NBSP}ft`);
    expect(formatFeet(525)).toBe(`525${NBSP}ft`);
    expect(formatFeet(null)).toBe('n.d.');
    expect(formatFeet(Number.NaN)).toBe('n.d.');
  });
  it('indicatif, à défaut l’adresse OACI ; jamais une chaîne vide', () => {
    expect(aircraftLabel({ callsign: 'FICTIF04', hex: '3bf004' })).toBe('FICTIF04');
    expect(aircraftLabel({ callsign: null, hex: '3bf004' })).toBe('adresse 3bf004');
    expect(aircraftLabel({ callsign: '  ', hex: '~2d1a0f' })).toBe('adresse ~2d1a0f');
  });
  it('familles et couleurs de catégorie (jetons présents dans main.css)', () => {
    expect(FAMILY_WORD).toEqual({ francais: 'français', autres: 'autres' });
    expect(FAMILY_COLOR).toEqual({ francais: 'var(--cat-mil-francais)', autres: 'var(--cat-mil-autres)' });
    for (const token of ['--cat-mil-francais', '--cat-mil-autres']) expect(css).toContain(`${token}: #`);
  });
  it('urgences publiées par adsb.lol en français ; sites par catégorie', () => {
    expect(EMERGENCY_WORD['nordo']).toBe('panne radio');
    expect(EMERGENCY_WORD['unlawful']).toBe('intervention illicite');
    expect(EMERGENCY_WORD['general']).toBe('urgence');
    expect(BASE_TYPE_WORD).toEqual({ air: 'air', navy: 'marine', army: 'terre', joint: 'interarmées', fortification: 'fortification', other: 'autre' });
  });
  it('secteurs ransomware.live traduits ; inconnu ou vide : « autre secteur » ou « secteur non publié », jamais l’anglais brut', () => {
    expect(sectorWord('Healthcare')).toBe('santé');
    expect(sectorWord('Government & Defense')).toBe('administration et défense');
    expect(sectorWord('Not Found')).toBe('secteur non publié');
    expect(sectorWord('')).toBe('secteur non publié');
    expect(sectorWord('Space Mining')).toBe('autre secteur');
    for (const [en, fr] of Object.entries(SECTOR_WORD)) expect(fr, en).not.toMatch(/[A-Z]{2}|\b(?:Services|Other|Found)\b/);
  });
  it('produit CERT-FR, sinon titre ; numéro de système autonome', () => {
    expect(certfrProductText(certfr())).toBe('Citrix NetScaler ADC et Gateway');
    expect(certfrProductText(certfr({ product: null, title: 'Note d’alerte, ciblage des messageries instantanées' }))).toBe('Note d’alerte, ciblage des messageries instantanées');
    expect(formatAsn(3215)).toBe('AS3215');
  });
  it('R1 : unités de la souveraineté collées à leur nombre, contrôle des coupures', () => {
    expect(glueSovUnits('navire lent à 300 m, 1,4 nœuds, 7 revendications sur 7 jours, Kp 5')).toBe(
      `navire lent à 300${NBSP}m, 1,4${NBSP}nœuds, 7${NBSP}revendications sur 7${NBSP}jours, Kp${NBSP}5`,
    );
    expect(sovBreakable('à 500 m du câble')).toBe('500 m');
    expect(sovBreakable('38 000 ft')).toBe('000 ft');
    expect(sovBreakable('indice Kp 5 à 11 h')).toBe('Kp 5');
    expect(sovBreakable(glueSovUnits('à 500 m du câble, 38 000 ft, Kp 5'))).toBeNull();
    expect(sovBreakable('9 militaires')).toBeNull();
  });
  it('veille des câbles non évaluée : la cause est dite (AIS muet, fichier illisible, relais injoignable, relevé interrompu)', () => {
    const NOW = Date.parse('2026-10-04T16:48:30+02:00');
    const at = '2026-10-04T14:41:00Z';
    expect(cablesUnevaluatedWhy({ aisLastMessageAt: at, errors: ['flux AIS interrompu : lot 1 sur 3 muet depuis 6 min'] }, NOW)).toBe('AIS muet depuis 16:41');
    expect(cablesUnevaluatedWhy({ aisLastMessageAt: null, errors: [] }, NOW)).toBe('AIS muet');
    expect(cablesUnevaluatedWhy({ aisLastMessageAt: at, errors: [CABLES_FILE_ERROR_TEXT] }, NOW)).toBe('fichier des câbles illisible');
    expect(cablesUnevaluatedWhy({ aisLastMessageAt: at, errors: ['Relais AIS : HTTP 503'] }, NOW)).toBe('relais AIS injoignable');
    expect(cablesUnevaluatedWhy({ aisLastMessageAt: at, errors: ['Veille des câbles interrompue : délai dépassé'] }, NOW)).toBe('veille des câbles interrompue');
    expect(CABLES_FILE_ERROR_TEXT).toBe('Câbles OpenStreetMap : fichier illisible');
    expect(cablesAisDown({ evaluated: false, errors: ['Relais AIS : HTTP 503'] })).toBe(true);
    expect(cablesAisDown({ evaluated: false, errors: [CABLES_FILE_ERROR_TEXT] })).toBe(false);
    expect(cablesAisDown({ evaluated: true, errors: [] })).toBe(false);
  });
});
