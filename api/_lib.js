const crypto = require('crypto');
const { put, list } = require('@vercel/blob');

const GRAPH = 'https://graph.facebook.com/v21.0';
const MANIFEST_PATH = 'gestodonto-posts/manifest.json';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload) {
  return b64url(crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(payload).digest());
}

function issueSession() {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `admin|${expires}`;
  return b64url(payload) + '.' + sign(payload);
}

function verifySession(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return false;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return false;
  const payload = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  if (sign(payload) !== sig) return false;
  const [, expiresStr] = payload.split('|');
  const expires = Number(expiresStr);
  return Number.isFinite(expires) && Date.now() <= expires;
}

function requireSession(req, res) {
  if (!verifySession(req)) {
    res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    return false;
  }
  return true;
}

function requireCronSecret(req, res) {
  const secret = req.headers['x-cron-secret'];
  if (!secret || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Cron secret inválido.' });
    return false;
  }
  return true;
}

async function readManifest() {
  try {
    const { blobs } = await list({ prefix: MANIFEST_PATH, token: process.env.BLOB_READ_WRITE_TOKEN, limit: 1 });
    if (!blobs || !blobs.length) return { pending: [], history: [] };
    const resp = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!resp.ok) return { pending: [], history: [] };
    const data = await resp.json();
    return { pending: Array.isArray(data.pending) ? data.pending : [], history: Array.isArray(data.history) ? data.history : [] };
  } catch (e) {
    return { pending: [], history: [] };
  }
}

async function writeManifest(manifest) {
  await put(MANIFEST_PATH, JSON.stringify(manifest, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

async function metaFetch(path, { method = 'GET', body } = {}) {
  const url = `${GRAPH}${path}`;
  const opts = { method };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(url, opts);
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (json && json.error && json.error.message) || `Graph API error (${resp.status})`;
    const err = new Error(msg);
    err.graph = json;
    throw err;
  }
  return json;
}

async function getPageAccessToken() {
  const data = await metaFetch(`/${process.env.FB_PAGE_ID}?fields=access_token&access_token=${encodeURIComponent(process.env.META_ACCESS_TOKEN)}`);
  return data.access_token;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

module.exports = {
  GRAPH,
  issueSession,
  verifySession,
  requireSession,
  requireCronSecret,
  readManifest,
  writeManifest,
  metaFetch,
  getPageAccessToken,
  readJsonBody,
};
