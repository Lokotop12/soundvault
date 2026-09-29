const { scFetch, readConfig } = require('./upstream');
const { getClientId, refreshClientId } = require('./clientId');

const API = 'https://api-v2.soundcloud.com';

function getToken() {
  return readConfig().oauth_token || null;
}

async function apiFetch(urlPath, { auth = true, params = {}, retry = true } = {}) {
  const clientId = await getClientId();
  const url = new URL(API + urlPath);
  url.searchParams.set('client_id', clientId);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const headers = {};
  const token = getToken();
  if (auth && token) headers['Authorization'] = `OAuth ${token}`;

  const res = await scFetch(url.toString(), { headers });
  if (res.status === 401 && retry) {
    if (token && auth) {
      await refreshClientId();
      const url2 = new URL(API + urlPath);
      url2.searchParams.set('client_id', await getClientId());
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url2.searchParams.set(k, String(v));
      }
      return scFetch(url2.toString(), { headers });
    }
    await refreshClientId();
    return apiFetch(urlPath, { auth, params, retry: false });
  }
  return res;
}

async function apiJson(urlPath, opts) {
  const res = await apiFetch(urlPath, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`api-v2 ${urlPath} -> ${res.status}`);
    err.status = res.status;
    err.body = body.slice(0, 500);
    throw err;
  }
  return res.json();
}

function search(q, limit = 20) {
  return apiJson('/search/tracks', { auth: false, params: { q, limit } });
}

let cachedMe = null;
async function me() {
  if (!cachedMe) cachedMe = await apiJson('/me');
  return cachedMe;
}

async function likes(limit = 50) {
  const { id } = await me();
  return apiJson(`/users/${id}/likes`, { params: { limit, linked_partitioning: 1 } });
}

async function myPlaylists(limit = 50) {
  const { id } = await me();
  return apiJson(`/users/${id}/playlists`, { params: { limit, linked_partitioning: 1 } });
}

function feed(limit = 30) {
  return apiJson('/stream', { params: { limit, linked_partitioning: 1 } });
}

async function playlist(id) {
  const data = await apiJson(`/playlists/${id}`, { auth: true });
  const stubs = (data.tracks || []).filter((t) => t && !t.title).map((t) => t.id);
  if (stubs.length) {
    const byId = new Map();
    for (let i = 0; i < stubs.length; i += 50) {
      const chunk = stubs.slice(i, i + 50);
      const full = await apiJson('/tracks', { auth: true, params: { ids: chunk.join(',') } });
      for (const t of full || []) if (t && t.id) byId.set(t.id, t);
    }
    data.tracks = (data.tracks || []).map((t) => (t && !t.title && byId.get(t.id)) || t);
  }
  return data;
}

async function trackInfo(id) {
  return apiJson(`/tracks/${id}`, { auth: true });
}

async function resolveStream(id) {
  let transcodings = null;

  try {
    const streams = await apiJson(`/tracks/${id}/streams`);
    if (streams.http_mp3_128_url) {
      return { type: 'progressive', url: streams.http_mp3_128_url };
    }
    if (streams.hls_mp3_128_url) {
      return { type: 'hls', url: streams.hls_mp3_128_url };
    }
    if (streams.hls_opus_64_url) {
      return { type: 'hls', url: streams.hls_opus_64_url };
    }
  } catch (e) {
    console.warn(`[stream] /tracks/${id}/streams failed (${e.status || e.message}), falling back to transcodings`);
  }

  if (!transcodings) {
    const t = await trackInfo(id);
    transcodings = (t.media && t.media.transcodings) || [];
  }
  const progressive = transcodings.find((tc) => tc.format.protocol === 'progressive');
  const hls = transcodings.find((tc) => tc.format.protocol === 'hls' && /mp3/.test(tc.format.mime_type || ''))
    || transcodings.find((tc) => tc.format.protocol === 'hls');
  const chosen = progressive || hls;
  if (!chosen) throw Object.assign(new Error('no streamable transcoding'), { status: 404 });

  const data = await apiJson(chosen.url.replace(API, ''), { auth: true });
  if (!data.url) throw Object.assign(new Error('empty stream url'), { status: 502 });
  return { type: progressive ? 'progressive' : 'hls', url: data.url };
}

async function likeMethod(id, method) {
  const clientId = await getClientId();
  const token = getToken();
  const url = `${API}/likes/tracks/${id}?client_id=${clientId}`;
  const res = await scFetch(url, {
    method,
    headers: token ? { Authorization: `OAuth ${token}` } : {},
  });
  return res;
}

module.exports = {
  search, me, likes, myPlaylists, feed, playlist, trackInfo,
  resolveStream, like: (id) => likeMethod(id, 'POST'), unlike: (id) => likeMethod(id, 'DELETE'),
  getToken,
};
