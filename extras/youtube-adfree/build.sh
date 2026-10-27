#!/bin/sh
# Rebuilds YouTube AdFree (webosbrew/youtube-webos, GPL-3.0) with the regular
# YouTube icon and the title "YouTube". Nothing else in the app is changed.
# Usage: extras/youtube-adfree/build.sh <output-dir>
set -eu

VERSION=0.5.3
SHA256=9c4f1dd0b04fd712adb6a9a1c5838da49b1003cd96de8354c10467b52d73259d
URL="https://github.com/webosbrew/youtube-webos/releases/download/v$VERSION/youtube.leanback.v4_${VERSION}_all.ipk"

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -sfL -o "$WORK/upstream.ipk" "$URL"
echo "$SHA256  $WORK/upstream.ipk" | shasum -a 256 -c -
(cd "$WORK" && ar x upstream.ipk && tar xzf data.tar.gz)
APP="$WORK/usr/palm/applications/youtube.leanback.v4"

for spec in icon:80 mediumLargeIcon:115 largeIcon:130 extraLargeIcon:192; do
    rsvg-convert -w "${spec#*:}" -h "${spec#*:}" "$HERE/tile.svg" -o "$APP/${spec%%:*}.png"
done
rsvg-convert -w 1920 -h 1080 "$HERE/wide.svg" -o "$APP/imageForRecents.png"
rsvg-convert -w 1920 -h 1080 "$HERE/wide.svg" -o "$APP/splashBackground-v1.png"
rsvg-convert -w 33 -h 23 "$HERE/play.svg" -o "$APP/playIcon.png"
cp "$HERE/tile.svg" "$APP/icon.svg"
python3 -I -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["title"]="YouTube"; json.dump(d, open(p, "w"), indent=1)' "$APP/appinfo.json"

ares-package -o "$OUT" "$APP"
rsvg-convert -w 192 -h 192 "$HERE/tile.svg" -o "$OUT/youtube-icon.png"
