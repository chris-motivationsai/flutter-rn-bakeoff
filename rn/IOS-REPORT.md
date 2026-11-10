# iOS report

Run on 2026-11-10 on GitHub Actions hosted macOS runners (workflow `.github/workflows/ios-rn.yml`, branch `ios-rn`).
Nothing iOS was built or run on the development Mac (it has no Xcode). Everything below ran in CI; anything
that did not run is under "Not proven".

## Milestone reached: 3

| Milestone | Result |
|---|---|
| 1. Premom debug build for the iOS Simulator with the C++ engine | Built on the first attempt. `Premom.app` (arm64, Debug, 134 MB). `strip_read`, `strip_engine_version`, `strip_bridge_read` and `strip_bridge_version` are in `Premom.app/Premom.debug.dylib` (`nm`). The engine source in the module is byte-identical to `kit/engine` (`scripts/sync-engine.sh --check` runs before every build). |
| 2. Polly from the same code | Built from the same commit in a parallel job with `APP_PACK=polly`. Bundle id `com.example.family.polly`, display name "Polly" (Premom: `com.example.family.premom`, "Premom"), read from the built `Info.plist` and compared with the pack's `appName` and the Expo config. Both apps start on the simulator and show their Today screen with the pack's name. |
| 3a. Engine in the app vs host `strip_cli` | 106 of 106 fixtures: status equal and ratio bit-identical (max difference 0), in both apps, in both runs. Path: Hermes -> Expo module (`StripEngineModule.swift`) -> `strip_bridge.cpp` -> engine. Slowest single read 11 ms. Host statuses: 93 ok, 5 no control line, 5 too dark, 3 too bright. |
| 3b. 27 public scenarios in the app vs the kit server | 27 of 27 pass, in both apps, in both runs (4 replays in total, identical results). |

## Environment

| | |
|---|---|
| Runner | `macos-26` (image `macos26` 20261102.0473.1), macOS 26.7.2 (25G332), arm64, 3 cores, 7 GB |
| Xcode | 26.6 (17F113), the image default; iOS Simulator SDK 26.5 |
| Simulator | iPhone 17, iOS 26.5 runtime (the newest installed runtime that has an "iPhone 17") |
| Tools | Node 26.13.0 (`actions/setup-node`), npm 11.20.0, CocoaPods 1.17.0, Ruby 3.4.12 |
| Pods (from `Podfile.lock`) | React-Core-prebuilt 0.88.1, hermes-engine 260318099.0.5 (pre-built), ExpoModulesCore 58.0.30, ExpoSQLite 58.0.15, NitroIap 17.3.5, react-native-ble-plx 3.5.1, StripEngine 1.0.0 |

## How it was built and run

Per pack (two parallel jobs, `premom` and `polly`):

```sh
npm ci                                             # rn/
(cd ../kit && npm ci) && ../kit/engine/build.sh    # kit server dependencies, host strip_cli
APP_PACK=<pack> npx expo prebuild --platform ios --clean      # generates ios/, runs pod install
./device-test/ios/build.sh <simulator udid> <derived data> <out>   # xcodebuild + product checks
./device-test/ios/run.sh   <simulator udid> <App.app> <out>        # device test, then a normal start
```

- Build: `xcodebuild -workspace ios/<Name>.xcworkspace -scheme <Name> -configuration Debug -sdk iphonesimulator
  -destination "platform=iOS Simulator,id=<udid>"`. No signing setting was passed and no identity exists on the
  runner; the simulator build did not ask for one.
- The debug app has no embedded JS bundle. Metro runs on the runner (`expo start --port 8081`) and the app
  loads from it. The simulator shares the Mac's loopback interface, so the app reaches Metro, the kit server
  (`kit/bin/start-server.sh 8787`) and the test host (`device-test/host.ts`, port 8799) at `127.0.0.1`. Plain
  HTTP to `127.0.0.1` worked with the generated `Info.plist` (`NSAllowsLocalNetworking`); nothing was added.
- Device test: the same `device-test/main.tsx` as on Android, inside the app process: the native engine on every
  fixture, then the scenarios through `AppCore` with the real `expo-sqlite` adapter, the real `FetchHttp` over the
  app's `fetch`, `expo-crypto` ids and the native engine. Camera, thermometer, store and clock are the same fakes
  as on Android. `device-test/host.ts` on the runner serves the job, resets the kit server per scenario and
  compares: engine against `kit/engine/build/strip_cli`, scenarios with the checks of `kit/judge/judge.ts`
  (its `diff` is copied, as in the Android round). The app never sees `expect`.
- The scenario replay ran in both apps. The pack for each scenario comes from the host, so both apps replay
  all 27 (Premom-pack and Polly-pack scenarios alike).
- After the device test the app is started once more with a normal bundle (the screens). The script checks the
  process is still running 20 s after the bundle loaded and takes a screenshot.

## Workflow runs

| Run | Result | What happened | What I changed afterwards |
|---|---|---|---|
| [1](https://github.com/chris-motivationsai/flutter-rn-bakeoff/actions/runs/42822251747) | success (both jobs) | Cold build. Both apps built on the first attempt, engine 106/106, scenarios 27/27 in both. One thing was wrong although the run was green: the "normal start" step ran the device test a second time instead of the screens (Metro log: `[device-test] FAILED: Error: fetch failed: Could not connect to the server`, because the host had already exited). Cause: in `run.sh`, `VAR=1 shell_function` leaves `VAR` set in `sh`, so the second Metro still had `EXPO_PUBLIC_DEVICE_TEST=1`. A bug in my test script, not in the app. So run 1 did not prove that the screens start. | `run.sh` passes the extra environment through `env`, and fails if the normal start logs the device test. |
| [2](https://github.com/chris-motivationsai/flutter-rn-bakeoff/actions/runs/42826248473) | success (both jobs) | Cached build. Engine 106/106 and scenarios 27/27 again in both apps. The normal start now shows the screens: "Premom" / "Polly" title, "Everything is synced", Sync button, "Nothing logged yet." | Nothing (this report and the result files, committed with `[skip ci]`). |

Two runs, none failed. No build failed. `gh run watch` once returned an HTTP 500 from the GitHub API during run 2; the run itself was not affected.

## Scenarios (Premom app, run 2; the Polly app and run 1 gave the same numbers)

"Checks passed" counts the same checks as the kit judge. "Push requests" is the kit server's `pushRequests` at the end of the scenario.

| Scenario | Pack | Checks passed | Push requests | Result |
|---|---|---|---|---|
| S01 Manual logs online (Premom) | premom | 14/14 | 1 | pass |
| S02 Catalog comes from the pack: Polly rejects what it does not have | polly | 15/15 | 1 | pass |
| S03 Strip levels in Premom without premium: numeric result is locked | premom | 12/12 | 1 | pass |
| S04 Strip levels in Polly: yes or no, never a number | polly | 13/13 | 1 | pass |
| S05 A failed strip read is an error, never a low result | premom | 15/15 | 1 | pass |
| S06 Thermometer: final reading only, Fahrenheit converted, device timestamp honoured | polly | 13/13 | 1 | pass |
| S07 Thermometer failures create nothing | premom | 17/17 | 1 | pass |
| S08 Offline logging survives a restart and syncs later | premom | 21/21 | 1 | pass |
| S09 A push that the server applied but never answered must not duplicate or conflict | polly | 15/15 | 2 | pass |
| S10 Large offline backlog is pushed in chunks of at most 20 | premom | 58/58 | 4 | pass |
| S11 Edit and delete; reader results are read-only | premom | 24/24 | 2 | pass |
| S12 One pending change per observation: edits coalesce, create+delete sends nothing | premom | 18/18 | 1 | pass |
| S13 Conflict: another device edited first, the server copy wins and the loss is recorded | premom | 19/19 | 2 | pass |
| S14 Conflict with a remote delete, and a local delete that loses to a remote edit | premom | 18/18 | 2 | pass |
| S15 Pull: changes from another app in the family arrive; types this pack lacks stay hidden but are kept | polly | 21/21 | 1 | pass |
| S16 Purchase unlocks the numeric LH result only after the server verifies | premom | 17/17 | 1 | pass |
| S17 Purchases that do not complete: cancelled, store error, pending | premom | 19/19 | 0 | pass |
| S18 Purchase while the server is unreachable: receipt is held, survives restart, verified on next sync | premom | 19/19 | 1 | pass |
| S19 Receipts the server refuses never unlock anything | premom | 19/19 | 1 | pass |
| S20 Entitlement expires on the clock and the number locks again | premom | 20/20 | 0 | pass |
| S21 Polly sells nothing: purchase is not available and the store is never called | polly | 10/10 | 0 | pass |
| S22 Restore purchases | premom | 19/19 | 1 | pass |
| S23 Analytics crosses the gate without health data, and only when online | premom | 18/18 | 1 | pass |
| S24 Persona: regular 28-day cycle | premom | 109/109 | 23 | pass |
| S25 Persona: long 36-day cycle | polly | 118/118 | 34 | pass |
| S26 Persona: PCOS-like, several LH surges | premom | 124/124 | 30 | pass |
| S27 Persona: anovulatory, no temperature shift | polly | 105/105 | 27 | pass |

The push-request counts are the same as the headless Node runner gives on the development Mac for all 27
scenarios (measured there by replaying each scenario through `run-scenario.sh` against the kit server and reading
`pushRequests`). In particular the "apply, then drop the connection" scenarios (S09, S10, S24 to S27) pass on iOS:
the iOS HTTP stack did not re-send the dropped POST. That is the failure the Android round reported for these six
scenarios; it did not occur here.

Result files: `device-test/results/ios-premom-app.json`, `device-test/results/ios-polly-app.json` (run 2).
Each run's artifacts (`ios-rn-premom`, `ios-rn-polly`) hold the xcodebuild log, Metro logs, the app's OS log, the kit
server log, both screenshots, `Podfile.lock` and the result JSON.

## Device-only problems

None in the app. The Swift half of the native module (`modules/strip-engine/ios/StripEngineModule.swift`) and its
podspec, which had never been compiled, compiled and worked unchanged. No scenario failed, so there was nothing to
fix or leave open.

Seen in the screenshots, not investigated: React Native's warning banner ("Open debugger to view warnings", from
the `SafeAreaView` deprecation warning also seen on Android) covers the bottom of the screen where the tab bar is,
so the tab bar's position on iOS was not seen.

## Changes

**App: 0 files, 0 lines.** Nothing under `src/`, `modules/`, `tests/`, and none of `App.tsx`, `index.ts`,
`app.config.ts`, `package.json`, `metro.config.js` was changed. Nothing under `kit/` or `flutter/` was changed.

**Test-only:**

| File | Lines | Why |
|---|---|---|
| `device-test/host.ts` | +8 -3 | `DEVICE_TEST_SERVER_URL` sets the kit server URL given to the app (default stays the Android emulator's `10.0.2.2`); the result file is written after every scenario and keeps the device's output for a failing one. No check was changed. |
| `device-test/main.tsx` | +2 -1 | Comment only. |
| `device-test/summary.ts` | new, 26 | Prints the result file as a table; exits 1 unless the engine matched on every fixture and every scenario passed. |
| `device-test/ios/build.sh` | new, 47 | xcodebuild, then checks bundle id, display name and engine symbols in the product. |
| `device-test/ios/run.sh` | new, 70 | Kit server, host, Metro, install, launch, wait, screenshots, normal start. |
| `.github/workflows/ios-rn.yml` | new, 122 | The workflow. |
| `device-test/results/ios-*.json`, this report | new | Results. |

`./test.sh` (164 tests) and `./check.sh` pass on the development Mac after the changes.

## Build times

From the step times of the two runs (Premom job / Polly job):

| | Cold (run 1) | Cached (run 2) |
|---|---|---|
| Whole job | 24 min 29 s / 21 min 48 s | 13 min 27 s / 12 min 10 s |
| `npm ci` | 5 min 31 s / 5 min 17 s | skipped |
| `expo prebuild` with `pod install` | 2 min 44 s / 2 min 36 s | skipped |
| `xcodebuild` | 549 s / 439 s (637 compile commands) | 256 s / 256 s (257 compile commands) |
| Cache restore | 54 s / 59 s (miss) | 4 min 34 s / 4 min 08 s (hit, 1585 MB per pack) |
| Cache save | 2 min 25 s / 1 min 49 s | skipped |
| Device test (launch to last result, includes the first Metro bundle) | 38 s / 32 s | 33 s / 35 s |
| Device-test step in total (both Metro starts, both launches) | 2 min 28 s / 2 min 36 s | 3 min 08 s / 2 min 39 s |

The cache holds `node_modules`, the generated `ios/` with Pods, and Xcode's derived data, keyed on the lock file,
`app.config.ts`, the native module, the packs and the engine source. On a hit, `npm ci` and prebuild are skipped and
xcodebuild builds incrementally. The cached xcodebuild was not a no-op: 242 of its 257 compile commands were the
`NitroIap` pod (react-native-iap) being compiled again; I did not find out why. Restoring the 1.6 GB cache takes over
4 minutes, so the net saving is about 11 minutes per job.

## Not proven

- Anything on a physical iPhone; any device build (`iphoneos` SDK), code signing, provisioning, release
  configuration, an embedded JS bundle, App Store packaging. Only an arm64 Debug simulator build loading JS from Metro ran.
- Any simulator other than iPhone 17 on iOS 26.5; any Xcode other than 26.6; an Intel simulator build.
- The real camera path, real Bluetooth, real StoreKit purchases. The scenario test fakes all three, as on Android
  and in the headless runner. The Scan, Thermometer and Upgrade screens were not opened.
- The screens beyond the first screen after start. Nothing was tapped: no log was entered, Sync was not pressed,
  no tab was switched. (The Android round did one manual log and sync through the screens; that was not repeated here.)
- Storage across a real process kill. The scenarios' `restart` step closes and reopens the database inside one
  process, as on Android.
- That the screens use the default server URL correctly on iOS (`http://127.0.0.1:8787` in the config; reachable
  on a simulator, wrong on a phone).
- Behaviour when the app is in the background during a request, and the 15 s fetch timeout on iOS.
- Why the cached build recompiles `NitroIap`.
- How the tab bar and safe areas look on iOS (covered by the warning banner in the screenshots).
