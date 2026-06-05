import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchOfficialIdfDatacenters } from '../api/_shared/infra-network-datacenters.js';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ms="http://mapserver.gis.umn.edu/mapserver" xmlns:gml="http://www.opengis.net/gml/3.2" numberReturned="1">
  <wfs:member>
    <ms:L_DATA_CENTER_P_R11>
      <ms:geometry>
        <gml:Point gml:id=".1" srsName="urn:ogc:def:crs:EPSG::2154">
          <gml:pos>651865.575600 6863490.922600</gml:pos>
        </gml:Point>
      </ms:geometry>
      <ms:id_dc>67</ms:id_dc>
      <ms:adresse>35 Rue des Jeuneurs, 75002 Paris</ms:adresse>
      <ms:etat_av>en exploitation</ms:etat_av>
      <ms:nom>Leonix Datacenter</ms:nom>
      <ms:nom_com>PARIS 2EME</ms:nom_com>
      <ms:operateur>Leonix Telecom</ms:operateur>
      <ms:bornes_mw>moins de 10MW</ms:bornes_mw>
    </ms:L_DATA_CENTER_P_R11>
  </wfs:member>
</wfs:FeatureCollection>`;

test('fetchOfficialIdfDatacenters caches official WFS rows between refresh cycles', async () => {
  let callCount = 0;
  const fakeFetch = async () => {
    callCount++;
    return {
      ok: true,
      text: async () => SAMPLE_XML,
    };
  };

  const first = await fetchOfficialIdfDatacenters(fakeFetch, { force: true, ttlMs: 60_000 });
  const second = await fetchOfficialIdfDatacenters(fakeFetch, { ttlMs: 60_000 });

  assert.equal(callCount, 1);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(second[0].nom, 'Leonix Datacenter');
});
