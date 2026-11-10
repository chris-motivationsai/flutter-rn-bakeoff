#!/bin/sh
# Runner contract (kit/SPEC.md section 8): ./run-scenario.sh <scenario.json> <serverUrl> <out.json> <workDir>
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/modules/strip-engine/node/build.sh" >&2
exec "$HERE/node_modules/.bin/tsx" "$HERE/src/runner/main.ts" "$@"
