#!/usr/bin/env bash
# SoundVault launcher: запускает десктоп-приложение (Electron).
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v node >/dev/null 2>&1 && [ -x "$DIR/node_modules/.bin/electron" ]; then
  exec env ELECTRON_DISABLE_SANDBOX=1 "$DIR/node_modules/.bin/electron" "$DIR" >/dev/null 2>&1 &
  exit 0
fi

# fallback: браузерное окно-приложение
URL="http://127.0.0.1:8787"
if ! curl -s --noproxy '*' -o /dev/null --max-time 2 "$URL/api/status"; then
  nohup node "$DIR/server.js" >> "$DIR/soundvault.log" 2>&1 &
  sleep 2
fi
for BROWSER in chromium chromium-browser google-chrome; do
  if command -v "$BROWSER" >/dev/null 2>&1; then
    exec "$BROWSER" --app="$URL" --class=SoundVault >/dev/null 2>&1 &
    exit 0
  fi
done
xdg-open "$URL" >/dev/null 2>&1 &
