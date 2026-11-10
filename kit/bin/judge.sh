#!/bin/sh
# Usage: kit/bin/judge.sh <stackDir> [scenario ids...]   (runs the public scenarios)
D="$(cd "$(dirname "$0")/.." && pwd)"; S="$1"; shift
exec node "$D/judge/judge.ts" "$S" "$D/scenarios" "$@"
