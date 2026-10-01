import { liveMoonshootEngine, MoonshootError } from './moonshoot.mjs';

function identity(headers = {}) {
  return headers['x-moonshoot-identity'] || headers['X-Moonshoot-Identity'] || '';
}

function response(status, body) { return { status, body }; }

export async function handleMoonshootApi({ method, path, headers = {}, body = null }) {
  try {
    if (method === 'GET' && path === '/api/moonshoot/state') return response(200, liveMoonshootEngine.snapshot());
    if (method === 'GET' && path === '/api/moonshoot/manifest') return response(200, { entries: liveMoonshootEngine.manifest() });
    const identityKey = identity(headers);
    if (method === 'POST' && path === '/api/moonshoot/claims') return response(201, await liveMoonshootEngine.claim({ ...(body || {}), identityKey }));
    if (method === 'POST' && path === '/api/moonshoot/fuel') return response(200, await liveMoonshootEngine.giveFuel({ ...(body || {}), identityKey }));
    if (method === 'POST' && path === '/api/moonshoot/updates') return response(201, await liveMoonshootEngine.postUpdate({ ...(body || {}), identityKey }));
    if (method === 'POST' && path === '/api/moonshoot/events') return response(200, await liveMoonshootEngine.recordEvent(body || {}));
    if (method === 'POST' && path === '/api/moonshoot/reports') return response(200, await liveMoonshootEngine.report({ ...(body || {}), identityKey }));
    return null;
  } catch (error) {
    if (error instanceof MoonshootError) return response(error.statusCode, { error: error.message, code: error.code });
    throw error;
  }
}
