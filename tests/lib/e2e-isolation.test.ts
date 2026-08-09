import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Harness finding 4 (test-plan.md §3 Phase 6): the two runners are separated by a FILENAME
// INFIX alone, inside one directory, with nothing asserting it in either direction — weaker
// than the eval, whose separation is a second config's `include` plus two runtime preflights
// that fail in opposite directions. This file is that assertion.
//
// The subject is two config files at the repository root rather than anything under `src/`,
// so the test sits in `tests/lib/` beside the suite's other pure-function files — test-plan.md
// §6.1's clarification, the same placement `typecheck.test.ts` and `kong-keepalive.test.ts`
// take for their own out-of-`src/` subjects.
//
// WHY IT MATTERS IN BOTH DIRECTIONS, because only one direction is obvious:
//
//   tests/e2e/foo.test.ts   Vitest's include is `tests/**/*.test.ts`, and Playwright's default
//                           testMatch takes `.test.` as well as `.spec.` — so this ONE file is
//                           collected by BOTH runners, and this node-only suite then tries to
//                           drive a browser spec. Demonstrated before this guard existed: a
//                           planted `tests/e2e/scratch.test.ts` was listed by `npx vitest list`.
//   src/foo.spec.ts         A Playwright spec outside `testDir` is collected by NEITHER runner.
//                           It is silently dead — the failure mode is a green run, which is the
//                           one this project treats as worse than a red.
//
// KEYED ON THE CONFIGS, NEVER ON A COPY OF THEM. Both patterns are read out of the real
// `vitest.config.ts` and `playwright.config.ts` rather than restated here. Restating them is the
// class §6.6 records the cost of four times — a guard "correct on what it looks at and silent
// about what it never looks at" — and here it bites for real: widening Vitest's include to
// `tests/**/*.{test,spec}.ts` breaks the separation completely while a hardcoded copy stays
// green. The price is a textual read of two config files, which is why the extraction itself
// carries positive controls below.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VITEST_CONFIG = join(REPO_ROOT, "vitest.config.ts");
const PLAYWRIGHT_CONFIG = join(REPO_ROOT, "playwright.config.ts");

/** Generated, vendored or non-source trees. Dot-directories cover `.git`, `.astro`, `.wrangler`,
 * `.playwright-cli`, `.husky` and `.stryker-tmp` in one rule; the three named ones are the
 * non-dotted equivalents. `context/` is documentation and is excluded from `tsconfig.json` too. */
const SKIP_DIRS = new Set(["node_modules", "dist", "context", "test-results", "playwright-report"]);

/** A Playwright spec by filename, i.e. what its default `testMatch` would take on the `.spec.`
 * side. The `.test.` side is deliberately NOT here — that suffix belongs to Vitest in this
 * repository, and claim 1 below is what keeps it out of `testDir`. */
const SPEC_FILE = /\.spec\.[jt]sx?$/;

function repoFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return entry.name.startsWith(".") || SKIP_DIRS.has(entry.name) ? [] : repoFiles(join(dir, entry.name));
    }
    return [join(dir, entry.name)];
  });
}

/** Repo-relative and slash-separated, so a Windows path compares against a config glob. */
function repoPath(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join("/");
}

/**
 * The glob subset the two configs actually use: `**` (crossing separators, and matching zero
 * directories when it is followed by a slash), `*`, `?` and `{a,b}` alternation. Hand-rolled
 * rather than taken from `picomatch`, which is present only as a transitive dependency of
 * Vitest's own globber and would vanish from a lockfile change with nothing declaring it.
 *
 * A converter that matched NOTHING would make every assertion in this file pass while guarding
 * nothing, so it carries its own controls: the fabricated-path case below, and — the half that
 * catches a matcher which merely rejects everything — a real file this suite genuinely collects.
 */
function globToRegExp(glob: string): RegExp {
  // Indexed rather than spread: a glob is ASCII by construction, but `[...string]` yields code
  // POINTS and `no-misused-spread` is right that the distinction bites on real text — no reason
  // to carry an inline disable for a loop that never needed the spread.
  const REGEXP_SPECIALS = new Set(".+^$()|[]\\");
  let out = "";
  let braceDepth = 0;

  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] ?? "";
    if (char === "*") {
      if (glob[i + 1] === "*") {
        i += 1;
        if (glob[i + 1] === "/") {
          i += 1;
          out += "(?:[^/]+/)*";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "{") {
      braceDepth += 1;
      out += "(?:";
    } else if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
      out += ")";
    } else if (char === "," && braceDepth > 0) {
      out += "|";
    } else {
      out += REGEXP_SPECIALS.has(char) ? `\\${char}` : char;
    }
  }

  return new RegExp(`^${out}$`);
}

/** Every string literal inside the config's `include: [...]` array. */
function readVitestInclude(source: string): string[] {
  const array = /\binclude:\s*\[([^\]]*)\]/.exec(source)?.[1] ?? "";
  return [...array.matchAll(/["'`]([^"'`]+)["'`]/g)].map((match) => match[1] ?? "");
}

/** Playwright's `testDir`, normalised to a repo-relative directory prefix (`tests/e2e/`). */
function readPlaywrightTestDir(source: string): string | null {
  const raw = /\btestDir:\s*["'`]([^"'`]+)["'`]/.exec(source)?.[1];
  return raw === undefined ? null : `${raw.replace(/^\.\//, "").replace(/\/$/, "")}/`;
}

describe("the Vitest and Playwright runners collect disjoint file sets", () => {
  const files = repoFiles(REPO_ROOT).map(repoPath);
  const includes = readVitestInclude(readFileSync(VITEST_CONFIG, "utf8"));
  const testDir = readPlaywrightTestDir(readFileSync(PLAYWRIGHT_CONFIG, "utf8"));
  // The two violation predicates, named rather than inlined into their claims, so the controls
  // below can drive them on fabricated paths. Without that, each claim is an assertion that a
  // list is empty — satisfied just as well by a predicate that never fires as by a clean tree.
  // Returns the MATCHING pattern rather than a boolean, so a failure can name it. With one
  // include that reads as a detail; with two it is the difference between "rename your file" and
  // "somebody widened `include` and every spec now trips this" — the C10X-43 class, where a guard
  // is right about the violation and sends the reader to the wrong file to fix it.
  const vitestPatternFor = (path: string) => includes.find((glob) => globToRegExp(glob).test(path)) ?? null;
  const collectedByVitest = (path: string) => vitestPatternFor(path) !== null;
  const isOrphanedSpec = (path: string) => SPEC_FILE.test(path) && testDir !== null && !path.startsWith(testDir);

  // Control 1 — the walker reaches the tree. A walker returning an empty list satisfies both
  // claims below while looking at nothing at all, which is the `listDueCounts` false-pass shape
  // §6.6 records: a denial asserted as "absent from a set" decays into a pass when the set is
  // empty for an unrelated reason.
  it("walks the repository and reaches both runners' files", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toEqual(
      expect.arrayContaining([
        "tests/lib/e2e-isolation.test.ts",
        "tests/e2e/seed.spec.ts",
        "tests/e2e/setup/env.ts",
        "src/middleware.ts",
      ]),
    );
  });

  // Control 2 — the extraction found something. `include` moving into a variable, a spread, or a
  // second config file would leave `includes` empty, and claim 1 would then pass over every file
  // in the repository. This is the guard's own version of "a command that always exits 0".
  it("reads the runners' real patterns out of their configs", () => {
    expect(includes).not.toHaveLength(0);
    expect(includes).toContain("tests/**/*.test.ts");
    expect(testDir).toBe("tests/e2e/");
  });

  // Control 3 — the Vitest matcher fires, in both directions. The fabricated path is the
  // violation claim 1 exists to catch, so it must match even when no such file exists; the real
  // one is the half that kills a matcher which simply rejects everything.
  it("matches a fabricated tests/e2e/*.test.ts and a file the suite really collects", () => {
    expect(collectedByVitest("tests/e2e/foo.test.ts")).toBe(true);
    expect(collectedByVitest("tests/harness.test.ts")).toBe(true);

    // …and does not fire on the two shapes that are legal: a Playwright spec, and a non-spec
    // helper module beside it. Both live under `tests/e2e/`, so a directory-scoped rule would
    // reject them — the rule is about Vitest's `include`, never about the directory's contents.
    expect(collectedByVitest("tests/e2e/seed.spec.ts")).toBe(false);
    expect(collectedByVitest("tests/e2e/setup/env.ts")).toBe(false);
  });

  // Control 4 — the same for claim 2, and it is the one this file nearly shipped without. No
  // orphaned spec exists today, so that claim's list is empty either way: a `SPEC_FILE` that
  // matched nothing, or a `testDir` prefix compared the wrong way round, would read exactly as
  // green as a clean tree does.
  it("recognises a Playwright spec stranded outside testDir", () => {
    expect(isOrphanedSpec("src/components/Deck.spec.ts")).toBe(true);
    expect(isOrphanedSpec("tests/lib/stranded.spec.tsx")).toBe(true);

    expect(isOrphanedSpec("tests/e2e/seed.spec.ts")).toBe(false);
    expect(isOrphanedSpec("tests/lib/http.test.ts")).toBe(false);
  });

  it("keeps Vitest out of the Playwright directory", () => {
    const offenders = files.flatMap((path) => {
      const pattern = testDir !== null && path.startsWith(testDir) ? vitestPatternFor(path) : null;
      return pattern === null
        ? []
        : [
            `${path} — lives under Playwright's testDir "${testDir ?? ""}" and ALSO matches Vitest's include "${pattern}", so BOTH runners collect it and this node-only suite tries to drive a browser spec; rename it to *.spec.ts, or move it out of ${testDir ?? ""} if it is a Vitest test`,
          ];
    });

    expect(offenders).toEqual([]);
  });

  it("keeps Playwright specs inside the Playwright directory", () => {
    const offenders = files.flatMap((path) =>
      isOrphanedSpec(path)
        ? [
            `${path} — a Playwright spec outside testDir "${testDir}", so NEITHER runner collects it and it fails silently; move it under ${testDir}`,
          ]
        : [],
    );

    expect(offenders).toEqual([]);
  });
});
