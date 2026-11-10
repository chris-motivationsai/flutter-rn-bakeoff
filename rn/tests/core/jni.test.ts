// Runs the Android JNI glue (strip_jni.cpp) on a host JVM, when a JDK is installed, and compares it with the
// Node binding on every strip fixture. Skipped (and reported as skipped) when there is no JDK.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadNodeStripEngine } from '../../src/adapters/fake/nodeStripEngine';
import { parsePgm } from '../../src/core/image';
import { KIT, PROJECT_ROOT } from '../helpers/server';

const brewed = fs.existsSync('/opt/homebrew/opt') ? fs.readdirSync('/opt/homebrew/opt').filter((name) => name.startsWith('openjdk')).map((name) => `/opt/homebrew/opt/${name}`) : [];
const jdk = [process.env.JAVA_HOME ?? '', ...brewed].find((home) => home && fs.existsSync(path.join(home, 'include', 'jni.h')) && fs.existsSync(path.join(home, 'bin', 'java')));

(jdk ? test : test.skip)('the Android JNI glue returns the same results as the Node binding', () => {
  const home = jdk as string;
  const module = path.join(PROJECT_ROOT, 'modules', 'strip-engine');
  const lib = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'strip-jni-')), 'libstrip-engine.dylib');
  execFileSync('clang++', [
    '-std=c++17', '-O2', '-fPIC', '-dynamiclib',
    `-I${home}/include`, `-I${home}/include/darwin`, `-I${module}/cpp`,
    path.join(module, 'cpp', 'engine', 'strip_engine.cpp'), path.join(module, 'cpp', 'strip_bridge.cpp'), path.join(module, 'android', 'src', 'main', 'cpp', 'strip_jni.cpp'),
    '-o', lib,
  ]);
  const dir = path.join(KIT, 'scenarios', 'fixtures', 'strips');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.pgm')).sort().map((name) => path.join(dir, name));
  const lines = execFileSync(path.join(home, 'bin', 'java'), [path.join(PROJECT_ROOT, 'tests', 'jni', 'StripEngineModule.java'), lib, ...files], { encoding: 'utf8' }).trim().split('\n');

  const engine = loadNodeStripEngine(PROJECT_ROOT);
  expect(lines[0]).toBe(engine.version());
  expect(lines[lines.length - 1]).toBe('bad 4');
  files.forEach((file, i) => {
    const image = parsePgm(new Uint8Array(fs.readFileSync(file)));
    const expected = engine.read(image.gray, image.width, image.height);
    const [status, ratio] = lines[i + 1].split(' ').map(Number);
    expect([path.basename(file), status]).toEqual([path.basename(file), expected.status]);
    expect(ratio).toBeCloseTo(expected.ratio, 12);
  });
});
