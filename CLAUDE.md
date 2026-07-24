## Komunikacja / Communication language

**Zawsze rozmawiaj ze mną po polsku.** Cała komunikacja, wyjaśnienia, pytania, podsumowania i komentarze do mnie mają być w języku polskim — bez wyjątków, niezależnie od języka, w którym napisana jest lekcja, skill czy plik.

Po angielsku zostają wyłącznie: kod, nazwy identyfikatorów (zmienne, funkcje, pliki), treść artefaktów generowanych przez skille (np. `shape-notes.md`, `prd.md` i ich nagłówki sekcji typu `## Open Questions`) oraz polecenia/komendy. Reszta — czyli to, co mówisz do mnie w czacie — po polsku.

Always communicate with me in Polish. Keep only code, identifiers, skill-generated artifacts, and commands in English.

## Agent onboarding

This file guides AI agents working in this repo. Project conventions live in AGENTS.md:
@AGENTS.md

## Mutation testing

Repo uses Stryker for SELECTIVE mutation testing on risk-critical modules.
Run it only for code covered by the current change or a risk from test-plan.md,
prefer narrowed scope via the `mutate` list or `--mutate "path:start-end"`, and
do NOT chase 100% mutation score. Review survived mutants one by one: add an
assertion only when the mutant is a user-visible or business-relevant bug.
Keep OPENROUTER_API_KEY unset so generation falls back to mock cards.

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
