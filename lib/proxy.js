const { scFetch } = require('./upstream');

const ALLOWED_HOST = /(^|\.)soundcloud\.com$|(^|\.)sndcdn\.com$|(^|\.)soundcloud\.cloud$/;

function isAllowed(urlStr) {
  try {
    const u = new URL(urlStr);
    return (u.protocol === 'https:' || u.protocol === 'http:') && ALLOWED_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

function passthroughHeaders(req) {
  const out = {};
  if (req.headers.range) out['Range'] = req.headers.range;
  if (req.headers['if-none-match']) out['If-None-Match'] = req.headers['if-none-match'];
  out['User-Agent'] = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  return out;
}

async function handleMedia(req, res, target) {
  if (!isAllowed(target)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'forbidden host' }));
  }
  let upstream;
  try {
    upstream = await scFetch(target, { headers: passthroughHeaders(req) });
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'upstream fetch failed', detail: e.message }));
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
  };
  for (const h of ['content-type', 'content-length', 'content-range', 'etag', 'last-modified', 'cache-control']) {
    const v = upstream.headers.get(h);
    if (v) headers[h.replace(/\b\w/g, (c) => c.toUpperCase())] = v;
  }
  res.writeHead(upstream.status, headers);

  if (!upstream.body) return res.end();
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
  } catch {
  } finally {
    try { reader.cancel(); } catch {}
    res.end();
  }
}

async function handleHls(req, res, target) {
  if (!isAllowed(target)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'forbidden host' }));
  }
  let upstream;
  try {
    upstream = await scFetch(target, { headers: passthroughHeaders(req) });
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'upstream fetch failed', detail: e.message }));
  }
  if (!upstream.ok) {
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `upstream ${upstream.status}` }));
  }
  const text = await upstream.text();

  const rewriteUri = (uri) => {
    const abs = new URL(uri, target).toString();
    return /\.m3u8($|\?)/.test(abs)
      ? `/hls?u=${encodeURIComponent(abs)}`
      : `/media?u=${encodeURIComponent(abs)}`;
  };
  const rewritten = text
    .split('\n')
    .map((line) => {
      if (line.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${rewriteUri(uri)}"`);
      }
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) return rewriteUri(trimmed);
      return line;
    })
    .join('\n');

  res.writeHead(200, {
    'Content-Type': 'application/vnd.apple.mpegurl',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  res.end(rewritten);
}

module.exports = { handleMedia, handleHls, isAllowed };
