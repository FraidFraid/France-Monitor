import { applyMinistersCors, handleMinistersRequest } from '../_shared/ministers.js';

export default async function handler(req, res) {
  applyMinistersCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (!(await handleMinistersRequest(req, res))) {
    res.status(404).json({ error: 'Not found' });
  }
}
