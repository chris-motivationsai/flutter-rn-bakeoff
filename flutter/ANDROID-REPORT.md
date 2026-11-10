# Android report: Flutter slice

Run on 2026-11-10, macOS arm64, Flutter 3.47.9 / Dart 3.13.7, Java 17, AGP 9.1.0, Gradle 9.3.1, NDK 28.2.13676358, compileSdk/targetSdk 36, minSdk 24. Emulator: Android 15 (API 35) `default` arm64-v8a image, headless.

## Milestone reached

All three, including both stretch parts.

1. **Premom debug APK builds and contains the engine.** Yes. But see failure 2: the APK from the untouched app contained an engine library that could not load on a device.
2. **Polly debug APK from the same code, different name and id.** Yes, after adding 13 lines of Gradle.
3. **On the emulator.** The C++ engine, called over FFI inside the installed app, gave the same status and the same ratio (exact double equality) as the host `strip_cli` on all 106 fixtures in `kit/scenarios/fixtures/strips/`. The storage and sync path passed against the kit test server at `10.0.2.2`. Both ran for both packs.

## What the APKs contain

Premom, final build (`aapt2 dump badging`): `package: name='com.bakeoff.premom'`, `application-label:'Premom'`, `native-code: 'arm64-v8a' 'armeabi-v7a' 'x86_64'`, 167 MB (debug, three ABIs).
Polly: `package: name='com.bakeoff.polly'`, `application-label:'Polly'`.

`.so` files in the Premom APK:

```
lib/arm64-v8a/libVkLayer_khronos_validation.so   15240080
lib/arm64-v8a/libdartjni.so                         97952
lib/arm64-v8a/libflutter.so                      38846424
lib/arm64-v8a/libsqlite3.so                       1749952
lib/arm64-v8a/libstrip_engine.so                   315648
lib/armeabi-v7a/libdartjni.so                       57600
lib/armeabi-v7a/libflutter.so                    33159780
lib/armeabi-v7a/libsqlite3.so                     1735120
lib/armeabi-v7a/libstrip_engine.so                 198088
lib/x86_64/libdartjni.so                            99968
lib/x86_64/libflutter.so                         40107168
lib/x86_64/libsqlite3.so                          1726728
lib/x86_64/libstrip_engine.so                      313728
```

arm64 `libstrip_engine.so`: ELF 64-bit aarch64, exports `strip_read` and `strip_engine_version`, needs only `libc.so` and `libdl.so`, LOAD segments aligned to 0x4000 (16 KB). The engine source in `kit/engine` was not touched; the build hook compiles it with the NDK.

## Failures, in order

| # | Where | What happened | Fix |
|---|---|---|---|
| 1 | Polly build (build attempt 2) | My own new Gradle code failed to compile: `Unresolved reference 'util'` on `java.util.Base64`, because `java` in a `build.gradle.kts` resolves to Gradle's `java` extension. | `import java.util.Base64` at the top of the file. |
| 2 | First on-device run | `Failed to load dynamic library 'libstrip_engine.so': dlopen failed: library "libc++_shared.so" not found`. `native_toolchain_c` links C++ against `libc++_shared.so` on Android by default, and nothing puts that library in the APK. The build succeeds and the APK looks right, so this shows up only at run time, on the first engine call. Milestone 1 as worded passed with this bug present. | One argument in `hook/build.dart`: `cppLinkStdLib: 'c++_static'` when the target is Android (the option the package documents for this). The engine library grew from 32 KB to 316 KB (arm64). |
| 3 | Second on-device run | Engine test timed out at the default 30 s after about 68 of 106 fixtures. Cause was my test, not the app: a new HTTP connection per fixture. The storage and sync test passed in this run. | Test only: one shared `http.Client` and a 5 minute timeout. The 106 fixtures then took 22 s (Premom run) and 54 s (Polly run, machine under load). |

The first build of the untouched app worked without any change: Gradle, the plugins (`flutter_blue_plus`, `in_app_purchase`, `image_picker`, `path_provider`), the `sqlite3` hook and the engine hook all built for Android first time.

One wart, not fixed: the application id now depends on `--dart-define=PACK`, and `flutter test` works out which package to uninstall afterwards from somewhere that can be stale. The first Premom test run ended with `adb uninstall failed ... uninstall com.bakeoff.polly` (the previous build had been Polly), and after the Polly test run the Premom app I had installed by hand was gone. The tests themselves were unaffected. Flutter's supported route for two ids is product flavors (`--flavor`), which would avoid this at the cost of a second flag that has to agree with `PACK`.

## Build attempts

- `flutter build apk --debug`: 5 runs, 1 failed (failure 1). In order: Premom (untouched app) ok, Polly failed, Polly ok, Premom after `flutter clean` ok, Polly final ok.
- `flutter test integration_test/...` (each builds and installs an APK): 4 runs. Premom failed (failure 2), Premom failed (failure 3), Premom passed, Polly passed.

## Changes to the app

| File | Lines | Why |
|---|---|---|
| `android/app/build.gradle.kts` | +13 −2 | Read `PACK` from the `dart-defines` Gradle property (default `premom`); application id `com.bakeoff.<pack>`; launcher label from `appName` in `assets/packs/<pack>.json`. |
| `android/app/src/main/AndroidManifest.xml` | +1 −1 | `android:label="${appLabel}"` instead of `"slice_app"`. |
| `hook/build.dart` | +4 | Static libc++ on Android (failure 2). |
| `pubspec.yaml` | +3 | `integration_test` dev dependency (test only). |
| `pubspec.lock` | +31 | Follows from the line above. |
| `integration_test/device_test.dart` | new, 124 | The on-device test. |

Nothing under `lib/` changed. Needed for the app itself: 3 files, 18 lines added, 3 removed. The rest is test. Flutter's tooling also regenerated `GeneratedPluginRegistrant.java` and some `ios/Flutter` generated files and created `android/.kotlin`. After the changes `./test.sh` still passes (159 tests) and `./check.sh` is clean.

## What ran on the emulator

Command (ports are whatever the two host servers use):

```
flutter test integration_test/device_test.dart -d emulator-5560 \
  --dart-define=PACK=premom \
  --dart-define=FIXTURE_URL=http://10.0.2.2:18931 \
  --dart-define=API_URL=http://10.0.2.2:18932
```

`FIXTURE_URL` was `python3 -m http.server` over a folder holding copies of the 106 fixture PGMs and `expected.txt`, one line per fixture produced by `kit/engine/build/strip_cli` on the Mac (93 status 0, 5 status 1, 5 status 2, 3 status 3). `API_URL` was `node kit/server/server.ts 18932`.

Output, Premom:

```
DEVICE abi=android_arm64 os=sdk_phone64_arm64-userdebug 15 AE3A.240806.019 ... engineVersion=bakeoff-1.0.0
ENGINE compared=106 fixtures, all identical to host
SYNC db=/data/user/0/com.bakeoff.premom/files/slice-premom.db serverObservations=3 pushRequests=1
All tests passed!
```

Polly gave the same lines with `com.bakeoff.polly` and `slice-polly.db`.

The storage and sync test uses the app's own code: `openDeviceStore` (`path_provider` + `sqlite3`), `AppCore`, `ApiClient` over real HTTP, `NativeStripEngine`, `SystemClock`; only billing is the fake. It logs a manual BBT and a strip scan, closes the database, reopens the file and checks both are still there and still pending, syncs and checks the server holds them with nothing rejected, has the server inject a remote change and pulls it, then deletes the database file and gets all three observations back by pull.

Beyond the test, I installed the plain debug APKs (entry point `lib/main.dart`, real adapters) and started them with `am start`. Each launched (cold start about 1.5 s), showed the Today screen with the right app name, and stayed up with no fatal exception in logcat. Tapping the Sync icon by `adb shell input tap` pulled the three observations from the kit server and listed them. Premom showed `LH: low (number locked)`, Polly `LH: negative`. Both apps were installed side by side on the one emulator.

## Installed

I ran no `sdkmanager` install. When I first looked at the SDK root, part-way through my first build, it already held platforms android-35/36/37.0, build-tools 36.0.0/37.0.0, NDK 27.1.12297006 and 28.2.13676358, CMake 3.22.1, the emulator, and the `system-images;android-35;default;arm64-v8a` image. Other bakeoff agents were using the same machine and SDK at the same time (a second emulator, `bakeoff35`, was already running), and Gradle auto-downloads missing SDK parts, so I cannot say which of those my first build fetched. I did:

- `flutter config --android-sdk /opt/homebrew/share/android-commandlinetools`
- Create the AVD `fa35` (`avdmanager create avd -n fa35 -k "system-images;android-35;default;arm64-v8a"`). It is still there; `avdmanager delete avd -n fa35` removes it.
- `flutter pub get` pulled the `integration_test` SDK package's dependencies.

## Build time

- First ever build of the untouched app: 3 min 21 s wall clock. Cold Gradle caches, and other agents' Gradle builds were running (load average about 28).
- After `flutter clean` (removes `build/` and `.dart_tool/`, so both hooks and all Dart and Gradle outputs rebuild; `~/.gradle` caches and the Gradle daemon stay warm): 19.7 s wall clock for `flutter build apk --debug --dart-define=PACK=premom`.
- Switching pack on a built tree: 16 to 19 s.

I did not measure a build with an empty `~/.gradle`, because other agents were using it.

## Not proven

- Release builds: AOT compile, R8, signing, app bundle, Play upload. Only debug APKs were built.
- A physical phone. Only the arm64 emulator on API 35 ran; the armeabi-v7a and x86_64 engine libraries were built and never loaded, and nothing ran on minSdk 24.
- Camera capture (`image_picker`), Bluetooth (`flutter_blue_plus`) and store billing (`in_app_purchase`): their Android code compiled and the app started with them linked in, but none was exercised. The on-device strip images came over HTTP as PGM, not from the camera.
- Sync over TLS or a real network. The test used cleartext HTTP to the Mac, which worked in a debug build.
- What happens if the OS kills the app mid-write. "Restart" in the test is closing and reopening the database in one process.
- Per-app icons, signing keys and store listings. The two apps differ only in id, name and bundled-pack behaviour.
- The emulator and both servers I started are shut down. The other agent's emulator (`emulator-5554`) was left alone.

Logs and screenshots from this run are in a local scratch folder (not kept) (temporary).
