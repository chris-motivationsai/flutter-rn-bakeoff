# Journal

Short log, in order. Times are rough.

1. **Read the kit.** SPEC, contracts, packs, engine, server, judge, a handful of scenarios, and a scan of all BLE fixtures for frame shapes (flags 0/1/5/6, one truncated frame, never more than one final reading).
2. **Toolchain spike (worked first time).** `flutter create`, added plugins, wrote a build hook (`hook/build.dart`, `native_toolchain_c`) that compiles `kit/engine/strip_engine.cpp` and a `@Native` binding. `dart run` inside the Flutter package built the engine, loaded it over FFI and opened SQLite. Cold run about 3 s, warm about 0.8 s. This decided the design: pure-Dart core inside the Flutter package, runner started with `dart run`, no `flutter test` wrapper needed.
   - Noise, not a failure: the first hook run printed `xcrun: error: SDK "iphonesimulator" cannot be located` several times (some dependency's hook probing for Xcode). The build still succeeded. I did not track down which package prints it.
3. **Contracts.** Chose to generate Dart from `kit/contracts/json-schema.json` and copy packs, with a `--check` mode. Found that the push limit, decimal rules and the reader rule are not in the JSON Schema, only in `schemas.ts`; extracted them by regex (see KIT-ISSUES 9).
4. **Core, storage, runner written in one pass.** First judge run: 26/27. The failure was S21 (`lastPurchaseError` expected `not_available`); the SPEC does not say either way, so I set it (KIT-ISSUES 1). Second run: 27/27.
5. **Real adapters.** Read the plugin sources in the pub cache for the current APIs rather than trusting memory. Things that differed from what I expected: `flutter_blue_plus` 2.x requires a `license:` argument on `connect` and is paid for commercial use; `in_app_purchase` gives no "restore finished" signal, so the adapter waits a fixed 2 s. Both adapters pass `flutter analyze` and have never executed.
6. **Tests.** Wrote an in-process fake server on `http`'s `MockClient` so tests can read request bodies and inject faults. Widget tests run the real core (SQLite file + FFI engine) under `flutter test`; that worked without special setup.
   - Real bug found by a test: the camera adapter's grayscale conversion used `package:image`'s `luminance`, which for single-channel images computes `0.299 * gray` (g and b read as 0). A grayscale photo would have reached the engine at 30% brightness. Fixed and covered.
   - One wrong test of mine (bad hex arithmetic in a thermometer frame); fixed the test.
   - `check.sh` bug of mine: a pipe into `grep` hid the generator's exit code. Fixed and verified by planting a stray pack and an edited generated file.
7. **Self-check by seeding bugs.** Seeded 37 single-line bugs into the core and ran the unit + widget tests without the scenario replay: 33 caught. The 4 misses were one weak assertion (request order) and three bugs that the pull in the same sync silently repaired. Added tests for "push answered, pull fails" and exposed `AppCore.applyPull`; all 37 then caught. The script lived in the scratchpad, not in this folder.
8. **Docs.**

## Could not verify

- Any iOS or Android build, including whether the engine hook cross-compiles and the sqlite3 hook bundles.
- The Bluetooth, store and camera adapters at run time.
- Behaviour on a real network.

## What cost time

Little did. The largest single items were reading plugin sources to write the real adapters against current APIs, and writing the test suite. No dead ends in the core. The decisions I am least sure of are the SPEC gaps in KIT-ISSUES 2-5, where hidden scenarios could expect something else.

## Dependencies on the environment

- First build after a clean checkout needs network: `package:sqlite3`'s hook downloads a prebuilt SQLite library. After that everything runs offline.
- The runner finds packs at `../kit/packs` (override: `BAKEOFF_KIT_DIR`, used in no test) and the build hook finds the engine at `../kit/engine` (override: `BAKEOFF_ENGINE_DIR`, never tried; build hooks may not see the caller's environment).
