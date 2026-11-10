# Kit issues and ambiguities

Nothing in the kit contradicted the spec in a way that forced a choice between them: all 27 public scenarios
pass without special cases. These are gaps where SPEC.md does not say what to do; each lists what I chose.

1. **"Before it was ever sent" (section 4) is ambiguous.** A create can be put on the wire and never answered
   (`applyThenDrop`, or a dropped connection). If the user then deletes it, "sends nothing" would leave an orphan
   on the server when the push had in fact been applied, and a delete with `baseRevision: 0` gets either
   `rejected: unknown_id` or a conflict that resurrects the observation. Choice: a push answered with an error
   status counts as never sent (create+delete sends nothing); a push with no answer keeps retrying the same
   create and sends the delete after the create is confirmed (`AppCore.delete`, `sync.ts`). No public scenario
   covers this.
2. **A new edit after an unanswered create** gets a new `mutationId` and `baseRevision: 0`, as the spec says
   ("a new local change replaces it"). If the server had applied the first push, the result is a conflict and
   the edit is lost to the server's older copy. This is what the spec literally asks for; it is a data-loss edge.
3. **`rejected` push results** are defined in the contract but not in the spec. Choice: drop the mutation.
4. **Saving entitlements**: "save the returned entitlements" does not say whether a later answer with an earlier
   `expiresAt` (e.g. restoring an old receipt after a newer one) replaces the stored one. Choice: replace by name.
5. **Rounding vs range order for manual numbers**: 42.004 rounds to 42.00. Choice: round first, then check the
   range (same order the spec gives for the thermometer).
6. **Thermometer details not specified**: several 2A1C frames in one session (choice: the first one decides);
   a timestamp that is not a real date, e.g. year 0 (choice: treat as absent and use the step time); the other
   IEEE-11073 special values (NRes, ±INFINITY) (choice: only NaN is special, as written).
7. **Engine status 4 (`STRIP_BAD_INPUT`)** has no error code in the spec. Choice: `strip_bad_input`.
8. **`not_available`**: the spec does not say it sets `lastPurchaseError`; the public scenario S21 expects it to.
   Followed the scenario, since the spec does not say otherwise.
9. **No contract for packs.** `kit/contracts` has schemas for everything on the wire but not for
   `kit/packs/*.json`, so each client must hand-write the pack shape. That is drift surface the kit creates.
10. **`engine/strip_engine.h` trusts the buffer length.** `strip_read` takes no length; a caller passing a short
    buffer reads out of bounds. The bridge in this project checks `length == width * height` first.
