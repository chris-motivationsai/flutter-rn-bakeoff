#!/bin/sh
# Static checks. Exits non-zero on any problem.
set -e
cd "$(dirname "$0")"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

echo "== engine copy in the native module is identical to kit/engine"
./scripts/sync-engine.sh --check

echo "== TypeScript (app, real adapters against the real libraries, tests)"
./node_modules/.bin/tsc --noEmit

echo "== ESLint"
./node_modules/.bin/eslint . --max-warnings 0

echo "== C++ bridge and Node binding compile without warnings"
NODE_INC="$(node -p "require('path').resolve(process.execPath, '..', '..', 'include', 'node')")"
clang++ -std=c++17 -Wall -Wextra -Werror -fsyntax-only -I"$NODE_INC" -Imodules/strip-engine/cpp \
  modules/strip-engine/cpp/strip_bridge.cpp modules/strip-engine/node/strip_napi.cpp
JNI_INC="$(ls -d /opt/homebrew/opt/openjdk*/include 2>/dev/null | head -1)"
if [ -n "$JNI_INC" ] && [ -f "$JNI_INC/jni.h" ]; then
  echo "== Android JNI glue compiles (host JDK headers)"
  clang++ -std=c++17 -Wall -Wextra -Werror -fsyntax-only -I"$JNI_INC" -I"$JNI_INC/darwin" -Imodules/strip-engine/cpp \
    modules/strip-engine/android/src/main/cpp/strip_jni.cpp
else
  echo "== (skipped) Android JNI glue syntax check: no JDK headers on this machine"
fi

echo "== Expo autolinking finds the native strip engine module on both platforms"
for platform in apple android; do
  ./node_modules/.bin/expo-modules-autolinking resolve --platform "$platform" --json > "$SCRATCH/autolink-$platform.json"
  grep -q 'StripEngineModule' "$SCRATCH/autolink-$platform.json" || { echo "StripEngineModule not autolinked for $platform" >&2; exit 1; }
done

echo "== Both apps resolve from their pack, and Metro bundles them (iOS: Polly, Android: Premom)"
for pack in polly premom; do
  APP_PACK=$pack ./node_modules/.bin/expo config --json > "$SCRATCH/config-$pack.json"
  node -e '
    const config = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const pack = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
    if (config.name !== pack.appName || config.slug !== pack.packId) { console.error("app config does not follow the pack"); process.exit(1); }
  ' "$SCRATCH/config-$pack.json" "../kit/packs/$pack.json"
done
APP_PACK=polly ./node_modules/.bin/expo export --platform ios --output-dir "$SCRATCH/export-ios" > "$SCRATCH/export-ios.log" 2>&1 || { cat "$SCRATCH/export-ios.log"; exit 1; }
APP_PACK=premom ./node_modules/.bin/expo export --platform android --output-dir "$SCRATCH/export-android" > "$SCRATCH/export-android.log" 2>&1 || { cat "$SCRATCH/export-android.log"; exit 1; }

echo "check.sh: all checks passed"
