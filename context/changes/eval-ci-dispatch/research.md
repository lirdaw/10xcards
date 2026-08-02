---
date: 2026-08-02T09:45:44+02:00
researcher: lirdaw
git_commit: 20b1866db057cf0458b15cf6a81c9d572cc62d9b
branch: main
repository: lirdaw/10xcards
topic: "Run the generation-quality eval from CI on demand (workflow_dispatch)"
tags: [research, codebase, github-actions, evals, openrouter, ci, secrets]
status: complete
last_updated: 2026-08-02
last_updated_by: lirdaw
---

# Research: Run the generation-quality eval from CI on demand

**Date**: 2026-08-02T09:45:44+02:00
**Researcher**: lirdaw
**Git Commit**: `20b1866db057cf0458b15cf6a81c9d572cc62d9b`
**Branch**: `main`
**Repository**: lirdaw/10xcards

## Research Question

What must a `workflow_dispatch`-only GitHub Actions workflow running `npm run eval` actually
do, on this repository, to satisfy the charter in `context/changes/eval-ci-dispatch/change.md`:
manual trigger with no schedule, a separate low-credit OpenRouter key passed per step, the full
result to an artifact rather than the world-readable log, and a hard contract that the workflow
is **never** a deploy-blocking gate?

Scope confirmed with the user before fanning out: **deep** on the output-capture question (it is
the one place where the `schema-diff.yml` template does not transfer), and **external
verification** of GitHub Actions and OpenRouter semantics rather than inference from precedent.

## Summary

The mechanical part is smaller than expected and the interesting part is not where the brief
puts it.

**Mechanically**, the job is five steps and needs almost nothing: `checkout` → `setup-node` →
`npm ci` → `npm run eval` with one env var. **No `npx astro sync`, no `supabase start`, no
Docker, no `SUPABASE_*`, no `.env`** — each proved by execution, not by reading (§1). A
step-level `env:` genuinely feeds both of the eval's key seams, because Vite's `loadEnv` runs
with an **empty prefix** and overlays the whole process environment onto `.env` values before
Astro inlines them (`vite/dist/node/chunks/config.js:9416-9417`). That same mechanism is a new,
sharper argument for per-step scoping than the one `schema-diff.yml` already records: every
variable visible to that step is serialised into the `astro:env/server` virtual module.

**The load-bearing premise of the change is half wrong, and in the direction that reads as
reassurance.** `evals/generation-quality.eval.ts:128-130` claims Vitest 4 swallows `console.log`
from passing tests. Measured on this repo's Vitest 4.1.10: that holds **only** under the
auto-selected `agent` reporter (`std-env` keys on `CLAUDECODE`), and is **false** under
`default`, which is what a GitHub runner gets. So in CI the eval prints its entire card-by-card
log — ~165 lines of card text plus 11 summary rows — to the public log **on every run,
including green ones**, unless something is done. The brief's premise ("redirect it") is
therefore right *for CI*, while the reason written in the code is wrong. Whoever reads that
comment next concludes CI is already quiet.

**The disclosure rationale, however, does not transfer at all.** `schema-diff.yml:100-105`
withholds the DDL body because it is (i) absent from the public repo and (ii) the
*authorization logic nobody reviewed*. Of the eval's four content classes, two — the reference
source texts and the model names — are **already committed byte-for-byte**
(`evals/fixtures/reference-texts.ts` is tracked, 6806 bytes), and the other two (generated cards,
judge rationales) are low-value derivatives of a published fixture through a published prompt.
None is security-relevant. The API key is **not reachable** from any first-party error path — it
appears at exactly two sites, both inside an `Authorization` header
(`evals/lib/judge.ts:196`, `src/lib/openrouter.ts:197`) — and Vitest does not print the custom
`rawRequest`/`rawResponse` error properties (probed directly with marker strings; neither
appeared). And a twist that inverts the intuition: **secret masking applies to logs, not to
artifacts**, so for the one theoretical leak path an artifact is marginally *worse* than the log.

That leaves two honest reasons to want a file, and the plan should stand on these rather than on
an inherited disclosure argument: **volume** (180 lines of noise around one verdict line — which
is exactly `schema-diff`'s "the log keeps the verdict, the body goes to an artifact" readability
argument, and that half does transfer), and **a first-party instruction pre-registered for this
exact ticket**. `evals/lib/judge.ts:204-207` was written by C10X-31's impl-review (F5) to be met
by the builder of this workflow — and it is scoped to **one line**, the 300-char upstream HTTP
excerpt at `:208`, not to the summary table. The brief widened it; that widening is a decision to
make explicitly.

**Three traps would each produce a workflow that looks correct and is not.** `if: failure()` on
the upload — the only artifact precedent in the repo — is wrong here, because `schema-diff`'s own
justification is that a green diff is a zero-byte file, whereas the eval's green table *is* the
deliverable. Piping to `tee` without `pipefail` makes **a red eval read as green** (measured:
subshell exit 0), and GitHub's default `run:` shell on Linux is `bash -e {0}` with no
pipefail — this is verbatim the class `lessons.md` already records as "a command that always
exits 0 is not a gate". And whether an `if: always()` upload step survives a **job** timeout is
**undocumented**; a **step**-level `timeout-minutes` is documented to kill the process and let the
job continue, which removes the dependence entirely.

The remaining constraints are cheap once named: the repository secret should be
**`OPENROUTER_EVAL_KEY`** (the user's own established convention) but must be exported to the
step **as `OPENROUTER_API_KEY`** or preflight fails on both seams; OpenRouter per-key credit
limits are a **verified** hard cap (requests refused with `402`), which makes the blast-radius
claim real rather than aspirational; and essentially all acceptance evidence is **ship-time**,
because a `workflow_dispatch` workflow is not dispatchable until it reaches the default branch —
measured here once already, with the exact error string on record.

## Detailed Findings

### 1. What the eval actually needs on a clean runner

Verified by two controlled executions (the `.astro` directory was renamed away and restored,
`md5sum` identical on all five files, `git status --porcelain` unchanged).

**Both key seams are fed by a plain step-level env var.** `evals/setup/eval-preflight.ts:39`
reads `OPENROUTER_API_KEY` from `astro:env/server`; `:46` reads `process.env.OPENROUTER_API_KEY`.
The chain that makes one export satisfy both: `getViteConfig()`
(`node_modules/astro/dist/config/index.js:4-43`) installs the `astroEnv` plugin
(`create-vite.js:160`), whose loader calls Vite's `loadEnv(mode, envDir, "")` with an **empty
prefix** (`astro/dist/env/env-loader.js:40`); `loadEnv` merges `.env` first and then overlays
every `process.env` key (`vite/.../config.js:9416-9417`), so process env wins. Under Vitest
`command === "serve"`, so the merged object is inlined as a JSON literal into the virtual module
(`astro/dist/env/vite-plugin-env.js:83,152-153`).

Proved live: with the key only in the shell and the repo's `.env` holding Supabase vars alone,
preflight passed on **both** seams, all 11 cases ran, and each threw
`OpenRouterError: OpenRouter HTTP 401` from `src/lib/openrouter.ts:213` — i.e. the generator
reached the real provider carrying the shell-supplied value. Independently corroborated by CI
itself: `.github/workflows/ci.yml:86-89` writes credentials into `$GITHUB_ENV` (no `.env` file)
and `npm test` reads them through `astro:env/server` in `tests/setup/preflight.ts:1`.

> **Security consequence, and it is a stronger argument than the one already in the repo.**
> Because the prefix is empty, the **entire process environment of the step** is serialised into
> the `astro:env/server` module literal. It is never printed, but it means every other secret
> exposed to that step is materialised inside the bundle. `schema-diff.yml:30-40` argues for
> per-step scoping on the grounds that `npm ci` runs install lifecycle scripts; this is a second,
> independent reason that applies to the eval step specifically.

**`npx astro sync` is not needed.** `astro sync` writes only `.d.ts` files into `.astro/`
(`astro/dist/core/sync/index.js:140-155`); for `astro:env` it only declares the module
(`astro/dist/env/sync.js:3-30`). The runtime module comes from the Vite plugin's `load` hook
(`vite-plugin-env.js:55-93`), which never reads `.astro/`. Confirmed by running the eval with
`.astro/` absent: byte-identical behaviour.

**Nothing under `evals/` touches a database.** `grep -rni "supabase|createClient|@/db|database"
evals/` returns two hits, both prose comments (`generation-quality.eval.ts:44`,
`eval-preflight.ts:21`). The only `src/` module pulled in at runtime is `src/lib/openrouter.ts`,
whose sole project import is `@/lib/flashcards` for `FRONT_MAX`/`BACK_MAX` — and
`src/lib/flashcards.ts:1-2` are `import type`, so `@supabase/supabase-js` is erased.
`vitest.eval.config.ts:55-58` deliberately omits `setupFiles`, so neither the ordinary preflight
nor the local-stack retry wrapper loads. **No `supabase start`, no Docker, no `SUPABASE_*`.**

**Env vars the run reads, complete:**

| Var | Seam | Read at | Default when unset |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | `astro:env/server` | `eval-preflight.ts:39`; `openrouter.ts:160,197` | none — preflight aborts |
| `OPENROUTER_API_KEY` | `process.env` | `eval-preflight.ts:46`; `judge.ts:163` | none — preflight aborts |
| `OPENROUTER_MODEL` | `astro:env/server` | `openrouter.ts:64,158` | `openai/gpt-4o-mini` (`openrouter.ts:19`) |
| `EVAL_JUDGE_MODEL` | `process.env` **only** (not in the Astro schema) | `judge.ts:32` | `google/gemini-2.5-flash` (`judge.ts:23`) |

`EVAL_JUDGE_MODEL` is the documented cross-examination lever (test-plan §6.6 C10X-31) and is a
natural `workflow_dispatch` input if one is wanted.

**Cost and time envelope.** 11 cases, sequential, one file. Generation: **exactly 11 calls, no
retry** (`openrouter.ts:192-217` is a single `fetch`). Judge: one call per returned card ≈ **55**,
so **≈66 paid calls** nominally. Retry policy, exactly: `postWithOneRetry`
(`judge.ts:112-134`) allows **2 HTTP attempts**, retrying only a thrown fetch error, `429`, or
`≥500`, after a fixed **3000 ms**; `judgeCard` (`judge.ts:148-160`) retries only
`TruncatedVerdictError` with backoffs `[3000, 10000]`, i.e. **max 3 invocations** → **max 6 paid
calls per card**. Worst case ≈ 341 calls, but the binding constraint is `testTimeout` 120 s
(`vitest.eval.config.ts:47`), so **worst-case wall clock ≈ 11 × 120 s ≈ 22 minutes** plus
install. Recorded local reality (test-plan §6.6, C10X-31): **117–312 s** and **~$0.012** for a
**10**-case matrix; C10X-41 took it to 11 cases / 55 judge calls, so **~$0.013** is the current
figure and the brief's `$0.012` is the older one.

**No path degrades silently to green.** Mock mode (`openrouter.ts:160-169`) is the only silent
degradation in the codebase and preflight closes exactly that seam, as `globalSetup`, so a throw
aborts before any file is collected (verified: exit 1, "No test files found", zero tests run).
An **empty string is rejected on both seams** — `astro/templates/env.mjs:26` maps `'' → undefined`,
and `process.env.X === ""` is falsy. The honest residual: a **truthy but invalid** key passes
preflight and then dies loudly at the provider (verified at HTTP 401). That is correct behaviour,
but it means preflight proves "a key string exists", not "a key works".

**Exit codes do not distinguish the three failure classes** — preflight abort, mid-run
infrastructure, and a real generation defect all exit **1**. They are separable only from the
output: a preflight failure prints `Eval preflight failed:` and no `Test Files` summary;
infrastructure prints `— MISSING (threw before judging completed…)` rows plus
`run: usability 0/0`; a real defect prints a **complete** table with green siblings and
`[case] language: n/m cards not in X`.

### 2. Output capture — the crux

**What is printed, and by whom.** Six `console.*` calls, all inside one `afterAll`
(`generation-quality.eval.ts:190-211`). `scoring.ts` and `judge.ts` contain **zero**.

| Line | Emits | Volume | Appears on |
| --- | --- | --- | --- |
| `:191` | `cardLog` — per card: `front`, `back`, `language_ok`/`detected`/`usable`/`reason` (built `:157-160`) | ~55 entries ≈ **165 lines** | always |
| `:192` | `generator: … \| judge: …` | 1 | always |
| `:193-194` | `SUMMARY_HEADER` + 11 rows (`scoring.ts:135,141-152`) | 12 | always |
| `:201` | `— MISSING (threw before judging completed…)` | 0–11 | only when a case threw early |
| `:206` | `failures:` list from `evaluateRun` | 0–13 | only on failure |

Order is report-then-assert: the table prints at `:191-206`, the gating assertion is last at
`:210` — so the diagnostic exists on a red run *provided the sink is reached*.

**Three assertion sites bypass `console` entirely** and print through Vitest's own failure
output: the floor (`:174-177`, a number), the language gate (`:181`, whose *received* value is an
array of `CardVerdict` objects — i.e. **`detected_language` and the judge's `reason` prose**), and
the run-level assert (`:210`). The boundary this draws is useful: **card front/back text reaches
the log only via `cardLog`; judge reasons reach it via both `cardLog` and the `:181` diff.**
Suppressing console alone does not suppress judge reasons on a red run.

**The reporter finding.** Measured on Vitest 4.1.10 in a scratch project:

| Run | Reporter | `console.log` in passing `it()` | in `afterAll` |
| --- | --- | --- | --- |
| green | auto-selected (`agent`) | **swallowed** | **swallowed** |
| green | `default` | **printed** | **printed** |
| red | either | printed | printed |

Mechanism: `coverage.DM_a_rWm.js:455` pushes `isAgent ? "agent" : "default"`; the `agent`
reporter is `MinimalReporter` constructed with `silent: "passed-only"`
(`index.UpGiHP7g.js:3867-3872`), whose `shouldLog()` returns false for any non-failed task
(`:2427-2430`). `isAgent` comes from `std-env`, which keys on `CLAUDECODE`/`CLAUDE_CODE`. **In
GitHub Actions `isAgent` is false**, so the `default` reporter applies and everything prints.
Hook output is attributed to the suite (`console.3WNpx0tS.js:80`) and follows the same path.

Two consequences. First, the comment at `generation-quality.eval.ts:128-130` — and by extension
C10X-41's local use of `--disable-console-intercept` — describes an agent-terminal artefact, not
a property of Vitest 4; **the workflow must not copy that flag reflexively**. Second,
`coverage.DM_a_rWm.js:456-457` additionally pushes the `github-actions` reporter when
`GITHUB_ACTIONS === "true"`, and it emits `::error` annotations through **stdout** — so a
full-stream redirect also suppresses the failure annotations in the run summary.

**What a public log would actually disclose:**

| Class | Verdict |
| --- | --- |
| (a) reference source texts | **Non-issue.** `evals/fixtures/reference-texts.ts` is tracked (`git ls-files`), 6806 bytes, already public verbatim. Both prompts likewise (`openrouter.ts:108-115`, `judge.ts:77-91`). |
| (b) generated card text | Not in the repo, but a model derivative of a published fixture via a published prompt. No user or production data — the eval reads no database. |
| (c) judge verdicts / reasons | Same class as (b). Reaches the log via `cardLog` **and** the `:181` diff. |
| (d) model names | Committed literals. Non-issue. |
| (e) the API key | **Not reachable.** Two sites only, both `Authorization` headers (`judge.ts:196`, `openrouter.ts:197`); never in a request body (`openrouter.ts:190` excludes headers). Error paths carry `err.message`, a variable *name*, a model id, or a 300-char body excerpt. `rawRequest`/`rawResponse` never surface — probed with marker strings inside a thrown `OpenRouterError`; Vitest printed the message and a code frame, **neither marker**. |

**So `schema-diff.yml`'s rationale does not transfer on disclosure grounds.** Its argument has
two premises — content absent from the public repo, *and* security-relevant (RLS predicates,
function bodies: the authorization logic nobody reviewed). The eval satisfies the first for two
of four classes and the second for **none**. Flashcards generated from a committed Polish text
about Copernicus, plus one-sentence rationales, are a *lower*-value derivative of the fixture,
not a higher-value disclosure than it. `schema-diff.yml:107-109` even concedes that artifacts on
a public repo are downloadable, so the move narrows rather than removes exposure where it *is*
justified.

The one path carrying anything the repo does not already contain is `judge.ts:208` — the upstream
body excerpt — and that is precisely what the pre-registered comment at `:204-207` names. Masking
would cover a verbatim key there **in the log** and would **not** cover it in an artifact, so for
class (e) specifically the artifact is the weaker choice.

**Capture strategies, measured.** GitHub's default `run:` on Linux is `bash -e {0}` — **no
pipefail**; writing `shell: bash` gives `bash --noprofile --norc -eo pipefail {0}`.
`schema-diff.yml` sets no `shell:`, which is harmless there only because it never pipes and
because `supabase db diff` always exits 0 (it tests `[ -s diff.sql ]` and calls `exit 1`
itself). **The eval's shape is the opposite** — `npm run eval` genuinely exits 1.

| # | Strategy | On a RED run | Exit survives? | Captures the GREEN table? |
| --- | --- | --- | --- | --- |
| (a) | `npm run eval > eval.log 2>&1` under default `bash -e` | step aborts at that line; the file is nonetheless complete (the shell owns the redirect) | **yes** | **yes** — everything, incl. reporter noise and the `:181` diff |
| (b1) | `--reporter=json --outputFile` | **worst.** No console output in the JSON at all, and a failing `afterAll` is not in `assertionResults` — only `"status":"failed"`. Table *and* reason lost | yes | no |
| (b2) | `--reporter=junit --outputFile` | console lands in `<system-out>`, failure + diff captured | yes | **no** — the suite-level `<testcase>` carrying hook output is emitted only when the suite has errors (`index.UpGiHP7g.js:3796-3800`) |
| (c) | the eval writes the file itself in `afterAll` | unaffected; the write sits before `evaluateRun`, which `:185-189` already orders that way; hook still runs when cases throw, so `MISSING` rows are captured | **yes**, untouched | **yes** — the only option symmetric on green and red |
| (d1) | `\| tee eval.log` under default `bash -e` | **exit 0. A red eval reads as green.** Measured | **no** | yes |
| (d2) | same with `shell: bash` (`-o pipefail`) | exit 1, aborts at that line | yes | yes — but puts the content back in the public log |
| (d3) | `\| tee …; exit ${PIPESTATUS[0]}` with `-e` off | recoverable (`PIPESTATUS[0]=1` while `$?=0`) | yes, if written | yes |

For (a) and (d2) the upload must be a **separate step**, since `-e` aborts the current one. To
post-process in place: `npm run eval > eval.log 2>&1 || STATUS=$?` … `exit $STATUS`.

**Purity constraint for (c), checked and satisfied.** `evals/lib/scoring.ts:1-5` declares "no
I/O … no imports from src/", and `tests/lib/eval-scoring.test.ts` pulls it into the ordinary
`npm test`, so I/O there would be dragged into a suite whose preflight forbids the key. **But the
boundary already has a legal home**: `evals/lib/judge.ts:5-7` states the precedent explicitly —
"Lives in `evals/` on purpose — it reads `process.env` and may log, both of which are `src/`-only
prohibitions" — and nothing under `tests/` imports `judge.ts` or the eval file. So the `afterAll`,
or a new `evals/lib/report.ts`, may write freely. `summaryRows`/`SUMMARY_HEADER` already **return
strings**; only the sink moves.

**No other precedent in the repo.** `upload-artifact` appears once (`schema-diff.yml:133`);
output redirection to a file once (`:116`). `scripts/*.ts` contain no `writeFile`. Nothing sets
Vitest `reporters` or `outputFile`. `.gitignore:20` already covers `*.log`.

### 3. Workflow shape and house style

**Pins, identical in both existing files:** `actions/checkout@v7` (`ci.yml:15,113,132`;
`schema-diff.yml:42`), `actions/setup-node@v6`, `actions/upload-artifact@v7`
(`schema-diff.yml:133`), `node-version: 22` bare (`.nvmrc` says `22.14.0`), `cache: npm` **only
where `npm ci` runs**. All three majors were sanity-checked against the Releases API and are
real: checkout **v7.0.1** (2026-07-20, current), setup-node **v6.5.0** with **v7.0.0** available
(2026-07-14 — one major behind, fine), upload-artifact **v7.0.1** (2026-04-10, current). The
unusual numbering is the Node 20→24 migration wave, not a typo. Match `ci.yml` so the new file
does not introduce a second version story.

**Per-step vs job-level `env:` is not a blanket rule.** `schema-diff.yml:30-40` scopes per step
because `npm ci` runs lifecycle scripts for the whole tree on a **public** repo; `ci.yml:109-111`
uses job-level `env:` and is correct because that job runs no `npm ci` at all. The discriminator
is "does `npm ci` run in this job" — and the eval job does, so **per step**, reinforced by the
`loadEnv` finding in §1.

**Fail-closed guard idiom**, `schema-diff.yml:60-72`: a named step before the work,
`test -n "$X" || { echo …; exit 1; }`, aligned `||` for one-liners, brace block when the message
needs two sentences, and for the non-obvious one it states *what happens if you skip it*.

**Comment density is the strongest convention and the easiest to under-deliver on.**
`schema-diff.yml` is ~70 comment lines out of 137. The shape: a file-header block **before**
`name:` saying why this is a separate workflow and ending on the contract ("A red run here must
never stop a release; it is a diagnostic, not a gate", `:10-13`); a comment on the trigger
justifying the **absence** of `schedule:` (`:16-23`); CAPS/bold on the load-bearing word;
cross-references to the sibling workflow; decisions stated as rejected alternatives; and comments
that admit uncertainty rather than assert (`:74-82`, "Flagged rather than asserted because it
could NOT be confirmed"). Note two `context/changes/…` pointers inside that file (`:95`, `:121`)
are **already stale** — that change is archived. Do not copy that idiom.

**Naming:** `name:` is Title-case prose (`CI`, `Schema diff`); job ids lowercase-kebab; step
names imperative sentences, with a parenthetical status qualifier where useful
(`ci.yml:65`, "(local parity, advisory)"); trivial steps carry no `name:`.

**Nothing can pick this up as a gate.** Every `needs:` in the repo is `ci.yml:106` (`needs: ci`)
and `ci.yml:128` (`needs: [ci, drift]`) — both inside one file, and `needs:` cannot reference a
job in another workflow. `.github/` holds exactly two files; no CODEOWNERS, dependabot, templates,
rulesets, or `workflow_run:` triggers anywhere. A `workflow_dispatch`-only workflow produces **no
check run on a PR**, so it cannot be auto-adopted into required status checks — a future required
check would have to be typed in deliberately.

**Tooling:** ESLint does **not** cover YAML (measured: "File ignored because no matching
configuration"). Prettier **does** — there is no `.prettierignore`, and both existing workflows
are already prettier-clean. But lint-staged globs are `*.{ts,tsx,astro}` and `*.{json,css,md}`, so
**`.yml` escapes the pre-commit hook entirely**: run `npm run format` (or `npx prettier --write`)
by hand. `.gitattributes` (`* text=auto eol=lf`) enforces LF on this Windows machine.

**`paths-ignore` interaction:** a new `.github/workflows/*.yml` matches neither ignore pattern, so
the commit adding it triggers the full `ci` workflow on the PR and `ci → drift → deploy` on merge.
The accompanying doc edits are all under `**/*.md` / `context/**` and trigger nothing.

### 4. Platform semantics, verified externally

**Who can trigger.** Write access, full stop — "Write access to the repository is required to
perform these steps" ([Manually run a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)),
and the REST endpoint needs the `repo` scope. A fork, an anonymous visitor, or a read/triage
collaborator cannot. Billing states the same boundary from the other side: "Anyone with write
access to a repository can run actions. Any costs of running the actions are billed to the
repository owner." (*Unverified*: the fine-grained-PAT permission name.)

**Default branch, confirmed.** "This event will only trigger a workflow run if the workflow file
exists on the default branch" ([Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)).
A non-default ref **can** then be selected (`gh workflow run WORKFLOW --ref BRANCH`). This
confirms C10X-29's local measurement as platform behaviour rather than a quirk.

**A confirmation gate.** `inputs:` supports `choice`, `boolean`, `string`, `environment`,
`number`, read via `${{ inputs.x }}`; a `required: true` input adds UI friction only — "If you run
this workflow from a browser you must enter values for the required inputs manually" — and
`gh workflow run -f` bypasses it entirely. **The only real gate is an environment with required
reviewers**: "A workflow job cannot access environment secrets until approval is granted by a
reviewer" ([Security hardening](https://docs.github.com/en/actions/reference/security/secure-use)),
because it withholds the key itself.

**Artifacts on a public repo.** "People who are signed into GitHub and have read access to a
repository can download workflow artifacts" — on a public repo that is every GitHub user, so
**treat the artifact as published**. Retention: default **90** days, and on a public repo the
**maximum is also 90** (private/internal go to 400); `retention-days` cannot exceed the repo
setting. `schema-diff.yml` uses 7. Since v4, artifacts are **immutable** and names must be
unique — so a **re-run of the same run** uploading the same artifact name **fails the step**
unless `overwrite: true` or the name carries `github.run_attempt`. That matters here, because
C10X-31's calibration rule is explicitly "a red case is re-run once by hand before being
believed".

**Secret masking is a backstop, not a control.** "Because there are multiple ways a secret value
can be transformed, automatic redaction is not guaranteed." Structured data is called out as a
failure case: "do not use a blob of JSON, XML, or YAML … as this significantly reduces the
probability the secrets will be properly redacted." Base64 and other encodings must be
**registered separately**. Redaction happens on the runner and applies to **logs**. An OpenRouter
`sk-or-v1-…` key is not on GitHub's built-in pattern list; it is masked only by virtue of being a
repository secret. (*Unverified*: a secret split across two log lines — the "exact match" wording
implies no redaction, but the docs do not say so.)

**Timeouts.** Job-level `timeout-minutes` defaults to **360**; the documented maximum applies to
the **step** level ("Maximum: 360"), while the job level is bounded in practice by the 6-hour
execution limit. **Whether an `if: always()` / `if: failure()` step runs after a JOB timeout is
undocumented** — the [cancellation reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation)
re-evaluates `if` only for *"jobs that continue to run"*, i.e. jobs **not** cancelled, and a
job killed by its own timeout is being cancelled; the page never mentions timeouts at all.
Secondary sources assert both ways and none is authoritative. **A step-level timeout is
documented to "kill the process"**, which fails the step without cancelling the job, so the upload
runs under ordinary semantics. Put the timeout on the eval step.

**Concurrency.** Group on `github.workflow` **alone** with `cancel-in-progress: false`. The
common `${{ github.workflow }}-${{ github.ref }}` is wrong here: two dispatches on different
branches land in different groups and both run — exactly the double spend. Note the trap:
`cancel-in-progress: false` protects the **in-flight** run only; a newly queued run still
*cancels the existing pending run and takes its place* ("any existing `pending` job or workflow
in the same concurrency group will be canceled"). The newer `queue: max` property would change
that, but it is version-gated in the docs source — **unverified for this account**.

**Billing.** "GitHub Actions usage is **free** … for **public repositories** that use standard
GitHub-hosted runners." Larger runners are always charged. Stay on `ubuntu-latest` and the
GitHub-side cost is zero; the only spend is OpenRouter.

**OpenRouter — the blast-radius claim is verified.** Per-key credit caps exist ("**Per-key credit
limits** — an optional spending cap configured on an individual API key") and requests are
**refused with `402`**, readable via `GET /api/v1/key` → `limit_remaining`. Three qualifications:
the **Provisioning API needs a separate *Management* key** ("Management keys … are exclusively for
administrative operations"), so the dashboard path is simpler; `limit_reset: null` means
lifetime-cumulative, and the exact enum strings for weekly/monthly are **unverified**; and a
separate key buys **spend isolation only, not rate-limit isolation** — "Making additional accounts
or API keys will not affect your rate limits, as we govern capacity globally." A `402` does not
distinguish "this key hit its cap" from "the account is out of credit" — both carry
`payment_required`. Relevant to §1: `judge.ts:128` treats 402 as neither 429 nor ≥500, so it
**throws immediately with no retry**, which is the loud behaviour we want. Paid model variants
carry no platform request cap, so the ~66-call burst hits no documented limit; residual exposure
is upstream provider 429s and Cloudflare's undocumented DDoS threshold.

> One cross-cutting warning worth carrying into any future budget pre-check: **`res.ok` is not a
> success oracle for OpenRouter** — mid-stream credit, rate and provider failures arrive as HTTP
> 200 with `finish_reason: "error"`. That is the same defect class this repo already recorded
> twice (`StudySession.rate()` reading a 302→HTML 200 as success, `lessons.md`; and C10X-31's
> ~10% truncated verdicts).

### 5. Secret naming, and the mapping that is easy to get wrong

`OPENROUTER_EVAL_KEY` is already the user's established local convention —
`context/archive/2026-07-31-forced-language-prompt-fix/verification.md:44,49,545,550` records the
invocation `$env:OPENROUTER_API_KEY = [Environment]::GetEnvironmentVariable('OPENROUTER_EVAL_KEY','User')`,
and the same rule sits in the user's memory index. It is also visibly distinct from the
production Cloudflare secret, which matters.

**The step must therefore export it under the other name:**

```yaml
env:
  OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_EVAL_KEY }}
```

A workflow exposing it as `OPENROUTER_EVAL_KEY` fails preflight on both seams
(`eval-preflight.ts:39,46`) with a message that is confusingly about `.env`.

`.env.example` must **not** gain a row: a key in `.env` satisfies only seam 1 and additionally
breaks the next `npm test` (`tests/setup/preflight.ts:111`). The README table
(`README.md:186-191`) is the one place that needs a new row; its house style is
`yes — <em-dash clause naming the property that matters>`, and the eval row writes itself as *a
**separate** OpenRouter key with a low credit limit, never the developer's or production's*.
`README.md:167-182` also describes the workflow inventory ("A separate workflow, **`schema-diff`**
…") and goes stale with a second dispatch-only workflow.

**A fail-closed guard is not redundant even though nothing degrades silently.** `lessons.md:119-120`
records the production instance of exactly this: a missing key put the app into mock mode while CI
read "success". Here the eval's preflight is what closes it — but a `test -n` guard before `npm ci`
fails in 2 seconds instead of after a 60-second install, and it matches the house idiom.

## Code References

- `evals/generation-quality.eval.ts:128-130` — the false "Vitest 4 swallows passing-test console" premise
- `evals/generation-quality.eval.ts:157-160,190-211` — every `console.*`; `cardLog` composition; report-then-assert order
- `evals/generation-quality.eval.ts:181` — the assertion whose received value carries judge `reason` prose past any console redirect
- `evals/lib/judge.ts:204-208` — the instruction pre-registered by C10X-31 impl-review F5 **for this ticket**
- `evals/lib/judge.ts:5-7` — the precedent that `evals/lib/` may do I/O and log
- `evals/lib/judge.ts:112-160` — the exact retry policy (2 HTTP attempts, 3000 ms; 3 truncation attempts, 3000/10000 ms)
- `evals/lib/judge.ts:196`, `src/lib/openrouter.ts:197` — the only two sites the key reaches
- `evals/lib/scoring.ts:1-5` — the purity contract that keeps I/O out of this file
- `evals/setup/eval-preflight.ts:39,46` — the two seams the workflow env must satisfy
- `vitest.eval.config.ts:13-27,45,47,55-58` — invocation contract, globalSetup, timeouts, deliberate absence of `setupFiles`
- `.github/workflows/schema-diff.yml:16-23` — the no-`schedule:` paragraph to parallel
- `.github/workflows/schema-diff.yml:30-40` — per-step secret rationale, and its stated contrast with `ci.yml`
- `.github/workflows/schema-diff.yml:100-109,127-137` — the log-vs-artifact reasoning and the `if: failure()` justification that does **not** transfer
- `.github/workflows/ci.yml:86-92` — process-env credentials feeding `astro:env/server`, corroborating §1
- `.github/workflows/ci.yml:106,128` — the complete set of `needs:` in the repo
- `README.md:167-194` — workflow inventory prose and the repository-secrets table
- `src/lib/openrouter.ts:160-169` — mock mode, the one silent-degradation path preflight closes
- `.gitignore:20` — `*.log` already ignored

## Architecture Insights

- **Two conventions in this repo look like rules and are actually discriminated decisions.**
  Per-step `env:` is not "always"; it is "when `npm ci` runs in this job". `if: failure()` on an
  artifact is not "always"; it is "when the green outcome produces an empty file". Both
  discriminators are written down at the site, and both resolve *against* the naive copy here.
- **The eval's isolation from `npm test` is structural and must stay so.** `vitest.eval.config.ts`
  replaces the `include` glob, and the two preflights are exact inverses. A CI leg is a third run
  path, not a widening of the second — and `jira-map.md:370` already draws the boundary against
  C10X-43: "C10X-42 gives running-in-CI, C10X-43 gives compilability". Keep `tsc --noEmit` out.
- **This change is the first automation to touch `evals/` at all**, which is exposed because
  `evals/` sits under no type gate (C10X-43 open). A `TS2353` there surfaces only at run time —
  after paid calls. Worth one sentence, not a scope change.
- **The repo's recurring failure shape appears again, twice.** "A command that always exits 0 is
  not a gate" (`lessons.md`) is the `tee`-without-pipefail trap; and a claim written from
  inference that reads as reassurance — the console-swallowing comment — is the same class as the
  Kong keep-alive mechanism C10X-39 measured and found false.
- **Masking inverts the log-vs-artifact intuition** for the one genuinely sensitive class: logs
  are redacted, artifacts are not.

## Historical Context (from prior changes)

- `context/archive/2026-07-29-ai-candidate-generation-test-3/plan.md:87-90` — the deferral
  verbatim: "**No GitHub workflow and no repo secret** — decided in planning (user choice:
  local-only). The `workflow_dispatch` leg (schema-diff.yml idiom, per-step secrets, capped
  OpenRouter key) is **deferred to a follow-up ticket**". `:102-103` carries the no-schedule half.
- `context/archive/2026-07-29-ai-candidate-generation-test-3/research.md:179-195` — "Escape route
  C" already specifies most of this workflow's design; C10X-31 chose not to build it, not to
  design it. Worth reading before drafting.
- `context/archive/2026-07-29-ai-candidate-generation-test-3/reviews/impl-review.md:122-137` —
  finding F5, which deliberately left `judge.ts`'s excerpt as-is and planted the comment "so the
  builder of the deferred workflow_dispatch leg meets it in the code they will touch". That is
  this ticket.
- `context/archive/2026-07-29-ai-candidate-generation-test-3/verification.md:39-45` — cost and
  wall clock: **~$0.012**, **117–312 s**, exit **1** on the honest red.
- `context/archive/2026-07-27-schema-drift-test/verification.md:474-507` — the default-branch
  trap, measured on a throwaway ref: `gh workflow run … --ref tmp-…` answered
  `HTTP 404: workflow schema-diff.yml not found on the default branch`, and "**There is no honest
  workaround** … Waiting for the merge is the correct answer." `:926-937` records the before/after
  `gh workflow list` check that turns registration into evidence.
- `context/archive/2026-07-27-schema-drift-test/reviews/impl-review.md:144-173` — F3, the
  world-readable-log finding whose fix (`if: failure()` + artifact) is the precedent being copied,
  including its own concession that artifacts on a public repo are also public.
- `context/archive/2026-07-31-forced-language-prompt-fix/verification.md:515-541` — `npx tsc
  --noEmit` exits 2 on the eval alone while `lint`, `build` and `npm test` are green. Deliberately
  left open; owned by **C10X-43**, with `follow-ups/typecheck-gate.md` written.
- `context/foundation/jira-map.md:84` — C10X-42's row: type `Zadanie`, Priority/Urgency **Low**,
  Fix Version **Post-MVP**, Epic **C10X-12**, Component **`generation`**, and `Change ID`
  (`customfield_10041`) **empty on both sides** — the change folder now exists, so both ends should
  be filled. `:369-372` records the C10X-43 link and the scope boundary.
- `context/foundation/roadmap.md:298` — H-06's Outcome already names this follow-up in Polish,
  including "OSOBNY klucz OpenRouter z niskim limitem kredytów jako ogranicznik szkód".
- **C10X-35 is a parked `Pomysł`, not a shipped decision** (`jira-map.md:85`,
  `roadmap.md:411`) — "Alerts + schedule for `schema-diff` — nobody watches the DDL diff result
  today". The brief's "same decision as C10X-35" means "the same reasoning that parked it", which
  is accurate but should be phrased precisely.

### Doc-sync targets (line numbers as of this commit)

| Target | Line(s) | Why it goes false |
| --- | --- | --- |
| test-plan §5 gate table, LLM-as-judge row | 577 | says "local only … no CI, no schedule" |
| test-plan §5 prose, the deferral paragraph | 590-597 | "was deliberately deferred to a named follow-up" |
| test-plan §4 Stack, AI-native row | 552 | invocation + `checked:` date |
| test-plan §3 Phase 5 sequencing note | 535-537 | "the `workflow_dispatch` leg — remains open and untouched" |
| test-plan §6.6 C10X-31 does-NOT-prove, "No CI leg" | 1938-1941 | the whole bullet |
| test-plan §6.6 C10X-41 does-NOT-prove, "Nothing about CI" | 2140-2141 | same |
| test-plan §2 Risk #7 row | 401 | "still local and human-triggered" |
| test-plan §8 ledger, C10X-31 and C10X-41 entries | 3141-3149, 3310-3311 | the deferral is named as open |
| test-plan §6.6 + §8 | new entries | this change |
| README workflow inventory + secrets table | 167-194 | second dispatch-only workflow; new secret row |
| roadmap | new **H-10** | none exists; C10X-41 has none either (backfill precedent, test-plan §8) |
| jira-map C10X-42 | 84 | `Change ID` empty on both sides |

> **Wording trap across five of those targets:** every one says "human-triggered", and that stays
> **true** after this ships — `workflow_dispatch` *is* human-triggered. What changes is "local
> only" / "no CI". Edit the location claim, not the trigger claim; §8's "this coverage date does
> not refresh itself" sentences survive verbatim.

## Related Research

- `context/archive/2026-07-29-ai-candidate-generation-test-3/research.md` — Escape route C, the
  pre-derived design for this workflow
- `context/archive/2026-07-27-schema-drift-test/research.md` — the nine drift classes and the
  always-exit-0 CLI trap that produced the `lessons.md` rule reused here
- `context/archive/2026-08-01-local-stack-transport-flake/verification.md` — the precedent for
  replacing a written-down inference with a measurement, which §2's reporter finding repeats

## Open Questions

1. **`if: always()` or `if: failure()` on the upload?** The brief says "full result uploaded as an
   artifact"; the only precedent is `if: failure()`, justified by an argument ("a green run's file
   is zero bytes") that does not hold here. Recommendation is `always()`, but it is a deliberate
   deviation and should be written as one.
2. **Which capture strategy?** Only (c) — the eval writing the file itself — is symmetric on green
   and red. (a) captures more (including the `:181` judge reasons the console path misses) at the
   cost of also capturing reporter noise and suppressing the `::error` annotations. (b1) is
   disqualified by measurement; (b2) is green-blind by construction.
3. **Should the artifact requirement be narrowed to what was actually pre-registered?**
   `judge.ts:204-207` scopes it to the upstream HTTP excerpt at `:208`, not to the summary table.
   The brief widened it by analogy to a disclosure argument that §2 shows does not transfer.
4. **Is the false comment at `generation-quality.eval.ts:128-130` in scope?** It is one line in a
   file the brief does not touch (`.github/` only), but leaving it means the next reader concludes
   CI is already quiet. Correcting it in place is the repo's own habit.
5. **Environment with required reviewers, or a plain repository secret?** The former is the only
   mechanism that actually gates the spend; the latter matches every existing secret here. A
   `required: true` input is a speed bump only and `gh workflow run -f` walks past it.
6. **`retention-days`** — `schema-diff` uses 7; the public-repo maximum is 90. And **re-runs**: with
   v4+ immutability, a second attempt uploading the same artifact name **fails** unless
   `overwrite: true` or the name carries `github.run_attempt`. The eval's own calibration rule
   ("re-run a red case once before believing it") makes this reachable.
7. **`timeout-minutes` value and placement.** Worst case is ~22 minutes of test time; a step-level
   timeout is documented, a job-level one leaves the artifact upload on undocumented ground.
8. **A `workflow_dispatch` input for `EVAL_JUDGE_MODEL`?** It is the documented cross-examination
   lever and costs one input block — but no existing workflow here uses `inputs:` at all.
9. **Does the low-credit key exist yet?** The cap is verified as a real mechanism, but provisioning
   it (dashboard, or a Management key) is an operational step outside the repo, and nothing here
   can assert it happened. It belongs in the plan's ship-time checklist beside the dispatch.
10. **Everything dispatch-related is ship-time evidence.** The workflow is undispatchable until it
    is on `main`. Budget the Progress accordingly and repeat C10X-29's before/after
    `gh workflow list` check.
