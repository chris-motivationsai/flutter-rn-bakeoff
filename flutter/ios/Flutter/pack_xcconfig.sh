#!/bin/sh
# One codebase, two apps: the stage pack named by --dart-define=PACK=<id> (default premom)
# also picks the iOS bundle id and the home-screen name (the pack's appName).
# Runs as a scheme pre-action (Runner.xcscheme) before each build and writes
# Flutter/Pack.xcconfig, which Debug.xcconfig and Release.xcconfig include.
# DART_DEFINES is a comma-separated list of base64 "KEY=value" items written by the flutter tool.
set -e
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
name=$(/usr/bin/plutil -extract appName raw -o - "$SRCROOT/../assets/packs/$pack.json")
printf 'PACK_ID=%s\nPACK_APP_NAME=%s\n' "$pack" "$name" > "$SRCROOT/Flutter/Pack.xcconfig"
