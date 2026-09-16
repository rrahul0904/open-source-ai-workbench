import { handleApi } from '../src/http.mjs';

export async function vercelAdapter(req, res, path) {
  let body = req.body ?? null;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const response = await handleApi({
    method: req.method,
    path,
    headers: req.headers,
    body,
    clientKey: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'vercel'
  });
  res.status(response.status).json(response.body);
}
