#!/bin/sh
# Builds the app for $APP_PACK for the iOS Simulator (Debug, no signing identity) and checks the product:
# bundle id and display name follow the pack, and the C++ strip engine is linked in.
# Usage: device-test/ios/build.sh <simulator udid> <derived data dir> <out dir>      (after `expo prebuild --platform ios`)
set -eu
cd "$(dirname "$0")/../.."
UDID="$1"; DD="$2"; OUT="$3"
mkdir -p "$OUT"
WORKSPACE="$(ls -d ios/*.xcworkspace | head -1)"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"

./scripts/sync-engine.sh --check
echo "== xcodebuild $SCHEME (Debug, iphonesimulator)"
START=$(date +%s)
if ! xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Debug -sdk iphonesimulator \
    -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$DD" \
    COMPILER_INDEX_STORE_ENABLE=NO build > "$OUT/xcodebuild.log" 2>&1; then
  grep -n -E "(error|fatal error):|BUILD FAILED|The following build commands failed" -A 6 "$OUT/xcodebuild.log" | tail -150
  echo "xcodebuild failed after $(( $(date +%s) - START )) s (full log in the artifact)"
  exit 1
fi
echo "xcodebuild_seconds=$(( $(date +%s) - START ))" | tee "$OUT/build-time.txt"
grep -c "^SwiftCompile\|^CompileC\|^SwiftDriver " "$OUT/xcodebuild.log" | sed 's/^/compile commands in the log: /' | tee -a "$OUT/build-time.txt"

APP="$DD/Build/Products/Debug-iphonesimulator/$SCHEME.app"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
DISPLAY_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$APP/Info.plist")"
EXPECT_NAME="$(node -p "require('../kit/packs/$APP_PACK.json').appName")"
EXPECT_ID="$(./node_modules/.bin/expo config --json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).ios.bundleIdentifier")"
{
  echo "app=$APP"
  echo "bundle_id=$BUNDLE_ID"
  echo "display_name=$DISPLAY_NAME"
  echo "architectures=$(lipo -archs "$APP/$SCHEME")"
  echo "app_size_kb=$(du -sk "$APP" | cut -f1)"
} | tee "$OUT/app.txt"
[ "$DISPLAY_NAME" = "$EXPECT_NAME" ] || { echo "display name is not the pack's appName ($EXPECT_NAME)"; exit 1; }
[ "$BUNDLE_ID" = "$EXPECT_ID" ] || { echo "bundle id is not the configured one ($EXPECT_ID)"; exit 1; }

echo "== engine symbols in the app"
: > "$OUT/engine-symbols.txt"
for f in "$APP/$SCHEME" "$APP"/*.dylib "$APP"/Frameworks/*.framework/*; do
  [ -f "$f" ] || continue
  nm "$f" 2>/dev/null | grep -E ' [Tt] _strip_(read|engine_version|bridge_read|bridge_version)$' | sed "s|^|$(basename "$f"): |" >> "$OUT/engine-symbols.txt" || true
done
cat "$OUT/engine-symbols.txt"
grep -q '_strip_read$' "$OUT/engine-symbols.txt" || { echo "strip_read is not in the app"; exit 1; }
