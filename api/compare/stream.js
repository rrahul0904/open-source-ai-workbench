import { streamComparison } from '../../src/compare/http.mjs';
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let body = req.body ?? null;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  return streamComparison({ req, res, body, clientKey: req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'serverless' });
}
