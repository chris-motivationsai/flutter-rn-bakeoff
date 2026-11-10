#!/bin/sh
# Builds the Node addon for this Mac from the kit engine source (compiled straight from kit/engine, unmodified)
# plus the shared bridge. Output: modules/strip-engine/node/build/strip_engine.node. Skips when up to date.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
KIT_ENGINE="$HERE/../../../../kit/engine"
OUT="$HERE/build/strip_engine.node"
STAMP="$HERE/build/.stamp"
NODE_INC="$(node -p "require('path').resolve(process.execPath, '..', '..', 'include', 'node')")"
SIG="$(cat "$KIT_ENGINE/strip_engine.cpp" "$KIT_ENGINE/strip_engine.h" "$HERE/../cpp/strip_bridge.cpp" "$HERE/../cpp/strip_bridge.h" "$HERE/strip_napi.cpp" | cksum) $(node -p process.version)"
if [ -f "$OUT" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$SIG" ]; then exit 0; fi
mkdir -p "$HERE/build"
"$HERE/../../../scripts/sync-engine.sh"
TMP="$OUT.$$.tmp"
clang++ -std=c++17 -O2 -fPIC -shared -undefined dynamic_lookup \
  -I"$NODE_INC" -I"$HERE/../cpp" \
  "$KIT_ENGINE/strip_engine.cpp" "$HERE/../cpp/strip_bridge.cpp" "$HERE/strip_napi.cpp" -o "$TMP"
mv "$TMP" "$OUT"
echo "$SIG" > "$STAMP"
