import { vercelAdapter } from '../_adapter.js';
export default async function handler(req, res) { return vercelAdapter(req, res, '/api/workflows/run'); }
