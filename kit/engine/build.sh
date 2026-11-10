#!/bin/sh
# Builds the host dylib and the CLI used by the kit. Safe to re-run.
set -e
cd "$(dirname "$0")"
mkdir -p build
clang++ -std=c++17 -O2 -fPIC -dynamiclib strip_engine.cpp -o build/libstrip_engine.dylib
clang++ -std=c++17 -O2 strip_engine.cpp strip_cli.cpp -o build/strip_cli
echo "built: $(pwd)/build/libstrip_engine.dylib"
