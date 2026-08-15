import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A deck name is UNIQUE PER ACCOUNT — `deck_user_name_unique`, an actual constraint, not a
// convention — and every integration file in this suite creates its decks as the same
// account A. The only thing keeping two files' deck names apart is the per-file
// `const suffix = Date.now().toString(36)`, which has MILLISECOND resolution: two files whose
// modules load in the same millisecond get the same suffix, so a deck-name stem used by two
// files is a real collision, not a theoretical one.
//
// It fired. `Gate deck ${suffix}` lived in `tests/study/study.test.ts:609` AND
// `tests/review/candidates.test.ts:908`, measured at a ~3.3 % red rate, and it is the flake
// C10X-51's §8 entry recorded TWICE without being able to attribute it. The mechanism had in
// fact been identified 16 days earlier, in
// `context/archive/2026-07-29-flashcards-test-order/reviews/impl-review.md:303`, under
// "Deliberately not raised as findings" — correctly out of scope there, and invisible to
// everyone afterwards. THIS FILE is why the rename is a closed class rather than a patch.
// test-plan.md §6.5 carries the rule and both halves of that history.
//
// Why a test rather than a note: `tests/lib/no-env-access.test.ts` opens by rejecting the
// alternative — "a prose rule nothing enforces is not a rule" — and this project has four
// textual guards of exactly this shape (`no-logging`, `no-env-access`, `form-endpoint-guards`,
// `e2e-isolation`), every one written after a sweep was found incomplete by READING rather
// than by a red run. This stem has the same history, one review-note deep.

const TESTS_DIR = fileURLToPath(new URL("../", import.meta.url));

/** `tests/e2e/` is Playwright's; its specs run as a different account with their own teardown. */
const SKIP_DIRS = new Set(["e2e", "node_modules"]);

/**
 * The two seams through which a test file names a deck that is then CREATED for account A.
 *
 * Textual, for the reason every sibling guard here is: nothing in this suite parses
 * TypeScript, and the values are template literals sitting inside call arguments.
 *
 * The accepted cost is NARROWER than the siblings', and it is stated precisely because the
 * loose version was measured false here. `no-logging` and `no-env-access` fire on a bare
 * mention, since their pattern IS the mention; these two seams need the literal to sit in a
 * call argument or after `newDeckName:`, so naming a stem in prose costs nothing — the very
 * comment at `tests/review/candidates.test.ts:906-911` names both stems and this guard stays
 * green over it, which is the proof rather than the argument. What DOES trip it is a stem
 * written next to a real seam inside a comment or a dead code sample, and there the fix is to
 * reword the comment, never to weaken the guard.
 *
 *   createDeck    the per-file helper (six files declare their own), taking either
 *                 `createDeck(name)` or `createDeck(as, name)`. The lookbehind keeps the six
 *                 `async function createDeck(` DECLARATIONS out — their parameter is `as` or
 *                 `submitted`, which resolves to nothing and would only be noise.
 *   newDeckName   `/api/generate`'s inline-deck path, which creates a deck for the same
 *                 account without going near `createDeck`. Same constraint, same collision,
 *                 so leaving it out would make the guard right about what it looks at and
 *                 silent about a seam that is already used by two files.
 */
const DECK_NAME_SEAMS: RegExp[] = [
  /(?<!function\s)\bcreateDeck\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?(`[^`]*`|[A-Za-z_$][\w$]*)/g,
  /\bnewDeckName\s*[:=]\s*(`[^`]*`|[A-Za-z_$][\w$]*)/g,
];

/**
 * What this does NOT reach, stated so nobody reads the guard as total:
 *
 *   NOT  a name built by a call — `sized(marker, NAME_MAX)` in `tests/validation/decks.test.ts`
 *        is four decks whose names no textual pass can resolve. They carry a per-case marker
 *        rather than a shared stem, so the class this guards against does not apply to them.
 *   NOT  a name assembled across lines, or held in a field this pattern does not name.
 *   NOT  the e2e specs, which are Playwright's and run as their own account.
 *
 * Under-reach is the failure mode that reads GREEN, which is why the controls below assert a
 * floor on what was extracted and name one stem per seam and per resolution path.
 */
function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : testFiles(full);
    // `.test.ts` is Vitest's own `include` (`vitest.config.ts`), i.e. exactly the files that
    // run as this suite and therefore create decks as account A.
    return entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

/** `Gate deck ${suffix}` → `Gate deck`; a fully static name is its own stem. */
function stemOf(template: string): string | null {
  const stem = (template.slice(1, -1).split("${")[0] ?? "").trim();
  return stem === "" ? null : stem;
}

/**
 * Every template literal this file binds to `ident`, in declaration order — ALL of them, not
 * the first. `tests/generation/generate.test.ts` declares `const deckName` twice with
 * different values, and resolving to whichever came first would silently drop the other from
 * the comparison. Over-collecting cannot produce a false positive: the comparison is over
 * STEMS, so an extra stem only ever adds a name this file really does use.
 */
function templatesBoundTo(source: string, ident: string): string[] {
  const escaped = ident.replace(/\$/g, "\\$");
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*(\`[^\`]*\`)`, "g");
  return [...source.matchAll(declaration)].map((match) => match[1] ?? "");
}

/** Every deck-name stem one test file can create a deck under. */
export function deckNameStems(source: string): string[] {
  const stems = new Set<string>();

  for (const seam of DECK_NAME_SEAMS) {
    for (const match of source.matchAll(seam)) {
      const argument = match[1] ?? "";
      const templates = argument.startsWith("`") ? [argument] : templatesBoundTo(source, argument);
      for (const template of templates) {
        const stem = stemOf(template);
        if (stem !== null) stems.add(stem);
      }
    }
  }

  return [...stems];
}

/** Stems claimed by more than one file, each rendered with the files that share it. */
function sharedStems(byFile: Map<string, string[]>): string[] {
  // Owners are a SET per stem, not a list: the claim is "two FILES", so one file naming the
  // same stem twice must not read as a collision with itself.
  const owners = new Map<string, Set<string>>();
  for (const [file, stems] of byFile) {
    for (const stem of stems) owners.set(stem, (owners.get(stem) ?? new Set()).add(file));
  }

  return [...owners]
    .filter(([, files]) => files.size > 1)
    .map(
      ([stem, files]) =>
        `"${stem}" is used by ${[...files].join(" and ")} — a deck name is unique per account (deck_user_name_unique) and both files create as account A, so the two collide whenever their module-load Date.now() lands in the same millisecond; rename one stem (test-plan.md §6.5)`,
    );
}

describe("no deck-name stem is shared by two test files", () => {
  const files = testFiles(TESTS_DIR);
  const relative_ = (file: string) => relative(TESTS_DIR, file).split(sep).join("/");
  const byFile = new Map(files.map((file) => [relative_(file), deckNameStems(readFileSync(file, "utf8"))]));

  // Control 1 — the walker reaches the files this claim is about. A walker returning an empty
  // list satisfies the claim below while looking at nothing at all: the same false-pass shape
  // §6.6 records for a denial asserted as "absent from a set" that is empty for an unrelated
  // reason. The two named files are the pair the collision actually lived in.
  it("walks tests/ and reaches the files that create decks", () => {
    expect(files.length).toBeGreaterThan(20);
    expect([...byFile.keys()]).toEqual(
      expect.arrayContaining([
        "study/study.test.ts",
        "review/candidates.test.ts",
        "isolation/decks.test.ts",
        "generation/failure-path.test.ts",
      ]),
    );
  });

  // Control 2 — the extraction found something, through EVERY path it claims to have. Each of
  // the four is a separate way the regex can quietly stop matching: an inline argument, the
  // two-argument form, an identifier resolved to its declaration, and the `newDeckName` seam.
  // Without this, a pattern that matched nothing would report zero duplicates forever.
  it("extracts stems through each seam and resolution path", () => {
    expect(byFile.get("study/study.test.ts")).toContain("Gate deck");
    expect(byFile.get("review/candidates.test.ts")).toContain("Study-gate deck");
    expect(byFile.get("isolation/decks.test.ts")).toContain("A's deck");
    expect(byFile.get("generation/failure-path.test.ts")).toContain("Talia 502");

    // …and the six `async function createDeck(` declarations contribute no phantom stem.
    expect([...byFile.values()].flat()).not.toContain("as");
  });

  // Control 3 — the detector fires, in both directions, on a fabricated map. The real claim's
  // list is empty once this change lands, so a comparison written the wrong way round would
  // read exactly as green as a clean tree does. `Gate deck` is the historical duplicate.
  it("reports a stem two files share, and stays silent on distinct ones", () => {
    const duplicate = sharedStems(
      new Map([
        ["study/study.test.ts", ["Gate deck", "Ordering deck"]],
        ["review/candidates.test.ts", ["Gate deck", "Chip deck"]],
      ]),
    );
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]).toContain("Gate deck");
    expect(duplicate[0]).toContain("study/study.test.ts");
    expect(duplicate[0]).toContain("review/candidates.test.ts");

    expect(
      sharedStems(
        new Map([
          ["study/study.test.ts", ["Gate deck"]],
          ["review/candidates.test.ts", ["Study-gate deck"]],
        ]),
      ),
    ).toEqual([]);

    // A stem repeated INSIDE one file is legal and must not fire: the same deck name in two
    // cases of one file is the file's own business (and `deckNameStems` de-duplicates it).
    expect(sharedStems(new Map([["study/study.test.ts", ["Gate deck", "Gate deck"]]]))).toEqual([]);
  });

  it("gives every deck-name stem exactly one owning file", () => {
    expect(sharedStems(byFile)).toEqual([]);
  });
});
