const fs = require('fs');
const path = require('path');
const { requireSession } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }
  if (!requireSession(req, res)) return;

  const html = fs.readFileSync(path.join(__dirname, '_strategic-content.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(html);
};
