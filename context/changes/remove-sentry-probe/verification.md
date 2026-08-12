# Verification — remove-sentry-probe (C10X-54)

> Evidence log. Every reading is recorded with its host, its timestamp and the command that produced
> it, so a later reader can tell a measurement from an assertion.

## Phase 1 — production baseline, then the deletion

### The production host, established rather than derived

`wrangler.jsonc` gives the shape only (`"name": "10xcards"` + `"workers_dev": true`). The full host was
read from the last successful `deploy` job's wrangler output rather than inferred from that shape:

```
$ gh run view 31622221974 --log --job=<deploy>
deploy  Run cloudflare/wrangler-action@v4  Deployed 10xcards triggers (0.63 sec)
deploy  Run cloudflare/wrangler-action@v4    https://10xcards.lirdaw.workers.dev
deploy  Run cloudflare/wrangler-action@v4  Current Version ID: 1d12e051-a595-4e2f-a2d4-47c57e7e7f2d
```

Run `31622221974` is the merge of PR #31 (`e7b538d`, C10X-53) — the deploy that put the probe on
production in the first place. **Host: `10xcards.lirdaw.workers.dev`.** Phase 4 must use this same
host verbatim, or the pair is void.

### 1.6 — the baseline reading (UNREPEATABLE)

Taken **before** any merge, against the deployed Worker as it stood:

```
$ date -u +%Y-%m-%dT%H:%M:%SZ
2026-08-12T18:41:25Z
$ curl -s -o /dev/null -w "STATUS: %{http_code}\n" https://10xcards.lirdaw.workers.dev/api/shipprobe
STATUS: 500
```

| Field     | Value                         |
| --------- | ----------------------------- |
| Host      | `10xcards.lirdaw.workers.dev` |
| Path      | `/api/shipprobe`              |
| Method    | `GET`                         |
| Status    | **500** (expected `500`)      |
| Timestamp | 2026-08-12T18:41:25Z          |

This is half of the Phase 4 pair.

**Repeated live during the manual gate (2026-08-12T18:45:46Z), with the response headers captured**, so
the reading is attributable to the deployed Worker rather than to a cache or an intermediary:

```
HTTP/1.1 500 Internal Server Error
Content-Length: 0
Server: cloudflare
CF-RAY: a2a1a39adf9e526b-PRG
```

`Server: cloudflare` plus a `CF-RAY` is the Worker answering; `Content-Length: 0` is the empty body of an
uncaught throw. Two readings, same host, same status.

**Positive controls on the SAME host, taken in the same series** — without these a `500` is equally
compatible with "the host is broken", which is the failure the Phase 4 pair exists to exclude:

| Request                | Status  | What it establishes                                                        |
| ---------------------- | ------- | -------------------------------------------------------------------------- |
| `GET /`                | **200** | The host is alive and serving the app                                      |
| `GET /auth/signin`     | **200** | A second real route renders — not a single lucky path                      |
| `GET /api/nonexistent` | **404** | **The deployed Worker already answers `404` for an absent `/api/*` route** |
| `GET /api/shipprobe`   | **500** | The `500` belongs to this route specifically                               |

The third row is worth more than it looks and was not something the plan anticipated. Phase 1's local
pre-check exists because nothing in this project had ever produced a `404` from a deleted `/api/*` route,
so the fall-through was reasoning rather than measurement. That control settles it **on production, on
the exact host the pair uses, before the change ships**: `404` is the established shape of "no such API
route" here. Phase 4 is therefore no longer asserting a status nobody has seen on this host — it is
asserting that `/api/shipprobe` joins a class already demonstrated.

Cost: two unsampled Sentry events, the documented price of the measurement, and the last this route will
ever produce.

### The deletion

```
$ git rm src/pages/api/shipprobe.ts
rm 'src/pages/api/shipprobe.ts'
$ git ls-files src/pages/api/shipprobe.ts
(no output)
```

### 1.7 — the local post-deletion pre-check

**This is a PRE-CHECK and explicitly NOT half of the production pair.** A local `404` says nothing
about the deployed Worker; the pair in Phase 4 is against production for exactly that reason. What
this buys is one measurement instead of one inference: nothing in this project had ever produced a
`404` from a deleted `/api/*` route (no `404.astro`, no catch-all, and `wrangler.jsonc` declares
`assets.not_found_handling: "404-page"` over `./dist`), so the plan's reasoning that the path falls
through to Astro's default 404 was untested until now.

Run 1 started a server that reported `Local http://localhost:4321/` — no port bump, so 4321 was free and
the reading was its own server's. `GET /api/shipprobe` → **404**.

**Run 2, during the manual gate, exposed a hazard worth recording rather than smoothing over.** The
second `npm run dev` reported `Local http://localhost:4322/` — a **port bump**, which means 4321 was
still held. `TaskStop` had killed the `npm` wrapper of run 1 but left the `astro`/`workerd` child
listening (confirmed: `netstat` showed PID 6332 on 4321). So the three requests issued to `localhost:4321`
in that second series reached the **orphan**, not the server just started. Same working tree and same
deletion, so the answers were not wrong — but "which server answered?" was momentarily unestablished,
which is not a claim this project accepts on trust.

Re-measured against the port the fresh server actually reported, whose identity is unambiguous
(PID 12988 on 4322), with a positive control beside it:

| Request                | Status  | What it establishes                            |
| ---------------------- | ------- | ---------------------------------------------- |
| `GET /`                | **200** | The server is up and rendering                 |
| `GET /api/nonexistent` | **404** | The fall-through shape for an absent API route |
| `GET /api/shipprobe`   | **404** | The deleted route now joins that class         |

Both servers were then terminated by PID (`taskkill /T /F`) and both ports confirmed free, so nothing
from this phase is left listening to confuse a later `npm run e2e` — which refuses to attach to a
foreign server on 4321 by design (`reuseExistingServer` deliberately unset, `test-plan.md` §6.11).

The general lesson is the e2e layer's own, met here at the dev-server layer: **a port bump is the
signal that the server you are talking to may not be the server you started.** Read the reported port,
never assume the default.

| Field  | Value                                    |
| ------ | ---------------------------------------- |
| Host   | `localhost:4322` (dev server, PID 12988) |
| Path   | `/api/shipprobe`                         |
| Status | **404** (expected `404`)                 |
| Date   | 2026-08-12                               |

Boundary, noted at the site as the plan requires: `npm run dev` does not execute `src/worker.ts` at
all (roadmap H-14's correction), so this observes **routing only** and says nothing about Sentry —
which is all this criterion needs.

### 1.1–1.5 — automated verification

| #   | Check                                     | Result                                                                                                                           |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | `npm run typecheck`                       | OK — **146 files**, 0 errors, 0 warnings (floor 50)                                                                              |
| 1.2 | `npm run lint`                            | exit 0 — 0 errors, **3** pre-existing `no-console` warnings, all in `evals/generation-quality.eval.ts` (unchanged by this phase) |
| 1.3 | `npm run build`                           | exit 0 — server built; the standing `@astrojs/sitemap` `site` warning is unchanged                                               |
| 1.4 | `npm test`                                | **405 passed / 405, 33 files**, seed `1786560253846`                                                                             |
| 1.5 | `git ls-files src/pages/api/shipprobe.ts` | no output — the route is gone from the tree                                                                                      |

**The file-count drop was measured as a PAIR rather than asserted**, because the plan predicts "exactly
1" and a single reading cannot show a delta. The probe was restored from `HEAD`, the gate re-run, and
the probe deleted again:

| Tree state    | `Result (N files)` |
| ------------- | ------------------ |
| probe present | **147**            |
| probe deleted | **146**            |

Delta **exactly 1**, as predicted, with the total staying far above the floor of 50 — which is why the
gate asserts a floor and not an equality (`test-plan.md` has recorded this number going stale at 130,
133, 135, 145; it is 146 today and no document should pin it).

No guard test went red. In particular the tightest tree-walking scan
(`tests/lib/error-param-guard.test.ts`, `>= 69` against a measured 71 → 70) keeps its spare, and the
three name-pinning guards (`no-logging`, `no-env-access`, `form-endpoint-guards`) name other files.

## Phase 2 — the sampling discriminator, extracted and under test

### 2.1–2.8 — automated verification

| #   | Check                                              | Result                                                                                                     |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 2.1 | `npm run typecheck`                                | OK — **149 files**, 0 errors, 0 warnings (floor 50). 146 → 149 is the three files this phase adds          |
| 2.2 | `npm run lint`                                     | exit 0 — 0 errors, the same **3** pre-existing `no-console` warnings in `evals/generation-quality.eval.ts` |
| 2.3 | `npm run build`                                    | exit 0 — see the alias measurement below                                                                   |
| 2.4 | `npx vitest run tests/lib/sentry-sampling.test.ts` | **14 passed**                                                                                              |
| 2.5 | `npx vitest run tests/lib/sentry-wiring.test.ts`   | **4 passed**                                                                                               |
| 2.6 | `npm test`                                         | **423 passed / 423, 35 files**, seed `1786561000244` (405/33 before → **+18 cases, +2 files**)             |
| 2.7 | `npx vitest run tests/lib/no-env-access.test.ts`   | passed — the new module reads no env                                                                       |
| 2.8 | `npx vitest run tests/lib/no-logging.test.ts`      | passed — the new module writes no log line                                                                 |

**The `@/*` alias in the Worker entry was MEASURED, not inferred from a green exit.** The plan named
this the one unproven step: the alias is known to resolve for `src/middleware.ts` in the same SSR
bundle, but `src/worker.ts` is `wrangler.jsonc`'s `main` and had never imported a first-party module.
A build can exit 0 while an import is dropped, so the check is the emitted bundle:

```
$ grep -n -A3 "auth-js/" dist/server/chunks/worker-entry_<hash>.mjs
31157: const DEPENDENCY_NOISE = [/@supabase\/ssr/, /@supabase\/auth-js/];
31158: const DEPENDENCY_EVENT_SAMPLE_RATE = 0.1;
31159: function sampleSentryEvent(event, roll) {
31160:   if (event.logger !== "console") return event;
```

The extracted module is inlined into the Worker entry chunk. **The fallback the plan reserved
(`./lib/sentry-sampling`) was not needed and was not used.** The chunk's filename carries a content
hash and changes on every rebuild, so it is written here as `<hash>` deliberately — re-derive it
rather than copying it.

### 2.9 — deliberate breakage: the pre-`d381c07` discriminator

The regression this file exists for, restored: sample on the `logger === "console"` stamp alone,
dropping the `DEPENDENCY_NOISE` signature test — i.e. the shape that silently dropped ~90 % of real
application errors in production and was caught only by measurement.

```diff
 export function sampleSentryEvent<T extends SentryEvent>(event: T, roll: number): T | null {
   if (event.logger !== "console") return event;
-  const haystack = [ … ].join("\n");
-  if (!DEPENDENCY_NOISE.some((pattern) => pattern.test(haystack))) return event;
   return roll < DEPENDENCY_EVENT_SAMPLE_RATE ? event : null;
 }
```

**Split: 5 of 14 red in `sentry-sampling.test.ts`, 0 of 4 in `sentry-wiring.test.ts`.** Observed
failure string, identical on all five:

```
AssertionError: expected null to be { logger: 'console', …(1) } // Object.is equality
```

| Case                                                                        | Result  |
| --------------------------------------------------------------------------- | ------- |
| sends an error stamped logger: console at a roll that would drop            | **red** |
| sends an error carried in exception.values rather than message              | **red** |
| sends an event with neither a message nor an exception                      | **red** |
| sends an event whose message is not a string                                | **red** |
| sends a console event whose text matches no noise pattern                   | **red** |
| all six dependency-noise cases (both packages × message/exception/survivor) | green   |
| both rate-boundary cases                                                    | green   |
| the non-console case                                                        | green   |

**The green half is the evidence, not decoration.** Every first-party case went red and every
dependency case stayed green — which is what shows those five observe the discriminator's
first-party branch rather than an incidental drop. `sentry-wiring.test.ts` stayed fully green
throughout, correctly: the wiring was untouched, only the decision was broken.

Restored from a pristine copy taken before the edit; `md5sum src/lib/sentry-sampling.ts` back to
`026ff134a2d0988a5d5aafa6a6207909`, identical.

### 2.10 — deliberate breakage: re-inlining the decision in `beforeSend`

The seam's own falsifiability. `beforeSend` re-implements the decision inline —
**with `import { sampleSentryEvent } from "@/lib/sentry-sampling";` left in place**, so co-presence
of the import cannot satisfy the guard. That is the point of the per-LINE rule and the reason this
file is not a "does the file mention the helper?" check.

```diff
-    beforeSend: (event) => sampleSentryEvent(event, Math.random()),
+    beforeSend(event) {
+      if (event.logger !== "console") return event;
+      … inline haystack + [/@supabase\/ssr/, /@supabase\/auth-js/] + Math.random() < 0.1 …
+    },
```

**Split: 1 of 4 red in `sentry-wiring.test.ts`; `sentry-sampling.test.ts` 14 of 14 GREEN.**

```
AssertionError: expected [ Array(1) ] to deeply equal []
+   "src/worker.ts:62: beforeSend(event) {",
```

The red names file and line. **The green is the deliverable here**: it is what proves the two files
observe different claims — the truth table cannot see an unwiring, and the guard cannot see a wrong
decision. Neither substitutes for the other, which is why the plan asked for both.

Restored; `md5sum src/worker.ts` back to `59af37fcdf30443d2ebe31da355e0346`, identical, and both
files re-run **18 passed**.

### 2.11 — what `src/worker.ts` did NOT change

`git diff src/worker.ts` — the Worker-entry shape is the constraint, and it is intact. Asserted
**mechanically** rather than by reading the diff, because "I looked and it was a context line" is the
weaker claim: the changed lines are extracted with `-U0` (which strips context entirely) and searched
for any of the five elements that must not move.

```
$ git diff -U0 src/worker.ts | grep -E "^[+-][^+-]" \
    | grep -E "WorkerEnv|SENTRY_DSN|captureConsoleIntegration|httpServerIntegration|entrypoints/server"
(no output)
```

An empty result over a NON-empty changed-line set is the evidence — the same command prints 55
changed lines before the second `grep` filters them, so this is not a pattern matching nothing.

| Element                                                        | State                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `import handler from "@astrojs/cloudflare/entrypoints/server"` | unchanged (context line in the diff)                     |
| `interface WorkerEnv { SENTRY_DSN?: string }`                  | unchanged                                                |
| `dsn: env.SENTRY_DSN`                                          | unchanged                                                |
| `Sentry.captureConsoleIntegration({ levels: … })`              | unchanged                                                |
| `Sentry.httpServerIntegration({ maxRequestBodySize: "none" })` | unchanged                                                |
| the two `DEPENDENCY_*` constants + their comments              | **removed** — they moved to `src/lib/sentry-sampling.ts` |
| `beforeSend`                                                   | **one-line delegation** supplying `Math.random()`        |

Boundary, stated because the two new files together still do not reach it: nothing in this project
loads `src/worker.ts`, so **no layer asserts that Sentry actually invokes `beforeSend`**. After the
probe's deletion nothing can. The truth table proves the decision is right; the guard proves this
file still makes it; neither proves the SDK calls it.

### All three manual checks were RE-EXECUTED at the gate, and reproduced exactly

Run twice on 2026-08-12: once during implementation, once live at the manual-verification gate, from
freshly taken pristine copies both times. Same splits, same failure strings, same restore hashes —
`5 of 14` / `0 of 4` for 2.9, `1 of 4` / `14 of 14 green` for 2.10, and both restores back to
`026ff134a2d0988a5d5aafa6a6207909` (sampling) and `59af37fcdf30443d2ebe31da355e0346` (worker).

The second run adds two things the first did not have. It pins the failing ASSERTION sites rather
than just the case titles — `sentry-sampling.test.ts:54`, `:66`, `:75`, `:84`, `:133` for 2.9 and
`sentry-wiring.test.ts:131` for 2.10 — and it confirms the import survived the 2.10 edit by reading
it back (`src/worker.ts:3`) before running, so "co-presence did not satisfy the guard" is an
observation rather than an intention.

## Phase 3 — doc-sync

Six targets, each chosen by reading its **section header and preamble** rather than by line number
(`lessons.md:236`). Which of them is a live declaration and which is a dated snapshot decides whether
it was overwritten or appended to, so that classification is recorded per target rather than left to
be inferred from the diff.

| Target                                       | Kind                                          | Treatment                                                                            |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `roadmap.md` § H-15 **Outcome**              | live declaration (`Status: not started`)      | **overwritten** — it described an intention; it now describes what shipped           |
| `roadmap.md` § H-15 **Unknowns**             | live declaration                              | **overwritten** into a dated decision (plain deletion; guarded replacement DECLINED) |
| `roadmap.md` § Done → the H-14 entry         | dated historical record                       | **appended** — a `Nota 2026-08-12 (C10X-54)`; the original sentence stands verbatim  |
| `src/worker.ts` comment above the delegation | live code comment                             | **appended** — a short dated note pointing at the two tests                          |
| `deploy-runbook.md` §5 and §6 (archived)     | dated snapshot, frozen                        | **two appended correction blocks**; no surrounding step rewritten                    |
| `test-plan.md` §7 dependency-log exclusion   | live exclusion carrying dated correction rows | **appended** dated correction; the exclusion itself still STANDS                     |

### Why the roadmap **Risk** bullet was deliberately NOT edited

H-15's `Risk` bullet is present-tense about the probe ("Sonda **jest** publiczna i nieuwierzytelniona
świadomie…", plus the `PROTECTED_ROUTES` stopgap). It was read and left alone, for two reasons, so the
absence of an edit is a decision rather than an oversight:

- the plan's Contract for this target is explicit — **"Outcome and Unknowns only"**;
- it matches the file's own convention. **H-14's `Risk` bullet is still present-tense today**, months
  after that item shipped, because a `Risk` bullet records _why the item exists_, not the current state
  of production. Re-tensing H-15's alone would make it the odd one out.

Both bullets immediately above it now carry the dated resolution, so a reader of the block cannot come
away thinking the route is live.

### 3.1 — live docs are formatter-clean

```
$ npx prettier --check context/foundation/roadmap.md context/foundation/test-plan.md
Checking formatting...
All matched files use Prettier code style!
EXIT=0
```

### 3.2 — the archive-is-ignored PAIR, and the plan's own command measured FALSE

The criterion exists because `prettier --check` reports an **ignored** file and a **clean** file
identically (§6.6's C10X-43 trap). The plan's second half named the runbook itself and predicted it
would print. **Measured, it does not — and it did not at `HEAD` either:**

```
$ npx prettier --list-different context/archive/.../deploy-runbook.md
(no output)                                                              EXIT=0
$ npx prettier --ignore-path /dev/null --list-different context/archive/.../deploy-runbook.md
(no output)                                                              EXIT=0
```

The file is **prettier-clean**, so that exact pair proves nothing: both halves are silent for
different reasons and the command cannot distinguish them. Confirmed against `HEAD` (the pre-edit
copy extracted with `git show` and checked with the ignore disabled) → also silent, so this is a
property of the file, not something these edits introduced.

**Substituted with a control that CAN print**, over the same ignore rule and the same tree:

| Command                                                                           | Result                |
| --------------------------------------------------------------------------------- | --------------------- |
| `npx prettier --list-different "context/archive/**/*.md"`                         | **no output**, exit 0 |
| `npx prettier --ignore-path /dev/null --list-different "context/archive/**/*.md"` | **116 files printed** |

That is strictly stronger than the single-file form the plan wrote: 116 files under
`context/archive/**` would be reported, and the ignore silences **all** of them, so the first line's
silence is attributable to `.prettierignore` and to nothing else. `npm run format` therefore still
cannot touch the archive, which is the property the criterion is actually about.

**One thing the first attempt got wrong, recorded rather than smoothed over.** Before the fix below,
the runbook _was_ prettier-different — because of these edits, not because of the archive. Prettier
wanted exactly one thing: a blank line between the new §6 correction blockquote and the next list
item. That would have satisfied criterion 3.2 as written, for the wrong reason entirely (my
formatting being off, dressed up as the archive being un-prettier). Fixed, and the fix is visible in
the control itself: the archive's different-file count went **117 → 116**, and the file that left the
list is this one.

### 3.3 — the gates still pass after the `src/worker.ts` comment edit

| Check               | Result                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | OK — **149 files**, 0 errors, 0 warnings (floor 50); unchanged from Phase 2, as a comment edit should      |
| `npm run lint`      | exit 0 — 0 errors, the same **3** pre-existing `no-console` warnings in `evals/generation-quality.eval.ts` |

**Not required by the criterion, run anyway, and it is the one thing this phase could plausibly have
broken:** `tests/lib/sentry-wiring.test.ts` reads `src/worker.ts` **per line**, and this phase edits
that file. `npx vitest run tests/lib/sentry-wiring.test.ts tests/lib/sentry-sampling.test.ts` →
**18 passed**, seed `1786561989382`. The note was deliberately written to contain no `beforeSend`,
no `DEPENDENCY_NOISE` and no `Math.random()` token, so it cannot trip the guard's negative control.

### 3.4 — no live document claims the probe exists

Repo-wide, excluding `context/archive/`, `dist/`, `node_modules/` and `.git/`:

| File                                     | Hits | Verdict                                                                                         |
| ---------------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `context/changes/remove-sentry-probe/**` | 40   | this change's own folder — allowed by the criterion                                             |
| `context/foundation/roadmap.md`          | 4    | the resolved H-15 entry (At-a-glance row, Outcome, Risk) + the H-14 note                        |
| `context/foundation/jira-map.md`         | 1    | excluded **by decision** — jira-\* owned and gitignored; `/jira-finish-work` updates the ticket |
| `context/foundation/test-plan.md`        | 1    | the new §7 correction, which states the route was deleted                                       |
| `src/worker.ts`                          | 1    | the new dated note: "the public `/api/shipprobe` route is GONE"                                 |
| `src/lib/sentry-sampling.ts`             | 1    | "…and that route is deleted by this change"                                                     |
| `tests/lib/sentry-sampling.test.ts`      | 1    | "…and this change deletes that route"                                                           |
| `tests/lib/sentry-wiring.test.ts`        | 1    | "…was the last end-to-end instrument for that property"                                         |
| `.idea/workspace.xml`                    | 1    | untracked IDE state, gitignored (`.gitignore:9`) — not a document                               |

**Four of those hits are outside the criterion's own enumeration, and that is a plan-vs-reality note
rather than a failure.** The criterion was written before Phase 2 existed and lists only the change
folder, the roadmap and `jira-map.md`; `src/worker.ts`, `src/lib/sentry-sampling.ts` and the two test
files are Phase 2's own deliverables. Each was read: **every one describes the deletion in the past or
in the deleting tense — none claims the route exists.** No hit anywhere instructs a reader to call it.

### 3.5 — append vs overwrite, decided at the CHARACTER level

The rule (`lessons.md:236`) is that a live declaration may be overwritten and a dated snapshot may
only be appended to. Which of the two happened is not a matter of intention, so it was measured:
`git diff --numstat` per target, plus a prefix test on every changed line.

| Target                                 | numstat   | Verdict                                             |
| -------------------------------------- | --------- | --------------------------------------------------- |
| `deploy-runbook.md` (archived, FROZEN) | **+38/0** | pure insertion — not one existing line removed      |
| `test-plan.md` §7 (live exclusion)     | **+24/0** | pure insertion — the exclusion's own text untouched |
| `src/worker.ts` (live comment)         | **+7/0**  | pure insertion                                      |
| `roadmap.md`                           | +3/−3     | three changed lines, classified individually below  |

The roadmap's three changed lines, each tested by asking whether the OLD text survives verbatim as a
prefix of the new one:

| Line                    | Kind           | Result                                                                   |
| ----------------------- | -------------- | ------------------------------------------------------------------------ |
| H-15 **Outcome**        | LIVE           | rewritten (diverges at char 179; 446 → 1558) — permitted and intended    |
| H-15 **Unknowns**       | LIVE           | rewritten (diverges at char 16; 269 → 845) — permitted and intended      |
| H-14 entry in `## Done` | DATED SNAPSHOT | **APPEND-ONLY** — all 1456 original chars preserved verbatim, +640 added |

So no frozen document lost a character anywhere in this phase.

> **A tooling trap met on the way, worth carrying because it produced a confident wrong answer.**
> The first extraction listed "removed lines" with `grep -E "^-[^-]"` and reported **zero removals
> for every file, roadmap included** — which is false: a removed markdown bullet appears in the diff
> as `-- **Outcome:** …`, i.e. a `-` marker followed by the bullet's own `-`, and the pattern
> excludes exactly that. `--numstat` disagreed, which is how it was caught. Read a diff's markers
> with `grep "^-" | grep -v "^---"`, never with a "not another dash" class, whenever the content
> itself can start with a dash.

### 3.7 — "renders correctly", made falsifiable instead of eyeballed

A human skim cannot see the failure that matters here — a blockquote silently merged into the
preceding paragraph, or a list split in two so every following bullet leaves it. Both were therefore
asserted by parsing the documents with a real CommonMark parser
(`mdast-util-from-markdown@2.0.3`, already in `node_modules`) and checking the resulting tree:

| Assertion                                                                         | Result   |
| --------------------------------------------------------------------------------- | -------- |
| §5 correction is a top-level blockquote (4 paragraphs)                            | **PASS** |
| "Then, in the first terminal:" is still its own node                              | **PASS** |
| the original "Do the cheap one first…" survives as a SEPARATE paragraph           | **PASS** |
| §6 correction is a blockquote NESTED INSIDE the `/api/shipprobe` bullet           | **PASS** |
| "Settle the alert rule" is still a SIBLING in the same 5-bullet list              | **PASS** |
| test-plan §7 correction is nested inside the exclusion (2 paragraphs)             | **PASS** |
| "Rate limiting on generation" is still a SIBLING in the same list                 | **PASS** |
| roadmap H-15 keeps all nine standard bullets, in order                            | **PASS** |
| the H-14 `## Done` entry is still one item in a 23-bullet list                    | **PASS** |
| no inline code span crosses a line break INSIDE a blockquote (the C10X-43 hazard) | **PASS** |

**Two positive controls, because a green structural check is worth nothing until it has been seen
red.** Both were run against the real file and restored, with the restore verified by hash
(`md5 cd56b8dc131467145637eeff1692b9b5`, identical both times):

- **A — un-indent the §6 correction blockquote by two spaces.** Goes red on both nesting assertions,
  and the §6 list collapses from **5 bullets to 2**: the correction and everything after it leave
  the list. Real, and precisely the damage a visual skim reads past.
- **B — delete the blank line before "Settle the alert rule".** **Structure is IDENTICAL — 5
  bullets, blockquote still nested, all checks green** — while `prettier --list-different` still
  flags the file. So that blank line, added earlier in this phase, is **cosmetic and not
  load-bearing**: it buys the prettier-clean property (which is what criterion 3.2's honesty rests
  on), never the rendering. Recorded because the earlier note in this file could be read as claiming
  the render was at risk. It was not.

**The boundary, stated rather than implied**: this proves STRUCTURE, not typography. A parser cannot
tell that a sentence is clumsy or a date is wrong; what it can tell — and what a reader cannot — is
that every block landed in the container it was aimed at.

Two scan caveats found while doing it, both recorded rather than tuned away. The code-span check
first ran over whole files and reported **five** split spans in `test-plan.md`; all five are
**pre-existing** (lines 977–2034), none inside a blockquote, and this change touches only line 3842
onward — so the check was narrowed to blockquotes, which is what the recorded hazard is actually
about. And the first version of the roadmap bullet assertion demanded **7** bullets against a
correct 9-bullet block; it now asserts the nine bullet NAMES in order, which is falsifiable in a way
a count is not.

### 3.6 — the two things `/10x-archive` owns, asserted rather than eyeballed

`/10x-archive` owns the Status flip and the `## Done` entry (`lessons.md:180`):

| Claim                                    | Measurement                                |
| ---------------------------------------- | ------------------------------------------ |
| H-15 detail-block `Status`               | `not started` — untouched                  |
| H-15 At-a-glance status cell             | `not started` — untouched                  |
| `## Done` bullet count, `HEAD` → now     | **23 → 23** — no entry added               |
| `## Done` section mentioning this change | **0** occurrences of `remove-sentry-probe` |

The H-14 `## Done` entry was **appended to** (a dated `Nota`), which is not the same act as writing a
`## Done` entry for this change — the thing the plan forbids. That bullet already carried a
hand-appended dated correction from the C10X-53 ship, so the idiom is the file's own.
