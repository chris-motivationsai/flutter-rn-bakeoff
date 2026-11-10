# Kit issues and gaps

Nothing in the kit was modified. None of these blocked the build; each is a place where the SPEC is silent or the kit and SPEC differ, with what this build does.

## SPEC and public scenarios disagree or the SPEC is silent

1. **`not_available` and `lastPurchaseError`.** SPEC section 5 names the cases that set `lastPurchaseError` (`store_error`, a 422 code) and says a cancel does not. It does not say what an unknown product does. Scenario S21 expects `lastPurchaseError: "not_available"`. This build sets it, because that does not contradict the SPEC; the SPEC should say so.
2. **`rejected` push results.** The contract has the status and the judge fails any run that produces one, but SPEC section 4 gives no client rule. This build drops the change, removes the local row if the server never had it (or the change was a delete), and records it in the conflicts list.
3. **Change made after a push that was applied but never answered.** SPEC: a new local change replaces the pending mutation with a new `mutationId`; "creating and deleting an observation before it was ever sent sends nothing". If the create reached the server (apply-then-drop) and the user then edits before the retry, the replacement upsert carries `baseRevision` 0 and the server answers `conflict`, so the edit is lost to the server's older copy. If the user deletes instead, this build treats "never confirmed" as "never sent", sends nothing, and the next pull brings the observation back. Both follow the letter of the SPEC and both are poor outcomes for the user. No public scenario covers either.
4. **Several `2A1C` frames in one session, or frames after the first final.** Not specified; no fixture has it. This build lets the first `2A1C` decide and stops listening.
5. **Invalid device timestamp** (month 13 and so on). Not specified. This build returns `thermo_invalid_reading`.
6. **Engine status 4 (`STRIP_BAD_INPUT`)** and an unreadable image have no SPEC error code. This build returns `strip_bad_input`.
7. **Manual number: range check before or after rounding.** Not specified (for the thermometer the SPEC says round, then check). This build checks the typed value, then rounds.
8. **Two observations with the same `{type, observedAt}`.** Edit/delete targets would be ambiguous. This build allows duplicates and acts on the oldest.

## Contract registry

9. `contracts/json-schema.json` does not carry three rules that only exist as code in `schemas.ts`: `MAX_MUTATIONS_PER_PUSH`, the decimal-place rules in `validateObservationBody`, and "strip_reader needs `reader.engineVersion`". A non-TypeScript client cannot get them from the generated artifact. This build's generator extracts them from `schemas.ts` by regular expression, which is brittle.
10. There is no schema for the stage pack format or for the snapshot. Both are described only by example.
11. `Value_bbt` in the contract fixes 34–42 while the pack also carries `min`/`max`. If a pack widened the range the server would still reject the value. This build checks both.

## Server

12. `GET /v1/sync/pull` has no page size. Fine for the kit; noted because a client written to this contract has no paging to test.
