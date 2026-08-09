// The e2e harness's preflight, and the map Playwright hands the dev server it starts.
//
// WHY THIS IS A CONFIG-TIME FUNCTION AND NOT A `globalSetup`. Playwright orders its startup
// tasks `removeOutputDirs` → plugin setup → globalTeardowns → globalSetups
// (playwright/lib/runner/index.js:6003-6010), and `WebServerPlugin.setup()` is what calls
// `_startProcess()` + `_waitForProcess()` (:823-834). So `globalSetup` runs AFTER the app server
// is already up: a check placed there would let a `PROD_`-swapped `.env` boot a server pointed at
// a cloud project before the guard ever spoke, violating the ordering discipline
// `tests/setup/preflight.ts:138` exists to state ("never even send a request to a non-local
// host"). Config-module evaluation is the only point strictly earlier — and it is where the
// resolved map has to be anyway, because `webServer.env` is a config field.
//
// WHY THE MAP IS THE LEVER, NOT THE ASSERTION. An assertion over `process.env` in the RUNNER says
// nothing about the CHILD. Playwright merges
// `{ ...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env, ...this._options.env }` (:858-862), so
// `webServer.env` outranks `process.env`, which outranks `.env`. Passing the verified values back
// through `webServer.env` is what turns "we checked" into "it cannot be otherwise".
//
// THE ONE EXCEPTION, NAMED SO THE CLAIM STAYS HONEST. `@astrojs/cloudflare` runs
// `if (existsSync(devVarsPath)) { … Object.assign(process.env, parsed) }` at `astro:config:done`
// INSIDE the child (@astrojs/cloudflare/dist/index.js:292-303) — after `webServer.env` has landed.
// So on that one source the guarantee is the ASSERTION rather than the forcing, which is why the
// value under assertion below is the MERGED map modelled in the child's own order. Measured
// 2026-08-09: no `.dev.vars` on this machine, so this is a latent seam, not a live incident —
// exactly the case lessons.md's "Preflight musi domknąć KAŻDY nielokalny szew" is written for.
//
// The split into a pure half and an I/O wrapper is test-plan.md §6.1's C10X-34 rule: extract the
// decision AND its inputs. `tests/lib/e2e-env.test.ts` drives `buildE2eEnv` with fabricated
// inputs, including the two states this machine cannot be in.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { loadEnv } from "vite";
import { assertAnonKey, assertLocal, sessionCookieName, type Fail } from "../../setup/env-assertions.ts";

// THREE hints, not one, and the split is a fix rather than a flourish. A single hint block
// covering every failure class means the reader whose browser is missing is handed three
// Supabase steps first and finds the real remedy at position four — a correct verdict carrying a
// wrong diagnosis, which is the C10X-43 `pre-push` trap and exactly what manual criterion 1.10
// exists to catch. Each `fail` below binds the remedy for its own class.

const CREDENTIALS_HINT = `
Fix:
  1. npm run db:start          (starts the local Supabase stack)
  2. npx supabase status       (prints Project URL + Publishable key)
  3. copy them into .env as SUPABASE_URL / SUPABASE_KEY (see .env.example)

If you keep a .dev.vars file, check that too: @astrojs/cloudflare merges it into the dev
server's environment AFTER Playwright's webServer.env, so a value there overrides everything
this preflight forces. The line above names which of the two files carries the problem.
`;

const GENERATION_HINT = `
Fix:
  unset OPENROUTER_API_KEY for the run — in .env, and in .dev.vars if you keep one.

The journeys assert on mock output; a real key also makes the run place billed calls.
`;

const BROWSER_HINT = `
Fix:
  npx playwright install chromium

A deliberate one-off: this repo has no postinstall step, so a fresh checkout installs the
runner without the ~150 MB browser until someone asks for it.
`;

function refuse(problem: string, hint: string): never {
  throw new Error(`E2E preflight failed: ${problem}\n${hint}`);
}

/** For the two shared credential predicates, which take a `Fail` and know nothing of hints. */
const failCredentials: Fail = (problem: string): never => refuse(problem, CREDENTIALS_HINT);

/**
 * The environment the dev server is allowed to boot with, or a throw naming the reason.
 *
 * PURE — every input is a parameter, so `tests/lib/e2e-env.test.ts` can drive the states the
 * runner cannot be in (a cloud host, a service-role key, a `.dev.vars` layer, a missing browser).
 *
 * @param source  `.env` as vite's `loadEnv(mode, cwd, "")` returns it — the same call Astro makes.
 * @param opts.browserExists  whether the chromium binary is on disk. A parameter, not a stat,
 *   because `chromium.executablePath()` does NOT throw when browsers are absent (measured: it
 *   returns a path regardless), so the presence check must be `fs.existsSync` and it must live in
 *   the wrapper.
 * @param opts.devVars  the parsed `.dev.vars`, if one exists. Parsed rather than merely detected,
 *   so a developer who legitimately keeps a local one gets the same protection instead of a
 *   blanket refusal.
 */
export function buildE2eEnv(
  source: Record<string, string | undefined>,
  opts: { browserExists: boolean; devVars?: Record<string, string> },
): Record<string, string> {
  const devVars = opts.devVars ?? {};

  // The two REAL sources, in the child's own order: `.env` < `.dev.vars`. The forced values are
  // deliberately NOT in this merge — they are our own injection, and layering them here would
  // overwrite a `.env` OPENROUTER_API_KEY with `""` before the assertion below could see it,
  // silencing the very case it exists for. (Found by the test, not by reading.)
  const effective: Record<string, string | undefined> = { ...source, ...devVars };

  // Which file a reader must edit. A refusal that names the wrong one is worse than none.
  const originOf = (key: string): string => `${key} (from ${key in devVars ? ".dev.vars" : ".env"})`;

  const url = effective.SUPABASE_URL;
  const key = effective.SUPABASE_KEY;
  if (!url) refuse("SUPABASE_URL is not set.", CREDENTIALS_HINT);
  if (!key) refuse("SUPABASE_KEY is not set.", CREDENTIALS_HINT);

  assertAnonKey(key, failCredentials, originOf("SUPABASE_KEY"));
  // Before anything that could touch the network: never even resolve a non-local host.
  assertLocal(url, failCredentials, originOf("SUPABASE_URL"));

  // The generation seam. The FORCING covers an ambient key; this ASSERTION is the whole
  // guarantee for a `.dev.vars` one, which lands on top of the forced value inside the child.
  if (effective.OPENROUTER_API_KEY) {
    refuse(
      `${originOf("OPENROUTER_API_KEY")} is set. The e2e journeys assert card counts that only ` +
        `mock generation guarantees, and a real key makes the run place billed calls to ` +
        `openrouter.ai carrying the journey's source text.`,
      GENERATION_HINT,
    );
  }

  // LAST, so a missing browser never masks a data-safety seam above it.
  if (!opts.browserExists) {
    refuse("the chromium binary Playwright needs is not installed.", BROWSER_HINT);
  }

  return {
    SUPABASE_URL: url,
    SUPABASE_KEY: key,
    // '' rather than an absent entry: astro/templates/env.mjs maps '' → undefined, while an
    // absent entry would let `process.env` flow through webServer.env's merge untouched.
    OPENROUTER_API_KEY: "",
    // Inert for the child (no astro:env schema entry reads it); it is here because the plan's
    // contract returns one map and the setup project needs the derivation to check that the
    // storageState it wrote could PAIR with this server. Pairing, never liveness.
    E2E_SESSION_COOKIE_NAME: sessionCookieName(url),
  };
}

/**
 * The thin I/O wrapper `playwright.config.ts` calls at module scope.
 *
 * Deliberately assertion-free: everything worth testing lives in `buildE2eEnv`, so nothing hides
 * behind this seam.
 */
export function resolveE2eEnv(): Record<string, string> {
  const cwd = process.cwd();
  return buildE2eEnv(loadEnv("development", cwd, ""), {
    browserExists: fs.existsSync(chromium.executablePath()),
    devVars: readDevVars(path.join(cwd, ".dev.vars")),
  });
}

function readDevVars(file: string): Record<string, string> | undefined {
  if (!fs.existsSync(file)) return undefined;
  return parseDevVars(fs.readFileSync(file, "utf8"));
}

/**
 * A minimal `.dev.vars` (dotenv-format) reader.
 *
 * First-party because this repo carries no `dotenv` dependency to borrow, and exported because
 * the `.dev.vars` assertions in `buildE2eEnv` are only as good as what reads the file — so it
 * belongs in front of the I/O seam, not behind it. Deliberately narrow: `KEY=value`, optional
 * surrounding quotes, `#` comments and blank lines. It does NOT implement dotenv's multi-line
 * values or variable expansion, because a value this preflight would wave through on a parse
 * miss is a value it must instead refuse — and every shape it does not parse simply stays
 * invisible, which is the failure direction to watch if a refusal ever reads as a false green.
 */
export function parseDevVars(text: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    if (key === "") continue;

    // Split on the FIRST `=` only: a token or URL carrying its own `=` must survive whole.
    const raw = trimmed.slice(separator + 1).trim();
    const quoted = raw.length >= 2 && (raw.startsWith('"') || raw.startsWith("'")) && raw.at(-1) === raw[0];
    parsed[key] = quoted ? raw.slice(1, -1) : raw;
  }

  return parsed;
}
