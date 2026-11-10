#!/bin/sh
# One codebase, two apps: the stage pack named by --dart-define=PACK=<id> (default premom)
# also picks the iOS bundle id and the home-screen name (the pack's appName).
# Runs as a scheme pre-action (Runner.xcscheme) before each build and writes
# Flutter/Pack.xcconfig, which Debug.xcconfig and Release.xcconfig include.
# DART_DEFINES is a comma-separated list of base64 "KEY=value" items written by the flutter tool.
#
# The flutter tool reads the bundle id from the build settings before it builds, so after
# switching packs `flutter test`/`flutter run` see the previous pack's id until this has run.
# To avoid that, run it by hand first: ios/Flutter/pack_xcconfig.sh <packId>
set -e
SRCROOT=${SRCROOT:-$(cd "$(dirname "$0")/.." && pwd)}
pack=premom
old_ifs=$IFS
IFS=,
for item in $DART_DEFINES; do
  define=$(printf '%s' "$item" | base64 --decode 2>/dev/null || true)
  case "$define" in
    PACK=*) pack=${define#PACK=} ;;
  esac
done
IFS=$old_ifs
[ -z "$1" ] || pack=$1
name=$(/usr/bin/plutil -extract appName raw -o - "$SRCROOT/../assets/packs/$pack.json")
printf 'PACK_ID=%s\nPACK_APP_NAME=%s\n' "$pack" "$name" > "$SRCROOT/Flutter/Pack.xcconfig"
