# CI / test infrastructure audit

- Audit date: 2026-08-31
- Scope: the recorded hazards that repeatedly cost development time without indicating a product fault

## Classification

Not every red gate is a code bug, and treating them alike is how a fixture defect gets debugged as a payments failure. Each known hazard, classified:

| Hazard | Class | State |
|---|---|---|
| Cross-clock fixture writes | **B** — test fixture defect | Two suites converted; the rest ratcheted |
| Connection ceiling formula | **C** — CI infrastructure defect | Fixed |
| Expo override drift | **C** — CI infrastructure defect | Guarded |
| Push registration 500 | **C** — CI infrastructure defect | Reclassified same day: the diagnostics named a mid-run Redis restart, not the SQL. See the addendum |
| Dangling Docker volumes | **D** — local environment hazard | Cause identified, not remediable within the safety rules |
| Long integration stalls | **A** — production defect | Fixed previously at `ea53fa1` |

## Fixed

### One clock per lifecycle, and a ratchet to keep it that way

Nine tables carry a CHECK constraint ordering two of their own timestamps. When a fixture creates such a row from PostgreSQL's `now()` and the production path under test then writes the later column from the application clock, the row is timed by two clocks that are not the same clock. Under Docker on macOS they drift by a few milliseconds, and a few milliseconds is all it takes.

This has now happened twice, and both times it presented as a product failure on a commit that had not touched the product — once in billing (fixed at `a572ea1`) and once in `realtime_sessions`, where an 8.8 ms gap refused the write and turned the RTC suite and the operator console red together.

`rtc-provider` — the suite where it was observed — and `rtc-authorization` are converted: one `const stamp = now()` from the clock each suite already declares, bound wherever `now()` appeared. Relative instants are computed in TypeScript, because `${stamp} + interval '1 minute'` looks right and is not: an untyped parameter beside an interval resolves to `interval + interval`, and PostgreSQL refuses that against a `timestamptz` column.

Thirty-eight such writes remain. Converting them all at once is a large mechanical change to suites that currently pass — the kind that trades a rare flake for a fresh one — so `scripts/check-fixture-clocks.mjs` records the count and fails when it rises. **It is a ratchet, not an allowlist**: nothing new can join the class, every conversion lowers the number the next person has to beat, and there is no path that raises it. Verified in both directions.

### The connection ceiling counts what the suites ask for

`run-integration-tests.mjs` sized PostgreSQL's `max_connections` as *suite count × 20 + 40*. Seven suites raise their pool to 60, so the figure described a repository that does not exist: 1700 against a real demand of 1980. It was never binding, because the suites do not all peak at once — and a ceiling that is wrong in the safe direction is still a ceiling nobody can reason about, which is exactly the state it was in when the earnings stall was being diagnosed against it.

It now reads each suite for the pool size it declares and sums them.

### An override cannot outlive its catalog entry

`expo-constants` is pinned in `overrides` for a structural reason — a native module may exist once in a build, and the resolver otherwise keeps two copies. The comment beside it says to raise both together, and nothing enforced that. Raising the catalog alone would leave the override pinning the version the catalog just moved off: worse than no override, because `expo-doctor` stays green while the whole tree is held on a stale module and the release-age and security policies are applied to a version nobody installs.

`scripts/check-override-drift.mjs` requires every override the catalog also names to state the same version. An override for a package the catalog does not carry is left alone; that is a different decision with different reasons.

## Investigated, not fixed

### The push registration 500

The recorded intermittent is `POST /v1/notifications/devices` answering 500 under fifty concurrent registrations. The instruction for this phase is to capture the SQLSTATE and fix only once the root cause is proven. **It is not proven, and it is not fixed.**

What was established:

- `notification_push_devices` carries two partial unique indexes — one on the token fingerprint, one on `(recipient, installation)`, both `where disabled_at is null` — and `upsertPushDevice` arbitrates on the token index alone. A conflict raised by the installation index has no `do update` to land on.
- That path is **real and reachable**, and it raises SQLSTATE **`23505`**. A new test calls the repository directly, without the retirement that normally precedes it, and asserts the code rather than merely that it throws — a unique violation and a check violation both throw, and only one of them is this.
- Through the service it cannot happen, and **not because the statement is safe**: `register` retires this installation's other tokens immediately before the upsert, so there is never a second live row to collide with. The safety is in the ordering of three statements, and nothing said so or tested it. It does now.
- The observed 500 was **not** reproduced. `register` takes two advisory transaction locks — one on the token, one on `(recipient, installation)` — in sorted order before it reads anything, which fully serialises the fifty-way case the failing test drives. Under that serialisation the installation index cannot fire, so the proven path above is not an explanation for the observed failure.

### Addendum, same day: the diagnostics named something else

Hosted run `33339223502` failed on this exact test, and the runner's own container diagnostics printed the reason:

```
redis: started=22:44:11.884  finished=22:44:11.706
published 6379/tcp: now=32771  handed-to-tests=32769
NOTE: the published host port changed after the tests started.
```

**Redis restarted mid-run and Docker re-allocated its published port.** Every suite still holding the URL captured at startup was addressing a port nothing was listening on, and this test failed seven minutes later. That is hazard 7 on this phase's own list — the Redis restart seen in hosted tests — and it accounts for every property the 500 has that the arbitration hypothesis does not: load-dependent, absent from an isolated run, latent rather than introduced by whatever commit happened to be red.

The classification therefore moves from **A, production defect with unproven cause** to **C, CI infrastructure defect**, with the arbitration finding above standing on its own as a real but separate hazard that this test cannot reach.

Two things follow, and neither is done here. The runner should re-read each container's published port rather than trusting the URL it captured at startup, and it should fail loudly when one moves rather than letting a suite time out against a dead socket. Both belong to the runner and to their own commit; recording the evidence while it is in hand is what this addendum is for.

### Dangling Docker volumes

Fifty-seven anonymous volumes had accumulated, dated across several days. The integration runner is **not** the source: measured directly, a run adds none, because `stop()` already removes the volume it created. They correlate with runs that were **killed** — an interrupted gate never reaches its `finally`, and this session produced one such interruption at a timestamp matching one of the volumes.

Nothing is deleted here. They carry only `com.docker.volume.anonymous` and no project label, so there is no way to attribute them, and the only commands that would remove them are global ones this phase explicitly forbids — a `docker volume prune` takes whatever else the developer is running. Removing another project's data to tidy this one's is not a trade this repository gets to make.

## Cross-references

[Operational readiness audit](29-operational-readiness-audit.md),
[Financial correctness audit](28-financial-correctness-audit.md),
[ADR-0013](../decisions/ADR-0013-observability-testing.md), and
[DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
