import { catalogResponse } from '../../src/compare/http.mjs';
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const result = catalogResponse(req.headers);
  return res.status(result.status).setHeader('cache-control', 'no-store').json(result.body);
}
