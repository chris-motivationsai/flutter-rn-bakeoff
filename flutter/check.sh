#!/bin/sh
# Static checks. Exits non-zero on any problem.
#  1. the generated contract code and bundled packs match kit/contracts and kit/packs
#  2. flutter analyze over app, adapters (against the real plugin APIs), tests, tools and build hook
cd "$(dirname "$0")" || exit 1
[ -f .dart_tool/package_config.json ] || flutter pub get >/dev/null
OUT="$(dart run tool/gen_contracts.dart --check 2>&1)"; CODE=$?
printf '%s\n' "$OUT" | sed 's/^\(Running build hooks\.\.\.\)*//'
[ $CODE -eq 0 ] || exit $CODE
flutter analyze --no-pub || exit 1
