#!/usr/bin/env bash
# SoundVault launcher: поднимает сервер (если не запущен) и открывает окно приложения.
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="http://127.0.0.1:8787"

if ! curl -s --noproxy '*' -o /dev/null --max-time 2 "$URL/api/status"; then
  nohup node "$DIR/server.js" >> "$DIR/soundvault.log" 2>&1 &
  for _ in $(seq 1 20); do
    curl -s --noproxy '*' -o /dev/null --max-time 1 "$URL/api/status" && break
    sleep 0.5
  done
fi

for BROWSER in chromium chromium-browser google-chrome; do
  if command -v "$BROWSER" >/dev/null 2>&1; then
    exec "$BROWSER" --app="$URL" --class=SoundVault "$@" >/dev/null 2>&1 &
    exit 0
  fi
done

# fallback: обычная вкладка
xdg-open "$URL" >/dev/null 2>&1 &
