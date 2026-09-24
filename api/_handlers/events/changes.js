// api/_handlers/events/changes.js — GET /api/events/changes?since=ISO|epochMs
// Fil « depuis votre dernière visite » : totaux par type de changement et détail des
// changements notables. Le client arrondit `since` à 5 min pour que le CDN mutualise.

import { listChanges, parseSince, serveEventsQuery } from '../../_lib/news-events-read.js';

export default function handler(req, res) {
  return serveEventsQuery(req, res, 'api/events/changes', async (sql, params) => ({
    status: 200,
    body: await listChanges(sql, parseSince(params.get('since'), Date.now())),
  }));
}
