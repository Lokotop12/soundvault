// SoundVault backend — node:http server, API routing, static files.
const http = require('http');

// Network hiccups (ETIMEDOUT, socket aborts inside undici) must never kill the process.
process.on('uncaughtException', (e) => console.error('[swallowed exception]', e.message));
process.on('unhandledRejection', (e) => console.error('[swallowed rejection]', e && e.message ? e.message : e));

const fs = require('fs');
const path = require('path');
const { detectUpstream, getUpstream, readConfig, writeConfig } = require('./lib/upstream');
const api = require('./lib/api');
const { handleMedia, handleHls } = require('./lib/proxy');

const PORT = 8787;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) { req.destroy(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function requireAuth(res) {
  if (!api.getToken()) {
    sendJson(res, 401, { error: 'not authenticated', authed: false });
    return false;
  }
  return true;
}

async function routeApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (p === '/api/status' && method === 'GET') {
    const token = api.getToken();
    const out = { upstream: getUpstream(), authed: !!token };
    if (token) {
      try {
        const profile = await api.me();
        out.username = profile.username;
        out.avatar_url = profile.avatar_url;
      } catch (e) {
        out.authed = false;
        out.auth_error = e.status === 401 ? 'invalid_token' : 'profile_fetch_failed';
      }
    }
    return sendJson(res, 200, out);
  }

  if (p === '/api/auth/token' && method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const token = (body.token || '').trim();
    if (!token) return sendJson(res, 400, { error: 'empty token' });
    writeConfig({ oauth_token: token });
    try {
      const profile = await api.me();
      return sendJson(res, 200, { ok: true, profile });
    } catch (e) {
      writeConfig({ oauth_token: null });
      return sendJson(res, 401, { error: 'invalid token', detail: e.status });
    }
  }

  if (p === '/api/auth/token' && method === 'DELETE') {
    writeConfig({ oauth_token: null });
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/me' && method === 'GET') {
    if (!requireAuth(res)) return;
    try { return sendJson(res, 200, await api.me()); }
    catch (e) { return sendJson(res, e.status || 502, { error: e.message }); }
  }

  if (p === '/api/me/likes' && method === 'GET') {
    if (!requireAuth(res)) return;
    try { return sendJson(res, 200, await api.likes(100)); }
    catch (e) { return sendJson(res, e.status || 502, { error: e.message }); }
  }

  if (p === '/api/me/playlists' && method === 'GET') {
    if (!requireAuth(res)) return;
    try { return sendJson(res, 200, await api.myPlaylists(100)); }
    catch (e) { return sendJson(res, e.status || 502, { error: e.message }); }
  }

  if (p === '/api/feed' && method === 'GET') {
    if (!requireAuth(res)) return;
    try {
      return sendJson(res, 200, { source: 'stream', ...(await api.feed(30)) });
    } catch (e) {
      console.warn(`[feed] /stream failed (${e.status || e.message}), falling back to likes`);
      try {
        const data = await api.likes(30);
        return sendJson(res, 200, { source: 'likes', collection: data.collection || [] });
      } catch (e2) {
        return sendJson(res, e2.status || 502, { error: e2.message });
      }
    }
  }

  if (p === '/api/search' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    if (!q.trim()) return sendJson(res, 400, { error: 'empty query' });
    try { return sendJson(res, 200, await api.search(q, 20)); }
    catch (e) { return sendJson(res, e.status || 502, { error: e.message, detail: e.body }); }
  }

  const mPlaylist = p.match(/^\/api\/playlists\/(\d+)$/);
  if (mPlaylist && method === 'GET') {
    try { return sendJson(res, 200, await api.playlist(mPlaylist[1])); }
    catch (e) { return sendJson(res, e.status || 502, { error: e.message }); }
  }

  const mStream = p.match(/^\/api\/stream\/(\d+)$/);
  if (mStream && method === 'GET') {
    try {
      const s = await api.resolveStream(mStream[1]);
      const local = s.type === 'hls'
        ? `/hls?u=${encodeURIComponent(s.url)}`
        : `/media?u=${encodeURIComponent(s.url)}`;
      return sendJson(res, 200, { type: s.type, url: local });
    } catch (e) {
      return sendJson(res, e.status || 502, { error: e.message });
    }
  }

  const mLike = p.match(/^\/api\/likes\/(\d+)$/);
  if (mLike && (method === 'POST' || method === 'DELETE')) {
    if (!requireAuth(res)) return;
    try {
      const r = method === 'POST' ? await api.like(mLike[1]) : await api.unlike(mLike[1]);
      return sendJson(res, r.ok ? 200 : r.status, { ok: r.ok, status: r.status });
    } catch (e) {
      return sendJson(res, e.status || 502, { error: e.message });
    }
  }

  if (p === '/media' && method === 'GET') {
    const target = url.searchParams.get('u');
    if (!target) return sendJson(res, 400, { error: 'missing u param' });
    return handleMedia(req, res, target);
  }

  if (p === '/hls' && method === 'GET') {
    const target = url.searchParams.get('u');
    if (!target) return sendJson(res, 400, { error: 'missing u param' });
    return handleHls(req, res, target);
  }

  return sendJson(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const abs = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!abs.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      if (url.pathname !== '/' && !path.extname(abs)) {
        // SPA-ish fallback
        filePath = '/index.html';
      } else {
        res.writeHead(404);
        return res.end('not found');
      }
    }
    const finalAbs = err ? path.join(PUBLIC_DIR, 'index.html') : abs;
    fs.readFile(finalAbs, (err2, data2) => {
      if (err2) { res.writeHead(404); return res.end('not found'); }
      const ext = path.extname(finalAbs).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data2);
    });
  });
}

async function main() {
  try {
    await detectUpstream();
  } catch (e) {
    console.error('[upstream] detection failed, continuing anyway:', e.message);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/') || url.pathname === '/media' || url.pathname === '/hls') {
        await routeApi(req, res, url);
      } else {
        serveStatic(req, res, url);
      }
    } catch (e) {
      console.error('[server] unhandled error:', e);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error', detail: e.message });
      else res.end();
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`SoundVault listening on http://${HOST}:${PORT} (upstream: ${getUpstream()})`);
  });
}

main().catch((e) => {
  console.error('Fatal:', e);
});
