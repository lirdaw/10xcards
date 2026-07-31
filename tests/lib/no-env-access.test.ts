import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// AGENTS.md's first hard rule for `src/`: "Read env only through `astro:env/server`
// (`SUPABASE_URL`, `SUPABASE_KEY`) — never `import.meta.env` or `process.env`." This file is
// that rule's gate.
//
// Why a test rather than lint: no ESLint rule in this project's config forbids either
// spelling, so `import.meta.env.DEV` shipped in `src/pages/auth/confirm-email.astro` with
// `npm run lint` exit 0 and CI green — for long enough that it became the ONE occurrence in
// the whole tree. A prose rule nothing enforces is not a rule; the same reasoning as
// `no-logging.test.ts`, which exists because `no-console` is configured "warn".
//
// The rule is not style. `import.meta.env` is resolved at BUILD time by Vite, so it cannot
// carry a runtime secret and it cannot answer a per-deploy question — which is exactly how
// the occurrence this guard was written for went wrong: `import.meta.env.DEV` was used as a
// proxy for "e-mail confirmations are off", so a production build with confirmations
// disabled promised a message that is never sent. `astro:env/server` reads at request time
// and is typed and validated by the schema.
//
// SCOPE — `src/` only, and that boundary is deliberate rather than convenient. AGENTS.md
// carves out `scripts/` explicitly: those files are CI tooling run by bare
// `node --experimental-strip-types` with no Vite, so `astro:env/server` does not exist there
// and `process.env` is the correct read. Widening this scan to the repo would fail on
// correct code. `evals/` is likewise outside `src/` and outside this claim.

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));

/**
 * Textual, for the same reason `no-logging.test.ts` is: `.astro` files are not parseable by
 * anything this suite loads, and the tree's `.astro` third is where the violation actually
 * lived. The cost is that a mention inside a comment or a string also trips the guard — that
 * is the intended trade (reword the comment), and the failure message names file and line.
 */
const ENV_ACCESS: { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: "import.meta.env", pattern: /(?<![\w$])import\s*\.\s*meta\s*(?:\.\s*env(?![\w$])|\[\s*["'`]env["'`]\s*\])/ },
  { rule: "process.env", pattern: /(?<![\w$])process\s*(?:\.\s*env(?![\w$])|\[\s*["'`]env["'`]\s*\])/ },
];

// What these patterns do and do NOT catch, spelled out so nobody reads the guard as total:
//
//   caught  import.meta.env.DEV · import . meta . env · import.meta["env"].MODE
//   caught  process.env.FOO · globalThis.process.env · process["env"]
//   NOT     const e = import.meta.env; e.DEV — an alias is not textually an env read, and
//           nothing short of an AST pass over .astro files could see it. Accepted: this
//           guards against the accidental read that ships, not against routing around it.
//   NOT     a read split across lines — the scan is line-by-line (see envAccessIn).
//   not a false positive on `import.meta.url` (used by this very file), nor on
//           `myprocess.env` / `preprocess.env`: the `env` member is required and the
//           lookbehind rejects an identifier character before `process`.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

function envAccessIn(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .flatMap((line, index) => {
      const hit = ENV_ACCESS.find(({ pattern }) => pattern.test(line));
      if (!hit) return [];
      return [`${relative(SRC_DIR, file).split(sep).join("/")}:${index + 1}: [${hit.rule}] ${line.trim()}`];
    });
}

describe("src/ reads env only through astro:env/server", () => {
  const files = sourceFiles(SRC_DIR);

  // Positive control, load-bearing rather than ceremony: a walker that returned an empty
  // list, or patterns that matched nothing, would make the assertion below pass while
  // guarding nothing at all. The named files pin that the walk reaches both the module tree
  // and the page tree — the violation this guard was written for was in an `.astro` page.
  it("scans the whole src/ tree", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((f) => relative(SRC_DIR, f).split(sep).join("/"))).toEqual(
      expect.arrayContaining([
        "lib/supabase.ts",
        "lib/openrouter.ts",
        "pages/auth/confirm-email.astro",
        "pages/api/auth/signin.ts",
      ]),
    );
  });

  // The other half of the control: the detectors fire on what they claim to detect,
  // including the spacings and bracket forms a plain `includes("import.meta.env")` misses.
  it("detects an env read when there is one", () => {
    for (const sample of [
      "const isAutoConfirmed = import.meta.env.DEV;",
      "import . meta . env",
      'import.meta["env"].MODE',
      "process.env.SUPABASE_URL",
      "globalThis.process.env",
      "process['env']",
    ])
      expect(ENV_ACCESS.some(({ pattern }) => pattern.test(sample))).toBe(true);

    // False positives matter as much: this file fails the build, so a guard that fires on an
    // unrelated identifier gets weakened by the next person it annoys. `import.meta.url` is
    // the one that would bite immediately — this suite uses it, and so may `src/`.
    for (const sample of [
      "const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));",
      "myprocess.env",
      "preprocess.env",
      "import { SUPABASE_URL } from 'astro:env/server';",
    ])
      expect(ENV_ACCESS.some(({ pattern }) => pattern.test(sample))).toBe(false);
  });

  it("contains no import.meta.env or process.env read anywhere", () => {
    expect(files.flatMap(envAccessIn)).toEqual([]);
  });
});
