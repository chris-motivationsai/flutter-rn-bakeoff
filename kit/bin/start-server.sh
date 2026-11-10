#!/bin/sh
# Starts the test server. Optional arg: port (default: random). Prints "LISTENING <port>".
exec node "$(dirname "$0")/../server/server.ts" "$@"
