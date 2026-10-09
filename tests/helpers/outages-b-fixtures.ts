// tests/helpers/outages-b-fixtures.ts : aides de test partagées de la phase B des panneaux Pannes réseau (jeux d'essai du 08/10/2026,
// tests/fixtures/outages/). `internetRoute` simule IODA et Cloudflare Radar pour les tests du collecteur et de la route Internet ;
// `cloudRoute` simule les sept pages d'état cloud et les trois lectures du référentiel (collecteur et route Cloud).
import { readFileSync } from 'node:fs';
import {
  AWS_RSS_URL, CLOUDFLARE_COMPONENTS_URL, GCP_INCIDENTS_URL, OUTSCALE_SUMMARY_URL, OVH_STATUS_PAGES, SCALEWAY_SUMMARY_URL,
} from '../../api/_lib/outages-cloud.js';
import { IODA_BASE, RADAR_ANOMALIES_URL, RADAR_OUTAGES_URL } from '../../api/_lib/outages-internet.js';
import { PEERINGDB_IX_URL } from '../../api/_lib/peeringdb.js';
import { respond } from './traffic-fixtures.ts';
import type { FakeResponse } from './traffic-fixtures.ts';

/** Contenu texte d'un jeu d'essai de tests/fixtures/outages/. */
export const outagesFixture = (name: string): string => readFileSync(new URL(`../fixtures/outages/${name}`, import.meta.url), 'utf8');

/** Réponses du jour du jeu d'essai : IODA (pays, régions, Scaleway ; les autres opérateurs sans événement) et Radar. */
export function internetRoute(url: string): FakeResponse {
  if (url.startsWith(`${IODA_BASE}/outages/events?entityType=region`)) return respond(outagesFixture('ioda-events-regions-30j.json'));
  if (url.startsWith(`${IODA_BASE}/outages/events?entityType=country`)) return respond(outagesFixture('ioda-events-fr-30j.json'));
  if (url.startsWith(`${IODA_BASE}/outages/events?entityType=asn&entityCode=12876`)) return respond(outagesFixture('ioda-events-as12876-30j.json'));
  if (url.startsWith(`${IODA_BASE}/outages/events?entityType=asn`)) return respond({ data: [] });
  if (url.startsWith(RADAR_ANOMALIES_URL)) return respond(outagesFixture('radar-traffic-anomalies-fr.json'));
  if (url.startsWith(RADAR_OUTAGES_URL)) return respond(outagesFixture('radar-outages-fr.json'));
  return respond('introuvable', 404);
}

/** Les quatre pages d'état OVHcloud, dans l'ordre d'OVH_STATUS_PAGES, et leurs jeux d'essai. */
const OVH_FIXTURES = ['ovh-public-cloud-summary.json', 'ovh-web-cloud-summary.json', 'ovh-network-summary.json', 'ovh-bare-metal-servers-summary.json'];

/** Jeu d'essai PeeringDB (points d'échange français), rangé avec ceux de la Souveraineté. */
const peeringdbFixture = (): string => readFileSync(new URL('../fixtures/sovereignty/peeringdb-ix-fr.json', import.meta.url), 'utf8');

/**
 * Réponses du jour du jeu d'essai pour le collecteur Cloud : sept pages d'état, PeeringDB, et deux référentiels vides (WFS DRIEAT et uMap
 * sans site : le référentiel se réduit alors aux inventaires embarqués).
 */
export function cloudRoute(url: string): FakeResponse {
  const ovh = OVH_STATUS_PAGES.indexOf(url);
  if (ovh >= 0) return respond(outagesFixture(OVH_FIXTURES[ovh]));
  if (url === SCALEWAY_SUMMARY_URL) return respond(outagesFixture('scaleway-summary.json'));
  if (url === OUTSCALE_SUMMARY_URL) return respond(outagesFixture('outscale-summary.json'));
  if (url === CLOUDFLARE_COMPONENTS_URL) return respond(outagesFixture('cloudflare-components.json'));
  if (url === GCP_INCIDENTS_URL) return respond(outagesFixture('gcp-incidents.json'));
  if (url === AWS_RSS_URL) return respond(outagesFixture('aws-all.rss'));
  if (url === PEERINGDB_IX_URL) return respond(peeringdbFixture());
  if (url.startsWith('https://ogc.geo-ide.developpement-durable.gouv.fr/')) return respond('<?xml version="1.0"?><wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"></wfs:FeatureCollection>');
  if (url.startsWith('https://umap.openstreetmap.fr/')) return respond({ type: 'FeatureCollection', features: [] });
  return respond('introuvable', 404);
}
