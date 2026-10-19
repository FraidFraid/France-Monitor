// tests/cyber-watch.test.ts : veille cyber élargie (api/_lib/cyber-watch.js, 18/10/2026) : lecture des sources, lieux sûrs seulement,
// domaines imitateurs sans faux positifs évidents, sortie publique sans état interne.
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  brandOf, communeCandidates, communeOf, euvdDay, hostKind, hourly, isFrenchHost, lastVsMedian, parseCnil, parseEuvd, parseFeodo, parseUrlhaus,
  prefectureOf, publicWatch, radarBgp, radarSeries, slug, targetState, trackedCves, unzipFirst,
} from '../api/_lib/cyber-watch.js';

const NOW = Date.parse('2026-10-18T15:00:00Z');

describe('veille cyber élargie : lecture des sources', () => {
  it('Radar : série quotidienne et écart du dernier jour à la médiane', () => {
    const json = { success: true, result: { serie_0: { timestamps: Array.from({ length: 8 }, (_, i) => `2026-10-${10 + i}T00:00:00Z`), values: ['0.5', '0.5', '0.4', '0.6', '0.5', '0.5', '0.5', '1.0'] } } };
    const s = radarSeries(json);
    expect(s).toHaveLength(8);
    expect(lastVsMedian(s)).toBe(2);
    expect(lastVsMedian(s.slice(0, 5))).toBeNull();
    expect(() => radarSeries({ success: false })).toThrow();
  });
  it('Radar : détournement BGP avec les noms des réseaux', () => {
    const json = {
      success: true,
      result: {
        asn_info: [{ asn: 3215, org_name: 'Orange S.A.', country_code: 'FR' }, { asn: 64500, org_name: 'Exemple', country_code: 'XX' }],
        events: [{ id: 1, min_hijack_ts: '2026-10-17T12:00:00.1', max_hijack_ts: '2026-10-18T12:00:00', hijacker_asn: 64500, victim_asns: [3215], prefixes: ['1.0.0.0/24'], confidence_score: 7, on_going_count: 2 }],
      },
    };
    const [h] = radarBgp(json, 'hijack');
    expect(h).toMatchObject({ id: '1', hijacker: { asn: 64500, name: 'Exemple' }, victims: [{ asn: 3215, name: 'Orange S.A.', cc: 'FR' }], prefixes: 1, ongoing: true });
  });
  it('URLhaus : flux pays, 30 jours, en ligne, hébergeurs', () => {
    const csv = ['# commentaire',
      '"2026-10-18 13:47:15","http://a.example/x.exe","online","malware_download","a.example","1.2.3.4","16276","FR"',
      '"2026-10-10 10:00:00","http://b.example/y","offline","malware_download","b.example","1.2.3.5","16276","FR"',
      '"2026-01-01 10:00:00","http://c.example/z","offline","malware_download","c.example","1.2.3.6","51167","FR"'].join('\n');
    const u = parseUrlhaus(csv, NOW);
    expect(u).toMatchObject({ last30: 2, online: 1, asns: [{ asn: 16276, count: 2 }] });
    expect(u.latest[0]).toMatchObject({ host: 'a.example', threat: 'malware_download', asn: 16276 });
  });
  it('Feodo : serveurs situés en France seulement', () => {
    const f = parseFeodo([{ ip_address: '1.1.1.1', port: 443, country: 'FR', status: 'online', malware: 'QakBot' }, { ip_address: '2.2.2.2', country: 'US' }]);
    expect(f).toMatchObject({ total: 2, fr: 1, frOnline: 1, servers: [{ ip: '1.1.1.1', malware: 'QakBot' }] });
  });
  it('CNIL : trimestres, secteurs et part du piratage sur 4 trimestres', () => {
    const text = '﻿Extraction générée le 25 septembre 2026;;;\n'
      + "Date de réception de la notification ;Secteur d'activité de l'organisme concerné;Natures;Nombre;Typologies;Sensibles;Origines de l'incident;Causes de l'incident;Info\n"
      + "2026-06;Activités financières et d''assurance;x;x;x;x;Piratage, logiciel malveillant (par exemple rançongiciel) et/ou hameçonnage;Acte externe malveillant;x\n"
      + '2026-05;Santé humaine;x;x;x;x;Autre;Acte interne accidentel;x\n';
    const c = parseCnil(text);
    expect(c.quarters).toEqual([{ q: '2026-T2', count: 2 }]);
    expect(c.hackingPct).toBe(50);
    expect(c.sectors.map((s) => s.label)).toContain("Activités financières et d'assurance");
  });
  it('EUVD : dates anglaises lues, exploitées sur 7 jours', () => {
    expect(euvdDay('Oct 15, 2026, 8:30:32 PM')).toBe('2026-10-15');
    const e = parseEuvd({ total: 2, items: [
      { id: 'EUVD-1', aliases: 'CVE-2026-1\nGHSA-x\n', exploitedSince: 'Oct 16, 2026, 12:00:00 AM', enisaIdProduct: [{ product: { name: 'P', vendor: { name: 'V' } } }] },
      { id: 'EUVD-2', aliases: '', exploitedSince: 'Sep 20, 2026, 12:00:00 AM' },
    ] }, NOW);
    expect(e).toMatchObject({ total30: 2, last7: 1, items: [{ id: 'EUVD-1', cve: 'CVE-2026-1', vendor: 'V', product: 'P' }, { id: 'EUVD-2', cve: null }] });
  });
  it('EPSS : CVE suivis par la vigilance cyber, sans doublon', () => {
    expect(trackedCves({ kev: { recent: [{ cve: 'CVE-2026-1001' }] }, certfr: { alerts: [{ cves: ['CVE-2026-1001', 'CVE-2026-20002'] }], avis: [{ cves: ['pas-un-cve'] }] } }))
      .toEqual(['CVE-2026-1001', 'CVE-2026-20002']);
  });
  it('archive zip à un fichier lue sans bibliothèque', () => {
    const body = Buffer.from('a.com\nb.fr\n');
    const data = deflateRawSync(body);
    const name = Buffer.from('domain-names.txt');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt16LE(name.length, 26);
    expect(unzipFirst(Buffer.concat([head, name, data]))).toBe('a.com\nb.fr\n');
  });
});

describe('veille cyber élargie : cibles NoName057(16)', () => {
  it('site français, préfecture d’après le domaine en gouv.fr', () => {
    expect(slug('Côtes-d’Armor')).toBe('cotes-darmor');
    expect(isFrenchHost('www.gers.gouv.fr')).toBe(true);
    expect(isFrenchHost('www.municipio.re.it')).toBe(false);
    expect(prefectureOf('www.haute-saone.gouv.fr')).toBe('70');
    expect(prefectureOf('www.interieur.gouv.fr')).toBeNull();
    expect(hostKind('www.vienne.gouv.fr')).toBe('préfecture');
    expect(hostKind('www.interieur.gouv.fr')).toBe('administration');
    expect(hostKind('www.larochelle.port.fr')).toBe('port');
    expect(hostKind('metropole.toulouse.fr')).toBe('collectivité');
  });
  it('commune seulement au nom exact et de 5 000 habitants ou plus', () => {
    const idx = new Map([
      ['brest', { nom: 'Brest', codeDepartement: '29', population: 139_000, centre: { coordinates: [-4.5, 48.4] } }],
      ['lehavre', { nom: 'Le Havre', codeDepartement: '76', population: 165_000, centre: { coordinates: [0.1, 49.5] } }],
      ['gtt', { nom: 'Gtt', codeDepartement: '01', population: 120, centre: { coordinates: [5, 46] } }],
    ]);
    expect(communeCandidates('www.marseille-port.fr')).toEqual(['marseille-port', 'marseille', 'port']);
    expect(communeOf('brest.fr', idx)).toMatchObject({ name: 'Brest', dept: '29' });
    expect(communeOf('www.lehavre.fr', idx)).toMatchObject({ name: 'Le Havre' });
    expect(communeOf('gtt.fr', idx)).toBeNull();
    expect(communeOf('www.mn.fr', idx)).toBeNull();
  });
});

describe('veille cyber élargie : domaines imitateurs', () => {
  it('marques et services publics reconnus, homonymes et domaines officiels écartés', () => {
    expect(brandOf('vinted-order803.com')).toBe('Vinted');
    expect(brandOf('vinted5333322.com')).toBe('Vinted');
    expect(brandOf('ameli-remboursement.info')).toBe('Assurance maladie (ameli)');
    expect(brandOf('antai-amende-paiement.com')).toBe('ANTAI (amendes)');
    expect(brandOf('caf-aide-logement.com')).toBe('CAF');
    expect(brandOf('credit-agricole-secure.net')).toBe('Crédit Agricole');
    expect(brandOf('ameliachicago.com')).toBeNull();
    expect(brandOf('victorantai.com')).toBeNull();
    expect(brandOf('cafe-paris.fr')).toBeNull();
    expect(brandOf('caf.fr')).toBeNull();
    expect(brandOf('ameli.fr')).toBeNull();
  });
});

describe('veille cyber élargie : réponse publique', () => {
  it('sans état interne (essais, configurations lues, cache des lieux, échantillons bruts)', () => {
    const body = publicWatch({
      readAt: '2026-10-18T15:00:00.000Z', errors: [], tried: { radar: 'x' }, failures: {},
      ddosia: { readAt: 'x', lastConfig: null, hosts: [], days: [], configsSeen: ['a'], places: {} },
      lookalikes: { readAt: 'x', domains: [], perDay: [], days: ['2026-10-17'] },
      services: { readAt: 'x', items: [{ id: 'a', name: 'A', url: 'u', ok: true, samples: [[29_000_000, 300]] }] },
    });
    expect(Object.keys(body).sort()).toEqual(['abuse', 'cnil', 'ddosia', 'epss', 'errors', 'euvd', 'lookalikes', 'radar', 'readAt', 'services', 'targets']);
    expect(body.ddosia).not.toHaveProperty('configsSeen');
    expect(body.lookalikes).not.toHaveProperty('days');
    expect(body.services.items[0]).not.toHaveProperty('samples');
    expect(body.services.items[0].hours).toHaveLength(24);
  });
  it('site visé : joignable, lent (plus de 3 fois sa médiane et plus de 3 s) ou injoignable', () => {
    expect(targetState(true, 400, 350)).toBe('joignable');
    expect(targetState(true, 4000, 350)).toBe('lent');
    expect(targetState(true, 2500, 300)).toBe('joignable');
    expect(targetState(true, 9000, null)).toBe('joignable');
    expect(targetState(false, null, 300)).toBe('injoignable');
  });
  it('disponibilité horaire sur 24 h', () => {
    const h = hourly([[60 * 100, 300], [60 * 100 + 5, -1], [60 * 101, 200]]);
    expect(h.at(-1)).toBe(100);
    expect(h.at(-2)).toBe(50);
    expect(h[0]).toBeNull();
  });
});
