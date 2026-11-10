#!/bin/sh
# Runs the on-device test (device-test/main.tsx + device-test/host.ts) in the built app on a booted iOS
# Simulator, then starts the normal app once and takes a screenshot of each.
# Usage: device-test/ios/run.sh <simulator udid> <App.app> <out dir> [engine-only | S01 S02 ...]
# Needs: kit/engine/build/strip_cli built, `npm ci` done in kit/ and here. Ports 8081 (Metro), 8787 (kit
# server) and 8799 (host) on the Mac; the simulator shares the Mac's loopback interface.
set -u
cd "$(dirname "$0")/../.."
UDID="$1"; APP="$2"; OUT="$3"; shift 3
mkdir -p "$OUT"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
PROCESS="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist")"
PIDS=""
cleanup() { for p in $PIDS; do kill "$p" 2>/dev/null; done; }
trap cleanup EXIT

wait_for() { # <seconds> <command...>: polls once a second until the command succeeds
  n="$1"; shift
  while [ "$n" -gt 0 ]; do "$@" > /dev/null 2>&1 && return 0; n=$((n - 1)); sleep 1; done
  return 1
}
metro_running() { curl -sf http://127.0.0.1:8081/status | grep -q 'packager-status:running'; }
start_metro() { # <log file> [NAME=value ...]: the extra environment decides the bundle's root component (index.ts)
  log="$1"; shift
  env ${1+"$@"} ./node_modules/.bin/expo start --port 8081 --clear > "$log" 2>&1 &
  METRO_PID=$!; PIDS="$PIDS $METRO_PID"
  wait_for 120 metro_running || { echo "Metro did not start"; tail -30 "$log"; exit 1; }
}

xcrun simctl bootstatus "$UDID" -b > /dev/null || { echo "simulator did not boot"; exit 1; }
xcrun simctl spawn "$UDID" log stream --style compact --predicate "process == \"$PROCESS\"" > "$OUT/app-oslog.log" 2>&1 &
PIDS="$PIDS $!"

../kit/bin/start-server.sh 8787 > "$OUT/kit-server.log" 2>&1 &
PIDS="$PIDS $!"
wait_for 30 curl -sf http://127.0.0.1:8787/__control/state || { echo "kit server did not start"; cat "$OUT/kit-server.log"; exit 1; }
DEVICE_TEST_SERVER_URL=http://127.0.0.1:8787 node device-test/host.ts 8787 "$OUT/device-test.json" ${1+"$@"} > "$OUT/host.log" 2>&1 &
HOST_PID=$!; PIDS="$PIDS $HOST_PID"

echo "== device test in $BUNDLE_ID"
start_metro "$OUT/metro-device-test.log" EXPO_PUBLIC_DEVICE_TEST=1 EXPO_PUBLIC_DEVICE_TEST_HOST=http://127.0.0.1:8799
xcrun simctl install "$UDID" "$APP" || exit 1
xcrun simctl launch "$UDID" "$BUNDLE_ID" || exit 1
START=$(date +%s)
host_done() { ! kill -0 "$HOST_PID" 2>/dev/null; }
wait_for 600 host_done || echo "device test did not finish in 600 s"
echo "device_test_seconds=$(( $(date +%s) - START ))" | tee "$OUT/device-test-time.txt"
xcrun simctl io "$UDID" screenshot "$OUT/device-test.png" > /dev/null 2>&1
xcrun simctl terminate "$UDID" "$BUNDLE_ID" > /dev/null 2>&1
kill "$METRO_PID" 2>/dev/null; wait "$METRO_PID" 2>/dev/null
cat "$OUT/host.log"

echo "== normal app start in $BUNDLE_ID"
start_metro "$OUT/metro-app.log"
xcrun simctl launch "$UDID" "$BUNDLE_ID"
bundled() { grep -q "Bundled" "$OUT/metro-app.log"; }
wait_for 240 bundled || echo "Metro did not report a bundle in 240 s"
sleep 20
xcrun simctl io "$UDID" screenshot "$OUT/app.png" > /dev/null 2>&1
if xcrun simctl spawn "$UDID" launchctl list | grep -q "$BUNDLE_ID"; then APP_ALIVE=yes; else APP_ALIVE=no; fi
echo "app_running_after_start=$APP_ALIVE" | tee "$OUT/app-start.txt"
grep -n -E "ERROR|Error:" "$OUT/metro-app.log" | head -20 | tee -a "$OUT/app-start.txt"
xcrun simctl terminate "$UDID" "$BUNDLE_ID" > /dev/null 2>&1

node device-test/summary.ts "$OUT/device-test.json" ${1+"$@"} > "$OUT/summary.md" 2> /dev/null
STATUS=$?
cat "$OUT/summary.md"
if grep -q "device-test" "$OUT/metro-app.log"; then echo "the normal start ran the device test, not the screens"; STATUS=1; fi
[ "$APP_ALIVE" = yes ] || { echo "the normal app was not running 20 s after its bundle loaded"; STATUS=1; }
exit $STATUS
