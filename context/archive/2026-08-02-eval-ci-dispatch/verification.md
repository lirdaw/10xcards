# Verification — eval-ci-dispatch (C10X-42)

> **Scope note.** Phases 1–3 recorded their evidence — the adapted criteria, the prettier
> landmine, the uninstalled husky hook, the key provisioning and the stale `342/342` figure — in
> this change's `change.md` Notes rather than here, so this file is **Phase 4 only**. That is a
> deviation from the house habit of one verification file per change, recorded rather than
> papered over: a reader looking for Phase 1's local eval run or Phase 3's doc-sync enumeration
> must read `change.md`, not this file.

## Phase 4: Ship-time evidence

Everything below happened **after** the merge, because a `workflow_dispatch` workflow is not
dispatchable until it exists on the default branch — measured on this repository once already
(C10X-29: `HTTP 404: workflow schema-diff.yml not found on the default branch`, with the
recorded conclusion that there is no honest workaround).

### The merge that made the phase possible

`/ship`, 2026-08-02. Branch `C10X-42-eval-ci-dispatch` → PR **#25** → merge commit
**`92bc9de`**, merged 16:07:12Z. No migration in the diff, so no `supabase db push`; the runbook
skipped that step by inspection rather than by assumption
(`git diff --name-only origin/main..HEAD -- supabase/migrations/` returned nothing).

The merge triggered CI run **30755905899**, and this is the first time `drift` and `deploy` ran
for this change — both carry `if: github.ref == 'refs/heads/main'`, so the PR run had them
`skipping`. All three green:

| Job      | Conclusion | Wall clock |
| -------- | ---------- | ---------- |
| `ci`     | success    | 2m52s      |
| `drift`  | success    | 6s         |
| `deploy` | success    | 55s        |

`deploy` redeployed the Worker even though no `src/` file changed — `ci.yml`'s
`paths-ignore: ["**/*.md", "context/**"]` does **not** cover `.github/**` or `evals/**`. The
deployed artifact is functionally identical (neither directory enters the Astro build), but the
merge was not consequence-free for production and is recorded as such.

### 4.1 — registration, as a PAIR

The "before" half was taken in Phase 2 and re-confirmed immediately before the merge; the "after"
half is the same command minutes later. Neither reading alone is evidence; the difference is.

| Moment                                   | `gh workflow list`                                                |
| ---------------------------------------- | ----------------------------------------------------------------- |
| before the merge (Phase 2, re-confirmed) | `CI`, `Schema diff`                                               |
| after the merge (`92bc9de`)              | `CI`, **`Generation quality eval` (id 325665475)**, `Schema diff` |

### A defect this phase found before it could measure anything: the stored secret carried a BOM

The first dispatch — run **30756346671**, no inputs, the default one — failed in **33 s**
(job 16:19:03Z → 16:19:36Z) with every one of the 11 cases reported
`MISSING (threw before judging completed)`. The per-case error, read from the artifact:

```
OpenRouterError: OpenRouter fetch failed: Cannot convert argument to a ByteString
because the character at index 7 has a value of 65279 which is greater than 255.
```

**65279 is U+FEFF, a byte order mark.** The header is `Bearer ${key}` (`src/lib/openrouter.ts:197`)
and `Bearer ` occupies indices 0–6, so index 7 is the **first character of the key**. The
repository secret `OPENROUTER_EVAL_KEY` began with a BOM.

Three things about it, in order of how much they matter:

- **This is exactly the claim Phase 3 deliberately left open, and the deferral paid for itself.**
  Phase 3 §1's contract says: verify presence with `gh secret list` — "the API lists names only,
  never values, so _the stored value is the working credential_ is a claim only Phase 4's green
  run can settle". It settled it **negative**. Criterion 3.1 was green throughout and is still
  green: the secret existed under the right name the whole time. A name-only check cannot see a
  BOM, and nothing else in the pipeline could either.
- **The key was fine; the TRANSFER corrupted it.** Two independent corroborations, neither of
  which required the value to be printed. Phase 1's local `npm run eval` passed against the same
  key. And the source environment variable measures **73 characters** — `sk-or-v1-` (9) plus a
  64-character body — i.e. no leading BOM at the source. So the three bytes `EF BB BF` were added
  between the variable and the stored secret.
- **The likely mechanism, labelled as likely rather than measured.** `change.md` records the
  secret being piped into `gh secret set` from the User environment variable. Windows PowerShell
  5.1 encodes a native command's stdin/stdout using `[Console]::OutputEncoding`, and when that is
  UTF-8-with-BOM the pipeline emits the BOM as the first bytes of the stream — the same family as
  the `Out-File` / `Set-Content` default this repository already trips over. **Not reproduced
  here**: what was measured is the effect (a BOM in the stored value) and the absence of a BOM at
  the source, not the pipe's byte output.

Cost of this run: **$0**. The request never left the runner — `fetch` could not construct the
header, so no call reached OpenRouter.

Fixed by re-setting the secret interactively (`gh secret set OPENROUTER_EVAL_KEY`, value pasted at
the prompt, no intermediate file and no shell history), `updated_at` 16:24:47Z. That timestamp
proves a write happened and **nothing more** — the same blindness as before, which is why the next
dispatch is what settles it.

### 4.3 — the controlled red, doubling as the credential probe

Run **30756592782**, `generator_model=bogus/does-not-exist`, dispatched 16:25:24Z, job
16:25:27Z → 16:25:59Z (**32 s**), conclusion **`failure`**.

```
OpenRouterError: OpenRouter HTTP 400
rawResponse: { status: 400, body: '{"error":{"message":"bogus/does-not-exist is not a valid
model ID","code":400}}' }
```

**The dispatch order was deliberately inverted against the plan's 4.2-then-4.3 numbering, and the
reason is that this run is a free credential probe.** The plan lists the green dispatch first, but
nothing in 4.3 depends on 4.2, and a bogus model fails at the first generation call — so it costs
a fraction of a green run while still requiring the header to construct AND the key to
authenticate. The `400` is therefore stronger evidence than the mere disappearance of the
`ByteString` error: a bad key answers `401`, not `400`-about-a-model. Only after this did the one
paid dispatch go out.

**The boundary, stated rather than left to be inferred:** this exercises the **infrastructure**
failure class, not the **real generation defect** class. Both exit 1 and both look identical from
the exit code; they are separable only from the output. The one time this project has seen a
genuine generation defect end to end is C10X-31's first calibrated run.

### 4.2 — the green dispatch

Run **30756678180**, no inputs, dispatched 16:27:38Z, job 16:27:46Z → 16:29:49Z (**2m03s**),
conclusion **`success`**. At the fast end of the 117–312 s recorded locally by C10X-31.

The 11-row table as printed into the job log (row order is shuffled because
`vitest.eval.config.ts` sets `sequence: { shuffle: true }` with an un-pinned seed —
`1785687573105` on the earlier run; the seed banner is in each artifact's console file):

```
generator: openai/gpt-4o-mini | judge: google/gemini-2.5-flash
case                | lang     | usable | count | skip
forced/de           | OK 5/5   | 5/5    | 5/5   | 0%
auto/pl             | OK 5/5   | 5/5    | 5/5   | 0%
forced/fr           | OK 5/5   | 5/5    | 5/5   | 0%
auto/fr             | OK 5/5   | 5/5    | 5/5   | 0%
forced/es           | OK 5/5   | 5/5    | 5/5   | 0%
auto/de             | OK 5/5   | 5/5    | 5/5   | 0%
forced/pl           | OK 5/5   | 4/5    | 5/5   | 0%
forced/fr-on-en     | OK 5/5   | 5/5    | 5/5   | 0%
auto/en             | OK 5/5   | 5/5    | 5/5   | 0%
auto/es             | OK 5/5   | 5/5    | 5/5   | 0%
forced/en           | OK 5/5   | 5/5    | 5/5   | 0%
```

Language fidelity **11/11 cases at 5/5**, usability **54/55**, count compliance **55/55**,
skip-rate **0%**.

**That single `usable=false` card is the reason to believe the rest.** C10X-41's two acceptance
runs were 11/11 at 5/5 with exactly one card judged unusable in each; this run reproduces that
shape from CI. A scorer that had quietly become permissive — the failure mode a green run is
otherwise compatible with — would not have produced it. This is corroboration, not proof: one
sample per case at temperature 0.4.

### 4.5 — the re-run, and the half of its rationale that measurement falsified

`gh run rerun 30756592782`, requested 16:31:13Z. Attempt 2 concluded **`failure`**, the upload
step succeeded, and the artifact **`eval-2`** was created at 16:31:57Z.

The row as worded in `## Progress` — "the second attempt produced a distinctly named artifact" —
is satisfied. The plan's fuller contract in Phase 4 §4 is **not**: it says "both attempts remain
downloadable", and they do not.

| Run         | What it was     | Attempts | Artifacts present now |
| ----------- | --------------- | -------- | --------------------- |
| 30756346671 | the BOM failure | 1        | `eval-1`              |
| 30756592782 | the red, re-run | **2**    | **`eval-2` only**     |
| 30756678180 | the green       | 1        | `eval-1`              |

Two never-re-run runs keep their attempt-1 artifact; the one that was re-run lost it. Retention is
30 days and `expired` is `false` on every row, so expiry is excluded, and the only event between
the two readings was the re-run. **Re-running a run deletes the previous attempt's artifacts.**

**The uncomfortable consequence for the suffix's stated rationale, recorded rather than smoothed
over.** `github.run_attempt` is in the artifact name because "artifacts have been immutable since
v4: a second attempt uploading the same name FAILS THE STEP". If a re-run first deletes the prior
artifact, then a **fixed** name would not have collided in this scenario — so the specific
collision the suffix was written to prevent is not reachable by `gh run rerun`. **This is an
inference from the deletion, not a measurement**: no dispatch with a fixed name was run, and one
such run is what would settle it. The suffix still costs nothing and still makes an artifact's
attempt visible from its name, which is a smaller benefit than the one claimed.

**The operational consequence inverts the standard procedure and is the part worth carrying.**
C10X-31's calibration rule is "a red case is re-run once by hand before being believed". Do
**not** honour it with `gh run rerun` — that destroys the first attempt's evidence, which is
precisely what the rule wants to compare against. Issue a **new dispatch** instead: it gets its
own run id and its own artifact, and both survive.

### 4.4 and 4.6 — the artifacts and the key grep

`gh run download` on the green run and on the red run each yielded **three** files:

| File               | Green run (30756678180) | Red run (30756592782) |
| ------------------ | ----------------------- | --------------------- |
| `eval-summary.log` | 702 B                   | 1 025 B               |
| `eval-report.log`  | 19 929 B                | 1 025 B               |
| `eval-console.log` | 22 118 B                | 37 044 B              |

On the red run the report and the summary are byte-identical in size because no card was
generated, so the card-record section is empty — the two files legitimately collapse to the same
content in that state.

`grep -rn "sk-or-\|Bearer "` over every downloaded file: **zero hits**, both runs.

`gh run view --log | grep -c` for the reference-fixture texts (`Kopernik`, `Barrier Reef`,
`Alhambra`, `Berliner Mauer`, `impressionnisme`): **0** on the green run and **0** on the red run.
On the green run that is a real measurement; on the two failed runs it is **vacuously** true,
because no cards existed to leak.

### A side effect of the redirect that nobody predicted: Vitest's GitHub annotations are suppressed

Vitest's `github-actions` reporter emits `::error file=…` workflow commands carrying the full
serialized error — including `rawRequest` with the system prompt and the source text. Because the
eval step redirects **both** streams into `eval-console.log`, GitHub never parses those commands,
so they become file content instead of job annotations. Visible in the red run's
`eval-console.log`, absent from its Actions UI.

Neither a defect nor a benefit that was designed for: it happens to reinforce the "no card text in
the job log" property, and it costs the inline annotations a reader might expect to find. Recorded
so the next person does not hunt for annotations that structurally cannot appear.

### Cost

Measured against the key's own accounting rather than estimated — but the reading does not
separate two hypotheses, so both are stated.

| Reading                       | `usage`    | `limit_remaining` |
| ----------------------------- | ---------- | ----------------- |
| Phase 3, before any dispatch  | —          | $4.909 (3 dp)     |
| After all four job executions | $0.0910555 | $4.9089445        |

The difference sits **within the rounding of the earlier figure**, so either the four job
executions cost under ~$0.001 in total, or OpenRouter's per-key usage accounting lags. One reading
cannot tell those apart and this file does not pretend otherwise. What is independently certain:
the BOM run cost **$0** (no request left the runner) and both red runs answered `400` before any
generation, so **only run 30756678180 could have cost anything at all** — against ~$0.013 recorded
by C10X-41 for the same 11-case matrix. The `limit` is $5 with the cap enforced by OpenRouter
refusing over-cap requests with `402`, which `evals/lib/judge.ts:128` classes as neither `429` nor
`≥500` and therefore throws on immediately, with no retry.

### What Phase 4 does NOT prove

- **The no-report branch of the eval step ships UNEXERCISED.** All four job executions produced
  both report files, including the two that failed — a throw _inside_ a test still lets `afterAll`
  run. Its four enumerated causes (preflight abort, collection-time error, step timeout, any crash
  before `afterAll`) and its 40-line tail are carried by reading, like the drift runner's I/O
  branches (test-plan §6.6, C10X-29). Note the BOM run came closer than the plan expected — every
  case threw — and still did not reach it.
- **The red class exercised is infrastructure, not a real generation defect.** Stated above and
  repeated here because the two are indistinguishable by exit code.
- **The step timeout was never approached.** The longest job was 2m03s against a 30-minute
  step-level timeout, so the sizing argument (11 × 120 s ≈ 22 min) is unexercised arithmetic.
- **The 75% acceptance rate**, unchanged from C10X-31 and C10X-41: the judge is a proxy for
  quality and only real users on the review screen produce the product metric.
- **That anyone will run this.** There is no `schedule:` and no notification channel. A
  dispatchable workflow nobody dispatches refreshes no coverage date.
- **`evals/` is still under no type gate** (C10X-43), and this change makes that exposure worse
  rather than better: a type error there now surfaces at run time **in CI, after paid calls**,
  rather than on a developer's machine.
- **A fixed artifact name was not tested**, so the collision claim above is an inference from the
  observed deletion.
- **`concurrency` was never contended.** The four executions were sequential by hand; nothing here
  exercises the serialisation the group is for.
- **The `judge_model` input was never exercised.** Only `generator_model` was passed. The
  conditional export that keeps an empty `EVAL_JUDGE_MODEL` from reaching the reader is proved
  only in its empty case — which is, admittedly, the default dispatch and the one that mattered.
