# Verification — `flashcards-test-order` (C10X-32)

Evidence for the order-independence fixes (Phase 1) and the permanent `sequence.shuffle`
regime (Phase 2). Every figure below comes from a run executed against the files as they
stood at that moment; environment for all of them: local Supabase stack up,
`OPENROUTER_API_KEY` unset, 20 CPUs (so Vitest's `forks` pool runs ~18 files concurrently).

## Phase 1 — the six order-dependent pairs

Four edits across three files (`tests/isolation/flashcards.test.ts` ×2,
`tests/review/candidates.test.ts`, `tests/study/study.test.ts`), each giving a mutating
positive control — or, for the `srs_state=3` canary, the fixture-less aggregate — its own
owned fixture. Landed as `eaaf6f1`.

| Check                          | Command                                          | Result          |
| ------------------------------ | ------------------------------------------------ | --------------- |
| Replay the first known-red seed | `npx vitest run --sequence.shuffle --sequence.seed=101` | 220/220 (was 3 failed) |
| Replay the second              | same, `--sequence.seed=202`                      | 220/220 (was 4 failed, incl. the original F6 line) |
| Replay the third               | same, `--sequence.seed=303`                      | 220/220 (was 3 failed) |
| Declaration order still green  | `npm test`                                       | 220/220         |
| Lint                           | `npm run lint`                                   | exit 0          |

## Phase 2 — `sequence.shuffle` in both configs

`sequence: { shuffle: true }` added to `vitest.config.ts` and `vitest.eval.config.ts`, seed
deliberately un-pinned.

| Criterion                             | Result                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------- |
| 2.1 Banner prints a seed, no CLI flags | `npm test` → `Running tests with seed "1785418078146"`, 220/220        |
| 2.2 Known seeds replay through config  | `npx vitest run --sequence.seed=101\|202\|303` → 220/220 each          |
| 2.3 Ten fresh unpinned runs            | **40** fresh runs, 40 distinct seeds, **220/220 every one** — see below |
| 2.4 Lint and build                     | `npm run lint` exit 0 (6 pre-existing `no-console` warnings in `scripts/`, allowed by AGENTS.md); `npm run build` exit 0 |
| 2.5 Shuffled eval run                  | failure set **equals the baseline** — see the eval section below       |

The 40 seeds of the final matrix run (all `220 passed (220)`):

```
1785419609590 1785419614617 1785419619678 1785419624690 1785419629893 1785419634956
1785419640030 1785419645097 1785419650374 1785419655688 1785419660983 1785419666238
1785419671750 1785419676819 1785419681907 1785419687045 1785419692201 1785419697310
1785419702391 1785419707376 1785419712517 1785419717746 1785419722933 1785419727998
1785419733254 1785419738470 1785419743733 1785419748899 1785419754005 1785419759076
1785419764179 1785419769284 1785419774429 1785419779629 1785419784824 1785419790037
1785419795880 1785419801607 1785419806968 1785419812386
```

Plus a no-shuffle control after the same edits: `npx vitest run --sequence.shuffle=false` →
220/220, so the change did not trade declaration-order green for shuffled green.

## The transport flake found while verifying 2.3 — diagnosed and fixed in-change

The first ten fresh runs went **3/10 red**, and the reds were not what criterion 2.3
anticipated. Each was a different random case, each passed in isolation, and **none
reproduced when replayed at its own seed**. Kong named the mechanism:

```
[error] upstream prematurely closed connection while reading response header from upstream,
  request: "POST /rest/v1/deck?select=id%2Cpublic_id",
  upstream: "http://172.18.0.5:3000/deck?select=id%2Cpublic_id"
"POST /rest/v1/deck?select=id%2Cpublic_id HTTP/1.1" 502 75 "-" "node"
```

Kong pools keep-alive connections to PostgREST and holds them idle longer than PostgREST's
warp server keeps them open; the observed 502s follow a ~28 s gap in Kong's access log (the
pause between two `npm test` runs), so the first request after the gap goes down a socket the
upstream has already closed. Downstream it surfaced as whatever assertion was in flight — a
non-null `error` (`"An invalid response was received from the upstream server"`), a `500`
from `/api/generate`, or `Setup failed: card "…" was never written` after a card-create whose
`302` was a refusal (§6.10's own trap).

**It is not an ordering defect.** The paired same-session control, 20 runs each:

| Regime                                              | Reds  |
| --------------------------------------------------- | ----- |
| shuffle **on** (config)                             | 3 / 20 |
| shuffle **off** (`--sequence.shuffle=false`)        | 3 / 20 |
| shuffle on, after restarting `rest` + `kong`        | 2 / 20 |
| shuffle on, `--maxWorkers=4` (18-way → 4-way)       | 2 / 20 |

Equal with shuffle off, so it is pre-existing and independent of this change. Two candidate
levers were **refuted by measurement** rather than assumed: restarting the two stateless
containers (up 3 days) did not clear it, and cutting file parallelism did not either — so it
is not simply 20 cores overrunning PostgREST's 10-connection pool. Neither
`supabase/config.toml` nor PostgREST exposes the keep-alive timeout that would fix it at the
source (`[db.pooler]` is Supavisor, which is stopped and not on this path), and Kong's config
is generated by the Supabase CLI.

**The fix** (`tests/setup/retry-transport.ts`, registered as `setupFiles`): a `globalThis.fetch`
wrapper that replays a request at most twice, and only when the response is a `502` carrying
Kong's own upstream wording, only for a `127.0.0.1`/`localhost` URL, and only when the body is
a string or absent (a `Request` instance or a stream body cannot be replayed without consuming
it). No other status is retried — a `500`, a `409`, a `4xx` refusal and a PostgREST error body
are all signals this suite asserts on.

Retrying a POST is safe here for a reason, not by hope: nginx reports this error after writing
the request and then reading EOF while waiting for the response *header*, and a PostgREST that
had committed would have sent that header first. The only way to commit without one is a
crash, which did not happen (`RestartCount=0`, and the container logged nothing across every
observed 502). The failures agreed from the other side — every red found the row **absent**,
never duplicated.

**The positive control is what makes the result evidence rather than a quiet green.** Over the
40-run matrix batch, Kong logged **22 more** `prematurely closed` upstream drops
(86 → 108) while the suite went **0/40 red**. So the flake fired 22 times in that window and
was absorbed every time; before the wrapper the same class produced ~3 reds per 20 runs. No
duplicate-write failure appeared across those 22 replayed requests — which is the failure mode
a wrongly-retried POST would have produced, and it would have been loud
(`deck_user_name_unique` 409, or a count assertion), never a false green.

`tests/generation/failure-path.test.ts` — the suite's only `fetch` double (§6.9) — still
passes 4/4: setup files run first, so the `realFetch` it captures at module scope IS this
wrapper, its delegated Supabase calls get the retry, and its synthetic OpenRouter responses
are built above this layer and are never a 502.

## The shuffled eval — failure set against the C10X-31 baseline

Three runs, `npm run eval` with the key in the shell environment only (never written to
`.env` — the ordinary suite's preflight fails if it is). Shuffle is active on this path too:
every run printed `Running tests with seed "<n>"`. The oracle is **failure-set equality, not
the exit code**; all three exited **1**, which is the documented contract ("run it, read the
table").

| Run | Seed             | Reds | Which                                                     | Wall clock |
| --- | ---------------- | ---- | --------------------------------------------------------- | ---------- |
| 1   | not recorded     | 4    | `forced/niemiecki`, `forced/francuski`, + **2 unidentified** | 481 s      |
| 2   | 1785420790791    | 3    | `forced/hiszpański`, `forced/niemiecki`, `forced/francuski`  | —          |
| 3   | 1785421342635    | 2    | `forced/niemiecki`, `forced/francuski`                       | 450 s      |

**Verdict: the failure set equals the baseline.** Run 3 reproduces it exactly — `niemiecki` +
`francuski` and nothing else, 8 passed. The `de`/`fr` core is red in **3 of 3** runs with all
five cards Polish each time, which is C10X-31's finding verbatim (`Write the flashcards in
this language: niemiecki.` — a Polish exonym inside an English prompt sentence). Every red in
every run sits on the **forced** prompt path; no `auto` case, no `polski`, no `angielski` ever
went red. Shuffle introduced no new eval failure.

`forced/hiszpański` behaved as the documented intermittent rather than as a regression, and
its *shape* is what says so: exactly **1 of 5** cards wrong, front Spanish and back Polish,
`usable: false` — character-for-character C10X-31's recorded "4/5 in four runs, one mixed
card" plus its hand spot-check "the mixed card (ES front, PL back) → `language_ok=false`,
`usable=false`". Per the calibration rule it got its hand re-run and came back **green** in
run 3.

**Two unidentified reds in run 1 are a gap in this record, and the cause was mine**: the first
run's output was truncated to the tail before it was saved, so only failures 3/4 and 4/4 were
readable. Runs 2 and 3 were captured in full, which is what the verdict rests on. What cannot
be claimed is that run 1's other two reds were `hiszpański` and one aggregate — plausible,
never verified. If it matters later, the cheap resolution is another logged run (~$0.012,
~8 min); it is not load-bearing for this change, whose subject is ordering, and the `auto`
cases were green in both fully-logged runs.

Cost: three runs at roughly $0.012 each.

## Phase 3 — doc-sync

Docs only; no test or config file was touched in this phase.

| Criterion                        | Command / check                                             | Result                                                                    |
| -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| 3.1 Replay line in the test plan | `grep -n "sequence.seed" context/foundation/test-plan.md`   | hits at `:23` (header) and `:535` (§6.2 rule)                             |
| 3.1 Lesson present               | `grep -n "positive control" context/foundation/lessons.md`  | hits at `:201`, `:203`–`:205` — the new entry, alongside the pre-existing RLS one |
| 3.2 Suite still green            | `npm test`                                                   | seed `1785422681609`, **220 passed (220)**, 18 files                      |

What landed where:

- **`test-plan.md` §6.2** — two new bullets under the positive-control discipline that produced
  the defect: (a) a positive control must own the fixture it mutates, with the
  assert-what-you-re-read-vs-a-file-scope-constant distinction and the fixture-less-aggregate
  case; (b) shuffle is permanently on in both runners, seed un-pinned, replay with
  `npx vitest run --sequence.seed=<n>` — plus the "if it does not reproduce at its own seed it
  is not an ordering defect" pointer at `tests/setup/retry-transport.ts`.
- **`test-plan.md` header** — a dated "Last updated" entry stating what this change does and does
  **not** claim: no risk row moves and no coverage claim changes; the axis is whether the
  existing claims are trustworthy in any order.
- **`test-plan.md` §8** — three ledger entries: order-independence proven by execution
  (seeds 101/202/303 + 40 fresh permutations + the no-shuffle control), the transport flake with
  its shuffle-off measurement and its two refuted candidate causes, and the eval's failure-set
  equality with the run-1 gap named rather than rounded.
- **`lessons.md`** — one new entry ("A positive control must OWN the fixture it mutates — and run
  the suite shuffled to prove it"), carrying the two quiet failure modes, the no-restore-after-mutate
  rule, and the "shuffle until green under-counts" measurement (three seeds fired four of six pairs).

No §6.6 claim, breakage split, or denominator was altered — this change re-runs none of them, and
the existing "re-derive before citing" rule stands unchanged.

## Follow-up left open, deliberately

The forced-language generation defect is **found, not fixed** — out of scope by plan ("Not
fixing the eval's forced-language defect"), still shipping in production, and owned by the
C10X-31 follow-up. This change's eval runs are further evidence for it, at a fourth
independent sitting.
