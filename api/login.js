const { issueSession, readJsonBody } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    res.status(400).json({ error: 'Corpo da requisição inválido.' });
    return;
  }
  const { password } = body || {};
  if (process.env.DEBUG_LOGIN === '1') {
    res.status(200).json({
      receivedLen: password ? password.length : 0,
      expectedLen: process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.length : 0,
      envSet: Boolean(process.env.ADMIN_PASSWORD),
      match: password === process.env.ADMIN_PASSWORD,
    });
    return;
  }
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Senha incorreta.' });
    return;
  }
  res.status(200).json({ token: issueSession() });
};
