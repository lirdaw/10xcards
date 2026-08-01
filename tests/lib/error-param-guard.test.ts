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

/** Reading the untrusted parameter at all. Surface-independent — the parameter has one name. */
const RAW_READ = /searchParams\s*\.\s*get\s*\(\s*["'`]error["'`]\s*\)/;

/** …and the only acceptable way to do it: wrapped in THIS surface's helper, on the spot. */
function wrappedRead(helper: string): RegExp {
  return new RegExp(`${helper}\\s*\\(\\s*[^)]*searchParams\\s*\\.\\s*get\\s*\\(\\s*["'\`]error["'\`]\\s*\\)`);
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

    // The shipped shape, plus the near-miss that a co-presence check would wave through: a page
    // that imports the helper and still reads the parameter raw.
    expect(wrapped.test(`const error = ${helper}(Astro.url.searchParams.get("error"));`)).toBe(true);
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
describe("no unregistered page reads ?error= at all", () => {
  const pagesRoot = fileURLToPath(new URL("../../src/pages", import.meta.url));
  const registered = SURFACES.map((s) => fileURLToPath(new URL(`../../${s.dir}`, import.meta.url)));
  const unregistered = astroPages(pagesRoot).filter((file) => !registered.some((dir) => file.startsWith(dir)));

  // Positive control: without it, a walker that returned nothing — or a `registered` filter that
  // swallowed the whole tree — would make the assertion below pass while scanning zero files.
  // The named pages are ones that exist today and belong to no surface.
  it("scans the pages outside the registered surfaces", () => {
    expect(unregistered.length).toBeGreaterThanOrEqual(3);
    expect(unregistered.map((f) => relative(pagesRoot, f).split(sep).join("/"))).toEqual(
      expect.arrayContaining(["index.astro", "generate.astro"]),
    );
    // …and it must genuinely EXCLUDE the registered ones, or this block would silently duplicate
    // the per-surface assertions and go red on their (correct, wrapped) reads.
    expect(unregistered.map((f) => relative(pagesRoot, f).split(sep).join("/"))).not.toContain("decks/index.astro");
  });

  it("finds no ?error= read outside src/pages/auth and src/pages/decks", () => {
    const reads = unregistered.flatMap((file) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .flatMap((line, index) =>
          RAW_READ.test(line) ? [`${relative(pagesRoot, file).split(sep).join("/")}:${index + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(reads).toEqual([]);
  });
});
