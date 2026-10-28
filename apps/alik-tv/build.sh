#!/bin/sh
# Builds Alik TV into <output-dir>: the IPK and the repository icon.
# Usage: apps/alik-tv/build.sh <output-dir>
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"

ares-package -o "$OUT" "$HERE/app" "$HERE/service"
cp "$HERE/app/largeIcon.png" "$OUT/icon.png"
