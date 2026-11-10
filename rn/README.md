# Bakeoff slice — React Native (Expo SDK 58, TypeScript)

One codebase that builds **Polly** and **Premom** from the stage packs in `../kit/packs`. Observations are logged
manually, from a strip photo (C++ engine) or from a Bluetooth thermometer, stored offline in SQLite, synced with
the test server, and a store purchase unlocks the numeric LH result.

Nothing here has run on a phone or simulator (this Mac has no Xcode or Android SDK). See `HARD-PARTS.md` for
exactly what is and is not verified.

## Run things

```sh
npm install                                   # once
./test.sh                                     # all automated tests (164: 137 hand-written + 27 public scenario replays)
SKIP_PUBLIC_SCENARIOS=1 ./test.sh             # only the 137 hand-written tests
./check.sh                                    # tsc, eslint, C++ warnings, autolinking, app config, Metro bundles
../kit/bin/judge.sh "$PWD"                    # the kit's public judge (27 scenarios)
./run-scenario.sh <scenario.json> <serverUrl> <out.json> <workDir>   # runner contract, SPEC section 8

APP_PACK=polly  npx expo start                # dev server for Polly (needs a development build on a device)
APP_PACK=premom npx expo run:ios              # native build for Premom (needs Xcode; never run here)
```

`APP_PACK` chooses the pack. `app.config.ts` reads `../kit/packs/<APP_PACK>.json` and takes the app name, slug,
bundle id and permission texts from it, and passes the whole pack to the app as the JSON string `extra.packJson`. `APP_SERVER_URL`
and `APP_API_TOKEN` set the server.

## Layout

| Path | What |
|---|---|
| `src/core/` | The app core. No React, no device APIs. `app.ts` (`AppCore`) is the single entry point used by the screens and by the scenario runner. |
| `src/core/ports.ts` | The interfaces the core needs from the device: SQLite, clock, ids, camera, strip engine, thermometer, store, HTTP. |
| `src/adapters/real/` | Device adapters: `expo-sqlite`, `react-native-ble-plx`, `react-native-iap`, `expo-camera` + `expo-image-manipulator`, the native strip engine module. Type-checked against the installed libraries. |
| `src/adapters/fake/` | Fakes used by tests and the runner: scripted thermometer, scripted store, loaded camera, fixed clock, Node SQLite, Node binding for the C++ engine. |
| `src/adapters/fetchHttp.ts`, `pngToGray.ts` | Adapter code that is identical on a phone and in tests. |
| `src/ui/` | Screens: Today, Add log, Scan strip, Thermometer, Upgrade. `AppRoot.tsx` is the shell. |
| `src/runner/main.ts` | Scenario runner behind `run-scenario.sh`. |
| `modules/strip-engine/` | Local Expo module wrapping the kit's C++ engine: shared C++ bridge (`cpp/`), iOS (Swift + podspec), Android (Kotlin + JNI + CMake), and the Node binding used headless (`node/`). |
| `App.tsx`, `app.config.ts` | Composition root for a phone build; per-pack app configuration. |
| `tests/` | `core/` (Node), `ui/` and `device/` (jest-expo), `runner/` (public scenario replay), `helpers/`. |

Where a rule lives:

| Rule (SPEC section) | File |
|---|---|
| Manual checks, value rounding, display/lock (3) | `src/core/observations.ts`, `src/core/pack.ts` |
| Strip status mapping, thermometer range, edit/delete (3) | `src/core/app.ts` |
| Thermometer frame decoding (3) | `src/core/thermometer.ts` |
| Pending mutations, storage tables (4) | `src/core/storage.ts`, `AppCore.delete/edit/create` |
| Push, pull, conflicts (4) | `src/core/sync.ts` |
| Purchases, entitlements (5) | `src/core/purchases.ts` |
| Analytics gate (6) | `AppCore.create` in `src/core/app.ts` |
| Snapshot (8) | `AppCore.snapshot` |

## Staying in step with `kit/contracts` and `kit/packs`

**Imported, not copied (zero drift):**

- `kit/contracts/schemas.ts` is imported directly by `src/core/contracts.ts` (the only file that touches it).
  All wire types (`ObservationBody`, `Observation`, `Mutation`, `MutationResult`, `Entitlement`, `AnalyticsEvent`,
  `Source`) are inferred from the kit's Zod schemas with `z.infer`. Server answers are parsed with the kit's
  `PushResponse`, `PullResponse`, `VerifyResponse`, `VerifyError`. `MAX_MUTATIONS_PER_PUSH` is the kit's constant.
  Every observation is passed through the kit's `validateObservationBody` before it is stored.
- `kit/packs/*.json` are read as data: by `app.config.ts` at build time (phone) and by the runner and tests at
  run time. No type list, level name, product or app name is written in the source.
- Metro (`metro.config.js`), TypeScript (`tsconfig.json` `paths`) and Jest (`moduleNameMapper`) all point `zod`
  at this project's copy so the kit file compiles in every toolchain. `./check.sh` bundles the app with Metro
  for iOS and Android to prove the import works there too.
- `kit/contracts/json-schema.json` is not used.

**Script-copied and verified:** `modules/strip-engine/cpp/engine/strip_engine.{cpp,h}` is a byte-identical copy
of `kit/engine` made by `scripts/sync-engine.sh` (CocoaPods, Gradle and EAS only see files inside the project).
`./check.sh` fails if the copy differs. The Node binding compiles `kit/engine/strip_engine.cpp` itself.

**Hand-written in the client (the drift surface):**

1. The *shape* of a pack (`PackSchema` in `src/core/pack.ts`). The kit ships no schema for packs.
2. Rounding precision: bbt 2 decimals, lh 3 (`BBT_DECIMALS`, `LH_DECIMALS` in `src/core/observations.ts`). In the
   kit this exists only as code inside `validateObservationBody`, which still runs as a guard.
3. The value key per catalog kind (`valueField` in `src/core/pack.ts`: number → the pack's `field`, enum → `code`, strip → `ratio`).
4. Engine status codes 1/2/3 → error names (`STRIP_ERRORS` in `src/core/app.ts`), from `strip_engine.h`.
5. The list of error codes (`ErrorCode` in `src/core/types.ts`) and the snapshot shape (`Snapshot`), from SPEC.md prose.
6. Endpoint paths and the bearer header (`src/core/api.ts`, `src/adapters/fetchHttp.ts`), from SPEC.md prose.
7. Bluetooth ids and frame layout (`src/core/thermometer.ts`), from SPEC.md prose.

In a real monorepo `kit/contracts` and `kit/packs` would be workspace packages; here they are reached by relative
path (`../kit`), which an EAS cloud build would not upload. That packaging step is not done.

## The public scenario replay in the tests

`tests/runner/public-scenarios.test.ts` replays the kit's 27 public scenarios through `runScenario` and compares
with the kit's expected results. It is a regression net, not the main suite; the 137 other tests assert the
rules directly with their own data. Set `SKIP_PUBLIC_SCENARIOS=1` to measure the suite without it.
