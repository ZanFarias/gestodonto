const {
  requireSession, readManifest, writeManifest, metaFetch, getPageAccessToken, readJsonBody,
} = require('./_lib');

const IG_USER_ID = process.env.IG_USER_ID;
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const META_TOKEN = process.env.META_ACCESS_TOKEN;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pollVideoReady(creationId, attempts = 6, delayMs = 5000) {
  for (let i = 0; i < attempts; i++) {
    const data = await metaFetch(`/${creationId}?fields=status_code&access_token=${encodeURIComponent(META_TOKEN)}`);
    if (data.status_code === 'FINISHED') return true;
    if (data.status_code === 'ERROR') throw new Error('Processamento do vídeo falhou no Meta.');
    await sleep(delayMs);
  }
  return false; // ainda processando — o cron termina depois
}

async function createIgContainer(mediaType, mediaUrls, caption) {
  if (mediaType === 'image') {
    const data = await metaFetch(`/${IG_USER_ID}/media`, {
      method: 'POST',
      body: { image_url: mediaUrls[0], caption, access_token: META_TOKEN },
    });
    return data.id;
  }
  if (mediaType === 'carousel') {
    const childIds = [];
    for (const url of mediaUrls) {
      const child = await metaFetch(`/${IG_USER_ID}/media`, {
        method: 'POST',
        body: { image_url: url, is_carousel_item: true, access_token: META_TOKEN },
      });
      childIds.push(child.id);
    }
    const parent = await metaFetch(`/${IG_USER_ID}/media`, {
      method: 'POST',
      body: { media_type: 'CAROUSEL', children: childIds.join(','), caption, access_token: META_TOKEN },
    });
    return parent.id;
  }
  if (mediaType === 'video') {
    const data = await metaFetch(`/${IG_USER_ID}/media`, {
      method: 'POST',
      body: {
        media_type: 'REELS', video_url: mediaUrls[0], caption, share_to_feed: true, access_token: META_TOKEN,
      },
    });
    return data.id;
  }
  throw new Error(`mediaType inválido: ${mediaType}`);
}

async function publishIg(creationId) {
  const data = await metaFetch(`/${IG_USER_ID}/media_publish`, {
    method: 'POST',
    body: { creation_id: creationId, access_token: META_TOKEN },
  });
  return data.id;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }
  if (!requireSession(req, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    res.status(400).json({ error: 'Corpo da requisição inválido.' });
    return;
  }

  const { mediaUrls, mediaType, caption, scheduleAt, platforms } = body || {};
  if (!Array.isArray(mediaUrls) || !mediaUrls.length) {
    res.status(400).json({ error: 'mediaUrls é obrigatório (array com ao menos 1 URL).' });
    return;
  }
  if (!['image', 'carousel', 'video'].includes(mediaType)) {
    res.status(400).json({ error: 'mediaType deve ser image, carousel ou video.' });
    return;
  }
  if (!Array.isArray(platforms) || !platforms.length) {
    res.status(400).json({ error: 'platforms é obrigatório (ex: ["ig"], ["ig","fb"]).' });
    return;
  }

  const scheduleTs = scheduleAt ? new Date(scheduleAt).getTime() : null;
  const isScheduled = Boolean(scheduleTs && scheduleTs > Date.now() + 60000);
  const now = Date.now();
  const result = {};

  const manifest = await readManifest();

  // ---------- Instagram ----------
  if (platforms.includes('ig')) {
    try {
      const containerId = await createIgContainer(mediaType, mediaUrls, caption);
      const entry = {
        id: `ig_${now}`,
        platform: 'ig',
        mediaType,
        mediaUrls,
        caption,
        containerId,
        scheduleAt: scheduleTs,
        needsVideoPoll: mediaType === 'video',
        status: 'pending',
        createdAt: now,
      };

      if (!isScheduled) {
        let readyToPublish = true;
        if (mediaType === 'video') {
          readyToPublish = await pollVideoReady(containerId);
        }
        if (readyToPublish) {
          const publishedId = await publishIg(containerId);
          entry.status = 'published';
          entry.publishedId = publishedId;
          entry.publishedAt = Date.now();
          manifest.history.unshift(entry);
        } else {
          // Vídeo ainda processando — deixa pendente, o cron finaliza assim que o Meta terminar.
          entry.scheduleAt = Date.now();
          manifest.pending.push(entry);
        }
      } else {
        manifest.pending.push(entry);
      }
      result.ig = { scheduled: isScheduled, containerId, status: entry.status };
    } catch (e) {
      result.ig = { error: e.message };
    }
  }

  // ---------- Facebook ----------
  if (platforms.includes('fb')) {
    if (mediaType === 'carousel') {
      result.fb = { skipped: true, reason: 'Carrossel não é suportado no Facebook nesta versão — publique manualmente ou use imagem única/vídeo.' };
    } else {
      try {
        const pageToken = await getPageAccessToken();
        const endpoint = mediaType === 'video' ? `/${FB_PAGE_ID}/videos` : `/${FB_PAGE_ID}/photos`;
        const fbBody = mediaType === 'video'
          ? { file_url: mediaUrls[0], description: caption, access_token: pageToken }
          : { url: mediaUrls[0], caption, access_token: pageToken };
        if (isScheduled) {
          fbBody.published = 'false';
          fbBody.scheduled_publish_time = Math.floor(scheduleTs / 1000);
        }
        const data = await metaFetch(endpoint, { method: 'POST', body: fbBody });
        const entry = {
          id: `fb_${now}`,
          platform: 'fb',
          mediaType,
          mediaUrls,
          caption,
          fbPostId: data.post_id || data.id,
          fbMediaId: data.id,
          scheduleAt: scheduleTs,
          status: isScheduled ? 'pending' : 'published',
          createdAt: now,
          publishedAt: isScheduled ? null : Date.now(),
        };
        if (isScheduled) manifest.pending.push(entry); else manifest.history.unshift(entry);
        result.fb = { scheduled: isScheduled, id: entry.fbPostId };
      } catch (e) {
        result.fb = { error: e.message };
      }
    }
  }

  await writeManifest(manifest);
  res.status(200).json({ ok: true, result });
};
