const { requireSession, readManifest, writeManifest, metaFetch, getPageAccessToken, readJsonBody } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }
  if (!requireSession(req, res)) return;

  let id = (req.query && req.query.id) || null;
  if (!id) {
    try {
      const body = await readJsonBody(req);
      id = body && body.id;
    } catch (e) { /* sem corpo, tudo bem se veio via query */ }
  }
  if (!id) {
    res.status(400).json({ error: 'id é obrigatório.' });
    return;
  }

  const manifest = await readManifest();
  const idx = manifest.pending.findIndex((p) => p.id === id);
  if (idx === -1) {
    res.status(404).json({ error: 'Post pendente não encontrado (talvez já tenha sido publicado).' });
    return;
  }
  const entry = manifest.pending[idx];

  if (entry.platform === 'fb' && entry.fbPostId) {
    try {
      const pageToken = await getPageAccessToken();
      await metaFetch(`/${entry.fbPostId}?access_token=${encodeURIComponent(pageToken)}`, { method: 'DELETE' });
    } catch (e) {
      // Se já não existir mais no Meta (ex: prazo mínimo de agendamento passou), seguimos removendo do manifesto mesmo assim.
    }
  }
  // Para IG: o container simplesmente expira sozinho no Meta se nunca for publicado — nada a fazer lá.

  manifest.pending.splice(idx, 1);
  await writeManifest(manifest);
  res.status(200).json({ ok: true });
};
