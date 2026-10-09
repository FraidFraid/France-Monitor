// tests/outages-cloud.test.ts : collecteur Cloud (spec 2026-10-08 § 3.2 ; faits § 8, 9) sur les pages d'état du 08/10 : filtres France (P2),
// incidents comptés une fois (P3), zones homonymes sans masquage (P7), lecture par partie gardée sur échec (P8), lecture stricte du
// référentiel (P9), inventaire jamais un état (P5, P11).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests, kvGetJson } from '../api/_lib/kv-history.js';
import {
  CLOUD_LAST_KEY, CLOUD_PENDING_NOTE, OVH_STATUS_PAGES, SCALEWAY_SUMMARY_URL, __resetCloudForTests, buildCloud, collectCloud, emptyCloud, ensureCloudFresh,
  fromAws, fromCloudflare, fromGcp, fromStatuspage, isOvhFrance, outscaleFrance, ovhTitleFrance, scalewayFrance, storedCloud,
} from '../api/_lib/outages-cloud.js';
import { PEERINGDB_IX_URL } from '../api/_lib/peeringdb.js';
import { cloudRoute, outagesFixture } from './helpers/outages-b-fixtures.ts';
import { respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';
import type { FakeResponse } from './helpers/traffic-fixtures.ts';
import { CLOUD_PROVIDER_LABEL } from '../src/services/outages-levels.ts';
import type { CloudOutagesResponse, CloudProvider } from '../src/types/index.ts';

const fx = (name: string): unknown => JSON.parse(outagesFixture(name)) as unknown;
const txt = outagesFixture;
const NOW = Date.parse('2026-10-08T20:00:00Z');
const MIN = 60_000;
const OVH = { component: isOvhFrance, title: ovhTitleFrance };
const WFS_PREFIX = 'https://ogc.geo-ide.developpement-durable.gouv.fr/';
const UMAP_PREFIX = 'https://umap.openstreetmap.fr/';

describe('filtres France', () => {
  it('OVHcloud : centres français gardés, Limbourg, Erith, Varsovie et Beauharnois écartés', () => {
    expect(['RBX4', 'SBG1', 'GRA', 'EU-WEST-PAR-A', 'France', '3AZ', 'Access RBX'].every(isOvhFrance)).toBe(true);
    expect(['LIM3', 'ERI1', 'WAW1', 'BHS', 'DE', 'EU-SOUTH-MIL'].some(isOvhFrance)).toBe(false);
    expect(ovhTitleFrance('[EU-WEST-PAR][Storage] - Object Storage S3 incident notification')).toBe(true);
    expect(ovhTitleFrance('[RBX4][Cooling System] - Rack 54B19 maintenance notification')).toBe(true);
    expect(ovhTitleFrance('[GLOBAL][Domains] - .MG and .TL Domain Names Incident Notification')).toBe(false);
    expect(ovhTitleFrance('[LIM1][Cooling System] - Rack L114B13 maintenance notification')).toBe(false);
  });
  it('P6 Outscale : titres [EU-WEST-2] et [CLOUDGOUV-EU-WEST-1], avec ou sans espace dans les crochets ; les autres régions écartées', () => {
    expect(outscaleFrance.title('[EU-WEST-2] Maintenance API')).toBe(true);
    expect(outscaleFrance.title('[cloudgouv-eu-west-1 ] Network Maintenance')).toBe(true);
    expect(['[US-EAST-2] Maintenance API', '[US-WEST-1 ] API Maintenance', '[AP-NORTHEAST-1] Network Maintenance', 'Maintenance EU-WEST-2'].some(outscaleFrance.title)).toBe(false);
  });
});

describe('pages d’état (jeux d’essai du 08/10)', () => {
  it('OVH public-cloud : incident S3 Paris « surveillé » (monitoring), non compté ; PostgreSQL GLOBAL touchant GRA : France, surveillé', () => {
    const p = fromStatuspage('ovhcloud', 'OVHcloud', fx('ovh-public-cloud-summary.json'), OVH, NOW);
    expect(p.incidents.map((i) => [i.title.slice(0, 13), i.state])).toEqual([['[EU-WEST-PAR]', 'surveille'], ['[GLOBAL][Data', 'surveille']]);
    expect(p.incidents[0].zones).toEqual(['EU-WEST-PAR-A', 'EU-WEST-PAR-B', 'EU-WEST-PAR-C']);
    expect(p.elsewhere).toEqual([]);
  });
  it('OVH web-cloud : incidents de domaines mondiaux hors France ; composants mondiaux en panne partielle ne colorent pas la France', () => {
    const p = fromStatuspage('ovhcloud', 'OVHcloud', fx('ovh-web-cloud-summary.json'), OVH, NOW);
    expect(p.incidents).toEqual([]);
    expect(p.elsewhere.map((i) => i.state)).toEqual(['en-cours', 'en-cours']);
    expect(p.zones.every((z) => z.status !== 'partial')).toBe(true);
  });
  it('OVH network : maintenances RBX4 (09/10) et RBX8 (12/10) dans les 7 jours, ERI1 écartée', () => {
    const p = fromStatuspage('ovhcloud', 'OVHcloud', fx('ovh-network-summary.json'), OVH, NOW);
    const titles = p.maintenances.map((m) => m.title);
    expect(titles.some((t) => t.startsWith('[RBX4]'))).toBe(true);
    expect(titles.some((t) => t.startsWith('[RBX8]'))).toBe(true);
    expect(titles.some((t) => t.startsWith('[DC]'))).toBe(false);
  });
  it('Scaleway : Container Registry fr-par compté une fois (pas trois zones) ; Generative APIs [fr-par] par le titre ; Support et Milan hors France', () => {
    const p = fromStatuspage('scaleway', 'Scaleway', fx('scaleway-summary.json'), scalewayFrance, NOW);
    expect(p.incidents.map((i) => i.title.slice(0, 20))).toEqual(['[Container Registry]', '[Generative APIs] - ']);
    expect(p.incidents.every((i) => i.state === 'en-cours')).toBe(true);
    expect(p.zones.map((z) => [z.id, z.status])).toEqual(expect.arrayContaining([['fr-par-1', 'operational'], ['DC1', 'maintenance']]));
    expect(p.elsewhere.length).toBeGreaterThanOrEqual(3);
  });
  it('Scaleway : zones fr-par et centres Dedibox DC1 à DC5 placés au point de Paris (publié « Paris » par Scaleway), région nommée « région parisienne »', () => {
    const p = fromStatuspage('scaleway', 'Scaleway', fx('scaleway-summary.json'), scalewayFrance, NOW);
    const ids = p.zones.map((z) => z.id).sort();
    expect(ids).toEqual(['DC1', 'DC2', 'DC3', 'DC4', 'DC5', 'fr-par-1', 'fr-par-2', 'fr-par-3']);
    for (const z of p.zones) expect([z.lat, z.lon], z.id).toEqual([48.86, 2.35]);
    expect(p.zones.find((z) => z.id === 'fr-par-2')?.label).toBe('Région parisienne (fr-par-2)');
    expect(p.zones.find((z) => z.id === 'DC3')?.label).toBe('Paris (DC3)');
    // Le point est celui des autres zones parisiennes (OVHcloud PAR, Cloudflare CDG).
    expect(fromCloudflare(fx('cloudflare-components.json')).find((x) => x.id === 'CDG')).toMatchObject({ lat: 48.86, lon: 2.35 });
  });
  it('Cloudflare : quatre points de présence français datés chacun, statut mondial ignoré', () => {
    const z = fromCloudflare(fx('cloudflare-components.json'));
    expect(z.map((x) => x.id)).toEqual(['BOD', 'CDG', 'LYS', 'MRS']);
    expect(z.find((x) => x.id === 'CDG')).toMatchObject({ label: 'Paris', status: 'operational', updatedAt: '2026-03-03T10:46:33.000Z', lat: 48.86, lon: 2.35 });
  });
  it('Google Cloud : aucun incident à Paris (europe-west9) ; AWS : aucun élément Paris dans le flux', () => {
    expect(fromGcp(fx('gcp-incidents.json'), NOW).incidents).toEqual([]);
    expect(fromAws(txt('aws-all.rss'), NOW).incidents).toEqual([]);
  });
  it('GCP et AWS : la zone déduite de l’absence d’incident n’a pas de date (jamais « opérationnel » daté)', () => {
    expect(fromGcp(fx('gcp-incidents.json'), NOW).zone).toMatchObject({ id: 'europe-west9', status: 'operational', updatedAt: null });
    expect(fromAws(txt('aws-all.rss'), NOW).zone).toMatchObject({ id: 'eu-west-3', status: 'operational', updatedAt: null });
  });
  it('AWS : un élément eu-west-3 non résolu est un incident en cours', () => {
    const xml = '<rss><channel><item><title><![CDATA[Increased API Error Rates]]></title><pubDate>Thu, 08 Oct 2026 11:00:00 PDT</pubDate>'
      + '<guid isPermaLink="false">https://status.aws.amazon.com/#ec2-eu-west-3_1791480000</guid><description><![CDATA[We are investigating.]]></description></item></channel></rss>';
    expect(fromAws(xml, NOW).incidents).toMatchObject([{ provider: 'aws', title: 'Increased API Error Rates', zones: ['eu-west-3'], state: 'en-cours' }]);
  });
  /** Flux AWS minimal : un élément par mise à jour (guid = service-région_horodatage). */
  const awsItem = (title: string, guid: string, pubDate: string): string => `<item><title><![CDATA[${title}]]></title><pubDate>${pubDate}</pubDate><guid isPermaLink="false">https://status.aws.amazon.com/#${guid}</guid></item>`;
  const awsFeed = (...items: string[]): string => `<rss><channel>${items.join('')}</channel></rss>`;

  it('AWS, jeu d’essai : un événement ouvert depuis des mois, dernière mise à jour à 23 jours, reste en cours (jamais « aucun incident »)', () => {
    // Le flux du 08/10 n'a pas d'événement à Paris : le même flux, région me-central-1 renommée eu-west-3 (ouvert depuis mars, mis à jour le 15/09).
    const xml = txt('aws-all.rss').replace(/me-central-1/g, 'eu-west-3');
    const p = fromAws(xml, NOW);
    expect(p.incidents).toMatchObject([{ id: 'aws:multipleservices-eu-west-3', provider: 'aws', zones: ['eu-west-3'], state: 'en-cours', title: 'Service disruption: Increased Error Rates' }]);
    expect(p.incidents[0].updatedAt).toBe('2026-09-15T10:27:10.000Z');
    expect(p.zone.status).toBe('degraded');
    // me-south-1, autre région du même flux : écartée.
    expect(p.incidents).toHaveLength(1);
  });
  it('AWS : les mises à jour d’un même événement comptent une fois (début = la plus ancienne, mise à jour = la plus récente)', () => {
    const p = fromAws(awsFeed(
      awsItem('Service disruption: Increased API Error Rates', 'ec2-eu-west-3_1791470000', 'Thu, 08 Oct 2026 08:00:00 PDT'),
      awsItem('Service disruption: Increased API Error Rates', 'ec2-eu-west-3_1791475000', 'Thu, 08 Oct 2026 09:30:00 PDT'),
      awsItem('Service disruption: Still investigating', 'ec2-eu-west-3_1791480000', 'Thu, 08 Oct 2026 11:00:00 PDT'),
      awsItem('Service disruption: Increased Error Rates', 'lambda-eu-west-3_1791481000', 'Thu, 08 Oct 2026 11:05:00 PDT'),
    ), NOW);
    expect(p.incidents.map((i) => [i.id, i.title, i.start, i.updatedAt])).toEqual([
      ['aws:lambda-eu-west-3', 'Service disruption: Increased Error Rates', '2026-10-08T18:05:00.000Z', '2026-10-08T18:05:00.000Z'],
      ['aws:ec2-eu-west-3', 'Service disruption: Still investigating', '2026-10-08T15:00:00.000Z', '2026-10-08T18:00:00.000Z'],
    ]);
  });
  it('AWS : un événement dont l’élément le plus récent est résolu n’est pas compté (« [RESOLVED] » ou « operating normally »), la zone est sans incident', () => {
    const p = fromAws(awsFeed(
      awsItem('Service disruption: Increased API Error Rates', 'ec2-eu-west-3_1791470000', 'Thu, 08 Oct 2026 08:00:00 PDT'),
      awsItem('[RESOLVED] Increased API Error Rates', 'ec2-eu-west-3_1791480000', 'Thu, 08 Oct 2026 11:00:00 PDT'),
      awsItem('Performance issues', 'rds-eu-west-3_1791470000', 'Wed, 07 Oct 2026 08:00:00 PDT'),
      awsItem('Service is operating normally', 'rds-eu-west-3_1791475000', 'Wed, 07 Oct 2026 09:00:00 PDT'),
    ), NOW);
    expect(p.incidents).toEqual([]);
    expect(p.zone).toMatchObject({ status: 'operational', updatedAt: null });
  });
  it('AWS : un événement rouvert après sa résolution est de nouveau en cours', () => {
    const p = fromAws(awsFeed(
      awsItem('[RESOLVED] Increased API Error Rates', 'ec2-eu-west-3_1791470000', 'Thu, 08 Oct 2026 08:00:00 PDT'),
      awsItem('Service disruption: Increased API Error Rates', 'ec2-eu-west-3_1791480000', 'Thu, 08 Oct 2026 11:00:00 PDT'),
    ), NOW);
    expect(p.incidents.map((i) => i.state)).toEqual(['en-cours']);
  });
  it('Outscale : eu-west-2 et cloudgouv-eu-west-1 seulement', () => {
    const p = fromStatuspage('outscale', 'Outscale', fx('outscale-summary.json'), outscaleFrance, NOW);
    expect(p.zones.map((z) => z.id).sort()).toEqual(['cloudgouv-eu-west-1', 'eu-west-2']);
  });
  it('P6 Outscale : la maintenance [EU-WEST-2] du 13/10 est gardée (titre seul), [US-EAST-2] et [US-WEST-1 ] écartées', () => {
    const p = fromStatuspage('outscale', 'Outscale', fx('outscale-summary.json'), outscaleFrance, NOW);
    expect(p.maintenances.map((m) => [m.title, m.start])).toEqual([['[EU-WEST-2] Maintenance API', '2026-10-13T12:00:00.000Z']]);
    expect(p.maintenances[0]).toMatchObject({ provider: 'outscale', inProgress: false, zones: [] });
  });
});

describe('P7 zones homonymes : le statut le plus grave, la date la plus récente', () => {
  const comp = (name: string, status: string, updated: string): object => ({ name, status, updated_at: updated });
  const page = (...components: object[]): object => ({ page: { updated_at: '2026-10-08T19:00:00Z' }, components, incidents: [], scheduled_maintenances: [] });

  it('deux « GRA » (public-cloud puis bare-metal) : la panne partielle du premier n’est pas masquée par le second, opérationnel', () => {
    const p = fromStatuspage('ovhcloud', 'OVHcloud', page(
      comp('GRA', 'partial_outage', '2026-10-08T18:00:00Z'), comp('GRA', 'operational', '2026-10-08T17:00:00Z'), comp('RBX', 'operational', '2026-10-08T16:00:00Z'),
    ), OVH, NOW);
    expect(p.zones.map((z) => [z.id, z.status, z.updatedAt])).toEqual([['GRA', 'partial', '2026-10-08T18:00:00.000Z'], ['RBX', 'operational', '2026-10-08T16:00:00.000Z']]);
  });
  it('la date la plus récente est gardée même quand elle vient du composant le moins grave ; la grille de gravité est complète', () => {
    const p = fromStatuspage('ovhcloud', 'OVHcloud', page(
      comp('GRA', 'degraded_performance', '2026-10-08T10:00:00Z'), comp('GRA', 'operational', '2026-10-08T19:30:00Z'),
      comp('RBX', 'operational', '2026-10-08T10:00:00Z'), comp('RBX', 'under_maintenance', '2026-10-08T10:00:00Z'),
      comp('SBG', 'operational', '2026-10-08T10:00:00Z'), comp('SBG', 'major_outage', '2026-10-08T10:00:00Z'), comp('SBG', 'partial_outage', '2026-10-08T10:00:00Z'),
      comp('PAR', 'bizarre', '2026-10-08T10:00:00Z'), comp('PAR', 'operational', '2026-10-08T10:00:00Z'),
    ), OVH, NOW);
    expect(p.zones.map((z) => [z.id, z.status])).toEqual([['GRA', 'degraded'], ['RBX', 'maintenance'], ['SBG', 'major'], ['PAR', 'operational']]);
    expect(p.zones[0].updatedAt).toBe('2026-10-08T19:30:00.000Z');
  });
  it('buildCloud : la même règle entre deux pages du même fournisseur (public-cloud puis bare-metal)', () => {
    const a = fromStatuspage('ovhcloud', 'OVHcloud', page(comp('GRA', 'major_outage', '2026-10-08T18:00:00Z')), OVH, NOW);
    const b = fromStatuspage('ovhcloud', 'OVHcloud', page(comp('GRA', 'operational', '2026-10-08T19:00:00Z')), OVH, NOW);
    const r = buildCloud({ statuspages: [a, b], reference: { generatedAt: null, datacenters: [], exchanges: [] }, readAt: '2026-10-08T19:50:00.000Z', errors: [] }, NOW);
    expect(r.providers.find((p) => p.provider === 'ovhcloud')?.zones).toMatchObject([{ id: 'GRA', status: 'major', updatedAt: '2026-10-08T19:00:00.000Z' }]);
  });
});

describe('réponse', () => {
  const reference = { generatedAt: null, datacenters: [], exchanges: [] };
  it('Azure dit qu’il ne publie pas d’état par région France ; incidents comptés une fois', () => {
    const r = buildCloud({
      statuspages: [fromStatuspage('scaleway', 'Scaleway', fx('scaleway-summary.json'), scalewayFrance, NOW)],
      cloudflare: fromCloudflare(fx('cloudflare-components.json')), gcp: fromGcp(fx('gcp-incidents.json'), NOW), aws: fromAws(txt('aws-all.rss'), NOW),
      reference: { generatedAt: null, datacenters: [], exchanges: [] }, readAt: '2026-10-08T19:50:00.000Z', errors: [],
    }, NOW);
    expect(r.providers.find((p) => p.provider === 'azure')?.note).toBe('Azure ne publie pas d’état par région France.');
    expect(r.incidents.filter((i) => i.state === 'en-cours')).toHaveLength(2);
  });
  it('sept fournisseurs dans l’ordre fixe ; un fournisseur sans donnée n’a ni lecture ni zone (n.d., jamais opérationnel)', () => {
    const r = buildCloud({ statuspages: [], reference, readAt: '2026-10-08T19:50:00.000Z', errors: [] }, NOW);
    expect(r.providers.map((p) => p.provider)).toEqual(['ovhcloud', 'scaleway', 'cloudflare', 'gcp', 'aws', 'outscale', 'azure']);
    expect(r.providers.every((p) => p.readAt === null && p.zones.length === 0)).toBe(true);
  });
  it('les noms du serveur sont ceux du client (CLOUD_PROVIDER_LABEL)', () => {
    const r = buildCloud({ statuspages: [], reference, readAt: null, errors: [] }, NOW);
    expect(Object.fromEntries(r.providers.map((p) => [p.provider, p.label]))).toEqual(CLOUD_PROVIDER_LABEL);
  });
  it('P8 : readAt d’un fournisseur = sa lecture réussie fournie (readAts), à défaut l’heure de la réponse s’il a des données', () => {
    const r = buildCloud({
      statuspages: [fromStatuspage('scaleway', 'Scaleway', fx('scaleway-summary.json'), scalewayFrance, NOW)], cloudflare: fromCloudflare(fx('cloudflare-components.json')),
      reference, readAt: '2026-10-08T19:50:00.000Z', readAts: { scaleway: '2026-10-08T19:10:00.000Z' }, errors: [],
    }, NOW);
    expect(r.providers.find((p) => p.provider === 'scaleway')?.readAt).toBe('2026-10-08T19:10:00.000Z');
    expect(r.providers.find((p) => p.provider === 'cloudflare')?.readAt).toBe('2026-10-08T19:50:00.000Z');
    expect(r.providers.find((p) => p.provider === 'gcp')?.readAt).toBeNull();
  });
  it('P31 : l’erreur d’une page OVH est portée par le fournisseur OVHcloud, nommée par page', () => {
    const r = buildCloud({ statuspages: [], reference, readAt: null, errors: ['OVHcloud (network) : HTTP 503', 'Scaleway : HTTP 503'] }, NOW);
    expect(r.providers.find((p) => p.provider === 'ovhcloud')?.error).toBe('OVHcloud (network) : HTTP 503');
    expect(r.providers.find((p) => p.provider === 'scaleway')?.error).toBe('Scaleway : HTTP 503');
    expect(r.providers.find((p) => p.provider === 'gcp')?.error).toBeNull();
  });
});

// ─── Collecte : parties par fournisseur, référentiel, KV simulé ───

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ms="http://mapserver.gis.umn.edu/mapserver" xmlns:gml="http://www.opengis.net/gml/3.2" numberReturned="1">
  <wfs:member>
    <ms:L_DATA_CENTER_P_R11>
      <ms:geometry><gml:Point gml:id=".1" srsName="urn:ogc:def:crs:EPSG::2154"><gml:pos>651865.575600 6863490.922600</gml:pos></gml:Point></ms:geometry>
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
const UMAP = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [5.37, 43.3] }, properties: { name: 'Projet Alpha - Marseille', description: 'Construction en cours.' } }],
};

let store: Map<string, string>;
beforeEach(() => {
  __resetSwrCacheForTests(); __resetKvForTests(); __resetCloudForTests();
  store = new Map<string, string>();
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

/** Route du jour ; `down` : URL (ou préfixes) servies en 503. */
const route = (down: readonly string[] = [], withReference = true) => (url: string): FakeResponse => {
  if (down.some((d) => url.startsWith(d))) return respond('indisponible', 503);
  if (withReference && url.startsWith(WFS_PREFIX)) return respond(SAMPLE_XML);
  if (withReference && url.startsWith(UMAP_PREFIX)) return respond(UMAP);
  return cloudRoute(url);
};
const provider = (r: CloudOutagesResponse, p: CloudProvider) => r.providers.find((x) => x.provider === p);
const NETWORK = OVH_STATUS_PAGES[2];

describe('collecte', () => {
  it('première lecture : sept fournisseurs, readAt = heure de lecture du serveur (jamais la date de la page), aucune erreur', async () => {
    stubFetch(route());
    const r = await collectCloud(NOW);
    const at = new Date(NOW).toISOString();
    expect(r.providers.map((p) => p.provider)).toEqual(['ovhcloud', 'scaleway', 'cloudflare', 'gcp', 'aws', 'outscale', 'azure']);
    expect(r.providers.filter((p) => p.provider !== 'azure').every((p) => p.readAt === at)).toBe(true);
    expect(provider(r, 'azure')?.readAt).toBeNull();
    expect(r.readAt).toBe(at);
    expect(r.errors).toEqual([]);
    expect(r.incidents.filter((i) => i.state === 'en-cours')).toHaveLength(2);
    expect(r.incidents.filter((i) => i.state === 'surveille')).toHaveLength(2);
    expect(r.elsewhere.length).toBeGreaterThanOrEqual(5);
    expect(r.maintenances.map((m) => m.title.slice(0, 5))).toEqual(expect.arrayContaining(['[RBX4', '[RBX8', '[EU-W']));
    // Le relevé est écrit en KV sous la clé du Cloud, avec une partie par page d'état et une pour le référentiel.
    const kept = await kvGetJson(CLOUD_LAST_KEY, NOW) as { parts: Record<string, unknown>; body: unknown } | null;
    expect(Object.keys(kept?.parts ?? {}).sort()).toEqual([
      'aws', 'cloudflare', 'gcp', 'outscale', 'ovhcloud:bare-metal-servers', 'ovhcloud:network', 'ovhcloud:public-cloud', 'ovhcloud:web-cloud', 'reference', 'scaleway',
    ]);
    expect(kept?.body).toEqual(r);
  });

  it('P8 : une page OVH en échec garde ses données, nomme son erreur par page (P31), garde l’ancienne lecture ; les autres pages avancent', async () => {
    stubFetch(route());
    await collectCloud(NOW);
    const later = NOW + 31 * MIN;
    const log = stubFetch(route([NETWORK]));
    const r = await collectCloud(later);
    expect(r.errors).toEqual(['OVHcloud (network) : HTTP 503']);
    expect(provider(r, 'ovhcloud')?.error).toBe('OVHcloud (network) : HTTP 503');
    // Les maintenances RBX4 et RBX8 de la page en échec sont gardées.
    expect(r.maintenances.map((m) => m.title.slice(0, 5))).toEqual(expect.arrayContaining(['[RBX4', '[RBX8']));
    // OVHcloud : la page la plus ancienne dicte la date ; Scaleway a avancé.
    expect(provider(r, 'ovhcloud')?.readAt).toBe(new Date(NOW).toISOString());
    expect(provider(r, 'scaleway')?.readAt).toBe(new Date(later).toISOString());
    expect(log.urls.filter((u) => u === NETWORK)).toHaveLength(1);
    // Nouvel essai de la seule page en échec, 5 min plus tard (pas 30).
    const retry = stubFetch(route());
    await ensureCloudFresh(later + 4 * MIN);
    expect(retry.urls).toEqual([]);
    const recovered = await ensureCloudFresh(later + 5 * MIN);
    expect(retry.urls.filter((u) => u.startsWith('https://') && !u.includes('peeringdb'))).toEqual([NETWORK]);
    expect(recovered.errors).toEqual([]);
    expect(provider(recovered, 'ovhcloud')?.readAt).toBe(new Date(later).toISOString());
  });

  it('un fournisseur jamais lu : readAt null, aucune zone, erreur nommée ; les autres sont servis', async () => {
    stubFetch(route([SCALEWAY_SUMMARY_URL]));
    const r = await collectCloud(NOW);
    expect(provider(r, 'scaleway')).toMatchObject({ readAt: null, zones: [], error: 'Scaleway : HTTP 503' });
    expect(provider(r, 'cloudflare')?.readAt).toBe(new Date(NOW).toISOString());
    expect(r.errors).toEqual(['Scaleway : HTTP 503']);
  });

  it('toutes les pages en échec : aucune lecture, aucune zone, chaque page nommée', async () => {
    stubFetch(route(['https://'], false));
    const r = await collectCloud(NOW);
    expect(r.readAt).toBeNull();
    expect(r.providers.every((p) => p.readAt === null && p.zones.length === 0)).toBe(true);
    expect(r.errors).toEqual(expect.arrayContaining([
      'OVHcloud (public-cloud) : HTTP 503', 'OVHcloud (web-cloud) : HTTP 503', 'OVHcloud (network) : HTTP 503', 'OVHcloud (bare-metal-servers) : HTTP 503',
      'Scaleway : HTTP 503', 'Outscale : HTTP 503', 'Cloudflare : HTTP 503', 'Google Cloud : HTTP 503', 'AWS : HTTP 503',
    ]));
  });

  it('cadence : pas de nouvelle lecture avant 29 min ; une relecture de tout au bout de 30 min', async () => {
    stubFetch(route());
    await ensureCloudFresh(NOW);
    const early = stubFetch(route());
    await ensureCloudFresh(NOW + 20 * MIN);
    expect(early.urls).toEqual([]);
    const due = stubFetch(route());
    await ensureCloudFresh(NOW + 30 * MIN);
    expect(due.urls.filter((u) => u === SCALEWAY_SUMMARY_URL)).toHaveLength(1);
    expect(due.urls.filter((u) => u.startsWith(WFS_PREFIX) || u.startsWith(UMAP_PREFIX))).toEqual([]);   // le référentiel a sa cadence (6 h)
  });
});

describe('référentiel (inventaire, jamais un état)', () => {
  it('P11 : stage, power et source portés par chaque site ; état non publié = null', async () => {
    stubFetch(route());
    const r = await collectCloud(NOW);
    const leonix = r.reference.datacenters.find((d) => d.name.startsWith('Leonix Datacenter'));
    expect(leonix).toMatchObject({ operator: 'Leonix Telecom', stage: 'en exploitation', power: 'moins de 10MW', source: 'data.gouv.fr DRIEAT IDF WFS' });
    expect(leonix?.lat).toBeCloseTo(48.86, 1);
    const alpha = r.reference.datacenters.find((d) => d.name === 'Projet Alpha - Marseille');
    expect(alpha).toMatchObject({ stage: 'en construction', lon: 5.37, lat: 43.3 });
    expect(alpha?.source).toMatch(/uMap/i);
    // Aucun site sans coordonnées, aucune chaîne « inconnu » ni libellé de supervision prise pour un état d'avancement.
    expect(r.reference.datacenters.every((d) => Number.isFinite(d.lat) && Number.isFinite(d.lon))).toBe(true);
    expect(r.reference.datacenters.some((d) => d.stage === 'inconnu' || d.stage === 'surveillance opérateur' || d.stage === '')).toBe(false);
    expect(r.reference.datacenters.some((d) => d.power === '')).toBe(false);
    expect(r.reference.datacenters.every((d) => d.source.length > 0)).toBe(true);
    expect(r.reference.generatedAt).toBe(new Date(NOW).toISOString());
    expect(r.reference.exchanges.length).toBeGreaterThan(5);
    expect(r.reference.exchanges.find((x) => x.id === 34)).toEqual({ id: 34, name: 'SFINX', city: 'Paris', url: 'https://www.peeringdb.com/ix/34' });
  });

  it('P9 : les deux lectures du référentiel passent par la lecture stricte (User-Agent FranceMonitor)', async () => {
    const log = stubFetch(route());
    await collectCloud(NOW);
    const sent = log.urls.map((u, i) => ({ u, ua: sentHeader(log.inits[i], 'User-Agent') }));
    const reference = sent.filter((x) => x.u.startsWith(WFS_PREFIX) || x.u.startsWith(UMAP_PREFIX) || x.u === PEERINGDB_IX_URL);
    expect(reference.length).toBeGreaterThanOrEqual(3);
    expect(reference.every((x) => x.ua === 'FranceMonitor/1.0 (+https://www.francemonitor.com)')).toBe(true);
    expect(sent.every((x) => x.ua === 'FranceMonitor/1.0 (+https://www.francemonitor.com)')).toBe(true);
  });

  it('une lecture du référentiel en échec est nommée, les pages d’état restent servies et le référentiel gardé est resservi', async () => {
    stubFetch(route());
    await collectCloud(NOW);
    const later = NOW + 7 * 60 * MIN;
    stubFetch(route([WFS_PREFIX]));
    const r = await collectCloud(later);
    expect(r.errors).toEqual(['Référentiel (DRIEAT) : HTTP 503']);
    expect(r.reference.datacenters.some((d) => d.name.startsWith('Leonix'))).toBe(true);
    expect(r.reference.generatedAt).toBe(new Date(NOW).toISOString());   // dernière relecture COMPLÈTE
    expect(provider(r, 'scaleway')?.error).toBeNull();
  });

  it('première lecture sans le WFS : sans date de relecture, erreur nommée, sites embarqués servis', async () => {
    stubFetch(route([WFS_PREFIX]));
    const r = await collectCloud(NOW);
    expect(r.errors).toEqual(['Référentiel (DRIEAT) : HTTP 503']);
    expect(r.reference.generatedAt).toBeNull();
    expect(r.reference.datacenters.some((d) => d.name.startsWith('Leonix'))).toBe(false);
    expect(r.reference.datacenters.length).toBeGreaterThan(0);
  });

  it('PeeringDB en échec : points d’échange vides et erreur nommée, jamais un compte inventé', async () => {
    stubFetch(route([PEERINGDB_IX_URL]));
    const r = await collectCloud(NOW);
    expect(r.errors).toEqual(['PeeringDB : HTTP 503']);
    expect(r.reference.exchanges).toEqual([]);
  });
});

describe('relevé gardé', () => {
  it('storedCloud : le dernier relevé avec la note ; emptyCloud sans lecture : listes vides, jamais « aucun incident »', async () => {
    stubFetch(route());
    await collectCloud(NOW);
    const s = await storedCloud(NOW + MIN, CLOUD_PENDING_NOTE);
    expect(s.errors).toEqual([CLOUD_PENDING_NOTE]);
    expect(s.providers).toHaveLength(7);
    __resetKvForTests();
    __setKvClientForTests({ get: async () => null, set: async () => undefined });
    const none = await storedCloud(NOW, CLOUD_PENDING_NOTE);
    expect(none).toEqual({ ...emptyCloud(), errors: [CLOUD_PENDING_NOTE] });
    expect(emptyCloud(['x']).providers).toEqual([]);
    expect(emptyCloud().readAt).toBeNull();
  });
});
