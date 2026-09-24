// api/_handlers/events.js — GET /api/events?status=active,cooling&limit=40
// Événements consolidés (articles regroupés par le cron d'ingestion), classés par gravité,
// corroboration puis fraîcheur. Voir api/_lib/news-events-read.js.

import { listEvents, parseLimit, parseStatuses, serveEventsQuery } from '../_lib/news-events-read.js';

export default function handler(req, res) {
  return serveEventsQuery(req, res, 'api/events', async (sql, params) => ({
    status: 200,
    body: {
      events: await listEvents(sql, { statuses: parseStatuses(params.get('status')), limit: parseLimit(params.get('limit')) }),
      generatedAt: new Date().toISOString(),
    },
  }));
}
