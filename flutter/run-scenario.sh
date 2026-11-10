#!/bin/sh
# Runner contract (SPEC section 8): ./run-scenario.sh <scenario.json> <serverUrl> <out.json> <workDir>
# Runs the scenario through the same Dart core the Flutter screens use, with the C++ engine
# loaded over FFI (built from kit/engine by hook/build.dart) and SQLite storage in <workDir>.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
abs() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$(pwd)" "$1" ;; esac; }
SCN="$(abs "$1")"; OUT="$(abs "$3")"; WORK="$(abs "$4")"
cd "$HERE"
[ -f .dart_tool/package_config.json ] || flutter pub get >/dev/null 2>&1
export SLICE_APP_ROOT="$HERE"
# Build-hook chatter goes to stderr only when the run fails.
LOG="$(mktemp)"
if dart run bin/run_scenario.dart "$SCN" "$2" "$OUT" "$WORK" >"$LOG" 2>&1; then rm -f "$LOG"; exit 0; fi
CODE=$?; cat "$LOG" >&2; rm -f "$LOG"; exit $CODE
