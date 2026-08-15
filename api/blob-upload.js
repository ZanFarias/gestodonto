const { handleUpload } = require('@vercel/blob/client');
const { verifySession, readJsonBody } = require('./_lib');

const ALLOWED_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/quicktime',
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }
  if (!verifySession(req)) {
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    res.status(400).json({ error: 'Corpo da requisição inválido.' });
    return;
  }
  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          addRandomSuffix: true,
          tokenPayload: clientPayload || '',
          maximumSizeInBytes: 200 * 1024 * 1024, // 200MB, cobre vídeo curto de Reels
        };
      },
      onUploadCompleted: async () => {
        // Nada a fazer aqui — o cliente chama /api/schedule-post depois do upload com a URL final.
      },
    });
    res.status(200).json(jsonResponse);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Falha no upload.' });
  }
};
