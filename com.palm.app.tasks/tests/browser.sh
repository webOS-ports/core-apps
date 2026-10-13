#!/bin/bash
# browser.sh [browser|phone]: run the suite against the mock database in a
# headless Chromium. ENYO must point at an Enyo 1.0 checkout (enyo-1.0-ports);
# CHROME and PORT (DevTools) / HTTP_PORT can be overridden.
set -e
T=$(cd "$(dirname "$0")" && pwd)
MODE=${1:-browser}
ENYO=${ENYO:?set ENYO to an enyo-1.0-ports checkout}
CHROME=${CHROME:-chromium}
PORT=${PORT:-9333}
HTTP_PORT=${HTTP_PORT:-8766}
[ -f "$ENYO/framework/enyo.js" ] || { echo "no framework/enyo.js under $ENYO" >&2; exit 2; }

# The app loads Enyo from its on-device path, so serve a root that has both.
# (Not a dot directory: a snap-packaged Chromium cannot use one for its profile.)
W=$T/out/www
mkdir -p "$W/usr/palm/frameworks/enyo"
ln -sfn "$(cd "$ENYO" && pwd)" "$W/usr/palm/frameworks/enyo/0.10"
ln -sfn "$(dirname "$T")" "$W/com.palm.app.tasks"

python3 -m http.server "$HTTP_PORT" --bind 127.0.0.1 --directory "$W" >/dev/null 2>&1 &
HTTP=$!
"$CHROME" --headless=new --disable-gpu --no-first-run --remote-debugging-port="$PORT" \
	--user-data-dir="$T/out/profile" --window-size=1024,768 \
	"http://127.0.0.1:$HTTP_PORT/com.palm.app.tasks/index-desktop.html" >/dev/null 2>&1 &
BROWSER=$!
trap 'kill $HTTP $BROWSER 2>/dev/null' EXIT

for i in $(seq 1 50); do
	curl -s -m 1 "http://127.0.0.1:$PORT/json/list" 2>/dev/null | grep -q index-desktop.html && break
	sleep 0.2
done
node "$T/run.js" "$MODE" "http://127.0.0.1:$PORT"
