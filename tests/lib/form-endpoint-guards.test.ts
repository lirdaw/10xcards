import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Two sweeps this project relies on, made falsifiable instead of enforced by reading
// (C10X-37 impl-review F6, 2026-08-01).
//
// WHY THIS FILE EXISTS, and it is a history rather than a preference. `src/lib/forms.ts` says it
// in its own header: "no test enumerates the readers — the sweep was found incomplete twice by
// reading, not by a red run." That is the literal record. C10X-30 guarded four of the six
// `formData()` readers and its plan's enumeration said "all four"; its impl-review (F1) found the
// deck pair still unguarded; C10X-34 re-recorded the gap; C10X-37 finally closed it. THREE reviews
// for one class, each of which had to notice by hand. A seventh form endpoint written tomorrow
// with a bare `formData()` and an `as string | null` cast re-opens it silently, and the only thing
// standing in the way would be a fourth reviewer being equally careful.
//
// The second sweep has the same shape and a quieter failure. `redirect-errors.ts` claims to hold
// "every value the six redirect-style endpoints can ever put in `?error=`" — closed by
// CONSTRUCTION, which is exactly why nothing fails when a future endpoint inlines a fresh literal.
// It does not throw and it does not 500: the page's `ownedRedirectMessage` simply cannot vouch for
// the value, so the banner does not appear. Fail-safe, and completely silent — a refusal the user
// never sees a reason for.
//
// SCOPE — `src/pages/api/`. That is where both sweeps were defined and it is the whole population:
// six `formData()` readers, three JSON endpoints, three body-less routes.
//
// Textual, like every other first-party guard here (`no-logging.test.ts`,
// `no-env-access.test.ts`, `error-param-guard.test.ts`, `no-client-redirect-errors.test.ts`), and
// for the same reason: it must fire on the code as WRITTEN. The cost — a mention inside a comment
// can trip it — is the intended trade, and every failure names file and line.

const API_DIR = fileURLToPath(new URL("../../src/pages/api", import.meta.url));
const DECKS_API_DIR = join(API_DIR, "decks");

/** The body read itself. Matched on the assignment, not on the bare call, so prose about it is ignored. */
const FORM_DATA_READ = /=\s*await\s+[\w.]*\.formData\s*\(\s*\)/;
/** Reading a part off the parsed form. */
const FORM_GET = /\bform\s*\.\s*get\s*\(/;
/** …and the only acceptable way to do it: narrowed, so a `File` part becomes `""` instead of crashing `.trim()`. */
const FORM_STRING = /\bformString\s*\(/;
/** A `?error=` value interpolated straight from a quoted literal — the drift the closed set cannot see. */
const INLINE_ERROR_LITERAL = /error=\$\{\s*encodeURIComponent\s*\(\s*["'`]|[?&]error=["'`]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

function label(file: string, root: string, index: number, line: string): string {
  return `${relative(root, file).split(sep).join("/")}:${index + 1}: ${line.trim()}`;
}

/** Lines, with comment-only lines dropped so "the line before" means the line that RUNS before. */
function codeLines(file: string): { text: string; index: number }[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.trim() !== "" && !/^\s*(\/\/|\*|\/\*)/.test(text));
}

describe("every form endpoint guards its body read", () => {
  const files = sourceFiles(API_DIR);

  // Positive control: a walker that returned nothing, or a pattern that matched nothing, would make
  // both assertions below pass while enumerating zero readers. The count is pinned exactly — the
  // whole point is that a SEVENTH reader must not appear unnoticed, so "at least six" would defeat
  // the guard. A new form endpoint is expected to bump this number in the same commit.
  it("finds exactly the six known formData() readers", () => {
    const readers = files.flatMap((file) =>
      codeLines(file)
        .filter(({ text }) => FORM_DATA_READ.test(text))
        .map(({ text, index }) => label(file, API_DIR, index, text)),
    );

    expect(readers).toHaveLength(6);
    expect(readers.map((r) => r.split(":")[0]).sort()).toEqual([
      "auth/signin.ts",
      "auth/signup.ts",
      "decks/[publicId].ts",
      "decks/[publicId]/cards/[cardPublicId].ts",
      "decks/[publicId]/cards/index.ts",
      "decks/index.ts",
    ]);
  });

  // The other half of the control: the detectors fire on the regressions they claim to detect, and
  // stay silent on the shipped forms.
  it("detects an unguarded read and an un-narrowed part", () => {
    expect(FORM_DATA_READ.test("  const form = await context.request.formData();")).toBe(true);
    expect(FORM_DATA_READ.test("    form = await context.request.formData();")).toBe(true);
    expect(FORM_GET.test('const name = ((form.get("name") as string | null) ?? "").trim();')).toBe(true);
    expect(FORM_STRING.test('const name = ((form.get("name") as string | null) ?? "").trim();')).toBe(false);
    expect(FORM_STRING.test('const name = formString(form.get("name")).trim();')).toBe(true);
    // Must not fire on prose about the read, or this guard gets weakened by the next person it annoys.
    expect(FORM_DATA_READ.test("// formData() rejects for TWO causes: a body that was never a form")).toBe(false);
  });

  // THE CLAIM. `formData()` rejects on a body that was never a form AND on a form-typed body that
  // arrived broken; unguarded, either is an uncontrolled framework 500 with no project-owned
  // response. Every reader must sit directly under a `try {`.
  it("reads the body inside a try on every one of them", () => {
    const unguarded = files.flatMap((file) => {
      const lines = codeLines(file);
      return lines.flatMap(({ text, index }, position) => {
        if (!FORM_DATA_READ.test(text)) return [];
        const previous = lines[position - 1]?.text.trim();
        return previous === "try {" ? [] : [label(file, API_DIR, index, text)];
      });
    });

    expect(unguarded).toEqual([]);
  });

  // …and the part read must be NARROWED. A multipart part of type `File` survives the compile-time
  // `as string | null` cast and throws at `.trim()` — the second half of the same defect, and the
  // one the cast makes invisible to the type checker.
  it("narrows every part through formString", () => {
    const raw = files.flatMap((file) =>
      codeLines(file)
        .filter(({ text }) => FORM_GET.test(text) && !FORM_STRING.test(text))
        .map(({ text, index }) => label(file, API_DIR, index, text)),
    );

    expect(raw).toEqual([]);
  });
});

describe("no deck route puts an inline literal into ?error=", () => {
  const files = sourceFiles(DECKS_API_DIR);

  // Positive control, in both directions: the walk reaches the producers, and the detector fires on
  // the regression while staying silent on the shipped shape.
  it("scans the deck route tree and detects an inline literal", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(INLINE_ERROR_LITERAL.test('`/decks?error=${encodeURIComponent("Nie udało się")}&open=create`')).toBe(true);
    expect(INLINE_ERROR_LITERAL.test("`/decks?error='oops'`")).toBe(true);
    expect(
      INLINE_ERROR_LITERAL.test("`/decks?error=${encodeURIComponent(DECK_CREATE_FAILED_MESSAGE)}&open=create`"),
    ).toBe(false);
    expect(INLINE_ERROR_LITERAL.test("const errorUrl = (msg: string) => `?error=${encodeURIComponent(msg)}`;")).toBe(
      false,
    );
  });

  // THE CLAIM, and note what it is NOT: it cannot prove the identifier came from the closed set
  // (that needs an import graph, and `msg` is a legitimate local built from two set members). What
  // it does prove is that no NEW string enters the channel inline — which is the drift that
  // actually happens, and whose failure mode is a banner that silently stops appearing.
  it("interpolates only identifiers, never a quoted string", () => {
    const inline = files.flatMap((file) =>
      codeLines(file)
        .filter(({ text }) => INLINE_ERROR_LITERAL.test(text))
        .map(({ text, index }) => label(file, DECKS_API_DIR, index, text)),
    );

    expect(inline).toEqual([]);
  });

  // The companion claim, which is cheap and closes the other direction: a file that produces an
  // `?error=` URL must take its vocabulary from the closed set rather than declaring its own.
  it("takes its vocabulary from the closed set in every producer", () => {
    const producers = files.filter((file) => /[?&]error=/.test(readFileSync(file, "utf8")));
    expect(producers.length).toBeGreaterThanOrEqual(6);

    const withoutTheSet = producers
      .filter((file) => !/from\s*["']@\/lib\/redirect-errors["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(DECKS_API_DIR, file).split(sep).join("/"));

    expect(withoutTheSet).toEqual([]);
  });
});
