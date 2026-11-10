// The C++ strip engine for headless runs: an N-API addon built from kit/engine + the shared bridge
// (modules/strip-engine/node/build.sh). A phone reaches the same C++ through modules/strip-engine/index.ts.
import path from 'node:path';
import type { StripEngine } from '../../core/ports';

export function loadNodeStripEngine(projectRoot: string): StripEngine {
  const addon = path.join(projectRoot, 'modules', 'strip-engine', 'node', 'build', 'strip_engine.node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const native = require(addon) as StripEngine;
  return { version: () => native.version(), read: (gray, width, height) => native.read(gray, width, height) };
}
