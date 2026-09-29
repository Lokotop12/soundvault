// client_id scraping + caching + 401 refresh.
// SoundCloud closed API app registration; client_id is embedded in the
// website's JS bundles. We scrape https://soundcloud.com/ for <script src>
// URLs and regex the bundles for client_id:"..." patterns.
const { scFetch, readConfig, writeConfig } = require('./upstream');

const CLIENT_ID_RE = /client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/;
let inflight = null;

async function scrapeClientId() {
  console.log('[client_id] scraping soundcloud.com JS bundles...');
  const res = await scFetch('https://soundcloud.com/');
  if (!res.ok) throw new Error(`soundcloud.com returned ${res.status}`);
  const html = await res.text();

  const scriptUrls = [];
  const re = /<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
  let m;
  while ((m = re.exec(html)) !== null) scriptUrls.push(m[1]);
  // Newest bundles tend to be at the end; check them first.
  scriptUrls.reverse();

  for (const url of scriptUrls) {
    try {
      const r = await scFetch(url);
      if (!r.ok) continue;
      const js = await r.text();
      const found = CLIENT_ID_RE.exec(js);
      if (found) {
        console.log('[client_id] found:', found[1]);
        writeConfig({ client_id: found[1] });
        return found[1];
      }
    } catch (e) {
      console.warn('[client_id] bundle fetch failed:', url, e.message);
    }
  }
  throw new Error('client_id not found in any JS bundle');
}

// Returns a cached client_id, scraping if missing. Deduplicates concurrent scrapes.
async function getClientId() {
  const cached = readConfig().client_id;
  if (cached) return cached;
  if (!inflight) {
    inflight = scrapeClientId().finally(() => { inflight = null; });
  }
  return inflight;
}

// Force re-scrape (used after a 401 from api-v2).
async function refreshClientId() {
  writeConfig({ client_id: null });
  if (!inflight) {
    inflight = scrapeClientId().finally(() => { inflight = null; });
  }
  return inflight;
}

module.exports = { getClientId, refreshClientId };
