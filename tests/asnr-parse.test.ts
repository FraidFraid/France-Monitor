// tests/asnr-parse.test.ts
// Analyse des pages ASNR (spec 2026-10-13 ASNR sûreté) : flux RSS, cartes de la liste des actualités, page d'un avis ; classement par
// le titre, niveau INES, centrale EDF. Fixtures relevées sur asnr.fr le 13/10/2026.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ASNR_PLANTS, canonicalUrl, classifyAsnr, matchPlant, parseAsnrDetail, parseAsnrListPage, parseAsnrRss, parseInes,
} from '../api/_lib/asnr.js';
import { NUCLEAR_PLANTS } from '../src/config/infrastructure.ts';

const read = (name: string): string => readFileSync(new URL(`./fixtures/nuclear/${name}`, import.meta.url), 'utf8');
const FLA = 'https://www.asnr.fr/actualites/incident-la-centrale-nucleaire-de-flamanville-manche';

describe('classifyAsnr (titre seul)', () => {
  it('centre de crise, y compris « a activé »', () => {
    expect(classifyAsnr('L’ASNR active son centre de crise à la suite d’un événement à la centrale de Chooz')).toBe('crise');
    expect(classifyAsnr('L’ASNR a activé son centre de crise à la suite d’un événement à la centrale nucléaire de Cruas-Meysse (Ardèche)')).toBe('crise');
  });
  it('incident dans une installation : centrale nommée, ou aucun mot de radioprotection', () => {
    expect(classifyAsnr('Incident à la centrale nucléaire de Flamanville (Manche)')).toBe('installation');
    expect(classifyAsnr('Incendie dans un bâtiment administratif de la centrale nucléaire du Bugey (Ain)')).toBe('installation');
    expect(classifyAsnr('Incident sur une installation du CEA de Saclay')).toBe('installation');
  });
  it('radioprotection : hôpital, laboratoire, événement radiologique', () => {
    expect(classifyAsnr('[Hospices civils de Lyon] Contamination externe d’un travailleur conduisant au dépassement d’une limite annuelle')).toBe('radioprotection');
    expect(classifyAsnr('Événement radiologique à l’Institut Gustave Roussy')).toBe('radioprotection');
    expect(classifyAsnr('Incident de radioprotection au centre de Recherche et de Restauration des Musées de France (C2RMF)')).toBe('radioprotection');
  });
  it('écartés : thèses, inspections, bilans, recherche, actualités', () => {
    for (const t of [
      'Soutenance de thèse de Léa Ould Boukhitine',
      'Inspection de revue à la centrale nucléaire de Cruas-Meysse',
      'Bilan 2025 des expositions professionnelles aux rayonnements ionisants en France',
      'Risque incendie : l’ASNR, acteur majeur de la recherche',
      'L’ASNR publie son analyse sur les événements significatifs de transport déclarés entre 2021 et 2024',
      'L’ASNR publie l’édition 2026 du Baromètre sur la perception des risques',
    ]) expect(classifyAsnr(t), t).toBeNull();
  });
});

describe('matchPlant', () => {
  it('titre d’abord, puis texte ; noms composés', () => {
    expect(matchPlant('Incident à la centrale nucléaire de Cruas-Meysse')).toEqual({ id: 'nuc-cruas', name: 'Cruas-Meysse' });
    expect(matchPlant('L’ASNR active son centre de crise', 'un événement à la centrale de Chooz')).toEqual({ id: 'nuc-chooz', name: 'Chooz' });
    expect(matchPlant('Incident à Saint-Laurent-des-Eaux')).toEqual({ id: 'nuc-saint-laurent', name: 'Saint-Laurent-des-Eaux' });
  });
  it('aucun site EDF : null (CEA, hôpital)', () => {
    expect(matchPlant('L’ASNR active son centre de crise à la suite d’un événement sur le site du CEA de Fontenay-aux-Roses (92)')).toBeNull();
  });
  it('table alignée sur NUCLEAR_PLANTS (identifiants et noms)', () => {
    expect(ASNR_PLANTS.map(([id, name]) => [id, name]).sort()).toEqual(NUCLEAR_PLANTS.map((p) => [p.id, p.name]).sort());
  });
});

describe('parseInes', () => {
  it('niveau lu, le plus haut si plusieurs ; absent : null', () => {
    expect(parseInes('l’ASNR classe cet événement au niveau 2 de l’échelle INES (échelle internationale)')).toBe(2);
    expect(parseInes('classé au niveau 0 de l’échelle INES puis au niveau 1 de l’échelle INES')).toBe(1);
    expect(parseInes('aucun niveau indiqué')).toBeNull();
  });
});

describe('parseAsnrRss', () => {
  it('10 items datés au jour de Paris, texte complet, URL canonique', () => {
    const { items, undated } = parseAsnrRss(read('asnr-rss.xml'));
    expect([items.length, undated]).toEqual([10, 0]);
    const fla = items.find((i) => i.url === FLA);
    expect(fla).toMatchObject({ title: 'Incident à la centrale nucléaire de Flamanville (Manche)', date: '2026-10-01' });
    expect(fla?.text).toMatch(/bore/);
  });
  it('flux sans canal : erreur', () => {
    expect(() => parseAsnrRss('<html>maintenance</html>')).toThrow(/flux RSS illisible/);
  });
});

describe('parseAsnrListPage', () => {
  it('16 cartes : titre, date jj/mm/aaaa → AAAA-MM-JJ, URL absolue, sans texte', () => {
    const page = parseAsnrListPage(read('asnr-actualites-0.html'));
    expect(page.cards).toBe(16);
    expect(page.items.find((i) => i.url === FLA)).toEqual({ url: FLA, title: 'Incident à la centrale nucléaire de Flamanville (Manche)', date: '2026-10-01', text: null });
    expect(page.items.some((i) => i.title.startsWith('[Hospices civils de Lyon]') && i.date === '2026-07-22')).toBe(true);
  });
  it('page sans carte lisible : erreur, jamais une liste vide', () => {
    expect(() => parseAsnrListPage('<html><body>Nouvelle maquette</body></html>')).toThrow(/aucune actualité lisible/);
  });
});

describe('parseAsnrDetail et canonicalUrl', () => {
  it('texte du <main> : INES 2 pour les Hospices civils de Lyon, aucun pour Flamanville', () => {
    expect(parseInes(parseAsnrDetail(read('asnr-detail-hcl-lyon.html')))).toBe(2);
    expect(parseInes(parseAsnrDetail(read('asnr-detail-flamanville.html')))).toBeNull();
  });
  it('page sans <main> : erreur', () => {
    expect(() => parseAsnrDetail('<html></html>')).toThrow(/illisible/);
  });
  it('URL relative ou à barre finale → absolue sans requête', () => {
    expect(canonicalUrl('/actualites/x/?a=1#b')).toBe('https://www.asnr.fr/actualites/x');
  });
});
