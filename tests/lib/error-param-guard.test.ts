import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The wiring half of the `?error=` channel's read side (test-plan §6.3, §6.6's C10X-34 entry),
// now across BOTH surfaces that have one.
//
// The helpers are well covered elsewhere — membership by equality, a crafted non-member, a
// one-character truncation, `null`/`""`, and a positive control over the WHOLE closed set,
// without which `() => null` satisfies every rejection case and reads as perfect protection
// (`tests/auth/errors.test.ts` for `ownedAuthMessage`, `tests/lib/redirect-errors.test.ts` for
// `ownedRedirectMessage`). What none of that observes is whether the PAGES still call them.
// Deleting the wrap from any of these `.astro` frontmatters re-opens the content-injection
// vector — a crafted link rendering attacker-chosen text inside this project's own red banner —
// and leaves the rest of the suite fully green. That gap was disclosed rather than hidden
// (test-plan §6.6: "A regression deleting the `ownedAuthMessage(...)` call from `signin.astro`
// leaves the suite green"); this file closes it, and was added by C10X-34's impl-review (F2).
//
// Why textual, and why here: §6.4 renders no pages and §4 has no DOM layer, so an `.astro`
// frontmatter is unreachable by every other means in this suite. The species already exists —
// `no-logging.test.ts` and `no-env-access.test.ts` are the same shape, and both live in this
// folder — so the guard sits beside its siblings rather than inventing a location.
//
// WHY IT IS A TABLE, added by C10X-37, and it is not tidiness. The two surfaces vouch against
// DIFFERENT closed sets: `src/pages/auth` against `AUTH_MESSAGES`, `src/pages/decks` against
// `REDIRECT_MESSAGES`. A single shared "is it wrapped in something?" regex would therefore
// accept a deck page wrapped in `ownedAuthMessage` — lexically a wrap, semantically the wrong
// vocabulary, and that page would then vouch for "Nieprawidłowy e-mail lub hasło" while refusing
// its own endpoints' copy. So the pattern is built per surface from ITS helper's name, and a
// case below asserts each surface's pattern rejects the other's helper.
//
// WHAT THIS PROVES, and do not read it as more. It proves the raw read is lexically WRAPPED by
// the right helper at every site — not that the wrapped value reaches `serverError`, and not
// that the helper behaves (that is the two files named above). It is a deletion detector, which
// is the regression a human actually commits.
//
// The stricter shape is deliberate. Asserting that the file merely MENTIONS the helper somewhere
// would pass on a page that imports it and then reads the parameter raw two lines down — the
// exact defect, wearing the costume of a fix. So the assertion is per LINE: a line that reads the
// parameter must be the same line that wraps it. Consequence, accepted: splitting the expression
// across lines trips this guard even when the wiring is correct. That is the trade — re-check the
// wiring and keep it on one line, or widen the pattern deliberately with a recorded reason. Do
// not weaken it because a reformat annoyed you.

/**
 * Reading the untrusted parameter at all. Surface-independent — the parameter has one name.
 *
 * Keyed on `.get("error")` with ANY receiver, deliberately (C10X-40, 2026-08-01). This used to
 * require the literal token `searchParams` immediately before `.get`, which made the guard
 * bypassable by the most ordinary tidy-up on these very pages: `[publicId]/index.astro` reads
 * FIVE parameters and `review.astro` five, so hoisting `const params = Astro.url.searchParams`
 * and calling `params.get("error")` is the natural refactor — and it produced zero findings,
 * disarming the guard on both pages at once while every test stayed green. A receiver-agnostic
 * pattern costs nothing here (no `.astro` page in this repo calls `.get("error")` on anything
 * else) and removes a bypass that would pass code review unremarked.
 */
const RAW_READ = /\.\s*get\s*\(\s*["'`]error["'`]\s*\)/;

/**
 * …and the only acceptable way to do it: wrapped in THIS surface's helper, on the spot.
 *
 * Receiver-agnostic for the same reason `RAW_READ` is, and it has to move in step with it: if the
 * detector widened alone, a CORRECTLY wrapped hoisted read would be reported as a violation and
 * the guard would be turned off by the next person it annoyed.
 */
function wrappedRead(helper: string): RegExp {
  return new RegExp(`${helper}\\s*\\(\\s*[^)]*\\.\\s*get\\s*\\(\\s*["'\`]error["'\`]\\s*\\)`);
}

interface Surface {
  /** Path relative to the repo root, and the base every reported line is relative to. */
  dir: string;
  /** The vouching helper this surface's pages must use — see the table note above. */
  helper: string;
  /** Pages known to carry a read. Named so a rename surfaces here instead of narrowing the scan. */
  expectedPages: string[];
  /** Lower bound on the walker's reach; a floor, not an equality — see the walker control. */
  floor: number;
}

const SURFACES: Surface[] = [
  { dir: "src/pages/auth", helper: "ownedAuthMessage", expectedPages: ["signin.astro", "signup.astro"], floor: 3 },
  {
    dir: "src/pages/decks",
    helper: "ownedRedirectMessage",
    expectedPages: ["index.astro", "[publicId]/index.astro", "[publicId]/review.astro"],
    floor: 3,
  },
];

function astroPages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return astroPages(full);
    return entry.name.toLowerCase().endsWith(".astro") ? [full] : [];
  });
}

/**
 * What the catch-all inspects: `.astro` AND the TypeScript sources beside them.
 *
 * `.astro`-only was the remaining gap (C10X-40 impl-review F5). The two sibling guards this file
 * cites as its precedent — `no-logging.test.ts`, `no-env-access.test.ts` — walk EVERY file under
 * `src/`, which is why their controls name `middleware.ts` next to a page. An island that swapped
 * its `searchParams.has("error")` for a `.get("error")` and rendered the value is the same
 * content-injection vector, and a WORSE one: `no-client-redirect-errors.test.ts` forbids a
 * component importing the vouching set, so such an island could only ever render the value raw.
 * Measured when this widened: four islands touch the parameter and all four use `.has`/`.delete`,
 * which `RAW_READ` does not match — so the widening costs no allowance list.
 */
function scannableFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return scannableFiles(full);
    return /\.(astro|ts|tsx)$/i.test(entry.name) ? [full] : [];
  });
}

/**
 * Lines with comment-only lines dropped.
 *
 * Needed the moment the scan reached `.ts`: `auth-errors.ts` and `redirect-errors.ts` both QUOTE
 * `searchParams.get("error")` in their docblocks to explain the rule, so a textual scan that did
 * not skip comments would report the two files that document the guard as violating it.
 */
function codeLinesOf(file: string): { text: string; index: number }[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text));
}

function uncheckedReadsIn(file: string, root: string, wrapped: RegExp): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (!RAW_READ.test(line) || wrapped.test(line)) return [];
      return [`${relative(root, file).split(sep).join("/")}:${index + 1}: ${line.trim()}`];
    });
}

describe.each(SURFACES)("$dir reads ?error= only through $helper", ({ dir, helper, expectedPages, floor }) => {
  const root = fileURLToPath(new URL(`../../${dir}`, import.meta.url));
  const pages = astroPages(root);
  const wrapped = wrappedRead(helper);
  const relativePages = pages.map((f) => relative(root, f).split(sep).join("/"));

  // Positive control, load-bearing rather than ceremony: a walker that returned an empty list
  // would make the assertion at the bottom pass while guarding nothing. Every page that carries
  // a read is named, so renaming or moving one surfaces here instead of silently narrowing the
  // scan. `.astro`-only by extension — a page that reads no parameter (auth's
  // `confirm-email.astro`) is expected to pass vacuously, which is correct and is why the count
  // is a floor, not an equality.
  it("scans the page tree", () => {
    expect(pages.length).toBeGreaterThanOrEqual(floor);
    expect(relativePages).toEqual(expect.arrayContaining(expectedPages));
  });

  // The other half of the control: the detector fires on the regression it claims to detect, and
  // stays silent on the shipped form. Without this, `RAW_READ` could match nothing at all and
  // every page would read as compliant.
  it("detects an unwrapped read, and accepts the wrapped one", () => {
    const unwrapped = [
      'const error = Astro.url.searchParams.get("error");',
      "const error = Astro.url.searchParams.get('error');",
      "const error = Astro . url . searchParams . get ( `error` );",
    ];
    for (const sample of unwrapped) {
      expect(RAW_READ.test(sample)).toBe(true);
      expect(wrapped.test(sample)).toBe(false);
    }

    // The hoisted-receiver bypass, which is why `RAW_READ` no longer names `searchParams`: on a
    // page reading five parameters this is the tidy-up a reviewer waves through, and it used to
    // produce zero findings.
    expect(RAW_READ.test('const error = params.get("error");')).toBe(true);
    expect(RAW_READ.test('const error = new URLSearchParams(Astro.url.search).get("error");')).toBe(true);

    // The shipped shape, plus the near-miss that a co-presence check would wave through: a page
    // that imports the helper and still reads the parameter raw.
    expect(wrapped.test(`const error = ${helper}(Astro.url.searchParams.get("error"));`)).toBe(true);
    expect(wrapped.test(`const error = ${helper}(params.get("error"));`)).toBe(true);
    expect(wrapped.test(`import { ${helper} } from "@/lib/x"; const e = Astro.url.searchParams.get("error");`)).toBe(
      false,
    );

    // And it must not fire on an unrelated parameter — `open` is read beside `error` on the deck
    // pages, and a guard that trips on it would be turned off by the next person it annoys.
    expect(RAW_READ.test('const openCreate = Astro.url.searchParams.get("open") === "create";')).toBe(false);
  });

  // THE CASE THAT JUSTIFIES THE TABLE. A wrap in the OTHER surface's helper is lexically a wrap
  // and semantically the wrong closed set, so a single shared pattern would report such a page as
  // compliant while it vouched against a vocabulary its own endpoints never emit. Each surface's
  // pattern must reject every other surface's helper by name.
  it.each(SURFACES.filter((other) => other.helper !== helper))(
    "does not accept a read wrapped in $helper instead",
    (other) => {
      const foreign = `const error = ${other.helper}(Astro.url.searchParams.get("error"));`;
      expect(RAW_READ.test(foreign)).toBe(true);
      expect(wrapped.test(foreign)).toBe(false);
    },
  );

  it("has no unwrapped ?error= read on any page", () => {
    expect(pages.flatMap((file) => uncheckedReadsIn(file, root, wrapped))).toEqual([]);
  });
});

// THE CATCH-ALL, and it is what stops this file from being the very shape it guards against.
//
// Everything above is scoped to the two REGISTERED surfaces. That leaves the rest of
// `src/pages/` — `study/`, `generate.astro`, `dashboard.astro`, and whatever is added next —
// completely unscanned: a future page reading `?error=` raw into a banner would not fail here,
// it would not be reported here, it simply would not be looked at. That is an incomplete sweep
// left unstated, which is the exact class C10X-37 exists to close (its own ticket came from
// C10X-30 sweeping four of six `formData()` readers), and both siblings in this folder —
// `no-logging.test.ts` and `no-env-access.test.ts` — walk the WHOLE of `src/` for that reason.
// Added by C10X-37's impl-review (F3, 2026-08-01).
//
// So: every `.astro` page outside the registered surfaces must carry NO read at all. A new page
// that needs one has two honest options, and no third — register a surface above (declaring
// which closed set it vouches against), or do not read the parameter. It cannot drift in
// unnoticed.
// TWO WAYS THIS BLOCK USED TO NOT LOOK, both closed by C10X-40 (2026-08-01), and both are the
// very class the paragraph above says the block exists to close.
//
//   1. It was rooted at `src/pages`. But `Astro.url` works in ANY `.astro` file, and seven live
//      outside that tree — `src/layouts/Layout.astro`, `AuthenticatedLayout.astro`, and five
//      components. A raw read added to `Layout.astro` would render an attacker-controlled banner
//      on EVERY page of the app — the largest blast radius available — with no guard looking.
//      Now rooted at `src/`.
//   2. The registered-surface exclusion was a bare prefix match with no separator, so
//      `src/pages/decks-archive/x.astro` was EXCLUDED here (it starts with `…/src/pages/decks`)
//      while the per-surface walk never descended into it either. Neither scanned nor reported —
//      the exact "not looked at" state, produced by the filter meant to prevent it. Now the
//      prefix carries a trailing separator.
//   3. It looked at `.astro` files only, while the two guards it names as its precedent walk the
//      whole tree. An island rendering a raw `.get("error")` is the same vector and cannot even
//      vouch, since components may not import the closed set. Now `.astro`, `.ts` and `.tsx`.
describe("no unregistered file under src/ reads ?error= at all", () => {
  const srcRoot = fileURLToPath(new URL("../../src", import.meta.url));
  // Trailing separator is load-bearing — see note 2 above.
  const registered = SURFACES.map((s) => fileURLToPath(new URL(`../../${s.dir}`, import.meta.url)) + sep);
  const unregistered = scannableFiles(srcRoot).filter((file) => !registered.some((dir) => file.startsWith(dir)));
  const named = unregistered.map((f) => relative(srcRoot, f).split(sep).join("/"));

  // Positive control: without it, a walker that returned nothing — or a `registered` filter that
  // swallowed the whole tree — would make the assertion below pass while scanning zero files.
  // The named files are ones that exist today and belong to no surface, and they now span BOTH
  // trees: a page, and the layout every page renders inside.
  it("scans every file outside the registered surfaces", () => {
    // Floor AT the measured value (69 = 12 `.astro` + 57 `.ts`/`.tsx`), not a round number below
    // it — slack here gives away the shrink direction, and shrink is the silent one. Same rule as
    // the emission floor in `form-endpoint-guards.test.ts`.
    expect(unregistered.length).toBeGreaterThanOrEqual(69);
    expect(named).toEqual(
      expect.arrayContaining([
        "pages/index.astro",
        "pages/generate.astro",
        "layouts/Layout.astro",
        // …and the non-`.astro` half, which is the point of the widening: a component, and the
        // middleware, exactly as `no-logging.test.ts`'s control names them.
        "middleware.ts",
        "components/flashcards/FlashcardWorkspace.tsx",
      ]),
    );
    // …and it must genuinely EXCLUDE the registered ones, or this block would silently duplicate
    // the per-surface assertions and go red on their (correct, wrapped) reads.
    expect(named).not.toContain("pages/decks/index.astro");
  });

  // The separator's own control. A directory sharing a registered surface's prefix must land in
  // `unregistered` — it cannot be asserted against the real tree, because no such directory exists
  // today, and the whole point is that the day one appears nobody will remember to check.
  it("does not mistake a shared-prefix sibling directory for a registered surface", () => {
    const excluded = (file: string) => registered.some((dir) => file.startsWith(dir));
    // Asserted rather than defaulted: `registered` is derived from the SURFACES table, and an empty
    // table would make both expects below vacuous instead of red.
    const [surface] = registered;
    expect(surface).toBeDefined();
    if (surface === undefined) return;
    const sibling = surface.slice(0, -sep.length) + "-archive" + sep + "x.astro";

    expect(excluded(surface + "index.astro")).toBe(true);
    expect(excluded(sibling)).toBe(false);
  });

  it("finds no ?error= read outside src/pages/auth and src/pages/decks", () => {
    const reads = unregistered.flatMap((file) =>
      codeLinesOf(file).flatMap(({ text, index }) =>
        RAW_READ.test(text) ? [`${relative(srcRoot, file).split(sep).join("/")}:${index + 1}: ${text.trim()}`] : [],
      ),
    );
    expect(reads).toEqual([]);
  });
});

// `?q=` is NOT the `?error=` class and deliberately has no vouching set — `deck-limits.ts` records
// why at length (the reflection sits behind a deck UUID an attacker would have to already know).
// What it does share is the shape this whole file exists for: the decision lives in an `.astro`
// frontmatter, so `tests/lib/deck-limits.test.ts` can prove `searchQuery` is CORRECT while nothing
// proves the page still CALLS it. Measured: reverting the read to an inline `.trim()` left the
// entire suite green (C10X-40 impl-review F10). Three lines close that, and the clamp being hygiene
// rather than a control is a reason to keep the guard cheap, not a reason to skip it.
describe("the ?q= read on the deck page goes through searchQuery", () => {
  const page = fileURLToPath(new URL("../../src/pages/decks/[publicId]/index.astro", import.meta.url));
  const RAW_Q = /\.\s*get\s*\(\s*["'`]q["'`]\s*\)/;
  const WRAPPED_Q = /searchQuery\s*\(\s*[^)]*\.\s*get\s*\(\s*["'`]q["'`]\s*\)/;

  // Both halves of the control, as everywhere else here: the detector fires on the regression and
  // stays silent on the shipped shape.
  it("detects an unwrapped read and accepts the wrapped one", () => {
    const inlined = 'const query = (Astro.url.searchParams.get("q") ?? "").trim();';
    const shipped = 'const query = searchQuery(Astro.url.searchParams.get("q"));';

    expect(RAW_Q.test(inlined)).toBe(true);
    expect(WRAPPED_Q.test(inlined)).toBe(false);
    expect(RAW_Q.test(shipped)).toBe(true);
    expect(WRAPPED_Q.test(shipped)).toBe(true);
  });

  it("has exactly one read, and it is wrapped", () => {
    const reads = codeLinesOf(page).filter(({ text }) => RAW_Q.test(text));

    expect(reads).toHaveLength(1);
    // `?? ""` keeps this red rather than throwing if the length assertion above ever passes with
    // an empty list: `WRAPPED_Q` does not match the empty string.
    expect(WRAPPED_Q.test(reads[0]?.text ?? "")).toBe(true);
  });
});
