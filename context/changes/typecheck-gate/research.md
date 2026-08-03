---
date: 2026-08-02T22:00:12+02:00
researcher: lirdaw
git_commit: 9fb37bba1db9a6e4762533dc09c4c257d3034c45
branch: main
repository: My10xCards_v2
topic: "Typecheck gate — `tsc --noEmit` / `astro check` as an npm script and a CI step (C10X-43)"
tags: [research, codebase, ci, gates, typescript, astro-check, husky, tooling]
status: complete
last_updated: 2026-08-02
last_updated_by: lirdaw
---

# Research: Typecheck gate (C10X-43)

**Date**: 2026-08-02T22:00:12+02:00
**Researcher**: lirdaw
**Git Commit**: `9fb37bba1db9a6e4762533dc09c4c257d3034c45`
**Branch**: `main`
**Repository**: My10xCards_v2 (`github.com/lirdaw/10xcards`)

## Research Question

Add a type gate to this project — an npm script plus a CI step — so a type error can no
longer hide behind a fully green `lint` + `build` + `test`. Decide the blast radius before
wiring it; confirm `scripts/` passes rather than assuming; sequence it against
`npx astro sync`; and decide deliberately, in or out, on `noUncheckedIndexedAccess`.

Charter: `context/archive/2026-07-31-forced-language-prompt-fix/follow-ups/typecheck-gate.md`.

## Summary

**The gate can be wired green today, and that is the first thing worth knowing** — the
follow-up's central fear ("a gate that has to be weakened on day one is worse than none")
does not materialise. Both candidates exit **0** on the current tree. A standing blocker
addressed directly at this change — _"`astro check` cannot be added as a CI gate until
those three are fixed"_
(`context/archive/2026-07-25-candidate-review/reviews/impl-review.md:38-42`) — is measured
**false**: those three pre-existing errors are gone.

**Scope decision taken during this research: the gate is `astro check`, not `tsc --noEmit`.**
That is a deliberate widening of the charter's ask and must be recorded as such, not left to
be inferred. It rests on a measurement rather than a preference: `tsc` type-checks **zero**
`.astro` files, and this project keeps its SSR loaders, its `?error=` reads and its
`visibleConfigStatuses` call in `.astro` frontmatter. `astro check` is a genuine superset —
**130 files = tsc's 112 root files + the 18 `.astro` templates**, at identical strictness,
resolved from the same `tsconfig.json`.

**The gate is falsifiable.** It goes red — exit **1** — in every class that matters,
including the exact historical defect this ticket is named after: reproducing
`generateCandidates({ language: … })` against `GenerateArgs` yields
`error ts(2353)` and exit 1. The instrument that sat uncompilable behind two green phases
would have been caught.

**But it has two false-green modes, and one is severe.** `astro check` exits **0** when its
own tooling is missing (proven with a positive control: the same broken file, exit 1 with
the package present, exit **0** with it hidden, `[ERROR]` printed either way), and it is
**blind to a malformed `tsconfig.json`** (a typo'd `strct: true` silently disables strict
mode; `tsc` exits 2, `astro check` reports `0 errors`). Both are verbatim the class
`lessons.md` records as _"bramka, która nie potrafi zaświecić na czerwono, jest gorsza niż
jej brak"_. **Neither is a reason to reject the gate — both are reasons the wiring must
carry an assertion on the `Result (N files):` line rather than trusting the exit code
alone.** This is the single most important finding in this document.

Three further conclusions, each measured: the step belongs **between `astro sync` and
`lint`** and must be **fail-closed** (no `continue-on-error`); `eval.yml` should **not** get
its own step, only a corrected parenthetical; and the local hook is broken for a precise,
fixable reason (**no `prepare` script**) whose repair carries an unbudgeted second-order
risk (`prettier --write` on three dirty foundation docs).

`noUncheckedIndexedAccess` is quantified and recommended **for a separate ticket**: 33
errors, **zero** real latent defects — but a reproduction proves it would have caught
C10X-41's F3 statically, which is the whole argument.

---

## Detailed Findings

### 1. Baseline — both candidates are green, and one blocker is retired

All measurements on `main` @ `9fb37bb`, clean tree, this machine.

| Command            | Exit  | Scope                                            | Wall clock         |
| ------------------ | ----- | ------------------------------------------------ | ------------------ |
| `npx tsc --noEmit` | **0** | 112 root input files, **0 × `.astro`**           | ~2.65 s            |
| `npx astro check`  | **0** | **130 files**, `0 errors / 0 warnings / 4 hints` | 8.0–8.6 s (5 runs) |
| `npm run lint`     | 0     | —                                                | ~12.3 s            |
| `npx astro sync`   | 0     | —                                                | ~2.9 s             |

**`scripts/` passes** — the charter's explicit "confirm rather than assume" item is
resolved. All 4 files are in the program and both commands are green over them, despite
`scripts/` being AGENTS.md's documented exception to the import rules (`AGENTS.md:11`). No
weakening is needed on day one.

**Retired blocker.** `context/archive/2026-07-25-candidate-review/reviews/impl-review.md:38-42`
recorded three pre-existing `astro check` errors in `vitest.config.ts`,
`tests/fixtures/endpoint.ts` and `tests/fixtures/session.ts`, and left an instruction for a
future phase: _"`astro check` cannot be added as a CI gate until those three are fixed."_
Measured today: **0 errors**. That instruction is addressed to this change and is now
satisfied — it should get a dated correction line in the archive rather than a rewrite.

#### The file counts reconcile exactly — and 18 is the right number, not 19

Three different numbers circulate for the same tree and all three are correct because they
measure different things. Stating this precisely matters, because this repo has recorded a
count going stale four separate times:

- **112** — root input files, from `tsc --showConfig` (the `files` array after glob expansion).
- **115** — files in the tsc _program_, from `--listFilesOnly`: the 112 roots plus 3
  transitively-pulled `.d.ts` (`.astro/content.d.ts`, `.astro/env.d.ts`, the Cloudflare
  integration shim). Those 3 are not type-checked by either tool — `astro/tsconfigs/base`
  sets `skipLibCheck: true`.
- **130** — `astro check` = 112 roots + **18** `.astro` files.

`git ls-files "*.astro"` returns **18**. A `find`-based count returns 19 because it matches
the generated directory `./.astro`, whose _name_ ends in `.astro`. The arithmetic
corroborates: 130 − 112 = 18.

### 2. `astro check` is a genuine superset — same tsconfig, same strictness

Confirmed from source, not inferred.
`node_modules/@astrojs/language-server/dist/check.js:153-165` (`getTsconfig()`) calls
`ts.findConfigFile(workspacePath, …)` with no override, resolving this repo's own
`tsconfig.json` — the same file `tsc` uses, extending `astro/tsconfigs/strict`. And
`@volar/kit/lib/createChecker.js:125-129` routes `check(fileName)` through the full TS
language service, so `.ts`/`.tsx` diagnostics are ordinary TS semantic diagnostics, not a
reduced `.astro`-only pass.

Empirically corroborated: a `.tsx` probe produced `ts(18047): 'value' is possibly 'null'`,
i.e. `strictNullChecks` is live.

**Resolved version is `0.9.9`, not `0.9.8`.** `package.json:14` declares `^0.9.8`;
`package-lock.json:59-62` pins **0.9.9**, and `node_modules/@astrojs/check/package.json`
confirms it. `@astrojs/language-server` is `2.16.8`. Every measurement here is against those.
**No new dependency is needed** — `@astrojs/check` and `typescript@5.9.3` are both already
installed.

### 3. Falsifiability — red in every class, including the historical defect

`lessons.md:194-199` demands the exit code be measured **in both directions**, on the
lockfile-pinned version, with a **positive control**. Both halves are now measured. Every
probe was deleted immediately and the tree verified clean afterwards.

| Class                             | Probe                                    | Exit  | Verbatim diagnostic                                                                                                       |
| --------------------------------- | ---------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| plain `.ts` under `src/`          | `src/lib/__typecheck_probe_a.ts`         | **1** | `error ts(2322): Type 'string' is not assignable to type 'number'.`                                                       |
| **`.astro` frontmatter**          | `src/pages/__typecheck_probe_b.astro`    | **1** | `error ts(2322)` at `:2:7`                                                                                                |
| **`.astro` template props**       | `src/pages/__typecheck_probe_h.astro`    | **1** | `error ts(2322)` on `<ServerError message={42} />`                                                                        |
| `evals/`                          | `evals/__typecheck_probe_c.ts`           | **1** | `error ts(2322)`                                                                                                          |
| `.tsx` strictness                 | `src/components/__typecheck_probe_g.tsx` | **1** | `error ts(18047): 'value' is possibly 'null'.`                                                                            |
| **the historical C10X-41 defect** | `evals/__typecheck_probe_d.ts`           | **1** | `error ts(2353): Object literal may only specify known properties, and 'language' does not exist in type 'GenerateArgs'.` |

The last row is the acceptance evidence for the whole ticket: the defect that sat behind two
fully green phases is caught by this gate. The two `.astro` rows are the evidence for the
scope widening — `tsc` cannot see either.

Red runs cost the same as green runs (~8.1–8.4 s), so a failing CI step is not slower.

### 4. 🔴 Two false-green modes — the finding that shapes the wiring

#### FM-1 (severe, proven with a positive control): missing tooling exits 0

Same broken file present in both runs; only the package differs.

```
control:  broken file, @astrojs/check installed, CI=true   → EXIT 1, "- 1 error"
variant:  broken file, @astrojs/check hidden,    CI=true   → EXIT 0
          "To continue, Astro requires the following dependency to be installed:
           @astrojs/check. Packages cannot be installed automatically in CI environments."
          "[ERROR] [check] The `@astrojs/check` and `typescript` packages are required…"
```

Mechanism, traced through source: `astro/dist/cli/install-package.js:22-25` returns
`undefined` when `ci.isCI`; `astro/dist/cli/check/index.js:22-27` logs and `return`s
`undefined`; `astro/dist/cli/index.js:224` then evaluates
`process.exit(typeof checkServer === "boolean" && checkServer ? 1 : 0)` → **0**.

It prints `[ERROR]` and passes. This is verbatim the `lessons.md:194-199` class.

Today both packages are installed by `npm ci`. It breaks the day someone runs
`npm ci --omit=dev` (removes `typescript`), prunes dev dependencies before the check step, or
hits a resolution failure — i.e. exactly the kind of change nobody would think to re-verify
the gate after.

**Two mitigations, both tested:**

- **Assert the output** contains a `Result (N files):` line with N in the expected range. A
  run that checked nothing cannot produce it. Cheapest, keeps `astro check`'s self-sync.
- **`npx astro-check`** (the package's own bin) **fails closed**: clean → 0, broken → 1,
  package hidden → **1** with `Cannot find module`. But it **does not sync**: with `.astro/`
  absent it reported `17 errors` / `Result (129 files)` / exit 1 — spurious. It would depend
  on `npx astro sync` running first.

#### FM-2 (proven): a malformed `tsconfig.json` is invisible

```
tsc   -p tsconfig.__probe_cfg2.json --noEmit  → EXIT 2
      error TS5025: Unknown compiler option 'strctNullChecks'. Did you mean 'strictNullChecks'?
astro check --tsconfig ./tsconfig.__probe_cfg2.json → EXIT 0, "Result (130 files): 0 errors"
```

A second probe with `"strict": "yes-please"` had `tsc` reporting `TS5023` **and** `TS5024`
while `astro check` emitted **zero** `ts(5xxx)` codes. Cause:
`@volar/kit/lib/createChecker.js:15-17` keeps only `options`/`fileNames` from the parsed
command line and **drops the `errors` array**.

Concretely: someone typos `"strct": true`, strict mode silently switches off, and the gate
reports `0 errors` over a whole project it is now checking loosely. The gate stays green
while the strictness it exists to enforce is gone.

Also noted: `check.js:139` sets `includeProjectReference = false` (upstream issue #920).
Moot today — `tsconfig.json` declares no `references` — but it would become a silent gap if
any were added.

#### FM-3 / FM-4 / FM-5 (operational)

- Never pass `--minimumFailingSeverity hint` — it turns the gate **red today** (4
  pre-existing hints).
- Never `--watch` in CI: `dist/index.js` returns `undefined` in watch mode and
  `cli/index.js:220-221` awaits a promise that never resolves.
- `allowJs: true` plus `include: ["**/*"]` means `eslint.config.js` and `astro.config.mjs`
  are **inside the checked set**. A `typescript-eslint` major can turn the gate red with no
  source change. That is a true positive, not a false one — but it couples CI to
  devDependency typings and should be budgeted for.

### 5. Severity semantics — safe at the default, and the label lies

`node_modules/@astrojs/check/dist/options.js:13-17`, confirmed against `--help`:

```
--minimumFailingSeverity   [choices: error, warning, hint]  [default: error]
--minimumSeverity          [choices: error, warning, hint]  [default: hint]
```

`minimumSeverity` is **display-only**; `minimumFailingSeverity` decides the exit code.

The 4 pre-existing diagnostics are `ts(6387)` tseslint deprecation notices at
`eslint.config.js:14,40,62,71`. **They print with a yellow `warning` label but are tallied
as hints** — disambiguated by measurement, not by reading the label:

| Flag                               | Exit  |
| ---------------------------------- | ----- |
| default (`error`)                  | 0     |
| `--minimumFailingSeverity warning` | 0     |
| `--minimumFailingSeverity hint`    | **1** |

Had they been severity `Warning`, the middle row would have failed. So: **at the default, only
`errors > 0` fails the gate** — correct for a gate.

Worth considering: `--minimumSeverity warning` makes a green CI log actually empty. Otherwise
every run prints 4 permanent hints, and a reader who learns to skim 4 lines is a reader who
will skim the fifth.

### 6. CI portability — clean

- **`.env` is gitignored** (`git check-ignore -v .env` → `.gitignore:29`), so a runner has
  none. Measured with `.env` renamed away: exit 0, `130 files`, identical output minus the
  informational `Using secrets defined in .env` line. `.env` restored and verified by hash
  (`d9ddbf2e05c76862c41808617bfcbaa5` before and after).
- **And it still goes RED with no `.env`** — the test that actually matters: a probe produced
  `ts(2322)` naming `SupabaseClient<Database, …>`, i.e. it resolved the `@/` alias,
  `src/lib/supabase.ts` and the generated `Database` type with no environment at all. This
  works because `astro.config.mjs:16-23` marks all four `envField` entries `optional: true`.
- **No database.** It never opens a connection; the local stack happened to be running during
  measurement, so this is argued from the code path plus the no-`.env` run rather than proved
  by absence. The stack dependency in this repo lives in `tests/setup/preflight.ts`, a Vitest
  `globalSetup` that `astro check` never loads.
- **No network.** With every proxy poisoned to a dead port: exit 0, 8.2 s.
  `astro/dist/cli/install-package.js:9-13` does a local `require.resolve` and returns; the
  registry `fetch` only executes on the install path, unreachable when the package is present.
- **It self-syncs.** `astro/dist/cli/check/index.js:27-30` runs `sync()` unless `--noSync`.
  Proved by removing `.astro/` entirely: exit 0, `130 files`, directory regenerated.
- **Stable timing**: 8204 / 8605 / 8244 / 8339 / ~8300 ms across five warm runs, of which
  ~1.0 s is the types sync. No Docker, no DB, no network — nothing here is flaky.

### 7. Where the step goes in `ci.yml`

**Recommended: between `npx astro sync` (`ci.yml:22`) and `npm run lint` (`ci.yml:23`).**

```
21  - run: npm ci
22  - run: npx astro sync
23+ - run: npm run typecheck        ← here
24  - run: npm run lint
29  - run: npm run build
35  - name: Start local Supabase stack     (~1m46s, per ci.yml:74)
92  - run: npm test
```

Justification, all from measurement:

- **Only `npm ci` must precede it.** No stack, no Docker, no credential, no `.env`.
- **Before `lint`, and this is the counter-intuitive part**: typecheck (8.4 s) is _cheaper_
  than lint (12.3 s), and type-aware ESLint rules degrade confusingly when types are broken —
  a type error surfacing as a lint error is a worse signal than the reverse.
- **Before `build`**, because `astro build` provably does not type-check — the exact premise
  C10X-41 measured and `src/lib/flashcards.ts:30` states.
- **Far before `supabase start`**, so a type error fails at ~T+15 s instead of ~T+2 min.

**Keep `npx astro sync` as its own step even though `astro check` syncs.** Mechanically it
could be dropped — `astro check` emits the identical `[types] Generated` line — but four
reasons say no: a broken `astro.config.mjs` should read as "sync failed", not "typecheck
failed"; `AGENTS.md:9`'s ordering rule is about **`lint`**, whose `projectService: true`
(`eslint.config.js:17-20`) depends on `.astro/types.d.ts` (`tsconfig.json:3`) — that contract
must not become a side effect of a different step; if `typecheck` ever gained a conditional,
lint would silently lose its types; and the cost is ~1 s.

**`deploy` should not typecheck.** It declares `needs: [ci, drift]` with no `always()` escape
(`ci.yml:126-128`) and runs on the same commit. Its `npm ci` + `astro sync` + `build` are
**artifact-production** steps — `wrangler deploy` needs `dist/` — not gates. A typecheck
produces no artifact. The repo states the principle itself at `ci.yml:119-121`: _"which is
what keeps this job at seconds rather than minutes on the path between merge and deploy.
Keep it that way."_

**`paths-ignore` has no consequence today** — zero `.ts`/`.tsx`/`.astro` files exist under
`context/`. But there is a cheap forward-looking hole worth closing while here:
`tsconfig.json:3` is `include: ["**/*"]`, so a scratch `.ts` dropped into a change folder
would be type-checked locally while a `context/`-only commit **never triggers CI at all**.
Adding `"context"` to `exclude` costs nothing today and makes the local and CI gates agree on
their scope by construction.

### 8. Fail-closed, no `continue-on-error`

This is the drift-gate side of the asymmetry `ci.yml:54-64` names, not the Kong side. That
comment's own test clause, applied item by item, inverts on every one:

| Kong step's reason to be advisory                              | Typecheck step                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| "an unsupported `docker` operation" breakable by a CLI upgrade | first-party `tsc` / `@astrojs/check`; no Docker, network or credential — **no flake mode** |
| CI "structurally immune" to what it fixes                      | CI is exactly where this defect hid — a real `TS2353` behind two green phases              |
| "its own justification is cosmetic" (local parity)             | evidence about code that ships to production                                               |
| a red is "ADVISORY … never evidence about the code"            | a red **is** evidence about the code                                                       |

And the decisive one: `continue-on-error` makes a step's `conclusion` report `success` on
failure (the pre-tolerance value lives in `outcome`, which the run API does not return
alongside it — measured at C10X-39's ship time). A tolerated typecheck would be
indistinguishable from not having one while reading as coverage in `test-plan.md §5`. That is
the failure mode this project has documented four separate times.

Corollary to state in the step's comment: unlike the Kong step, **a green `ci` job does imply
this step passed.**

### 9. `eval.yml` — fix the parenthetical, do not add a step

`grep -rn "C10X-43" .github/` returns exactly one line:

```
.github/workflows/eval.yml:217:  echo "  2. a collection-time error (evals/ sits under no type gate — C10X-43)"
```

It is the only falsified claim in this repo that **ships as executable output**, printed into
a job log at runtime.

**Do not delete cause #2.** A collection-time error stays fully live — an import throw, a
top-level side effect, a bad `vi.mock` path — none of which any type gate sees. Only the
parenthetical becomes false.

**Do not add a typecheck step to `eval.yml`.** The case for is real (it spends money in CI,
and the file already contains the identical placement argument at `eval.yml:94-97` for the key
guard: _"The guard's whole value is placement"_). But the case against wins: `eval.yml:10-15`
defends, across four documents, **what a red in that file means** — _"Read a red run here as a
FINDING, not as a hygiene failure."_ A typecheck red is precisely a hygiene failure.
Introducing a categorically different red either weakens that header or forces a caveat into
it. Meanwhile `ci.yml` already covers `evals/` on every push and PR to `main`, so the only
residue is a dispatch from a feature branch — the exploratory use the workflow exists for,
where a ~$0.013 wasted run is the accepted cost. Insuring $0.013 is not worth muddying that
paragraph.

### 10. The local hook — root cause, and a second-order risk nobody budgeted

**Measured state.** `.husky/pre-commit` exists (content: `npx lint-staged`) and **is tracked**
(`git ls-files -s` → blob `2312dc5`). But `.husky/_/` does not exist, `core.hooksPath` is
**unset in every scope**, and `.git/hooks/` holds only 14 `*.sample` files. husky `9.1.7` is
installed.

**Root cause: `package.json` has no `prepare` script.** husky v9 installs itself only from
`prepare`; with none, nothing ever ran `husky`, so `core.hooksPath` was never set and
`.husky/_/` was never created. This state survives every `npm ci` indefinitely — it is a
missing wire, not a stale install.

**Fix, read from the installed source rather than memory.** `node_modules/husky/bin.js:14`
sets `(o.scripts ||= {}).prepare = 'husky'` — the v9 idiom is the bare word **`husky`**;
`bin.js:24` prints `husky - install command is DEPRECATED` for the v8 spelling. Then run it
once in this tree; nothing retroactively fixes an existing checkout.
**CI-safe with no `|| true`**: `index.js:11` _returns a string_ when `.git` is absent rather
than throwing, and `bin.js:26` only writes it to stdout — exit code is always 0.

**The `.gitignore` claim in `test-plan.md §8` is wrong as stated.** It says _"husky's
installed half is gitignored"_. Measured: `grep -i husky .gitignore` → **no match**, and
`git check-ignore -q` returns exit 1 (not ignored) for all five of `.husky`,
`.husky/pre-commit`, `.husky/_`, `.husky/_/h`, `.husky/_/pre-commit`. The ignoring is done by
a file **husky itself writes** (`index.js:20` creates `.husky/_/.gitignore` containing `*`).
And the real reason the setup does not travel is `core.hooksPath` — **per-repository git
config, which `git worktree add` never copies and which gitignore does not touch at all.** The
conclusion (it does not survive) is right; the mechanism is not, and the doc's version sends a
reader grepping for something that is not there.

#### The lint-staged trap — documented in lint-staged's own README

`node_modules/lint-staged/README.md:1077-1092` carries this FAQ verbatim: _"How can I resolve
TypeScript (`tsc`) ignoring `tsconfig.json` when `lint-staged` runs via Husky hooks?"_ — root
cause: _"lint-staged automatically passes matched staged files as arguments"_, and certain
inputs make TypeScript discard `tsconfig.json` (`TS17004`, `TS1056`).

In **this** repo that would mean: every `@/…` import unresolved (AGENTS.md mandates them),
every `.tsx` a JSX error, `astro:env/server` unresolvable — **a false red on nearly every
commit**, the worst possible first day for a new gate.

**`astro check` fails differently and worse, because it fails silently.** Its CLI accepts no
positional file arguments (`--root`, `-w`, `--tsconfig`, the two severity flags,
`--preserveWatchOutput`), so given file paths it discards them and **checks the whole project
anyway** — and since lint-staged chunks long file lists, a large commit runs the full 8.4 s
check **once per chunk**. The glob becomes a lie without ever going red.

The documented workaround (a _function_ value in the config, which gets no arguments appended)
is **unavailable here**: this repo's lint-staged config lives in `package.json:73-80`, which
is JSON and cannot hold a function. Using it requires first extracting the config to
`lint-staged.config.js` — a second change with its own blast radius.

**Correct pattern: put the project-wide check in the HOOK, not in lint-staged.** The hook runs
under `sh -e` with `node_modules/.bin` on PATH (`node_modules/husky/husky:16-17`), so:

```sh
npx lint-staged
npm run typecheck
```

**Order is load-bearing** — lint-staged's `eslint --fix` and `prettier --write` rewrite staged
files, so the project-wide check must come second or it checks pre-fix content.

#### Recommendation: `pre-push`, not `pre-commit`

8.0–8.6 s on **every commit** is a standing incentive to reach for `--no-verify`, which
`AGENTS.md` and the global `CLAUDE.md` **both** forbid absolutely. A hook that makes people
want to break a rule they are forbidden to break is a bad hook. `pre-push` runs once per push,
alongside an already-multi-second network operation. Same v9 mechanics — `pre-push` is one of
the 14 shimmed hook names.

If pre-commit is insisted on, `tsc --noEmit` (**2.65 s**) is the affordable option there — but
it trades away all 18 `.astro` files, i.e. most of the reason `astro check` was chosen.

#### 🟡 The second-order risk: enabling hooks starts rewriting docs

Turning the hook on makes `prettier --write` run on `*.{json,css,md}` **for the first time in
this tree**. Measured at HEAD:

```
[warn] context/foundation/roadmap.md
[warn] context/foundation/prd.md
[warn] context/foundation/lessons.md
exit=1
```

`test-plan.md` is clean (C10X-42 normalised it) but **`roadmap.md` is dirty again despite
that change formatting it**, and `prd.md` / `lessons.md` were never normalised. This matters
more than usual because `test-plan.md §8` records that `npx prettier --write` was
**destructive and non-idempotent** on `test-plan.md` — it collapsed a blockquote-embedded code
span into one unreadable line. That landmine was disarmed for one file only.

**Normalise those three in a separate, reviewed commit before enabling the hook.** Do not let
the first enabled hook run be the thing that discovers a second landmine.

### 11. `noUncheckedIndexedAccess` — quantified; recommended for a separate ticket

`npx tsc --noEmit --noUncheckedIndexedAccess` → exit **2**, **33 errors**: 22 `tests/`, 7
`src/`, 3 `scripts/`, 1 `evals/`. Codes: 16× TS2532, 7× TS18048, 5× TS2322, 4× TS2345, 1× TS2769.

**Classified individually: 0 real latent defects.** 22 are provably-safe indexes TypeScript
cannot narrow (guarded by a `.length` test, a preceding `if (!match) throw`, a bounds check on
the same `if`), 11 are tests indexing a fixture they just built. **On the strength of this
list alone the answer would be "not worth it."**

**The argument is C10X-41's F3, and it is reproduced rather than asserted.** The pre-fix code
was recovered from `ec0959f` — five sites assigning `PROMPT_LANGUAGE_NAMES[code]` into
non-optional `string` fields — and compiled both ways:

| Flags                                     | Result                 |
| ----------------------------------------- | ---------------------- |
| `--strict` (today's effective strictness) | **exit 0, 0 errors**   |
| `--strict --noUncheckedIndexedAccess`     | **exit 2, 5 × TS2322** |

It catches the dotted form (`PROMPT_LANGUAGE_NAMES.fr`) too, which is not obvious and was
checked rather than assumed. The compound point: the hand-written guard that replaced F3 is
recorded by its own impl-review as _"not proved falsifiable by execution"_ — it fires during
collection behind the eval's inverse preflight, so exercising it needs a paid provider run.
nUIA would have caught it statically and for free.

The class is live in production too: `src/lib/auth-errors.ts:259-265` does the identical
`Record<string, string>` lookup on **upstream-controlled** input and is safe only because a
human hardened it by hand after an earlier review finding. This repo has now paid for this
guarantee twice in reviewer attention.

**Two constraints shape every fix.** `@typescript-eslint/no-non-null-assertion` is **error**,
so `!` is unavailable — every fix must be `?.` / `??` / an explicit guard (zero `!` exist in
the repo today). And `no-unnecessary-condition` is **error**, which is why
`src/components/study/StudySession.tsx:170-172` carries a comment explaining it _cannot_ write
an honest `if (!card)` guard while nUIA is off. **Enabling the flag deletes a workaround
rather than adding one.**

Estimated diff: **14 files, ~50 lines, ~48 of them purely type-level**; three edits are
behaviour-adjacent and deserve real review (StudySession's new early return,
`generations.ts:82`'s `data.length === 0` → `!data[0]`, `judge.ts:166`'s retry condition).

**`astro check` honours nUIA identically** — verified non-destructively via
`astro check --tsconfig` against an untracked probe config: 33 errors both ways, same files,
same codes. One setting governs both tools.

**Recommendation: separate ticket, gate first.** Landing the gate on a **0-error baseline**
makes its own claim provable without entangling it with a 33-item sweep; bundling makes the
gate-introduction PR ~90% mechanical noise. This project's `test-plan.md` records the
"incomplete sweep left unstated" pattern three separate times (C10X-30 → C10X-34 → C10X-37).

### 12. Doc-sync — 28 locations, 11 live / 17 historical

Produced by enumeration. The **list** is the contract; the count is fragile.

**LIVE — must be edited (11):**

| Location                                  | Claim                                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context/foundation/test-plan.md:642`     | §5 gate table row 1: `lint + typecheck \| local (husky pre-commit via lint-staged) + CI \| required — wired today`. **Already false today in both halves** — this change makes it true.         |
| `context/foundation/test-plan.md:459`     | §2 Risk #7: _"`tsc` is in no gate…"_. Append a **fourth dated half**, per C10X-42's own idiom.                                                                                                  |
| `context/foundation/test-plan.md:652-686` | §5 prose — each gate earns a paragraph; this one needs its fail-closed statement.                                                                                                               |
| `README.md:49`                            | Available Scripts — add `typecheck`; _"type-checked rules"_ is the exact confusion the charter names.                                                                                           |
| `README.md:169-178`                       | `## CI` job inventory.                                                                                                                                                                          |
| `AGENTS.md:22`                            | Commands.                                                                                                                                                                                       |
| `AGENTS.md:9`                             | The `astro sync` ordering rule now binds this step too.                                                                                                                                         |
| `.github/workflows/eval.yml:217`          | The only falsified claim that **ships as executable output**.                                                                                                                                   |
| `src/lib/flashcards.ts:30`                | Production comment: _"no script runs `astro check`"_ — load-bearing design rationale for two optional fields.                                                                                   |
| `tests/review/candidates.test.ts:855`     | _"with no type gate to catch the difference."_                                                                                                                                                  |
| `context/foundation/jira-map.md:86`       | Empty `Change ID` **and** a stale source path (points at `context/changes/…` for an archived change). ⚠️ Owned by the Jira skills — `jira-map.md:3-4` says do not hand-edit. Flag, do not edit. |

**HISTORICAL — dated correction line, never rewritten (17):** `test-plan.md` §6.6's C10X-41
and C10X-42 entries and four §8 ledger lines; the charter file itself; C10X-41's
`verification.md` and `reviews/impl-review.md`; **`2026-07-25-candidate-review/reviews/impl-review.md:38-42`**
(the retired blocker — the highest-value correction in the archive); three more
`candidate-review` artifacts; `2026-07-27-schema-drift-test/research.md:212`; nine sites
across `2026-08-02-eval-ci-dispatch/`; and the earliest instance of the finding,
`2026-07-05-per-user-data-isolation/reviews/plan-review.md:64` (2026-07-05).

Mixed class — a present-tense sentence inside a dated block, taking a **dated supplement**
per the H-03 precedent: `context/foundation/roadmap.md:349`, and `jira-map.md:342-357`.

**Structural additions:**

- **`roadmap.md` has NO row for this change** — `## At a glance`, `## Slices` and `## Done`
  all end at H-10. The note at `:68-76` is explicit about the cost, and H-04, H-07 and H-08
  were all backfilled retroactively. **Create `H-11` before `/10x-archive` runs**, with
  `Status` left unset — `lessons.md:180` reserves the Status flip for archive.
- **`package.json:5-21`** — no `typecheck` script exists.

## Code References

- `tsconfig.json:2-3` — `extends: astro/tsconfigs/strict`, `include: [".astro/types.d.ts", "**/*"]`; the reason the gate covers `src/`, `tests/`, `evals/`, `scripts/` and the root configs at once
- `package.json:5-21` — the 15 existing scripts; no `typecheck`
- `package.json:14`, `package-lock.json:59-62` — `@astrojs/check` declared `^0.9.8`, **resolved 0.9.9**
- `package.json:73-80` — the `lint-staged` block, in JSON, which is why the documented function workaround is unavailable
- `.github/workflows/ci.yml:21-29` — `npm ci` → `astro sync` → `lint` → `build`; the insertion point is line 23
- `.github/workflows/ci.yml:54-64` — the advisory-vs-fail-closed discriminator this change must apply
- `.github/workflows/ci.yml:119-121` — why `deploy` stays minimal
- `.github/workflows/eval.yml:217` — the executable false claim
- `.github/workflows/eval.yml:10-15` — the "a red here is a FINDING" paragraph that argues against a typecheck step in that file
- `.github/workflows/eval.yml:94-97` — the placement-guard precedent
- `src/lib/flashcards.ts:25-31` — two fields optional _because_ nothing type-checks
- `src/components/study/StudySession.tsx:170-172` — the workaround comment nUIA would delete
- `src/lib/auth-errors.ts:259-265` — the hand-hardened `Record` lookup on upstream input
- `astro.config.mjs:16-23` — all four `envField` entries `optional: true`; why no `.env` is needed
- `eslint.config.js:14,40,62,71` — the 4 permanent `ts(6387)` hints
- `context/foundation/lessons.md:194-199` — the five demands this change must satisfy
- `node_modules/@astrojs/language-server/dist/check.js:153-165` — same-tsconfig resolution
- `node_modules/@volar/kit/lib/createChecker.js:15-17` — where tsconfig errors are dropped (FM-2)
- `node_modules/astro/dist/cli/index.js:224` — the `process.exit(… ? 1 : 0)` behind FM-1
- `node_modules/husky/bin.js:14`, `node_modules/husky/index.js:9-22`, `node_modules/husky/husky:16-17` — the v9 install idiom and hook execution contract
- `node_modules/lint-staged/README.md:1077-1096` — the `tsc`-ignores-tsconfig FAQ

## Architecture Insights

**A gate's trustworthiness is a separate claim from its correctness, and this repo already
knows it.** `lessons.md:194-199` was written from `supabase migration list` / `db diff`, both
of which always exit 0. `astro check` exits 0 in two situations nobody would predict — missing
tooling and a malformed tsconfig — which means the lesson generalises further than the entry
that records it: **the failure mode is not "this vendor's CLI is sloppy" but "an exit code is
a summary, and summaries lose information."** The mitigation is the same one the drift runner
already uses: assert on _content_, not on `$?`.

**Fail-closed vs advisory is a per-gate decision with a written justification, not a default.**
This repo ships one of each in the same job and states the discriminator inline
(`ci.yml:54-64`). Applying that written test — rather than inventing a new rationale — resolves
this change's version in four lines.

**Two claims, two homes.** §2's risk row is the _coverage_ claim; §6.6's entry is the
_mechanism_. The house rule is that they are written to be read together and must not drift —
and where they conflict, §2 is the coverage claim.

**Live claims are edited; dated entries take a correction line.** The count of "human-triggered"
survivals in C10X-42's doc-sync is the worked example: a word can stay true while the sentence
around it goes false, so mass replacement is the wrong tool.

**The command this ticket is about is already the de facto per-phase criterion in five recent
plans** (`deck-form-hardening/plan.md:275,321,392,600,699`;
`local-stack-transport-flake/plan.md:649`; `eval-ci-dispatch/plan.md:300`). The ticket moves it
from "the author remembered" to "CI enforces it" — which is the cleanest one-line framing of
its value.

## Historical Context (from prior changes)

- `context/archive/2026-07-31-forced-language-prompt-fix/follow-ups/typecheck-gate.md` — the
  charter. Its measurement (`b015662` → `TS2353`, exit 2) is the defect this gate is named for.
- `context/archive/2026-07-31-forced-language-prompt-fix/reviews/impl-review.md:137-162` — F3,
  which named nUIA's absence explicitly and worked around it by hand.
- **`context/archive/2026-07-25-candidate-review/reviews/impl-review.md:38-42`** — _"`astro
check` cannot be added as a CI gate until those three are fixed."_ Measured false today; the
  instruction is discharged.
- `context/archive/2026-07-05-per-user-data-isolation/reviews/plan-review.md:64` — the earliest
  instance of this finding, **2026-07-05**: nearly a month before the charter was written.
- `context/archive/2026-07-27-schema-drift-test/` — the gate-design precedent: fail-closed,
  `GATE UNAVAILABLE` vs a real finding, the rehearsal-as-a-pair with a positive control, and
  the rule that a gate carrying no test must say so rather than imply it.
- `context/archive/2026-08-02-eval-ci-dispatch/` — the immediately preceding change; nine sites
  record the `evals/`-has-no-type-gate boundary, and `jira-map.md` draws it as _"C10X-42 gives
  running-in-CI, C10X-43 gives compilability. Do not merge the two."_

## Related Research

- `context/archive/2026-08-02-eval-ci-dispatch/research.md` — the two `env:` conventions, and
  the analysis of what a red in `eval.yml` means
- `context/archive/2026-07-27-schema-drift-test/research.md` — the nine drift classes and the
  exit-code trap that produced the `lessons.md` entry this change must satisfy

## Open Questions

1. **How is FM-1 closed?** Assert the `Result (N files):` line, or switch to the `astro-check`
   bin (fails closed, but does not sync and so depends on `ci.yml:22`). A decision for the plan
   — but the gate must not ship without one of them.
2. **Is FM-2 accepted or mitigated?** A `tsc --noEmit` step would cover it, since `tsc` reports
   `TS5xxx` and `astro check` does not. That is an argument for running **both**, cheaply
   (2.65 s), which the scope question rejected on redundancy grounds — the redundancy turns out
   not to be total. Worth revisiting explicitly rather than by default.
3. **`--minimumSeverity warning`** to silence the 4 permanent hints — cosmetic, but it decides
   whether a green log is empty or teaches readers to skim.
4. **Add `"context"` to `tsconfig.json`'s `exclude`?** Zero cost today; closes the
   local-vs-CI scope asymmetry created by `paths-ignore`.
5. **Where does the local check run — `pre-push` (recommended) or `pre-commit`?** And is the
   prettier normalisation of `roadmap.md` / `prd.md` / `lessons.md` in this change or its own?
6. **nUIA in or out** — quantified above; recommendation is a separate ticket.
7. **`jira-map.md:86`'s empty `Change ID` and stale path** — owned by `/jira-backlog-sync` /
   `/jira-finish-work`, not by `/10x-implement`. Flag in the plan.
