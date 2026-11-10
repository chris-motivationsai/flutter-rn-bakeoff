# On-device scenario replay: Flutter slice, Android

Run on 2026-11-10. Emulator `fa35` (Android 15, API 35, arm64-v8a, headless), debug build, app id `com.bakeoff.premom`.

## Result

**27 of 27 public scenarios passed on the device.** No failures, so no causes to report. One run; nothing was retried and nothing under `lib/` was changed.

## How it ran

Test file: `integration_test/scenarios_device_test.dart` (new; the only file added besides this report).

```
flutter test integration_test/scenarios_device_test.dart -d emulator-5560 \
  --dart-define=PACK=premom \
  --dart-define=SCENARIO_URL=http://10.0.2.2:18941 \
  --dart-define=API_URL=http://10.0.2.2:18942
```

- `API_URL`: `kit/bin/start-server.sh 18942` on the Mac.
- `SCENARIO_URL`: `python3 -m http.server 18941` over `kit/scenarios` (read only). The test fetches each `Sxx.json` and the strip and thermometer fixtures its steps name, and writes the fixtures to the app's support directory at the same relative paths.

Inside the app process on the emulator, per scenario:

1. `POST /__control {"reset":{"user":<scenario.user>}}`.
2. The app's existing `ScenarioRunner.run(steps)` from `lib/core/scenario.dart` (the class behind `run-scenario.sh`), unchanged. It was given the pack from the app's bundled `assets/packs/`, the steps, and nothing from `expect`.
3. Step results and snapshots compared with `expect`, then `GET /__control/state` compared the way `kit/judge/judge.ts` does: live observations, deletions, analytics event count, no violations, no oversize pushes, no rejected mutations. The comparison is a line-for-line port of the judge's `diff`.

What was real and what was fake:

| Part | On the device |
|---|---|
| Storage | Real. SQLite file `/data/user/0/com.bakeoff.premom/files/scenarios/<id>/slice.db`, under the directory `path_provider` returns, opened by the app's `LocalStore.open`. `restart` steps close and reopen that file. |
| HTTP | Real. `package:http` over `dart:io` sockets on Android, cleartext to `10.0.2.2`. |
| Strip engine | Real. `libstrip_engine.so` (C++) through FFI. |
| Clock | The runner's `ManualClock`, set from each step's `at` (as in the headless runner). |
| Bluetooth | Fake: `ScriptedThermometer` from the fixture script. |
| Store | Fake: `FakeStore`. |

One difference from the app's own launch path: the database file sits in a per-scenario folder under the support directory rather than at `slice-<pack>.db`, because the runner takes a work directory. Same directory root, same storage code.

Both packs ran in the one installed app (`com.bakeoff.premom`); the pack for each scenario came from the scenario file. The Polly-id build was not used for this run.

## Per scenario

`Checks` counts the same things the judge counts. `Run ms` is the time for the runner on the device. `Push requests` is the server's `pushRequests` at the end of the scenario.

| Scenario | Pack | Steps | Checks | Run ms | Push requests | Result |
|---|---|---|---|---|---|---|
| S01 | premom | 6 | 14/14 | 613 | 1 | PASS |
| S02 | polly | 8 | 15/15 | 562 | 1 | PASS |
| S03 | premom | 5 | 12/12 | 471 | 1 | PASS |
| S04 | polly | 6 | 13/13 | 576 | 1 | PASS |
| S05 | premom | 7 | 15/15 | 558 | 1 | PASS |
| S06 | polly | 6 | 13/13 | 580 | 1 | PASS |
| S07 | premom | 9 | 17/17 | 553 | 1 | PASS |
| S08 | premom | 12 | 21/21 | 560 | 1 | PASS |
| S09 | polly | 7 | 15/15 | 1077 | 2 | PASS |
| S10 | premom | 50 | 58/58 | 1242 | 4 | PASS |
| S11 | premom | 16 | 24/24 | 587 | 2 | PASS |
| S12 | premom | 10 | 18/18 | 573 | 1 | PASS |
| S13 | premom | 10 | 19/19 | 574 | 2 | PASS |
| S14 | premom | 10 | 18/18 | 579 | 2 | PASS |
| S15 | polly | 13 | 21/21 | 572 | 1 | PASS |
| S16 | premom | 8 | 17/17 | 574 | 1 | PASS |
| S17 | premom | 9 | 19/19 | 535 | 0 | PASS |
| S18 | premom | 10 | 19/19 | 573 | 1 | PASS |
| S19 | premom | 10 | 19/19 | 1099 | 1 | PASS |
| S20 | premom | 10 | 20/20 | 565 | 0 | PASS |
| S21 | polly | 3 | 10/10 | 534 | 0 | PASS |
| S22 | premom | 10 | 19/19 | 1099 | 1 | PASS |
| S23 | premom | 11 | 18/18 | 1093 | 1 | PASS |
| S24 | premom | 99 | 109/109 | 8817 | 23 | PASS |
| S25 | polly | 107 | 118/118 | 4509 | 34 | PASS |
| S26 | premom | 113 | 124/124 | 6303 | 30 | PASS |
| S27 | polly | 94 | 105/105 | 1376 | 27 | PASS |

Total for the test run, including the build and install: 3 min 24 s.

## Apply-then-drop (S09, S10, S24 to S27)

All six passed, so in each the sync that the server applied and then dropped reported `{"ok": false, "error": "network"}`, the pending changes stayed pending, and the next sync cleared them with no duplicate observation, no conflict and no rejection on the server.

To count push requests for a single sync, the test replays these six scenarios a second time, step by step through the same `ScenarioRunner.runStep`, and reads `pushRequests` from `/__control/state` just before and just after each sync.

**For every sync that followed `applyThenDrop: 1`, the server counted exactly 1 push request.** The device's HTTP stack did not resend the request when the connection was dropped.

| Scenario | Step | Pending before | Sync result | Push requests counted for this sync | Pending after |
|---|---|---|---|---|---|
| S09 | 3 | 2 | `network` | 1 (counter 0 to 1) | 2 |
| S10 | 46 | 45 | `network` | 1 (counter 0 to 1) | 45 |
| S24 | 56 | 2 | `network` | 1 (counter 9 to 10) | 2 |
| S25 | 47 | 2 | `network` | 1 (counter 11 to 12) | 2 |
| S26 | 54 | 2 | `network` | 1 (counter 10 to 11) | 2 |
| S27 | 50 | 2 | `network` | 1 (counter 11 to 12) | 2 |

In S10 the queue held 45 changes, which is three batches at 20 per push. The first batch was dropped, the app stopped there and sent no second batch in that sync. S10's end-of-scenario total of 4 is that 1 plus 3 for the later successful sync. S09's total of 2 is 1 dropped plus 1 retry by the next sync.

The second pass also printed the other syncs that returned `network` in S24 to S27 (13 of them). Those are the scenarios' server-down steps, not apply-then-drop: the counter did not move (0 push requests counted), because the kit server drops the connection before it counts a request when it is in `down` mode.

## Not covered

- Same limits as `ANDROID-REPORT.md`: emulator only, debug build, cleartext HTTP to the host, arm64 only.
- "Restart" is the runner's own: dispose the core and reopen the database in one process. The OS did not kill the app.
- The push-count pass is a second replay, not the judged run. The judged run's end-of-scenario totals (table above) agree with it for S09 and S10; for S24 to S27 I compared only the per-sync deltas.
- I did not run the headless judge on the host in this session, so there is no side-by-side host figure for `pushRequests` here.

## Cleanup

The emulator (`emulator-5560`), the kit server (port 18942) and the fixture server (port 18941) that I started are shut down. `flutter test` uninstalled the app when it finished. The AVD `fa35` is still defined. Full log of the run: `/private/tmp/claude-501/-Users-chrislema-projects-premom-product-family-platform/d44438a5-f41a-4296-875e-09d54b641ae3/scratchpad/ods/run1.log` (temporary).
