## Komunikacja / Communication language

**Zawsze rozmawiaj ze mną po polsku.** Cała komunikacja, wyjaśnienia, pytania, podsumowania i komentarze do mnie mają być w języku polskim — bez wyjątków, niezależnie od języka, w którym napisana jest lekcja, skill czy plik.

Po angielsku zostają wyłącznie: kod, nazwy identyfikatorów (zmienne, funkcje, pliki), treść artefaktów generowanych przez skille (np. `shape-notes.md`, `prd.md` i ich nagłówki sekcji typu `## Open Questions`) oraz polecenia/komendy. Reszta — czyli to, co mówisz do mnie w czacie — po polsku.

Always communicate with me in Polish. Keep only code, identifiers, skill-generated artifacts, and commands in English.

Project conventions live in AGENTS.md:
@AGENTS.md

## Mutation testing

Repo uses Stryker for SELECTIVE mutation testing on risk-critical modules.
Run it only for code covered by the current change or a risk from test-plan.md,
prefer narrowed scope via the `mutate` list or `--mutate "path:start-end"`, and
do NOT chase 100% mutation score. Review survived mutants one by one: add an
assertion only when the mutant is a user-visible or business-relevant bug.
Keep OPENROUTER_API_KEY unset so generation falls back to mock cards.

## E2E — this repo

**Edit E2E rules HERE, never inside the block below.** That block sits between
`10x-cli` sentinel markers and is REGENERATED: the CLI strips everything between
BEGIN and END and re-appends a freshly generated copy at the end of this file, so
any edit made in there is destroyed on its next run. Content outside the markers
survives, which is why this section exists.

**Where a bullet here and the generic block below disagree, this section wins** —
each bullet records something this project measured, and three of the block's
rules are stale against the shipped harness.

- **The five anti-patterns map to six lint ERRORS**, scoped to `tests/e2e/**`
  in `eslint.config.js` (`playwrightConfig`): `no-wait-for-timeout`,
  `no-wait-for-selector`, `no-element-handle`, `prefer-locator`,
  `no-skipped-test`, `expect-expect`. Never `page.waitForTimeout()`. Wait for
  state: `toBeVisible()`, `waitForURL()`, `waitForResponse()`. `npm run lint`
  is a fail-closed `ci` step, so a violation cannot reach `main`.
- **Locators:** `getByRole` / `getByLabel` / `getByText`, with `exact: true` as
  the default — every accessible name matches as a case-insensitive SUBSTRING
  otherwise. `getByTestId` only once one of those resolves to 0 or >1 element
  (a strict-mode violation). Never CSS selectors, XPath, or DOM structure.
- **Cleanup is NOT a step in the test body.** Declare the row with the `registry`
  fixture from `tests/e2e/fixtures.ts` BEFORE creating it; the `teardown` project
  (`tests/e2e/teardown/cleanup.teardown.ts`) removes it whatever the outcome.
  Register the generation too — `generation_session` carries no deck FK and does
  not cascade. An inline cleanup on the last line of a spec orphans its rows
  permanently the first time anything above it fails.
- **One deck-name stem, one owning file** — `tests/lib/deck-name-stems.test.ts`
  enforces it. A `Date.now()` suffix separates cases inside one file, never two
  files from each other. The layer runs `workers: 1` (`playwright.config.ts`), so
  there are no parallel runs to isolate against.
- **The e2e account is SHARED and carries state between runs**, so no spec may
  assume an empty starting deck list; scope every count to rows the spec created.

The measured traps a spec author meets — `Edytuj` rendering on two pages, `Usuń`
over-counting, `role="alert"` on every authenticated page, the `toPass` helper,
why `workers: 1` — live in `context/foundation/test-plan.md` §6.11. Read that
section just-in-time when writing a spec; it is NOT imported here on purpose
(the file is ~6.7k lines).

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
