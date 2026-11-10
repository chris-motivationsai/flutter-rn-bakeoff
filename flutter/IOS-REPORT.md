# iOS report: Flutter slice

Run on 2026-11-10 on GitHub Actions hosted runners (workflow `.github/workflows/ios-flutter.yml`, branch `ios-flutter`). Nothing iOS was built or run on a local machine; the development Mac has no Xcode. Everything below ran on an iOS Simulator. No physical iPhone was involved.

## Milestone reached

All three.

1. **Premom debug build for the iOS Simulator, containing the C++ engine.** Yes, first attempt.
2. **Polly from the same code, different bundle id and display name, driven by the pack.** Yes, first attempt, after the app changes listed below.
3. **On the simulator, inside the app process.**
   a. Engine: same status and same ratio (exact double equality) as the host `strip_cli` on **106 of 106** fixtures. Run with the Premom build and again with the Polly build.
   b. Scenarios: **27 of 27** public scenarios passed, checked the way `kit/judge/judge.ts` checks them.

## Environment

| | |
|---|---|
| Runner label | `macos-26` (arm64, 3 cores, 7 GB) |
| Runner image | `macos26` version `20261102.0473.1`, macOS 26.7.2 (25G332) |
| Xcode | 26.6 (17F113), the image default |
| iOS runtime | iOS 26.5 (23F77) simulator |
| Simulator device | iPhone 17 (picked by the workflow: newest iOS runtime, "iPhone 17" preferred) |
| Flutter | 3.47.9 stable, Dart 3.13.7 (`subosito/flutter-action@v2`) |
| Node | 24.22.2 (preinstalled on the image) |
| Plugins on iOS | Swift Package Manager. No Podfile, CocoaPods not used. |
| Code signing | None configured. `flutter build ios --simulator --debug` and `flutter test -d <simulator>` needed no identity or team. |

## Workflow runs, in order

| Run | Trigger, commit | Result | What happened |
|---|---|---|---|
| [1](https://github.com/chris-motivationsai/flutter-rn-bakeoff/actions/runs/42822204133) | push `87583c0` | Cancelled by the 45 minute job timeout | Premom build, Premom inspection, Polly build, Polly inspection all passed. The first on-simulator test (`device_test.dart`, Premom) printed both tests as passed (106 fixtures identical; storage and sync ok), then `flutter test` failed in its own cleanup with `Unable to terminate com.bakeoff.polly ... found nothing to terminate` and never exited. The step hung for 34 minutes until the job timeout. No artifacts were uploaded (my upload step did not run on a timed-out job). Cause: see "Device-only problems" 1. |
| [2](https://github.com/chris-motivationsai/flutter-rn-bakeoff/actions/runs/42829365751) | push `3153e07` | Success, 23 min 28 s | Changes: the workflow runs `ios/Flutter/pack_xcconfig.sh <pack>` before each `flutter test`; 12 minute step timeouts on the test steps; results uploaded with `always()`. All steps passed: both builds, both inspections, engine 106/106 (Premom and Polly builds), scenarios 27/27, both apps installed and launched side by side. |
| [3](https://github.com/chris-motivationsai/flutter-rn-bakeoff/actions/runs/42833388932) | `workflow_dispatch`, same commit as run 2 | Success, 25 min 46 s | Rerun with the Flutter SDK and pub caches restored. Same results; the per-scenario lines (pack, steps, checks, push requests, server observations, events) and the per-sync push counts were identical to run 2. |

3 runs, 1 failed (run 1). Pushes of this report do not start a run (`*.md` is excluded from the trigger paths).

## Device-only problems

1. **`flutter test` tried to stop the wrong bundle id and hung (run 1).** The bundle id now depends on the pack. The pack reaches Xcode through a scheme pre-action that runs during the build, but the flutter tool reads the bundle id from the Xcode build settings *before* it builds. In run 1 the previous build had been Polly, so the tool believed the app was `com.bakeoff.polly`, while the app it had just built, installed and launched (it takes that id from the built `Info.plist`) was `com.bakeoff.premom`. The tests ran and passed; the tool then failed to terminate an app that was not running and did not exit. This is the same wart the Android report describes (`adb uninstall` of the wrong package), but on iOS it hangs the command instead of printing a warning.
   Fix (CI only, 3 lines in the workflow, plus an optional argument in the script): run `ios/Flutter/pack_xcconfig.sh <pack>` before `flutter test`, so the build settings are already right when the tool reads them. A developer switching packs before `flutter test` or `flutter run` has to do the same. `flutter build ios` is not affected, apart from printing `Building com.bakeoff. for simulator` on a clean checkout. Flutter's supported route (flavors with `--flavor`) would avoid this at the cost of a second flag that has to agree with `PACK`.
2. **Nothing else.** The untouched Dart code, build hook, plugins, SQLite hook and both integration test files worked on the iOS Simulator first time. No scenario failed, so there are no scenario causes to report.

## What the apps contain

From `tool/ios_inspect_app.sh` in run 2 (it fails the job unless the id and name follow the pack and the engine exports are present):

```
BUNDLE pack=premom id=com.bakeoff.premom displayName=Premom size=168M
BUNDLE pack=polly  id=com.bakeoff.polly  displayName=Polly  size=168M
ENGINE-LIB path=Frameworks/strip_engine.framework/strip_engine bytes=166560 archs=x86_64 arm64
```

`Runner.app/Frameworks` holds `App.framework`, `Flutter.framework`, `objective_c.framework`, `sqlite3.framework` and `strip_engine.framework`. The engine binary is a universal Mach-O dynamic library (x86_64 and arm64 simulator slices, platform 7 = iOS Simulator, minimum iOS 15.0), exports `_strip_read` and `_strip_engine_version`, and links `libc++.1.dylib`, Foundation and `libSystem`. It is built by the existing `hook/build.dart` from `kit/engine/strip_engine.cpp`. The workflow fails if anything under `kit/` or `rn/` differs from the repository's first commit.

Both saved apps were then installed on the one simulator and started with `simctl launch`. Both processes were running (`UIKitApplication:com.bakeoff.premom`, `UIKitApplication:com.bakeoff.polly`), `simctl listapps` showed both ids with display names Premom and Polly, and the screenshots (run artifacts `launch-premom.png`, `launch-polly.png`) show the Today screen titled "Premom" and "Polly" with "Nothing logged yet". Nothing was tapped.

## Engine comparison

`kit/engine/build.sh` built `strip_cli` on the runner; the workflow ran it over the 106 files in `kit/scenarios/fixtures/strips/` (93 status 0, 5 status 1, 5 status 2, 3 status 3) and served the PGMs and the expected lines over HTTP on the runner. `integration_test/device_test.dart`, unchanged from the Android round, fetched each file inside the app on the simulator, ran it through `NativeStripEngine` (FFI into `strip_engine.framework`) and compared.

```
DEVICE abi=ios_arm64 os=Version 26.5 (Build 23F77) engineVersion=bakeoff-1.0.0
ENGINE compared=106 fixtures, all identical to host
```

Same output for the Premom and the Polly build, in runs 1, 2 and 3. Host and simulator are both arm64 with Apple clang, so this is a weaker cross-check than the Android one (NDK clang against Apple clang).

The second test in that file (storage survives closing and reopening the database, sync reaches the kit server, pull of a remote change, wipe and pull back) passed for both packs: `serverObservations=3 pushRequests=1`, database at `<app container>/Library/Application Support/slice-<pack>.db`.

## Scenarios on the simulator

`integration_test/scenarios_device_test.dart`, unchanged from the Android round, in the Premom-id app. Per scenario: reset the kit server, run the app's `ScenarioRunner` (the class behind `run-scenario.sh`) with only `pack` and `steps`, then compare step results, snapshots and the server's `/__control/state` with `expect` using a port of the judge's `diff`. `expect` is read only by the test, after the run.

| Part | On the simulator |
|---|---|
| Storage | Real: SQLite files under the app container's `Library/Application Support/scenarios/<id>/`, opened by the app's `LocalStore`. `restart` closes and reopens the file. |
| HTTP | Real: `package:http` over `dart:io` sockets, cleartext to `127.0.0.1` on the runner (the simulator shares the host's loopback). |
| Kit server | `kit/bin/start-server.sh 18932` on the runner, after `npm ci` in `kit/`. |
| Strip engine | Real: `strip_engine.framework` through FFI. |
| Clock | The runner's `ManualClock`, set from each step's `at`. |
| Bluetooth, store | Fakes: `ScriptedThermometer`, `FakeStore` (as on Android). |

Run 2 (run 3 was identical except for the times):

| Scenario | Pack | Steps | Checks | Run ms | Push requests | Result |
|---|---|---|---|---|---|---|
| S01 | premom | 6 | 14/14 | 316 | 1 | PASS |
| S02 | polly | 8 | 15/15 | 37 | 1 | PASS |
| S03 | premom | 5 | 12/12 | 61 | 1 | PASS |
| S04 | polly | 6 | 13/13 | 41 | 1 | PASS |
| S05 | premom | 7 | 15/15 | 43 | 1 | PASS |
| S06 | polly | 6 | 13/13 | 69 | 1 | PASS |
| S07 | premom | 9 | 17/17 | 29 | 1 | PASS |
| S08 | premom | 12 | 21/21 | 54 | 1 | PASS |
| S09 | polly | 7 | 15/15 | 70 | 2 | PASS |
| S10 | premom | 50 | 58/58 | 354 | 4 | PASS |
| S11 | premom | 16 | 24/24 | 148 | 2 | PASS |
| S12 | premom | 10 | 18/18 | 123 | 1 | PASS |
| S13 | premom | 10 | 19/19 | 117 | 2 | PASS |
| S14 | premom | 10 | 18/18 | 73 | 2 | PASS |
| S15 | polly | 13 | 21/21 | 80 | 1 | PASS |
| S16 | premom | 8 | 17/17 | 151 | 1 | PASS |
| S17 | premom | 9 | 19/19 | 32 | 0 | PASS |
| S18 | premom | 10 | 19/19 | 72 | 1 | PASS |
| S19 | premom | 10 | 19/19 | 84 | 1 | PASS |
| S20 | premom | 10 | 20/20 | 47 | 0 | PASS |
| S21 | polly | 3 | 10/10 | 22 | 0 | PASS |
| S22 | premom | 10 | 19/19 | 70 | 1 | PASS |
| S23 | premom | 11 | 18/18 | 76 | 1 | PASS |
| S24 | premom | 99 | 109/109 | 529 | 23 | PASS |
| S25 | polly | 107 | 118/118 | 668 | 34 | PASS |
| S26 | premom | 113 | 124/124 | 669 | 30 | PASS |
| S27 | polly | 94 | 105/105 | 929 | 27 | PASS |

`Push requests` is the server's `pushRequests` counter at the end of the scenario. Every figure equals the Android emulator's figure for the same scenario in `ONDEVICE-SCENARIOS.md`.

The test's second pass (apply-then-drop scenarios replayed step by step, reading the counter around each sync) gave, for every sync that followed `applyThenDrop: 1`: result `network`, exactly 1 push request counted, pending count unchanged (S09 step 3; S10 step 46 with 45 pending; S24 step 56; S25 step 47; S26 step 54; S27 step 50). The iOS HTTP stack did not resend a dropped request. The 12 other `network` syncs it printed in S24 to S27 are server-down steps and counted 0 push requests.

## Changes

### App (needed for milestone 2; nothing was needed for milestone 1 or 3)

| File | Lines | Why |
|---|---|---|
| `ios/Flutter/pack_xcconfig.sh` | new, 25 | Decodes `PACK` from `DART_DEFINES` (default `premom`), reads `appName` from `assets/packs/<pack>.json`, writes `Flutter/Pack.xcconfig` with `PACK_ID` and `PACK_APP_NAME`. Takes the pack as an optional argument for running by hand. |
| `ios/Runner.xcodeproj/xcshareddata/xcschemes/Runner.xcscheme` | +16 | Scheme pre-action that runs the script before each build. |
| `ios/Flutter/Debug.xcconfig`, `Release.xcconfig` | +1 each | `#include? "Pack.xcconfig"`. |
| `ios/Runner.xcodeproj/project.pbxproj` | +3 −3 | `PRODUCT_BUNDLE_IDENTIFIER = "com.bakeoff.$(PACK_ID)"` (Debug, Release, Profile); was `com.bakeoff.sliceApp`. |
| `ios/Runner/Info.plist` | +1 −1 | `CFBundleDisplayName` is `$(PACK_APP_NAME)`; was `Slice App`. |
| `ios/.gitignore` | +1 | Ignore the generated `Flutter/Pack.xcconfig`. |

App total: 7 files, 49 lines added, 4 removed. Nothing under `lib/`, `hook/`, `pubspec.yaml` or `android/` changed. The pre-action's output was picked up by the same build on a clean checkout (run 1, first build), and when switching pack on a built tree.

### Test and CI only

| File | Lines | Why |
|---|---|---|
| `.github/workflows/ios-flutter.yml` | new, 224 | The whole iOS round. |
| `tool/ios_inspect_app.sh` | new, 25 | Checks a built app's id, name and engine library. |
| `IOS-REPORT.md` | new | This report. |

`integration_test/device_test.dart` and `integration_test/scenarios_device_test.dart` were not edited (their header comments still show the Android `10.0.2.2` addresses). No check was changed.

Headless tests after the changes, run locally: `./test.sh` 158 passed, 1 skipped, 0 failed; `./check.sh` clean.

## Build and step times

Seconds, wall clock, 3-core hosted runner. "Step" includes `flutter` start-up, `pub get` and hooks; "Xcode" is the tool's own `Xcode build done` figure.

| | Run 1 | Run 2 | Run 3 (SDK and pub caches restored) |
|---|---|---|---|
| Premom build, first build on a fresh runner (cold: no DerivedData, Swift packages resolved, engine and SQLite hooks run) | step 236, Xcode 167.9 | step 276, Xcode 210.9 | step 311, Xcode 222.3 |
| Polly build right after, same tree (incremental) | step 75, Xcode 44.9 | step 95, Xcode 65.7 | step 98, Xcode 62.9 |
| `device_test.dart` Premom (build, install, run) | hung after passing; Xcode 82.1 | 172, Xcode 86.2 | 171, Xcode 83.7 |
| `scenarios_device_test.dart` | not reached | 123, Xcode 41.5 | 139, Xcode 59.0 |
| `device_test.dart` Polly | not reached | 115, Xcode 66.8 | 118, Xcode 65.5 |
| Flutter SDK set-up step | 212 (download) | 226 (download) | 213 (cache hit, restore) |
| Simulator boot | about 100 | about 105 | about 200 |
| Whole job | 45 min (timeout) | 23 min 28 s | 25 min 46 s |

The cache restored the Flutter SDK and the pub cache in run 3 but saved no time: restoring took as long as downloading, and the Xcode build is not cached between runs (each run is a cold Xcode build). The only "cached" build figures are the incremental ones within a job.

## Not proven

- A physical iPhone, a device (`iphoneos`) build, code signing, provisioning, archive/IPA, TestFlight or App Store upload. Only unsigned-for-distribution simulator debug builds exist. With signing, the pack-driven bundle id would also need matching provisioning profiles per id; not tried.
- Release or profile builds (AOT). Only debug (JIT) ran.
- The engine's arm64 device slice. Only the arm64 simulator slice was loaded; the x86_64 simulator slice was built and never loaded.
- Any iOS version other than the 26.5 simulator. The deployment target is 15.0; nothing ran there.
- Camera (`image_picker`), Bluetooth (`flutter_blue_plus`) and StoreKit (`in_app_purchase`): compiled and linked through Swift Package Manager, and the app started with them, but none was exercised. Strip images came over HTTP as PGM. The simulator has no Bluetooth or camera.
- App Transport Security and real networks. Traffic was cleartext HTTP to `127.0.0.1` through `dart:io` sockets; no TLS, no cellular, no background limits.
- Process death. "Restart" is the runner closing and reopening the database in one process; iOS never killed the app.
- UI behaviour. The apps were launched and screenshotted once each; no screen was driven. The scenarios go through the app core, not the widgets.
- That the scheme pre-action works from the Xcode IDE or with an archive action; it was exercised only through `flutter build ios --simulator` and `flutter test`.
- Per-app icons and launch screens. The two apps differ in id, display name and pack behaviour only.
- Timing stability. Two green runs on shared hosted runners; step times varied by up to 30 percent between them.
