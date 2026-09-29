// Upstream detection + unified scFetch() used for all SoundCloud traffic.
// Priority: (1) direct, (2) local proxy http://127.0.0.1:10809, (3) SC_RELAY_URL env.
const fs = require('fs');
const path = require('path');
const { ProxyAgent } = require('undici');

const CONFIG_PATH = process.env.SV_CONFIG_DIR
  ? path.join(process.env.SV_CONFIG_DIR, 'config.json')
  : path.join(__dirname, '..', 'config.json');
const PROXY_URL = 'http://127.0.0.1:10809';
const PROBE_URL = 'https://api-v2.soundcloud.com/';
const PROBE_TIMEOUT = 5000;

let state = {
  upstream: null,      // 'direct' | 'proxy' | 'relay'
  relayUrl: null,      // base URL when upstream === 'relay'
  dispatcher: null,    // undici dispatcher for proxy mode
};

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const cfg = { ...readConfig(), ...patch };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    // Конфиг — кэш/настройки; невозможность записи не должна убивать приложение.
    console.warn(`[config] cannot write ${CONFIG_PATH}: ${e.message}`);
  }
  return cfg;
}

async function probe(dispatcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
  try {
    // Any HTTP response (even 401/404) means the host is reachable.
    await fetch(PROBE_URL, {
      signal: controller.signal,
      dispatcher: dispatcher || undefined,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function detectUpstream() {
  // 1. direct
  if (await probe()) {
    state.upstream = 'direct';
    state.dispatcher = null;
    state.relayUrl = null;
    console.log('[upstream] direct connection works');
  } else {
    // 2. local proxy
    const agent = new ProxyAgent(PROXY_URL);
    if (await probe(agent)) {
      state.upstream = 'proxy';
      state.dispatcher = agent;
      state.relayUrl = null;
      console.log(`[upstream] using proxy ${PROXY_URL}`);
    } else if (process.env.SC_RELAY_URL) {
      // 3. relay (e.g. Cloudflare Worker). Relay expects ?u=<encoded target>.
      state.upstream = 'relay';
      state.dispatcher = null;
      state.relayUrl = process.env.SC_RELAY_URL.replace(/\/+$/, '');
      console.log(`[upstream] using relay ${state.relayUrl}`);
    } else {
      state.upstream = 'none';
      console.warn('[upstream] WARNING: no working upstream found (direct and proxy both failed, SC_RELAY_URL not set)');
    }
  }
  writeConfig({ upstream: state.upstream });
  return state.upstream;
}

function toRelayUrl(target) {
  return `${state.relayUrl}/?u=${encodeURIComponent(target)}`;
}

let fallbackAgent = null;
function getFallbackAgent() {
  if (!fallbackAgent) fallbackAgent = new ProxyAgent(PROXY_URL);
  return fallbackAgent;
}

// Unified fetch for all SoundCloud traffic. Mirrors global fetch signature.
// On a network-level failure in direct mode, retries once through the local
// proxy and sticks to it for the rest of the session.
async function scFetch(url, opts = {}) {
  if (state.upstream === 'relay') {
    // Headers pass through; relay forwards them.
    return fetch(toRelayUrl(url), opts);
  }
  const o = { ...opts };
  if (state.dispatcher) o.dispatcher = state.dispatcher;
  if (state.upstream !== 'direct') return fetch(url, o);
  try {
    return await fetch(url, o);
  } catch (e) {
    try {
      const agent = getFallbackAgent();
      const res = await fetch(url, { ...opts, dispatcher: agent });
      state.upstream = 'proxy';
      state.dispatcher = agent;
      console.warn(`[upstream] direct failed (${e.message}), switched to proxy ${PROXY_URL}`);
      writeConfig({ upstream: 'proxy' });
      return res;
    } catch {
      throw e;
    }
  }
}

function getUpstream() {
  return state.upstream;
}

module.exports = { detectUpstream, scFetch, getUpstream, readConfig, writeConfig };
