// api/_handlers/events/detail.js — GET /api/events/detail?id=42
// Un événement, ses articles (≤ 50, du plus ancien au plus récent) et son journal.

import { getEventDetail, serveEventsQuery } from '../../_lib/news-events-read.js';

export default function handler(req, res) {
  return serveEventsQuery(req, res, 'api/events/detail', async (sql, params) => {
    const id = Number(params.get('id'));
    if (!Number.isSafeInteger(id) || id <= 0) return { status: 400, body: { error: 'invalid id' } };
    const detail = await getEventDetail(sql, id);
    return detail ? { status: 200, body: detail } : { status: 404, body: { error: 'event not found' } };
  });
}
