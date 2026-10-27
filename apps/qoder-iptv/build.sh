#!/bin/sh
# Mirrors Qoder IPTV (HCLGitHub/qoder-iptv, MIT) unchanged into <output-dir>.
# Usage: apps/qoder-iptv/build.sh <output-dir>
set -eu

VERSION=1.1.48
SHA256=ad70abaf87cb72e2adb3b0db1dc98fa1354c8bcce56018db8e40bee946e72f67
URL="https://github.com/HCLGitHub/qoder-iptv/releases/download/v$VERSION/com.qoder.iptv_${VERSION}_all.ipk"

OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -sfL -o "$OUT/com.qoder.iptv_${VERSION}_all.ipk" "$URL"
echo "$SHA256  $OUT/com.qoder.iptv_${VERSION}_all.ipk" | shasum -a 256 -c -

(cd "$WORK" && ar x "$OUT/com.qoder.iptv_${VERSION}_all.ipk" && tar xzf data.tar.gz)
APP="$WORK/usr/palm/applications/com.qoder.iptv"
ICON="$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("largeIcon") or d["icon"])' "$APP/appinfo.json")"
cp "$APP/$ICON" "$OUT/icon.png"
