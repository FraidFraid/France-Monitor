// src/config/sovereignty-sources.test.ts : couches et sources Souveraineté (contrats § 3.4 ; amendement 7, S11) : trois couches dans
// l'ordre du tiroir, lignes du panneau des sources datées par la donnée et nommant leur source avec un lien, relèves.
import { describe, expect, it } from 'vitest';
import type { DataSourceStatus } from '../types/index.ts';
import {
  SOVEREIGNTY_ALWAYS_POLLED, SOVEREIGNTY_LAYER_KEYS, SOVEREIGNTY_LAYER_SOURCES, SOVEREIGNTY_POLL_MS, SOVEREIGNTY_SOURCE_DETAILS,
  SOVEREIGNTY_SOURCE_NAMES, SOVEREIGNTY_STATUS_SOURCES, hasActiveSovereignty, sovereigntyReportSources, sovereigntySourceDetail,
} from './sovereignty-sources.ts';
import { MILITARY_FIGURE_LABEL } from '../services/sovereignty-levels.ts';

describe('couches et sources Souveraineté (contrats § 3.4)', () => {
  it('trois couches dans l’ordre du tiroir ; le maître est actif dès qu’une couche l’est', () => {
    expect(SOVEREIGNTY_LAYER_KEYS).toEqual(['military', 'subseaCables', 'cyber']);
    expect(hasActiveSovereignty({})).toBe(false);
    expect(hasActiveSovereignty({ subseaCables: true })).toBe(true);
    expect(hasActiveSovereignty({ military: false, subseaCables: false, cyber: false })).toBe(false);
  });
  it('huit lignes datées par la donnée, chacune rattachée à une couche ; aucune ligne « Cyber », d’exposition ni de NVD', () => {
    expect(SOVEREIGNTY_SOURCE_NAMES).toEqual([
      'Vols militaires', 'Vigipirate (page du SGDSN)', 'Câbles et AIS', 'CERT-FR', 'CISA KEV', 'Ransomware.live', 'Have I Been Pwned',
      'Cybermalveillance.gouv.fr',
    ]);
    expect(Object.values(SOVEREIGNTY_LAYER_SOURCES).flat().sort()).toEqual([...SOVEREIGNTY_SOURCE_NAMES].sort());
    expect(SOVEREIGNTY_STATUS_SOURCES.map(([key]) => key)).toEqual([
      'adsb-mil', 'vigipirate', 'ais-cables', 'certfr', 'kev', 'ransomware', 'hibp', 'cybermalveillance',
    ]);
    // La relecture de la page du SGDSN (O14) a sa ligne, rattachée à la Défense ; la saisie Vigipirate n'en a pas.
    expect(SOVEREIGNTY_LAYER_SOURCES.military).toEqual(['Vols militaires', 'Vigipirate (page du SGDSN)']);
    expect(SOVEREIGNTY_SOURCE_NAMES.join(' ')).not.toMatch(/^Cyber$|Shodan|Censys|NVD|adsb\.fi|OpenSky/);
  });
  it('détail et lien de chaque ligne : attributions de la spec, jamais « LIVE » ni une source retirée ; Ransomware.live nommée avec ses conditions', () => {
    expect(Object.keys(SOVEREIGNTY_SOURCE_DETAILS)).toEqual([...SOVEREIGNTY_SOURCE_NAMES]);
    const text = Object.values(SOVEREIGNTY_SOURCE_DETAILS).map((d) => d.detail).join(' | ');
    expect(text).not.toMatch(/LIVE|TEMPS RÉEL|temps réel|adsb\.fi|airplanes\.live|OpenSky|Shodan|Censys|NVD/);
    expect(Object.values(SOVEREIGNTY_SOURCE_DETAILS).every((d) => new URL(d.link).protocol === 'https:')).toBe(true);
    expect(SOVEREIGNTY_SOURCE_DETAILS['Ransomware.live']).toEqual({
      detail: 'Source : Ransomware.live · revendications non confirmées, conditions d’utilisation', link: 'https://www.ransomware.live/t&c',
    });
    expect(SOVEREIGNTY_SOURCE_DETAILS['Vols militaires'].detail).toContain('Données adsb.lol, ODbL 1.0');
    // O9 : libellé du gros chiffre de la Défense repris par la ligne des sources.
    expect(SOVEREIGNTY_SOURCE_DETAILS['Vols militaires'].detail).toContain(MILITARY_FIGURE_LABEL);
    expect(SOVEREIGNTY_SOURCE_DETAILS['Vigipirate (page du SGDSN)']).toEqual({
      detail: 'SGDSN, page Vigipirate relue chaque jour par le serveur (empreinte du texte, sans le reprendre)', link: 'https://www.sgdsn.gouv.fr/vigipirate',
    });
    expect(SOVEREIGNTY_SOURCE_DETAILS['Have I Been Pwned'].detail).toContain('CC BY 4.0');
    expect(SOVEREIGNTY_SOURCE_DETAILS['CERT-FR'].detail).toContain('Licence ouverte 2.0');
    expect(SOVEREIGNTY_SOURCE_DETAILS['CISA KEV'].detail).toContain('domaine public');
  });
  it('relèves : défense 2 min, connectivité 5, cyber 15 ; les trois toujours relevées (score)', () => {
    expect(Object.fromEntries(Object.entries(SOVEREIGNTY_POLL_MS).map(([k, v]) => [k, v / 60_000]))).toEqual({ military: 2, subseaCables: 5, cyber: 15 });
    expect([...SOVEREIGNTY_ALWAYS_POLLED].sort()).toEqual(['cyber', 'military', 'subseaCables']);
  });
  it('détail d’une ligne par son nom (panneau des sources) : lien de la source, null hors Souveraineté', () => {
    expect(sovereigntySourceDetail('Ransomware.live')).toEqual(SOVEREIGNTY_SOURCE_DETAILS['Ransomware.live']);
    expect(sovereigntySourceDetail('Vigipirate (page du SGDSN)')?.link).toBe('https://www.sgdsn.gouv.fr/vigipirate');
    expect(sovereigntySourceDetail('Vigicrues')).toBeNull();
    expect(sovereigntySourceDetail('Cyber')).toBeNull();
  });
  it('note de situation : statuts présents seulement, identifiés « sovereignty:<clé> »', () => {
    const status: DataSourceStatus = { name: 'CERT-FR', lastUpdate: new Date('2026-10-04T14:00:00Z'), status: 'ok', period: '16:00' };
    expect(sovereigntyReportSources([status])).toEqual([{ sourceId: 'sovereignty:certfr', status }]);
  });
});
