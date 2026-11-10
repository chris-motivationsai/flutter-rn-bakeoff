# Bakeoff slice: Flutter (Dart)

One Flutter package that builds both Polly and Premom from the stage pack JSON. Nothing here was run on a phone or simulator (this Mac has no Xcode and no Android SDK); see `HARD-PARTS.md` for exactly what was and was not exercised.

## Run things

| Command | What it does |
|---|---|
| `./run-scenario.sh <scenario.json> <serverUrl> <out.json> <workDir>` | Runner contract (SPEC section 8). Runs `bin/run_scenario.dart` with `dart run`. |
| `../kit/bin/judge.sh "$PWD" [S01 …]` | Public judge. |
| `./test.sh` | All automated tests (`flutter test`): 159 tests. Extra arguments are passed to `flutter test`. |
| `./check.sh` | Generated-code drift check, then `flutter analyze` over everything. |
| `dart run tool/gen_contracts.dart` | Regenerate the contract code and bundled packs after the kit changes. |

Needs `flutter`/`dart`, `clang++` (the build hook compiles the kit's C++ engine) and `node` (the scenario-replay test starts the kit server). The first `dart run`/`flutter test` after a clean checkout runs build hooks: ours compiles the engine; `package:sqlite3`'s fetches its prebuilt SQLite library, which needs network access once.

A device build would be `flutter build ipa|apk --dart-define=PACK=premom --dart-define=API_URL=https://…` (or `PACK=polly`). Not attempted here.

## Layout

```
lib/core/            pure Dart; no Flutter, no plugins
  app_core.dart        every rule in SPEC sections 3-6 (AppCore). Screens and runner both drive this.
  storage.dart         SQLite storage (package:sqlite3)
  api.dart             HTTP client; bodies checked against the generated schemas
  thermometer.dart     Health Thermometer frame parsing + "final reading only" session rule
  strip.dart           GrayImage, StripEngine interface, PGM decoding
  engine/              Dart FFI binding to the kit's C++ engine (@Native) + NativeStripEngine
  pack.dart            stage pack model, parsed from JSON at run time
  contracts.dart       generic JSON Schema checker + helpers
  generated/           contracts.g.dart: GENERATED from kit/contracts, never edited
  adapters.dart        the device seams: StripImageSource, ThermometerTransport, StoreAdapter, Clock
  scenario.dart        ScenarioRunner: plays scenario steps through AppCore with the fakes
lib/adapters/real/   plugin-backed adapters a phone uses (flutter_blue_plus, in_app_purchase,
                     image_picker + image, path_provider)
lib/adapters/fake/   scripted adapters used by the runner and the tests
lib/ui/              AppController (ChangeNotifier) and the five screens
lib/main.dart        device entry point: real adapters + AppCore + screens
hook/build.dart      build hook: compiles ../kit/engine/strip_engine.cpp for the target platform
bin/run_scenario.dart, run-scenario.sh
tool/gen_contracts.dart
test/                core/, ui/ (widget tests), adapters/, scenarios_test.dart, support/harness.dart
```

The runner and the screens share one core: `bin/run_scenario.dart` → `ScenarioRunner` → `AppCore`; `lib/main.dart` → `AppController` → the same `AppCore`. The runner reads a scenario's `pack` and `steps` and never touches `expect`.

## How the client stays in step with `kit/contracts` and `kit/packs`

**Generated (not hand-written):** `tool/gen_contracts.dart` reads the kit and writes two things. `./check.sh` fails if either is out of date, so drift cannot go unnoticed.

1. `lib/core/generated/contracts.g.dart`, from `kit/contracts/json-schema.json`: every wire schema as a Dart const (`kSchemas`), the per-type value schemas (`kValueSchemas`), `kSources`, `kIsoSecondsPattern`, `kAnalyticsEventName`. Three constants exist in the kit only as TypeScript code, not in the JSON Schema, so the generator lifts them out of `kit/contracts/schemas.ts` by regular expression and fails loudly if a pattern stops matching: `kMaxMutationsPerPush`, `kValueDecimals` (bbt 2, lh 3) and `kRequiredReaderField`.
2. `assets/packs/*.json`: byte-for-byte copies of `kit/packs/*.json`, bundled into the app.

**Validation:** `lib/core/contracts.dart` is a small generic JSON Schema checker (hand-written, but it contains no contract shape). `api.dart` uses it with the generated schemas to check every push request and analytics event before sending and every push, pull and verify response on arrival. Manual and edited values are checked against the pack entry (`min`/`max`/`values`) and then against the generated value schema for the type. Rounding uses `kValueDecimals`; the push chunk size is `kMaxMutationsPerPush`.

**Catalog:** read from the pack JSON at run time (`StagePack.parse`). The app loads `assets/packs/$PACK.json`; the scenario runner loads `../kit/packs/<pack>.json` directly and falls back to the bundled copy. No type list, level table, product or app name is written in Dart. The name of an enum or strip entry's value field (`code`, `ratio`) is not in the pack, so it is taken from the generated value schema for that type.

**Hand-written, and would need editing if the kit changed:**

- Field names where JSON is built or read: the mutation / observation body in `app_core.dart` (`_mutation`, `_fromServer`) and `model.dart` (`Obs.body`), response fields and the analytics event in `api.dart`, pack keys in `pack.dart`, the snapshot shape in `model.dart`. The schema checks above catch a mismatch at run time, not at compile time.
- The error code strings in `model.dart` (`Err`) and the source names (`Src`), from SPEC prose.
- Reader keys `engineVersion` / `deviceModel` in `app_core.dart`.
- The Bluetooth frame format in `thermometer.dart` and the engine's C struct layout and status codes in `engine/strip_engine_ffi.dart` / `app_core.dart` (from `strip_engine.h`; not generated with ffigen).
- The SQL schema in `storage.dart`.

## Behaviour where the SPEC is silent

Listed in `KIT-ISSUES.md` with the choice made for each.

## Tests

- `test/core/` (102): thermometer frames and sessions, C++ engine over FFI (compared with the kit's `strip_cli` on public fixtures, plus synthetic strips at the level thresholds), manual logging rules, analytics gate, edit/delete, sync (chunking, order, retry ids, applied-then-dropped, conflicts, pull, pull failure after push), durability across restart, purchases and entitlements. They run `AppCore` on real SQLite files and the real engine, against an in-process fake server (`test/support/harness.dart`) that records every request.
- `test/ui/` (25): widget tests of the five screens for both packs, on the same real core.
- `test/adapters/` (4): the camera adapter's decode-to-gray step, and the fakes.
- `test/scenarios_test.dart` (28): replays the 27 public scenarios through `ScenarioRunner` against the kit's real server and checks what the judge checks. This is the one place `expect` is read. It overlaps with the judge by design; when measuring the suite's own strength, run `./test.sh test/core test/ui test/adapters` to leave it out.
