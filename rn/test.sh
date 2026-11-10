#!/bin/sh
# Runs every automated test: core + adapters + scenario runner (Node), screens and device adapters (jest-expo).
# Exits non-zero on any failure. Extra arguments go to Jest, e.g. ./test.sh tests/core/sync.test.ts
set -e
cd "$(dirname "$0")"
./modules/strip-engine/node/build.sh
exec ./node_modules/.bin/jest "$@"
