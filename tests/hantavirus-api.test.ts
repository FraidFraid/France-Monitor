import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  extractPeppsHantavirusSources,
  extractSpfSituationFromHtml,
  buildSnapshot,
  buildActiveClusterTemplates,
} from '../api/health/hantavirus.js';

const SAMPLE_PEPPS_HTML = `
  <html>
    <body>
      <h3>Hantavirus</h3>
      <p class="pucetete_vert">
        <a href="https://www.sf2h.net/publications/18-mai-2026-reponses-rapides-la-prise-en-soins-contexte-hantavirus-des-andes-esr.html">
          Réponses rapides aux questions spécifiques concernant la prise en soins dans le contexte d'Hantavirus des Andes, dans les Établissements Sanitaires de Référence (SF2H, 18/05/2026).
        </a>
      </p>
      <p class="pucetete_vert">
        <a href="2026/26_minsante_2026-08_reply_12052026.pdf">
          MINSANTE n°2026-08, version REPLY du 12/05/2026 : Recommandations sanitaires dans le cadre de l’alerte «Hantavirus»
        </a>
      </p>
      <h4>Points de situation</h4>
      <blockquote>
        <p class="pucetete_vert">
          <a href="2026/26_point-hantavirus-n08_11052026.pdf">Point de situation Hantavirus n°8 (11/05/2026, 23h13)</a>
        </p>
      </blockquote>
      <h3>Ebola</h3>
    </body>
  </html>
`;

const SAMPLE_SPF_HTML = `
  <html>
    <body>
      <time datetime="2026-05-26T00:00:00+0200">Mis à jour le 26 mai 2026</time>
      <div class="field__item">
        <h2>Cas d'hantavirus andes à bord du navire MV HONDIUS</h2>
        <p>Au 26 mai, 13 cas d’infection à l’hantavirus andes ont été diagnostiqués parmi les passagers du navire de croisière dont 1 cas chez une ressortissante française.</p>
        <p>En France, 25 personnes contacts (dont 4 croisiéristes) ont été identifiées, isolées et prises en charge en milieu hospitalier spécialisé, pour une durée pouvant aller jusqu’à 42 jours. Au 26 mai, aucune de ces personnes ne présentaient de symptômes et toutes ont été testées négatives.</p>
      </div>
    </body>
  </html>
`;

describe('api/health/hantavirus', () => {
  it('extractPeppsHantavirusSources returns hantavirus official sources from PEPS section', () => {
    const result = extractPeppsHantavirusSources(SAMPLE_PEPPS_HTML);

    assert.equal(result.entries.length, 3);
    assert.deepEqual(
      result.pdfUrls,
      [
        'https://peps.sante.gouv.fr/actu/2026/26_minsante_2026-08_reply_12052026.pdf',
        'https://peps.sante.gouv.fr/actu/2026/26_point-hantavirus-n08_11052026.pdf',
      ],
    );
    assert.equal(result.latestDate, '2026-05-18');
    assert.match(result.sectionText, /hantavirus des andes/i);
  });

  it('buildSnapshot overrides hard-coded asOf when fresher source date is available', () => {
    // La baseline codée en dur vaut 2026-05-26 ; une source plus récente doit primer.
    const snapshot = buildSnapshot({ latestSourceDate: '2026-06-01' });

    assert.equal(snapshot.asOf, '2026-06-01T00:00:00.000Z');
  });

  it('extractSpfSituationFromHtml returns updated date and live counts', () => {
    const result = extractSpfSituationFromHtml(SAMPLE_SPF_HTML);

    assert.equal(result.updatedDate, '2026-05-26');
    assert.equal(result.snapshotDate, '2026-05-26');
    assert.equal(result.globalConfirmed, 13);
    assert.equal(result.franceConfirmedCases, 1);
    assert.equal(result.franceContactsMonitored, 25);
  });

  it('buildSnapshot and cluster templates use SPF live situation when available', () => {
    const spfSituation = extractSpfSituationFromHtml(SAMPLE_SPF_HTML);
    const snapshot = buildSnapshot({ latestSourceDate: spfSituation.updatedDate, spfSituation });
    const events = buildActiveClusterTemplates({ spfSituation });

    assert.equal(snapshot.asOf, '2026-05-26T00:00:00.000Z');
    assert.equal(snapshot.globalConfirmed, 13);
    assert.equal(snapshot.franceContactsMonitored, 25);
    assert.match(snapshot.narrative[1], /25 cas contacts/i);

    const confirmedCase = events.find((event) => event.id === 'hanta-idf-confirmed-case');
    const contactMonitoring = events.find((event) => event.id === 'hanta-france-contact-monitoring');
    const shipCluster = events.find((event) => event.id === 'hanta-cluster-hondius');

    assert.equal(shipCluster.reportedCounts.confirmed, 13);
    assert.equal(confirmedCase.reportedCounts.contacts, 25);
    assert.equal(contactMonitoring.reportedCounts.contacts, 25);
  });
});
