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
/** …and the name the parsed body was bound to, which is what the part reads are checked against. */
const FORM_RECEIVER = /(?:const|let|var)?\s*(\w+)\s*=\s*await\s+[\w.]*\.formData\s*\(\s*\)/;
/**
 * Reading a part off the parsed form, on the receiver THIS file bound it to.
 *
 * Derived per file rather than hardcoded to the name `form` (C10X-40, 2026-08-01). Keyed on the
 * literal name, a rename of the local to `fd` or `body` exempted the whole endpoint from the
 * narrowing check below — while the reader count and the `try {` check both stayed green, because
 * they match the ASSIGNMENT. So the `File`-part `.trim()` crash this file was written for could
 * come back under a rename with the suite fully green.
 */
function formGet(receiver: string): RegExp {
  return new RegExp(`\\b${receiver}\\s*\\.\\s*get\\s*\\(`);
}
/** …and the only acceptable way to do it: narrowed, so a `File` part becomes `""` instead of crashing `.trim()`. */
const FORM_STRING = /\bformString\s*\(/;
/** A `?error=` value interpolated straight from a quoted literal — the drift the closed set cannot see. */
const INLINE_ERROR_LITERAL = /error=\$\{\s*encodeURIComponent\s*\(\s*["'`]|[?&]error=["'`]/;

/** `const errorUrl = (msg: string) => …` — the local helper four of the six endpoints build the URL with. */
const ERROR_URL_HELPER = /const\s+(\w+)\s*=\s*\(\s*(\w+)\s*:\s*string\s*\)\s*=>/;
/** Whatever is interpolated into `error=` on a line that builds the URL directly. */
const ERROR_INTERPOLATION = /error=\$\{([^}]*)\}/g;
/** `encodeURIComponent(X)` — stripped so the check lands on X rather than on the encoder. */
const ENCODE_WRAPPER = /^encodeURIComponent\s*\(\s*(.*?)\s*\)$/;
/** A bare identifier. A literal, a member access (`err.message`) and a call are all NOT this. */
const BARE_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
/** A quoted string, in any of the three spellings. */
const STRING_LITERAL = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g;

/**
 * String literals sitting in a VALUE position of an expression.
 *
 * `const msg = error.code === "23505" ? A : B` is legitimate — `"23505"` is a discriminator that
 * is compared and discarded, never assigned. `const msg = "Nowy komunikat"` is the drift. The
 * distinction a text scan can actually draw is the operator in front: a literal preceded by
 * `===`/`!==`/`==`/`!=` is being compared, anything else is being used.
 */
function valuePositionLiterals(expression: string): string[] {
  return [...expression.matchAll(STRING_LITERAL)]
    .filter((match) => !/[=!]==?$/.test(expression.slice(0, match.index).trimEnd()))
    .map((match) => match[0]);
}

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
    expect(formGet("form").test('const name = ((form.get("name") as string | null) ?? "").trim();')).toBe(true);
    expect(FORM_STRING.test('const name = ((form.get("name") as string | null) ?? "").trim();')).toBe(false);
    expect(FORM_STRING.test('const name = formString(form.get("name")).trim();')).toBe(true);

    // The receiver is DERIVED, so a renamed local is still checked — the bypass that used to
    // exempt an endpoint wholesale while every other case here stayed green.
    expect(FORM_RECEIVER.exec("  const fd = await context.request.formData();")?.[1]).toBe("fd");
    expect(FORM_RECEIVER.exec("    form = await context.request.formData();")?.[1]).toBe("form");
    expect(formGet("fd").test('const name = ((fd.get("name") as string | null) ?? "").trim();')).toBe(true);
    expect(formGet("form").test('const name = ((fd.get("name") as string | null) ?? "").trim();')).toBe(false);
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
    const raw = files.flatMap((file) => {
      const lines = codeLines(file);
      const receivers = lines
        .filter(({ text }) => FORM_DATA_READ.test(text))
        .map(({ text }) => FORM_RECEIVER.exec(text)?.[1])
        .filter((name): name is string => Boolean(name));

      return lines.flatMap(({ text, index }) =>
        receivers.some((receiver) => formGet(receiver).test(text)) && !FORM_STRING.test(text)
          ? [label(file, API_DIR, index, text)]
          : [],
      );
    });

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

// THE GAP THE TWO CASES ABOVE LEAVE, and it is most of the channel (C10X-40, 2026-08-01).
//
// `INLINE_ERROR_LITERAL` fires only on a quoted literal sitting syntactically NEXT TO the text
// `error=`. But four of the six endpoints build their URL through a local helper —
// `const errorUrl = (msg: string) => \`…?error=${encodeURIComponent(msg)}…\`` — and its call sites
// contain no `error=` text at all. Measured: **20 of the 29 emissions** go through such a helper,
// so the detector never even inspects them. `return context.redirect(errorUrl("Nowy komunikat"))`
// passed the whole suite. So did `errorUrl(err.message)`.
//
// And the companion case above is weaker than its name: it asserts the file IMPORTS the module
// somewhere. All seven do. It stays green while a file emits a brand-new local literal.
//
// WHY IT MATTERS MORE THAN "a message drifted out of the set". The failure is silent and it lands
// on the USER, not on a developer: `ownedRedirectMessage` cannot vouch for a non-member, so
// `ServerError.tsx:8` renders nothing. The person who genuinely hit that refusal watches the form
// reload with no explanation. No error, no log, no red test — the one failure shape that is
// indistinguishable from success in a form flow.
//
// It also closes the WRITE half (`test-plan.md` Risk #4), which until now was carried by a grep
// quoted in prose: "no `.message`, `String(err)` or `JSON.stringify` on any redirect branch". The
// rule below enforces that without naming those spellings — it demands POSITIVE evidence (the
// value is a set member, or is built from one) rather than blacklisting the ways to leak, so a
// spelling nobody thought of is refused by default.
//
// WHY THE COUNT IS A FLOOR HERE, unlike the `toHaveLength(6)` above and the `toHaveLength(11)` in
// `redirect-errors.test.ts`. Those pin populations where a new member is a DECISION worth stopping
// on: a seventh form endpoint, a twelfth vouched string. A new emission of an ALREADY-vouched
// message is ordinary refactoring — a new refusal branch reusing existing copy — and pinning it
// exactly would spend a red run on something that needs no thought. The vocabulary is pinned; its
// number of call sites deliberately is not.
describe("every ?error= value is a member of the closed set", () => {
  const files = sourceFiles(DECKS_API_DIR);

  /** The names this file imported from the closed set — the only ones it may emit. */
  function ownedNames(source: string): Set<string> {
    // `[^}]*` cannot cross a brace, so a multi-line import list is captured and a NEIGHBOURING
    // import's names cannot be swept in by a lazy match that ran too far.
    const match = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/redirect-errors["']/.exec(source);
    return new Set(match ? match[1].split(",").map((name) => name.trim().split(/\s+as\s+/)[0]) : []);
  }

  /** The right-hand side of `const <name> = …;` in the same file, or null if it is not declared there. */
  function localDeclaration(source: string, name: string): string | null {
    const match = new RegExp(`const\\s+${name}\\s*=\\s*([^;]*);`).exec(source);
    return match ? match[1] : null;
  }

  /** Why this expression may not reach `?error=`, or null when it may. */
  function rejection(expression: string, owned: Set<string>, source: string): string | null {
    const encoded = ENCODE_WRAPPER.exec(expression.trim());
    const value = (encoded ? encoded[1] : expression).trim();

    // A literal, `err.message`, `String(err)`, a template — none of them is a bare identifier, so
    // the whole leak class is refused here without the guard having to enumerate it.
    if (!BARE_IDENTIFIER.test(value)) return `not an identifier: ${value}`;
    if (owned.has(value)) return null;

    const declaration = localDeclaration(source, value);
    if (declaration === null) return `\`${value}\` is neither imported from the closed set nor declared here`;

    const literals = valuePositionLiterals(declaration);
    if (literals.length > 0) return `local \`${value}\` assigns a literal: ${literals.join(", ")}`;
    if (![...owned].some((name) => new RegExp(`\\b${name}\\b`).test(declaration))) {
      return `local \`${value}\` is not built from the closed set: ${declaration.trim()}`;
    }
    return null;
  }

  /** Every place a value enters the `?error=` channel in one file, with the reason it may not. */
  function rejectionsIn(file: string): string[] {
    const source = readFileSync(file, "utf8");
    const owned = ownedNames(source);
    const lines = codeLines(file);

    const helpers = new Map<number, { name: string; param: string }>();
    for (const { text, index } of lines) {
      const declared = ERROR_URL_HELPER.exec(text);
      if (declared && text.includes("error=")) helpers.set(index, { name: declared[1], param: declared[2] });
    }
    const helperNames = [...helpers.values()].map((helper) => helper.name);

    return lines.flatMap(({ text, index }) => {
      const found: string[] = [];
      const declared = helpers.get(index);

      if (declared) {
        // The declaration itself is covered rather than skipped: its body must interpolate its OWN
        // parameter and nothing else, or a helper could smuggle a literal past every call site.
        for (const [, expression] of text.matchAll(ERROR_INTERPOLATION)) {
          const encoded = ENCODE_WRAPPER.exec(expression.trim());
          const value = (encoded ? encoded[1] : expression).trim();
          if (value !== declared.param) found.push(label(file, DECKS_API_DIR, index, `helper body: ${value}`));
        }
      } else {
        for (const [, expression] of text.matchAll(ERROR_INTERPOLATION)) {
          const reason = rejection(expression, owned, source);
          if (reason) found.push(label(file, DECKS_API_DIR, index, reason));
        }
      }

      for (const name of helperNames) {
        if (index === [...helpers.entries()].find(([, h]) => h.name === name)?.[0]) continue;
        for (const [, argument] of text.matchAll(new RegExp(`\\b${name}\\s*\\(([^)]*)\\)`, "g"))) {
          const reason = rejection(argument, owned, source);
          if (reason) found.push(label(file, DECKS_API_DIR, index, reason));
        }
      }
      return found;
    });
  }

  /** Every emission site, whatever its verdict — the walker's own reach. */
  function emissionCount(file: string): number {
    const source = readFileSync(file, "utf8");
    const lines = codeLines(file);
    const helperNames = lines
      .filter(({ text }) => ERROR_URL_HELPER.test(text) && text.includes("error="))
      .map(({ text }) => ERROR_URL_HELPER.exec(text)?.[1] ?? "");
    void source;
    return lines.reduce((total, { text }) => {
      const isDeclaration = ERROR_URL_HELPER.test(text) && text.includes("error=");
      const interpolations = isDeclaration ? 0 : [...text.matchAll(ERROR_INTERPOLATION)].length;
      const calls = helperNames.reduce(
        (sum, name) =>
          sum + (isDeclaration ? 0 : [...text.matchAll(new RegExp(`\\b${name}\\s*\\(([^)]*)\\)`, "g"))].length),
        0,
      );
      return total + interpolations + calls;
    }, 0);
  }

  // Positive control, in both halves. Without the floor, a walker that found nothing would make
  // the claim below pass while inspecting zero emissions — the shape this whole file exists to
  // stop. The named files pin that BOTH idioms are reached: `decks/index.ts` interpolates inline,
  // `[publicId]/cards/index.ts` goes through the helper.
  it("reaches every emission site, through both idioms", () => {
    const perFile = files
      .map((file) => [relative(file, DECKS_API_DIR).split(sep).join("/"), emissionCount(file)] as const)
      .filter(([, count]) => count > 0);
    const total = files.reduce((sum, file) => sum + emissionCount(file), 0);

    expect(total).toBeGreaterThanOrEqual(25);
    expect(perFile.length).toBeGreaterThanOrEqual(6);
    expect(emissionCount(join(DECKS_API_DIR, "index.ts"))).toBeGreaterThan(0);
    expect(emissionCount(join(DECKS_API_DIR, "[publicId]", "cards", "index.ts"))).toBeGreaterThan(0);
  });

  // The other half: the detector fires on each regression it claims to detect, and stays silent on
  // every shape that ships today. The four rejections are the four ways a value can enter the
  // channel without the set vouching for it.
  it("rejects a literal, an upstream string, an unknown name and a literal-bearing local", () => {
    const owned = new Set(["CARD_SAVE_FAILED_MESSAGE", "DECK_NAME_TAKEN_MESSAGE"]);
    const source = [
      'const msg = error.code === "23505" ? DECK_NAME_TAKEN_MESSAGE : CARD_SAVE_FAILED_MESSAGE;',
      "const encoded = encodeURIComponent(CARD_SAVE_FAILED_MESSAGE);",
      'const drifted = "Nowy komunikat";',
      "const relayed = err.message;",
    ].join("\n");

    // Shipped shapes — all four must be accepted, or the guard gets weakened by the next person it
    // annoys. `msg` is the real ternary from `decks/index.ts:73`, discriminator literal included.
    expect(rejection("CARD_SAVE_FAILED_MESSAGE", owned, source)).toBeNull();
    expect(rejection("encodeURIComponent(CARD_SAVE_FAILED_MESSAGE)", owned, source)).toBeNull();
    expect(rejection("msg", owned, source)).toBeNull();
    expect(rejection("encoded", owned, source)).toBeNull();

    // Regressions.
    expect(rejection('"Nowy komunikat"', owned, source)).toContain("not an identifier");
    expect(rejection("err.message", owned, source)).toContain("not an identifier");
    expect(rejection("String(err)", owned, source)).toContain("not an identifier");
    expect(rejection("unknownName", owned, source)).toContain("neither imported");
    expect(rejection("drifted", owned, source)).toContain("assigns a literal");
    expect(rejection("relayed", owned, source)).toContain("not built from the closed set");
  });

  // THE CLAIM. Every value that can reach `?error=` on a deck route is a member of the closed set
  // the three deck pages vouch against — by import, or by a local built from one.
  it("emits only values the deck pages can vouch for", () => {
    expect(files.flatMap(rejectionsIn)).toEqual([]);
  });
});
