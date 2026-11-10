#!/bin/sh
# Copies the kit's C++ engine source, unmodified, into the native module so that CocoaPods / Gradle / EAS
# (which only see files inside this project) can compile it. `--check` only verifies the copy is identical.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/../kit/engine"
DST="$ROOT/modules/strip-engine/cpp/engine"
if [ "$1" = "--check" ]; then
  for f in strip_engine.cpp strip_engine.h; do
    cmp -s "$SRC/$f" "$DST/$f" || { echo "engine copy out of date: $f (run scripts/sync-engine.sh)" >&2; exit 1; }
  done
  exit 0
fi
mkdir -p "$DST"
cp "$SRC/strip_engine.cpp" "$SRC/strip_engine.h" "$DST/"
