// tests/helpers/outages-b-fixtures.ts : aides de test partagées de la phase B des panneaux Pannes réseau (jeux d'essai du 08/10/2026,
// tests/fixtures/outages/). `internetRoute` simule IODA et Cloudflare Radar pour les tests du collecteur et de la route Internet.
import { readFileSync } from 'node:fs';
import { IODA_BASE, RADAR_ANOMALIES_URL, RADAR_OUTAGES_URL } from '../../api/_lib/outages-internet.js';
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
