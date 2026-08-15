const { requireSession, readManifest } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }
  if (!requireSession(req, res)) return;

  const manifest = await readManifest();
  const pending = [...manifest.pending].sort((a, b) => (a.scheduleAt || 0) - (b.scheduleAt || 0));
  const history = [...manifest.history].sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)).slice(0, 100);

  res.status(200).json({ pending, history });
};
