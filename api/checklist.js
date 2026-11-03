const { list, put, del } = require('@vercel/blob');
const { readJsonBody } = require('./_lib');

// Cada item marcado vira um arquivo próprio em ITEMS_PREFIX (ex.: .../items/chk-7).
// O estado é lido pela listagem de arquivos (metadados da API do Blob), e não
// baixando um JSON pelo CDN: assim não há cópia em cache desatualizada e
// marcar um item nunca reescreve (nem desmarca) os outros.
const ITEMS_PREFIX = 'gestodonto-checklist/items/';
const MIGRATED_MARKER = 'gestodonto-checklist/items-migrated';
const LEGACY_STATE_PATH = 'gestodonto-checklist/state.json';
const TOKEN = () => process.env.BLOB_READ_WRITE_TOKEN;

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000, token: TOKEN() });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function markItem(id) {
  await put(ITEMS_PREFIX + id, '1', {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'text/plain',
    token: TOKEN(),
  });
}

async function unmarkItem(id) {
  const blobs = await listAll(ITEMS_PREFIX + id);
  const exact = blobs.filter((b) => b.pathname === ITEMS_PREFIX + id).map((b) => b.url);
  if (exact.length) await del(exact, { token: TOKEN() });
}

// Migra uma única vez o state.json antigo para o formato de um arquivo por item.
async function migrateLegacyOnce() {
  const marker = await listAll(MIGRATED_MARKER);
  if (marker.some((b) => b.pathname === MIGRATED_MARKER)) return;
  const legacy = (await listAll(LEGACY_STATE_PATH)).find((b) => b.pathname === LEGACY_STATE_PATH);
  if (legacy) {
    try {
      const resp = await fetch(legacy.url + '?v=' + Date.now(), { cache: 'no-store' });
      const data = resp.ok ? await resp.json() : {};
      const ids = Object.keys(data || {}).filter((id) => data[id] === true && /^chk-\d+$/.test(id));
      await Promise.all(ids.map(markItem));
    } catch (e) {
      // sem estado antigo legível: começa vazio
    }
  }
  await put(MIGRATED_MARKER, String(Date.now()), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'text/plain',
    token: TOKEN(),
  });
}

async function readState() {
  await migrateLegacyOnce();
  const blobs = await listAll(ITEMS_PREFIX);
  const state = {};
  blobs.forEach((b) => {
    const id = b.pathname.slice(ITEMS_PREFIX.length);
    if (/^chk-\d+$/.test(id)) state[id] = true;
  });
  return state;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      res.status(200).json(await readState());
    } catch (e) {
      res.status(500).json({ error: 'Falha ao ler o checklist.' });
    }
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
    try {
      await migrateLegacyOnce();
      if (checked) await markItem(id);
      else await unmarkItem(id);
      const state = await readState();
      // garante que a resposta reflete esta ação mesmo se a listagem atrasar
      if (checked) state[id] = true;
      else delete state[id];
      res.status(200).json(state);
    } catch (e) {
      res.status(500).json({ error: 'Falha ao salvar o checklist.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método não permitido.' });
};
