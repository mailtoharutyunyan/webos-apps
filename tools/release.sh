#!/bin/sh
# Builds one app and adds it to hbrepo/. Commit and push afterwards.
# Usage: tools/release.sh <app-folder-name>     e.g. tools/release.sh devmode-renew
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/apps/$1"
OUT="$ROOT/dist/$1"

[ -x "$APP/build.sh" ] || { echo "No build script at $APP/build.sh" >&2; exit 1; }
rm -rf "$OUT"
"$APP/build.sh" "$OUT"

META="$APP/hbrepo.json"
DESCRIPTION="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["description"])' "$META")"
SOURCE_URL="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("sourceUrl", ""))' "$META")"

set -- --ipk "$(ls "$OUT"/*.ipk)" --icon "$OUT/icon.png" --description "$DESCRIPTION"
[ -n "$SOURCE_URL" ] && set -- "$@" --source-url "$SOURCE_URL"
python3 -I "$ROOT/tools/publish-hbrepo.py" "$@"
