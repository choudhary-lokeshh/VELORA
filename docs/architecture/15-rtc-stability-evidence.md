# RTC repeated-run stability evidence

## Purpose

A gate that passes once has said it can pass once. What a freeze needs is whether it passes *reliably*, and the failures that decide that — ordering, load, clocks — are exactly the ones a single green run hides. This records the repeated-run evidence taken before the RTC core was frozen, the method that produced it, and the environment hazards that had to be closed first.

`scripts/rtc-stability-proof.mjs` is the harness. It is checked in rather than described, so the evidence can be reproduced rather than believed.

## What was repeated, and what was not

Twenty iterations of **the integration suite and the browser suite**, in that order, each iteration a full run of both.

The deterministic stages are deliberately not repeated. Formatting, lint, dependency boundaries, strict typecheck, contract drift, AUTH policy assertions, the secret scan, and hygiene either pass or fail identically every time; repeating them twenty times would spend hours proving that a compiler is a function. Every one of them passed in the full `pnpm ci:verify` that gated the commit this evidence accompanies. **This is not twenty full gate runs, and is not described as one.**

What is repeated is where the flakiness actually lived during this build: the integration suite runs against real PostgreSQL and Redis with real concurrency and real clocks, and the browser suite runs three real browsers against three real servers on three real ports.

## Result

| | |
| --- | --- |
| Iterations | 20 |
| Passed | 20 |
| Failed | 0 |
| Killed | 0 |
| Integration duration | 269–320 s, mean 305 s |
| Browser duration | 30–39 s, mean 37 s |
| First iteration completed | 2026-08-21T20:15:07.475Z |
| Last iteration completed | 2026-08-21T22:04:23.916Z |

Per-iteration evidence is one JSON line each, carrying the outcome of every stage, its duration, how many disposable volumes were pruned before it, and when it finished. Nothing is averaged away in the record itself: a report that only kept a mean could not distinguish twenty passes from nineteen passes and a silence.

## The three hazards, and why each is checked per iteration

Each of these produced a failure during this build that looked like a product defect and was not. They are enforced by the harness rather than remembered by whoever runs it.

**A run must own its ports.** Playwright reuses a server already listening on 3000, 3001, or 3002 outside CI and does not check what is answering. During this build an unrelated project's development server was adopted silently, and every Consumer Web and Platform Admin assertion failed as "element(s) not found" — 54 failures that read as a broken product. The harness refuses to start an iteration while anything holds those ports, because a run against a server VELORA does not own is not evidence. Reuse itself is not disabled: it is what keeps a warm surface between local runs, and turning it off locally would make the local gate diverge from the hosted one, which runs with `CI` set and always starts its own.

A supervised development stack must be stopped at its supervisor. Killing the server alone lets the supervisor restart it onto the same port, and an orphaned supervisor keeps holding the port after its own parent is gone — both were observed.

**Disposable volumes accumulate.** Test containers leave volumes behind, and enough of them degrade container timings. Every iteration prunes dangling volumes and never touches `velora-local_` ones, which belong to the development stack. Across this proof, 20 were removed — roughly one per iteration, which is the accumulation confirmed rather than assumed.

**A killed run is not a failed run.** The environment terminated a full gate mid-check during this build. A termination says nothing about the product, but it also says nothing in favour of it, so the harness records `killed` as its own outcome and fails the proof on any. Excluding them quietly is how a nineteen-run proof gets reported as twenty. The signal that distinguishes them is a process signal rather than an exit status — and, for a manually run gate, the absence of the trailing exit marker the run appends when it finishes.

## What repeated running found earlier in the build

Two order- and load-dependent defects were found and fixed before this evidence was taken, both of which passed in isolation:

- A creator paging test took one side of a "newer" comparison from the process clock and the other from PostgreSQL's, so it depended on the container clock not lagging the host's. Under a stalled machine it lagged by more than eleven seconds and the premise inverted, reporting a paging defect that had not happened.
- An RTC reconciliation test asserted a two-second backoff against a freshly read clock, which held alone and failed once eight suites ran together.

Both are the same class: a margin measured against wall-clock time rather than against a captured instant. That class is what repeated running exists to surface.

## What twenty local runs did not catch

The proof above was taken on one machine, and one machine is not the population a gate runs on. The commit that followed it failed hosted on a query-plan assertion that had passed twenty consecutive times locally.

The assertion was that a sweep for calls stuck `reconnecting` uses the partial deadline index. The seed created forty live calls spread evenly across four states, which left the live-side indexes and the deadline index at nearly the same size — so the planner's choice between them turned on cost differences smaller than the variation between a local machine and a hosted runner. Locally it chose the deadline index every time; on the runner it chose a live-side index and applied the deadline as a filter. The test was asserting a preference under conditions where no preference had been established.

The fix was to the seed rather than to the assertion. Live calls are now overwhelmingly `active` with a handful stuck in the two states that have a deadline, which is both the shape a real platform has and the condition the assertion depends on. Measured after the change: the deadline plan costs 73.92 against 312.88 for the next best, and the deadline index is 16 KB against 147 KB — a margin decided by selectivity rather than by hardware.

**The lesson for repeated-run evidence is narrower than "run it more times".** Repetition on identical hardware proves stability against ordering, load, and clocks. It cannot prove stability against a different planner, a different PostgreSQL build, or a different machine, because every iteration shares those. A plan assertion needs a seed that makes the intended index decisively cheaper, and the way to check that is to measure the margin rather than to observe that the test passed.

## Authority

See [testing and release discipline](../engineering/05-testing-release.md) for the port-ownership rule in its permanent home, and [REALTIME](../domains/realtime.md) for what the suites being repeated actually assert.
