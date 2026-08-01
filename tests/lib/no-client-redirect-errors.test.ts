import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `src/lib/redirect-errors.ts` is server-side only. This file is that rule's gate.
//
// Why a test rather than a comment, and this is the whole reason it exists (C10X-37
// impl-review F1, 2026-08-01). Four sites used to justify the split by claiming the module
// "drags a query layer into the browser bundle via flashcards.ts". That does not survive a
// check: `flashcards.ts` has only `import type`, and three islands already import
// `FRONT_MAX`/`BACK_MAX` from it as VALUES. So the rule was resting on a reason a contributor
// who verified it would find false — and nothing enforced it. A prose rule nothing enforces is
// not a rule; the same reasoning as `no-logging.test.ts` (because `no-console` is only "warn")
// and `no-env-access.test.ts` (because no lint rule forbids `import.meta.env`).
//
// The rule's REAL basis, so the next reader does not re-derive the false one: this module is the
// `?error=` channel's closed set plus `ownedRedirectMessage`, the guard that vouches for a value
// arriving from a URL. Both belong to the server surface, where the producers are and where the
// read happens (`Astro.url.searchParams` in the page frontmatter). An island reaching for one of
// these strings would be routing around the `serverError` prop its page already passes it — and
// that prop is the pattern the whole read-side fix depends on, because every island seeds
// `React.useState(serverError)` at first render. The browser-safe half of the vocabulary is
// `deck-limits.ts`, which imports nothing and is what the two deck islands take.
//
// SCOPE — `src/components/` only. That is where islands live; `src/pages/` is server-rendered
// and imports this module legitimately (three `.astro` pages and six endpoints do).

const COMPONENTS_DIR = fileURLToPath(new URL("../../src/components", import.meta.url));

/**
 * Textual, for the same reason its two siblings are: it must cover files no loader in this
 * suite parses, and it must fire on the import as WRITTEN rather than on a resolved graph. The
 * cost is that a mention inside a comment also trips it — intended (reword the comment), and the
 * failure message names file and line. Note the four sites that legitimately NAME this module in
 * prose say "redirect-errors.ts" without the `@/lib/` specifier, so they do not trip it.
 */
const CLIENT_IMPORT =
  /from\s*["'](?:@\/lib\/redirect-errors|.*\/redirect-errors)["']|import\s*\(\s*["'][^"']*redirect-errors["']/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

function clientImportsIn(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .flatMap((line, index) =>
      CLIENT_IMPORT.test(line)
        ? [`${relative(COMPONENTS_DIR, file).split(sep).join("/")}:${index + 1}: ${line.trim()}`]
        : [],
    );
}

describe("no island imports the server-side redirect-errors module", () => {
  const files = sourceFiles(COMPONENTS_DIR);

  // Positive control, load-bearing rather than ceremony: a walker that returned an empty list
  // would make the assertion below pass while guarding nothing. The named files pin that the
  // walk reaches the two deck islands (the ones whose headers cite this guard) and the shared
  // component every banner renders through.
  it("scans the whole src/components/ tree", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.map((f) => relative(COMPONENTS_DIR, f).split(sep).join("/"))).toEqual(
      expect.arrayContaining([
        "decks/CreateDeckModal.tsx",
        "decks/DeckActions.tsx",
        "auth/ServerError.tsx",
        "flashcards/FlashcardItem.tsx",
      ]),
    );
  });

  // The other half of the control: the detector fires on what it claims to detect, in every
  // spelling that would actually reach the bundler — and stays silent on the ones that would not.
  it("detects a client import when there is one", () => {
    for (const sample of [
      'import { ownedRedirectMessage } from "@/lib/redirect-errors";',
      "import { REDIRECT_MESSAGES } from '@/lib/redirect-errors';",
      'import { DECK_NAME_TAKEN_MESSAGE } from "../../lib/redirect-errors";',
      'const m = await import("@/lib/redirect-errors");',
    ])
      expect(CLIENT_IMPORT.test(sample)).toBe(true);

    // False positives matter as much: this file fails the build, so a guard that fires on the
    // four comments which legitimately NAME the module would be turned off by the next person it
    // annoys. `deck-limits.ts` is the browser-safe module islands DO import — it must stay silent.
    for (const sample of [
      "// Never import `redirect-errors.ts` here: it is server-side.",
      'import { NAME_MIN, NAME_MAX, DECK_NAME_MESSAGE } from "@/lib/deck-limits";',
      'import { FRONT_MAX, BACK_MAX } from "@/lib/flashcards";',
    ])
      expect(CLIENT_IMPORT.test(sample)).toBe(false);
  });

  it("has no import of redirect-errors anywhere under src/components/", () => {
    expect(files.flatMap(clientImportsIn)).toEqual([]);
  });
});
