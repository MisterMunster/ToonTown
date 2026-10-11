#!/usr/bin/env bash
# Headless WebGL screenshot of a page served by the Vite dev server.
#   tools/shot.sh <path-or-url> <out.png> [virtual_ms=12000] [WIDTHxHEIGHT=1280x720]
# e.g. tools/shot.sh /tools/preview/character.html /tmp/char.png
#      tools/shot.sh "/?autostart=1&quality=high" /tmp/game.png 20000
# Requires the dev server:  npx vite --port 5173   (already running in this session)
# Prints page console messages / uncaught errors captured from Chrome's log.
# Each run uses a throwaway Chrome profile, so runs can happen in parallel.
set -euo pipefail
TARGET="${1:?path or url}"
OUT="${2:?output png}"
BUDGET="${3:-12000}"
SIZE="${4:-1280x720}"
case "$TARGET" in http*) URL="$TARGET" ;; *) URL="http://localhost:5173${TARGET}" ;; esac
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/tt-chrome.XXXXXX")"
LOG="$PROFILE/log.txt"
"$CHROME" --headless=new --disable-gpu-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
  --ignore-gpu-blocklist --no-first-run --no-default-browser-check --disable-extensions \
  --autoplay-policy=no-user-gesture-required --mute-audio \
  --user-data-dir="$PROFILE" --window-size="${SIZE/x/,}" --hide-scrollbars \
  --enable-logging=stderr --v=0 \
  --virtual-time-budget="$BUDGET" --screenshot="$OUT" "$URL" >"$LOG" 2>&1 || true
grep -E "CONSOLE|Uncaught|ERROR:.*(console|javascript)" "$LOG" | sed -E 's/^\[[^]]*\] //' | grep -v -E "Download the|DevTools|GL Driver Message|GPU stall" | head -40 || true
if [ -s "$OUT" ]; then echo "screenshot: $OUT"; else echo "NO SCREENSHOT WRITTEN"; tail -20 "$LOG"; fi
rm -rf "$PROFILE"
