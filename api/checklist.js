const { list, put } = require('@vercel/blob');
const { readJsonBody } = require('./_lib');

const STATE_PATH = 'gestodonto-checklist/state.json';

async function readState() {
  try {
    const { blobs } = await list({ prefix: STATE_PATH, token: process.env.BLOB_READ_WRITE_TOKEN, limit: 1 });
    if (!blobs || !blobs.length) return {};
    const resp = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!resp.ok) return {};
    const data = await resp.json();
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

async function writeState(state) {
  await put(STATE_PATH, JSON.stringify(state, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const state = await readState();
    res.status(200).json(state);
    return;
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      res.status(400).json({ error: 'JSON inválido.' });
      return;
    }
    const id = body && body.id;
    if (typeof id !== 'string' || !/^chk-\d+$/.test(id)) {
      res.status(400).json({ error: 'id inválido.' });
      return;
    }
    const checked = !!(body && body.checked);
    const state = await readState();
    state[id] = checked;
    await writeState(state);
    res.status(200).json(state);
    return;
  }

  res.status(405).json({ error: 'Método não permitido.' });
};
