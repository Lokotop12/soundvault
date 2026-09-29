# SoundVault

Desktop and web client for SoundCloud. The browser only talks to `localhost` — all SoundCloud traffic goes through a local Node server that picks a working route on its own (direct connection, local proxy, or a Cloudflare Worker relay).

## Run

```bash
npm start          # desktop app (Electron)
npm run serve      # web app at http://localhost:8787
```

## Sign in

SoundCloud doesn't accept new API registrations, so auth uses your existing account token (`oauth_token` cookie from soundcloud.com):

1. Open soundcloud.com and sign in
2. DevTools (F12) → Application → Cookies → `https://soundcloud.com`
3. Copy the `oauth_token` value and paste it into the app

The token is stored locally in `config.json` (Electron: in the userData dir). Without it the app works in anonymous mode (search only).

## How it works

- `server.js` — Node server on `127.0.0.1:8787`, one dependency (`undici`)
- Upstream selection at startup: direct → `http://127.0.0.1:10809` → `SC_RELAY_URL`
- `client_id` for the API is scraped from soundcloud.com JS bundles at runtime and re-scraped on 401
- Audio and images are proxied through `/media` (Range supported), HLS playlists are rewritten through `/hls`

## Optional: Cloudflare Worker relay

If your ISP blocks SoundCloud and you have no local proxy, deploy `worker/worker.js` as a free Cloudflare Worker and run:

```bash
SC_RELAY_URL="https://your-worker.workers.dev" npm start
```

## Hotkeys

- Space — play/pause
- Left / Right — seek 5 s
- N / P — next / previous track

## Building the Windows installer

```bash
# needs wine (Kron4ek portable build works) and libc6:i386
PATH=/path/to/wine/bin:$PATH npx electron-builder --win nsis
# output: dist/SoundVault Setup <version>.exe
```
