import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The wiring half of the `?error=` channel's read side (test-plan §6.3, §6.6's C10X-34 entry).
//
// `ownedAuthMessage` is well covered in `tests/auth/errors.test.ts` — membership by equality, a
// crafted non-member, a one-character truncation, `null`/`""`, and a positive control over the
// WHOLE closed set, without which `() => null` satisfies every rejection case and reads as
// perfect protection. What none of that observes is whether the auth PAGES still call it.
// Deleting `ownedAuthMessage(...)` from either `.astro` frontmatter re-opens the content-injection
// vector — a crafted link rendering attacker-chosen text inside this project's own red banner —
// and leaves the suite fully green. That gap was disclosed rather than hidden (test-plan §6.6:
// "A regression deleting the `ownedAuthMessage(...)` call from `signin.astro` leaves the suite
// green"); this file closes it, and was added by C10X-34's impl-review (F2).
//
// Why textual, and why here: §6.4 renders no pages and §4 has no DOM layer, so an `.astro`
// frontmatter is unreachable by every other means in this suite. The species already exists —
// `no-logging.test.ts` and `no-env-access.test.ts` are the same shape, and both live in this
// folder — so the guard sits beside its siblings rather than inventing a location.
//
// WHAT THIS PROVES, and do not read it as more. It proves the raw read is lexically WRAPPED by
// the helper at every site — not that the wrapped value reaches `serverError`, and not that the
// helper behaves (that is `errors.test.ts`'s job). It is a deletion detector, which is the
// regression a human actually commits.
//
// The stricter shape is deliberate. Asserting that the file merely MENTIONS `ownedAuthMessage`
// somewhere would pass on a page that imports it and then reads the parameter raw two lines down
// — the exact defect, wearing the costume of a fix. So the assertion is per LINE: a line that
// reads the parameter must be the same line that wraps it. Consequence, accepted: splitting the
// expression across lines trips this guard even when the wiring is correct. That is the trade —
// re-check the wiring and keep it on one line, or widen the pattern deliberately with a recorded
// reason. Do not weaken it because a reformat annoyed you.

const AUTH_PAGES_DIR = fileURLToPath(new URL("../../src/pages/auth", import.meta.url));

/** Reading the untrusted parameter at all. */
const RAW_READ = /searchParams\s*\.\s*get\s*\(\s*["'`]error["'`]\s*\)/;

/** …and the only acceptable way to do it: wrapped, on the spot. */
const WRAPPED_READ = /ownedAuthMessage\s*\(\s*[^)]*searchParams\s*\.\s*get\s*\(\s*["'`]error["'`]\s*\)/;

function astroPages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return astroPages(full);
    return entry.name.toLowerCase().endsWith(".astro") ? [full] : [];
  });
}

function uncheckedReadsIn(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (!RAW_READ.test(line) || WRAPPED_READ.test(line)) return [];
      return [`${relative(AUTH_PAGES_DIR, file).split(sep).join("/")}:${index + 1}: ${line.trim()}`];
    });
}

describe("src/pages/auth reads ?error= only through ownedAuthMessage", () => {
  const pages = astroPages(AUTH_PAGES_DIR);

  // Positive control, load-bearing rather than ceremony: a walker that returned an empty list
  // would make the assertion at the bottom pass while guarding nothing. Both pages that carry a
  // read are named, so renaming or moving one surfaces here instead of silently narrowing the
  // scan. `.astro`-only by extension — `confirm-email.astro` reads no parameter and is expected
  // to pass vacuously, which is correct and is why the count is a floor, not an equality.
  it("scans the auth page tree", () => {
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.map((f) => relative(AUTH_PAGES_DIR, f).split(sep).join("/"))).toEqual(
      expect.arrayContaining(["signin.astro", "signup.astro"]),
    );
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
      expect(WRAPPED_READ.test(sample)).toBe(false);
    }

    // The shipped shape, plus the near-miss that a co-presence check would wave through: a page
    // that imports the helper and still reads the parameter raw.
    expect(WRAPPED_READ.test('const error = ownedAuthMessage(Astro.url.searchParams.get("error"));')).toBe(true);
    expect(
      WRAPPED_READ.test(
        'import { ownedAuthMessage } from "@/lib/auth-errors"; const e = Astro.url.searchParams.get("error");',
      ),
    ).toBe(false);

    // And it must not fire on an unrelated parameter — `open` is read beside `error` on the deck
    // pages, and a guard that trips on it would be turned off by the next person it annoys.
    expect(RAW_READ.test('const openCreate = Astro.url.searchParams.get("open") === "create";')).toBe(false);
  });

  it("has no unwrapped ?error= read on any auth page", () => {
    expect(pages.flatMap(uncheckedReadsIn)).toEqual([]);
  });
});
