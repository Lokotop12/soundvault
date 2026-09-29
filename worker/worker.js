// Optional Cloudflare Worker relay for SoundCloud traffic.
// Deploy with: npx wrangler deploy  (route requests as: https://<worker>/?u=<encoded target URL>)
// Then set SC_RELAY_URL=https://<worker> before starting the SoundVault server.
// Only soundcloud.com / sndcdn.com targets are allowed.
const ALLOWED = /(^|\.)soundcloud\.com$|(^|\.)sndcdn\.com$|(^|\.)soundcloud\.cloud$/;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('u');
    if (!target) return new Response('missing u param', { status: 400 });

    let t;
    try {
      t = new URL(target);
    } catch {
      return new Response('bad u param', { status: 400 });
    }
    if (!ALLOWED.test(t.hostname)) return new Response('forbidden host', { status: 403 });

    const headers = new Headers();
    for (const h of ['range', 'if-none-match', 'authorization', 'user-agent']) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has('user-agent')) {
      headers.set('user-agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    }

    const upstream = await fetch(t.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    });

    const out = new Headers(upstream.headers);
    out.set('Access-Control-Allow-Origin', '*');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
