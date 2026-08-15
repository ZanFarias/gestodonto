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
  const { password, debug } = body || {};
  if (debug === 'zzz') {
    const exp = process.env.ADMIN_PASSWORD || '';
    res.status(200).json({
      receivedLen: password ? password.length : 0,
      receivedCodes: password ? Array.from(password).map((c) => c.charCodeAt(0)) : [],
      expectedLen: exp.length,
      expectedCodes: Array.from(exp).map((c) => c.charCodeAt(0)),
      envKeys: Object.keys(process.env).filter((k) => /ADMIN|SESSION|CRON|DEBUG/.test(k)),
      match: password === exp,
    });
    return;
  }
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Senha incorreta.' });
    return;
  }
  res.status(200).json({ token: issueSession() });
};
