const { requireCronSecret, readManifest, writeManifest, metaFetch } = require('./_lib');

const IG_USER_ID = process.env.IG_USER_ID;
const META_TOKEN = process.env.META_ACCESS_TOKEN;

async function isVideoReady(creationId) {
  const data = await metaFetch(`/${creationId}?fields=status_code&access_token=${encodeURIComponent(META_TOKEN)}`);
  if (data.status_code === 'ERROR') throw new Error('Processamento do vídeo falhou no Meta.');
  return data.status_code === 'FINISHED';
}

async function publishIg(creationId) {
  const data = await metaFetch(`/${IG_USER_ID}/media_publish`, {
    method: 'POST',
    body: { creation_id: creationId, access_token: META_TOKEN },
  });
  return data.id;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }
  if (!requireCronSecret(req, res)) return;

  const manifest = await readManifest();
  const now = Date.now();
  const stillPending = [];
  let published = 0;
  let errors = 0;

  // Só Instagram passa por aqui — Facebook é agendado nativamente pelo próprio Meta.
  for (const entry of manifest.pending) {
    if (entry.platform !== 'ig') {
      stillPending.push(entry);
      continue;
    }
    if ((entry.scheduleAt || 0) > now) {
      stillPending.push(entry);
      continue;
    }
    try {
      if (entry.needsVideoPoll) {
        const ready = await isVideoReady(entry.containerId);
        if (!ready) {
          stillPending.push(entry); // tenta de novo no próximo tick
          continue;
        }
      }
      const publishedId = await publishIg(entry.containerId);
      entry.status = 'published';
      entry.publishedId = publishedId;
      entry.publishedAt = now;
      manifest.history.unshift(entry);
      published++;
    } catch (e) {
      entry.status = 'error';
      entry.error = e.message;
      entry.lastAttemptAt = now;
      stillPending.push(entry); // fica pra tentar de novo; cancelamento manual remove definitivamente
      errors++;
    }
  }

  manifest.pending = stillPending;
  manifest.history = manifest.history.slice(0, 200);
  await writeManifest(manifest);

  res.status(200).json({ ok: true, checked: manifest.pending.length + published + errors, published, errors });
};
