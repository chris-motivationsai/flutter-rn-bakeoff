# Android report

Run on 2026-11-10, macOS arm64, Node 26, Homebrew openjdk 17. About 21 minutes from first command to last.
Everything below was run; anything not run is listed under "Not proven".

## Milestone reached: 3 (stretch), with one open finding

| Milestone | Result |
|---|---|
| 1. Premom debug APK with the C++ engine for arm64 | Built on the first Gradle attempt. `lib/arm64-v8a/libstrip-engine.so` (401 KB, ELF aarch64) is in the APK and exports `strip_read`, `strip_engine_version`, `strip_bridge_read`, `strip_bridge_version` and the two JNI functions. |
| 2. Polly debug APK from the same code | Built. `com.example.family.polly`, label "Polly" (Premom: `com.example.family.premom`, "Premom"). Both install side by side. The first Polly APK crashed at start; fixed (failure 2 below). |
| 3a. Engine on the emulator vs host engine | 106 of 106 strip fixtures: status equal and ratio bit-identical to `kit/engine/build/strip_cli` (max difference 0). Called from JS in the app process: Hermes -> Expo module (Kotlin) -> JNI -> bridge -> engine. |
| 3b. Storage and sync on the emulator vs the kit server | The kit's 27 public scenarios replayed inside the app on the emulator: 21 pass, 6 fail, all 6 for one reason (failure 4 below, not fixed). Separately, one manual log entered through the real screens was saved, synced to the kit server, and was still there after the process was killed and relaunched. |

Emulator: Android 15 (API 35), `system-images;android-35;default;arm64-v8a`, headless (`-no-window`), AVD `bakeoff35`. It was shut down at the end.

`.so` files in the Premom APK (all `lib/arm64-v8a/`): libNitroIap, libNitroModules, libandroidx.graphics.path,
libappmodules, libbarhopper_v3, libc++_shared, libexpo-modules-core, libexpo-modules-jsi, libexpo-modules-v2,
libexpo-sqlite, libfbjni, libgifimage, libhermestooling, libhermesvm, libimage_processing_util_jni,
libimagepipeline, libjsi, libnative-filters, libnative-imagetranscoder, libreactnative, libstatic-webp,
**libstrip-engine**, libsurface_util_jni, libzstd-kmp (24 files). The engine source in the module is byte-identical to `kit/engine/strip_engine.cpp` (`diff`, and `check.sh`).

## How it was built

```sh
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=$ANDROID_HOME
APP_PACK=premom npx expo prebuild --platform android --no-install          # add --clean when switching pack
(cd android && APP_PACK=premom ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a)
```

All builds were arm64-v8a only (`-PreactNativeArchitectures`, a command-line flag). The other three ABIs were not built.
The native module (`modules/strip-engine/android`: `build.gradle`, `CMakeLists.txt`, Kotlin, JNI) compiled and
worked without any change.

## Build attempts

Four Gradle builds, all successful. No build failed.

| # | Pack | Wall clock | Notes |
|---|---|---|---|
| 1 | Premom | 3 min 15 s | First ever: Gradle 9.4.1, dependencies, and SDK platforms 35 and 36 + build-tools 36.0.0 were downloaded during it. |
| 2 | Polly | 52 s | After `prebuild --clean`. |
| 3 | Premom | **51 s (clean build)** | `android/` and every `build`/`.cxx` folder under `node_modules` and `modules` deleted, Gradle daemon stopped, `--no-build-cache`, 372 of 372 tasks executed. Download cache warm. Includes the config fix. |
| 4 | Polly | 31 s | After `prebuild --clean`, with the config fix. |

`expo prebuild` ran four times (under 1 s each when timed).

## Failures and fixes

1. **`sdkmanager "platforms;android-37"` not found.** React Native 0.88 wants compileSdk 37; the package is named `platforms;android-37.0`. Environment only, no app change.
2. **Polly crashed at start with a ZodError** (`catalog[1].numeric.requiresEntitlement: expected string, received undefined`). `app.config.ts` passed the pack object in `extra.pack`; Expo's config output turns Polly's `"numeric": null` into `{}` (seen in `expo config --json` and in the APK's `assets/app.config`). Premom has no null, so it started fine. Fix: pass the pack as a JSON string (`extra.packJson`) and parse it in `App.tsx`. After the fix both apps start and show pack-driven tabs (Polly has no Upgrade tab). No test in the repo caught this.
3. **App could not reach Metro** ("Unable to load script", it tries `localhost:8081`). Fixed with `adb reverse tcp:8081 tcp:8081`. Environment only. A debug APK has no embedded JS bundle; it needs Metro.
4. **Not fixed: a push whose answer is dropped is silently re-sent on Android.** Scenarios S09, S10, S24, S25, S26, S27 expect the sync to report failure when the server applies a push and drops the connection. On the emulator that sync reports success. Cause, measured: for the first four steps of S09 the kit server counted 1 push request from the Node runner and 2 from the device, with the same app code, so the Android HTTP stack re-sent the POST itself (OkHttp's retry on connection failure is the likely mechanism; I did not confirm which setting). The data ends up correct: no duplicate, no conflict, all server-side checks pass, because the retry carries the same mutation id. Only the reported step result and the intermediate "pending" state differ. Changing it needs native OkHttp configuration (for example a config plugin that disables retry), which I did not attempt. Plain "server down" (S08, S18) is reported as unreachable correctly.
5. **Lint**: the `require()` added to `index.ts` tripped ESLint's zero-warning rule; one disable comment added. (Added after the last emulator run; comment only.)

Seen on the emulator, not fixed (outside the milestones):

- The app draws under the system bars. The title overlaps the status bar and the tab bar sits under the navigation bar. With 3-button navigation, a tap on the "Add log" tab pressed the system Back button (twice). I switched the emulator to gesture navigation to continue.
- On "Add log", with the keyboard open, the first tap on Save only closes the keyboard; a second tap saves.
- The default server URL baked into the APK is `http://127.0.0.1:8787`, which on a device is the device itself. For the screen test I used `adb reverse tcp:8787 tcp:8787`. The on-device scenario test used `http://10.0.2.2:8787`.
- React Native warns that `SafeAreaView` is deprecated.

## The on-device test

- `device-test/main.tsx` runs in the app instead of the screens when Metro is started with `EXPO_PUBLIC_DEVICE_TEST=1`. It runs the native engine on every fixture, then replays the scenarios through `AppCore` with the real `expo-sqlite` adapter, the real `FetchHttp` over the device's `fetch`, real `expo-crypto` ids and the native engine. Camera, thermometer, store and clock are the same fakes the headless runner uses.
- `device-test/host.ts` runs on the Mac: serves fixtures and scenarios, resets the kit server per scenario, and compares (engine vs `strip_cli`; scenarios with the same checks as `kit/judge/judge.ts`, whose `diff` is copied because the judge cannot be imported).
- Results: `device-test/results/full-run.json`, `device-test/results/s09-first-four-steps.json`.

```sh
node ../kit/server/server.ts 8787 &
node device-test/host.ts 8787 /tmp/result.json &            # optional: engine-only | S09 S10 ...
APP_PACK=premom EXPO_PUBLIC_DEVICE_TEST=1 npx expo start --port 8081 --clear &
adb reverse tcp:8081 tcp:8081
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.example.family.premom/.MainActivity
```

The scenario replay ran in the Premom APK for both packs' scenarios (the pack JSON comes from the host per scenario). The Polly APK was only started and looked at.

## Changes to the app

Existing files: 5 files, 12 lines added, 5 removed.

| File | Lines | Why |
|---|---|---|
| `app.config.ts` | +2 -1 | Pack passed as `extra.packJson` (failure 2). |
| `App.tsx` | +1 -1 | Parse `extra.packJson` (failure 2). |
| `index.ts` | +7 -1 | Switch to the device test when `EXPO_PUBLIC_DEVICE_TEST=1`. |
| `tsconfig.json` | +1 -1 | Type-check `device-test/main.tsx`. |
| `README.md` | +1 -1 | `extra.pack` -> `extra.packJson`. |

New files: `device-test/main.tsx` (148 lines), `device-test/host.ts` (125 lines), two result JSON files, this report.
Nothing under `src/`, `modules/`, `tests/` or `bakeoff/kit/` was changed. After the changes `./test.sh` passes (164 tests) and `./check.sh` passes.
`android/` (generated, git-ignored) is left in place and currently holds the Polly project.
`HARD-PARTS.md` and the README still say nothing has run on a device; they were not rewritten.

## Installed

Under `/opt/homebrew/share/android-commandlinetools` (now 9.1 GB): `platforms;android-37.0`, `build-tools;37.0.0`,
`ndk;27.1.12297006`, `cmake;3.22.1`, `emulator`, `system-images;android-35;default;arm64-v8a` (by me);
`platforms;android-35`, `platforms;android-36`, `build-tools;36.0.0` (downloaded by Gradle during build 1).
`ndk;28.2.13676358` is also present there; I did not install it and the SDK folder is shared, so the 9.1 GB is not all from this work.
Gradle 9.4.1 and dependencies in `~/.gradle`. AVD `bakeoff35` in `~/.android/avd`. No npm packages were added.

## Not proven

- Release builds, signing, R8/minify, an embedded JS bundle (only debug APKs loading JS from Metro were run).
- ABIs other than arm64-v8a; any physical phone; any Android version other than 15.
- The real camera path (capture, resize, PNG to gray), real Bluetooth, real Play purchases. The scenario test fakes all three, as the headless runner does. The Scan, Thermometer and Upgrade screens were not exercised.
- The screens beyond: start, tab switch, one manual BBT log, Sync, relaunch.
- Polly on the emulator beyond starting and showing its Today screen.
- Which OkHttp setting causes the re-send in failure 4, and whether a fix is practical.
- iOS: nothing (no Xcode).

## Housekeeping notes

- A second emulator (`fa35`, not mine) was running on this Mac during the work. I addressed mine by serial (`emulator-5554`) and stopped only mine. Before build 3 I ran `pkill -f GradleDaemon` to force a cold daemon; that would also have stopped any other Gradle daemon running on the machine at that moment. `fa35` was no longer running when I finished; I did not stop it and do not know why it ended.
