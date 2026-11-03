import { describe, expect, it } from 'vitest';
import { cgtClock, cgtDay, cgtItems, cgtMapSlugs, cgtMapTitle, cgtPlace, cgtRows } from '../api/_lib/protests-cgt.js';
import { isProtestsResponse } from '../src/services/protests.ts';

const NOW = Date.parse('2026-11-03T10:00:00Z');

/** Ligne du tableau telle que l'écrit carte.cgt.fr (cellules réduites à l'essentiel). */
const row = (id: string, title: string, date: string, hour: string, place: string, lat: string, lon: string, layer = '') => `
 <tr>
  <td class="element-id hidden"><a class="focus-marker" data-marker-id="${id}" href="#">${id}</a></td>
  <td class="element-title"><h3 class="h4">${title}</h3><a href="https://carte.cgt.fr/carto/x-${id}/" class="ajax" data-id="${id}">[&nbsp;Voir +&nbsp;]</a></td>
  <td class="element-calque">${layer}</td>
  <td class="element-date ">${date}</td>
  <td class="element-heure ">${hour}</td>
  <td class="element-lieu">${place}</td>
  <td class="element-lat hidden">${lat}</td>
  <td class="element-long hidden">${lon}</td>
  <td class="element-url hidden">https://carte.cgt.fr/carto/x-${id}/</td>
 </tr>`;

const dayMap = `<title>📍 Carte du 5 novembre 2026 | carte.cgt.fr 🗺️</title><table><tbody>
${row('10662', '77 &#8211; MELUN', '5 novembre', '11h30', 'Parking Conforama', '48.54000', '2.66000')}
${row('10700', '6 &#8211; NICE', '5 novembre', '', 'Gare SNCF Nice-Ville', '43.70', '7.26')}
${row('10701', '80 &#8211; ', '5 novembre', '10h', 'Place Gambetta', '', '')}
${row('10702', '2B &#8211; BASTIA', '1er mai', '10h', 'Préfecture', '42.70', '9.45')}
</tbody></table>`;
// Carte thématique : aucune date, rien à reprendre ; même rendez-vous repris sur une seconde carte : une seule fois.
const themeMap = `<title>Carte des luttes | carte.cgt.fr</title><table>
${row('900', 'Les soignants de la prison des Baumettes', '', '', '', '43.23', '5.41', 'Conditions de travail')}
${row('10662', '77 &#8211; MELUN', '5 novembre', '11h30', 'Parking Conforama', '48.54000', '2.66000')}
</table>`;

describe('cartes de mobilisation de la CGT (carte.cgt.fr, 03/11/2026)', () => {
  it('cartes de la page d’accueil, sans doublon', () => {
    const home = '<a href="https://carte.cgt.fr/carto/carte/carte-5-novembre-2026">x</a><a href="https://carte.cgt.fr/carto/carte/ud">y</a>'
      + '<a href="https://carte.cgt.fr/carto/carte/carte-5-novembre-2026">x</a>';
    expect(cgtMapSlugs(home)).toEqual(['carte-5-novembre-2026', 'ud']);
  });

  it('lignes du tableau, titre de la carte', () => {
    expect(cgtMapTitle(dayMap)).toBe('Carte du 5 novembre 2026');
    expect(cgtRows(dayMap)[0]).toMatchObject({ id: '10662', title: '77 – MELUN', date: '5 novembre', hour: '11h30', place: 'Parking Conforama', lat: 48.54, lon: 2.66 });
  });

  it('département sur deux caractères, ville à la française, numéro seul sans ville', () => {
    expect(['77 – MELUN', '6 – NICE', '2B – BASTIA', '80 – ', 'Marseille'].map(cgtPlace)).toEqual([
      { dept: '77', city: 'Melun' }, { dept: '06', city: 'Nice' }, { dept: '2B', city: 'Bastia' }, { dept: '80', city: null }, { dept: null, city: 'Marseille' },
    ]);
  });

  it('jour sans année placé au plus près, heures lues', () => {
    expect(cgtDay('5 novembre', NOW)).toBe('20261105');
    expect(cgtDay('1er octobre', NOW)).toBe('20261001');
    expect(cgtDay('1er février', NOW)).toBe('20270201');
    expect(cgtDay('28 décembre', Date.parse('2027-01-02T10:00:00Z'))).toBe('20261228');
    expect(cgtDay('', NOW)).toBeNull();
    expect(['10h30', '9 h', '14H00', '', 'matin'].map(cgtClock)).toEqual(['1030', '0900', '1400', null, null]);
  });

  it('fenêtre de 7 jours, cartes sans date ignorées, rendez-vous repris deux fois compté une fois', () => {
    const r = cgtItems([{ slug: 'carte-5-novembre-2026', html: dayMap }, { slug: 'luttes', html: themeMap }], NOW);
    expect(r.items.map((x) => x.id)).toEqual(['cgt:10662:20261105:1130', 'cgt:10700:20261105:journee', 'cgt:10701:20261105:1000']);
    expect(r.undated).toBe(1);
    expect(r.items[0]).toMatchObject({
      source: 'cgt', status: 'annonce', title: 'Mobilisation (CGT)', city: 'Melun', dept: '77', place: 'Parking Conforama',
      startsAt: '2026-11-05T10:30:00.000Z', allDay: false, edition: 'Carte du 5 novembre 2026', precision: 'commune',
    });
    expect(r.items[1]).toMatchObject({ allDay: true, dept: '06' });
    expect(r.items[2]).toMatchObject({ lat: null, lon: null, precision: null, city: null, dept: '80' });
  });

  it('acceptées par la garde du contrat côté client (sinon tout le panneau passerait à n.d.)', () => {
    const { items } = cgtItems([{ slug: 'carte-5-novembre-2026', html: dayMap }], NOW);
    const body = { readAt: new Date(NOW).toISOString(), items, demosphere: { readAt: null, editions: 0, failedEditions: [], scanned: 0 },
      gdelt: { readAt: null, files: 0, missingFiles: 0 }, presse: { readAt: null, scanned: 0, matched: 0, unplaced: 0 }, errors: [] };
    expect(isProtestsResponse(body)).toBe(true);
  });
});
