#!/bin/sh
# Runs every automated test: core unit tests, adapter tests, widget tests and the replay of
# the kit's public scenarios against the kit server. Exits non-zero on any failure.
set -e
cd "$(dirname "$0")"
[ -f .dart_tool/package_config.json ] || flutter pub get >/dev/null
exec flutter test --reporter "${TEST_REPORTER:-expanded}" "$@"
