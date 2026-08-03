# Follow-up: no gate in this project runs `tsc`

> Raised by **C10X-41** (`forced-language-prompt-fix`), Phase 5, and re-confirmed by its
> impl-review. **To be ticketed via `/jira-backlog-sync`** — no ticket is created by this
> change, deliberately.

> **DISCHARGED 2026-08-03 by C10X-43 (`typecheck-gate`, roadmap H-11).** This charter is left
> standing verbatim — including its title, which was accurate the day it was written and is the
> reason the ticket exists. It was ticketed as predicted, and every item under "What the ticket
> should cover" was taken:
>
> - **A `typecheck` script and a CI step** — `npm run typecheck`, and one fail-closed step in the
>   `ci` job between `astro sync` and `lint`. The script is a **wrapper**, not `tsc --noEmit`
>   alone, and it is `astro check` preceded by `tsc`: `tsc` type-checks **zero** `.astro` files,
>   and this project keeps its SSR loaders, its `?error=` reads and its `visibleConfigStatuses`
>   call in `.astro` frontmatter. It also does not trust either checker's exit code — `astro check`
>   exits **0** with its own tooling missing and is blind to a malformed `tsconfig.json`, so the
>   wrapper asserts on the `Result (N files):` line and runs `tsc` first.
> - **Blast radius decided before wiring** — and the charter's central fear did not materialise:
>   `scripts/` passes as-is despite being AGENTS.md's documented exception to the import rules, so
>   nothing had to be weakened on day one. `context` was added to `tsconfig.json`'s `exclude` so
>   the local gate and CI agree on scope by construction.
> - **Sequenced against `npx astro sync`** — and more tightly than this charter asked: the wrapper
>   syncs itself, because the tsc-first short-circuit would otherwise skip the only self-syncing
>   leg and answer 13 errors naming files nobody touched.
> - **`noUncheckedIndexedAccess` scoped deliberately, and taken IN** — 33 diagnostics across 13
>   files, swept in one commit. Zero were latent defects; the argument is exactly the one this
>   charter makes, and it was reproduced as a pair rather than asserted.
>
> One thing this charter got right that is easy to lose: the closing "What it is NOT" holds
> unchanged. The eval's isolation from `npm test` is byte-identical, and it is now both outside the
> test run and type-checked. And one boundary the charter could not have known to state: the gate
> proves `evals/` **compiles**, never that it RAN, and it cannot see a collection-time error at all.

## Why this exists

C10X-41 did not find this by reasoning about the gate set; it tripped over it. Phase 3
renamed `GenerateArgs.language` to `targetLanguage`. The eval kept passing `language:` for
**two full phases**, on a branch whose every gate was green, and nothing said so.

Measured rather than argued — reverting the five files to Phase 4's end state (`b015662`):

```
$ npx tsc --noEmit
evals/generation-quality.eval.ts(96,9): error TS2353: Object literal may only specify known
properties, and 'language' does not exist in type 'GenerateArgs'.        [exit 2]
```

Exactly one error, and no gate in the project can see it:

| Gate | Why it is blind |
| --- | --- |
| `npm run lint` | ESLint with type-aware **rules**, which is not the same thing as `tsc` diagnostics |
| `npm run build` | `astro build` does not run `astro check` |
| `npm test` | never collects `evals/**` — the deliberate isolation C10X-31 built |

Confirmed again during the impl-review: `package.json` has no typecheck script (`dev`,
`build`, `preview`, `astro`, `lint`, `lint:fix`, `format`, `test`, `test:watch`, `eval`,
`db:start`, `db:stop`, `db:reset`, `db:types`) and `.github/workflows/` contains neither
`tsc` nor `astro check`.

## Why it matters more than "a type error slipped through"

The uncompilable file was **the acceptance instrument for test-plan Risk #7** — the only
thing in this project that can see a wrong-language generation at all, since the response
contract stays intact and no deterministic layer goes red. So the branch could read fully
green while the one instrument that could contradict it was unable to run. The only thing
that surfaces this class today is a human running `npm run eval`, which is local and
human-triggered by design (test-plan §5).

`evals/` is the sharpest case but not the only exposed surface: `tests/` and `scripts/` are
likewise type-checked by nothing that gates.

## What the ticket should cover

- A `typecheck` script (`tsc --noEmit`) and a CI step that runs it.
- **Decide the blast radius before wiring it.** `tsconfig.json` has `include: ["**/*"]`, so
  the check covers `src/`, `tests/`, `evals/` and `scripts/` at once. `scripts/` is the
  documented exception to this repo's import rules (AGENTS.md: bare
  `node --experimental-strip-types`, no `@/*` alias, no `astro:env/server`), so confirm it
  passes rather than assuming it — this is a gate change, and a gate that has to be
  weakened on day one is worse than none.
- Sequence it against `npx astro sync`: the generated types must exist first, exactly as
  `lint` already requires.
- Consider `noUncheckedIndexedAccess`. It is **off** today (`astro/tsconfigs/strict` does
  not enable it — verified via `npx tsc --showConfig`), and its absence is what let a
  missing fixture entry type as `string` while being `undefined` at runtime — the defect
  the impl-review's F3 had to guard against by hand in `evals/generation-quality.eval.ts`.
  Enabling it is a separate, larger job with its own diff; scope it deliberately, in or out.

## What it is NOT

Not a fix for the eval's own isolation, which is correct and load-bearing (`npm test` must
keep collecting zero eval files — test-plan §6.6, C10X-31 entry). The eval should stay out
of the test run **and** be type-checked; those are not in tension.

## Pointers

- The measurement, with its verified per-file MD5 restore:
  `context/changes/forced-language-prompt-fix/verification.md`, "A finding, measured rather
  than noticed"
- Named as an open gap in the does-NOT-prove list: `context/foundation/test-plan.md` §6.6,
  C10X-41 entry, and the dated §8 ledger line
- The gate set this would join: `context/foundation/test-plan.md` §5
- `scripts/` exception that must be checked before widening: `AGENTS.md`, "Hard Rules"
