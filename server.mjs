import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './src/http.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256_000) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : null;
      const response = await handleApi({ method: req.method, path: url.pathname, headers: req.headers, body, clientKey: req.socket.remoteAddress || 'local' });
      res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(response.body));
      return;
    }

    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const target = path.resolve(root, 'public', relative);
    const publicRoot = path.resolve(root, 'public');
    if (!target.startsWith(publicRoot)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    try {
      const content = await readFile(target);
      res.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream', 'cache-control': path.extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      res.end(content);
    } catch {
      const content = await readFile(path.join(publicRoot, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(content);
    }
  } catch (error) {
    res.writeHead(error.statusCode || 500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message || 'Internal error' }));
  }
});

server.listen(port, '0.0.0.0', () => console.log(`AI Workbench listening on http://0.0.0.0:${port}`));
