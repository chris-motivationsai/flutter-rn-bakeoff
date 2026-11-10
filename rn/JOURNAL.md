# Journal

Short, in order. Times are rough.

1. **Read the kit** (SPEC, contracts, packs, engine, server, judge, scenario steps, BLE fixtures). Decided up
   front: import the kit's Zod file directly; synchronous SQL driver port so the same SQL runs on expo-sqlite and
   `node:sqlite`; one shared C++ bridge under three thin bindings (Swift, JNI, N-API).
2. **Scaffold.** `create-expo-app` gave Expo SDK 58 / React Native 0.88 / React 19.3 / TypeScript 6 / Jest 30,
   all newer than anything I know from memory. I read the installed `.d.ts` files and module sources instead of
   trusting recall. The template also dropped `AGENTS.md`, `.claude/settings.json`, a `LICENSE` and a `.git`
   folder into `rn/`; I removed them (the AGENTS.md told agents to use Expo Router, which this app does not).
3. **C++ bridge + Node addon.** Built with plain `clang++` against Homebrew Node's headers (no node-gyp). Worked
   first time; matches the kit CLI.
4. **Core + runner.** First judge run: 27/27. No iteration was needed against the judge.
5. **Type-checking the real adapters** against react-native-ble-plx 3.5, react-native-iap 17, expo-sqlite,
   expo-camera, expo-image-manipulator: one error (`requestCameraPermissionsAsync` is on the `Camera` object now).
   react-native-iap 17 is a Nitro module with a GraphQL-style API (`MutationField<'requestPurchase'>`), very
   different from the versions I remember; found the shapes by grepping its typings.
6. **Expo Modules API changed.** SDK 58's own modules (expo-crypto) use a new `@ExpoModule` / `@JS` macro style
   I had never seen; expo-camera still uses the `ModuleDefinition` DSL. I wrote the strip module in the DSL I
   know, copying import paths from the installed sources. Neither file can be compiled here, so this is the
   least certain code in the project.
7. **Jest obstacles** (cost the most time of anything):
   - Under the `jest-expo` preset, global `fetch` is Expo's native fetch backed by a stub, even with
     `@jest-environment node`. Requests "succeeded" with `status: undefined`. Fix: two Jest projects, a plain
     Node one for the core and a jest-expo one for screens; UI tests use a `node:http` transport.
   - `fast-png` is ESM-only; needed `transformIgnorePatterns` in the Node project.
   - `jest.mock` factories may only touch variables named `mock*`.
   - `@testing-library/react-native` 14 made `render` and `fireEvent` async and needs the `test-renderer` peer.
   - React `act()` warnings from state updates that land after real I/O; silenced in `tests/helpers/quietAct.ts`.
8. **A real adapter bug found by a mocked-library test**: `waitForPoweredOn` used the subscription inside the
   callback before `onStateChange` had returned it. Fixed. It is a reminder that the unmocked parts are untested.
9. **Checked my own tests by seeding 38 bugs** into the core (script kept outside the repo), with the public
   scenario replay switched off. 36 caught at first. One survivor was an equivalent mutant; the other (not
   remembering the revision from a push answer) was hidden by the pull that follows, so I added a test where
   the pull fails. This is my own list, not the bakeoff's hidden one.
10. **Edge case added late**: delete after an unanswered create (KIT-ISSUES 1). Not required by any public scenario.
11. **Headless native checks that did work**: `expo-modules-autolinking resolve` finds the local module on both
    platforms; `expo export` bundles the app for iOS and Android to Hermes bytecode with the kit imports;
    `expo prebuild --no-install` generated both native projects with pack-driven names and permissions (then
    deleted); the JNI glue runs on a host JVM because a Homebrew openjdk 17 happened to be installed.
12. **Could not verify**: see HARD-PARTS.md. In short: no native compile, no device, no real BLE, store or camera.

Dead ends: none that cost more than a few minutes. I considered calling the engine from Node via the kit's
prebuilt dylib with an FFI package, or via WebAssembly; chose N-API because it shares the bridge file with the
phone bindings and needs no extra dependency.
