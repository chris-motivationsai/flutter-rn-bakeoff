#!/bin/sh
# CI check of a built simulator app: ios_inspect_app.sh <Runner.app> <packId>
# Fails unless the bundle id and display name follow the pack and the C++ engine is inside.
set -e
app=$1
pack=$2
here=$(cd "$(dirname "$0")/.." && pwd)
want_name=$(/usr/bin/plutil -extract appName raw -o - "$here/assets/packs/$pack.json")
id=$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$app/Info.plist")
name=$(/usr/bin/plutil -extract CFBundleDisplayName raw -o - "$app/Info.plist")
echo "BUNDLE pack=$pack id=$id displayName=$name size=$(du -sh "$app" | cut -f1)"
cat "$here/ios/Flutter/Pack.xcconfig" || true
find "$app" -maxdepth 3 | sed "s|$app|Runner.app|" | sort
lib=$(find "$app" -type f -name 'strip_engine*' | head -1)
[ -n "$lib" ] || { echo "no strip_engine binary in the app"; exit 1; }
echo "ENGINE-LIB pack=$pack path=${lib#"$app"/} bytes=$(stat -f %z "$lib") archs=$(lipo -archs "$lib")"
file "$lib"
nm -gU "$lib" | grep -E ' _strip_(read|engine_version)$'
[ "$(nm -gU "$lib" | grep -cE ' _strip_(read|engine_version)$')" = 2 ]
otool -L "$lib"
otool -l "$lib" | grep -A4 -E 'LC_BUILD_VERSION' | head -6
codesign -dv "$app" 2>&1 | head -8 || true
[ "$id" = "com.bakeoff.$pack" ] || { echo "bundle id is not com.bakeoff.$pack"; exit 1; }
[ "$name" = "$want_name" ] || { echo "display name is not $want_name"; exit 1; }
echo "OK $pack"
