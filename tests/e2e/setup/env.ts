// The e2e harness's preflight, and the map Playwright hands the dev server it starts.
//
// WHY THIS IS A CONFIG-TIME FUNCTION AND NOT A `globalSetup`. Playwright orders its startup
// tasks `removeOutputDirs` → plugin setup → globalTeardowns → globalSetups
// (playwright/lib/runner/index.js:6003-6010), and `WebServerPlugin.setup()` is what calls
// `_startProcess()` + `_waitForProcess()` (:823-834). So `globalSetup` runs AFTER the app server
// is already up: a check placed there would let a `PROD_`-swapped `.env` boot a server pointed at
// a cloud project before the guard ever spoke, violating the ordering discipline
// `tests/setup/preflight.ts` states at its `assertLocal` call ("Before reachability: never even
// send a request to a non-local host") — cited by SYMBOL rather than by line, because this change
// shortened that file and a pinned number rots the moment either file moves.
// Config-module evaluation is the only point strictly earlier — and it is where the
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
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
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

const SENTRY_HINT = `
Fix:
  remove SENTRY_DSN from .dev.vars.

A DSN in .env or the shell is fine — the map below blanks it for the run. .dev.vars is the one
file it cannot outrank, so a DSN there would make e2e runs report real events to a real project.
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

/**
 * Where the setup project writes the signed-in session and the `chromium` project reads it.
 *
 * It lives in THIS module rather than beside the account it belongs to because `playwright.config.ts`
 * is its other reader, and this is the only module the config already imports — so single-sourcing
 * it here costs no new dependency at config-module evaluation.
 *
 * Single-sourced at all because the drift is silent by construction: a producer writing one path
 * while the consumer reads another leaves every downstream test running SIGNED OUT, and journey B's
 * positive control is the only thing that would notice — reporting it as a guard defect. Same
 * failure shape as the cookie-name derivation below, one layer up.
 */
export const AUTH_STATE_FILE = "playwright/.auth/user.json";

/** For the two shared credential predicates, which take a `Fail` and know nothing of hints. */
const failCredentials: Fail = (problem: string): never => refuse(problem, CREDENTIALS_HINT);

/**
 * The verified map, as a NAMED shape rather than a `Record<string, string>` bag.
 *
 * `noUncheckedIndexedAccess` types every read off a bag as `string | undefined`, so each consumer
 * would have to launder the value through a `?? ""` or a non-null assertion — and both spellings
 * turn "the preflight guarantees this is present" into "whatever was there, or nothing", at the
 * three call sites furthest from the guarantee. Structurally still a `{ [k: string]: string }`,
 * which is what `webServer.env` takes.
 */
// A `type`, NOT an `interface`, and the distinction is load-bearing rather than stylistic:
// TypeScript infers an implicit index signature for an object type ALIAS but never for an
// interface, so `interface E2eEnv` fails to satisfy `webServer.env`'s `{ [key: string]: string }`
// with "Index signature for type 'string' is missing". Measured — this line WAS an interface until
// `npm run typecheck` said otherwise.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type E2eEnv = {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  /** Always `""` — see the forcing below. */
  OPENROUTER_API_KEY: string;
  /** Always `""` — see the forcing below. */
  SENTRY_DSN: string;
  E2E_SESSION_COOKIE_NAME: string;
};

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
  opts: {
    browserExists: boolean;
    devVars?: Record<string, string>;
    shellEnv?: Record<string, string | undefined>;
  },
): E2eEnv {
  const devVars = opts.devVars ?? {};
  const shellEnv = opts.shellEnv ?? {};

  // The two REAL sources, in the child's own order: `.env` < `.dev.vars`. The forced values are
  // deliberately NOT in this merge — they are our own injection, and layering them here would
  // overwrite a `.env` OPENROUTER_API_KEY with `""` before the assertion below could see it,
  // silencing the very case it exists for. (Found by the test, not by reading.)
  const effective: Record<string, string | undefined> = { ...source, ...devVars };

  // Which file a reader must edit. A refusal that names the wrong one is worse than none — the
  // C10X-43 `pre-push` trap, a correct verdict carrying a wrong diagnosis.
  //
  // THREE origins, not two. `source` is vite's `loadEnv(mode, dir, "")`, and with an empty prefix
  // that overlays `process.env` ON TOP of the parsed files (measured: a shell
  // `SUPABASE_URL=…` wins over `.env`). So a value from the ambient shell arrives inside `source`
  // and, checked only against `devVars`, would be reported as "(from .env)" — sending the reader
  // to edit a file that does not contain it. Where the shell and `.env` agree the two are
  // indistinguishable and either answer is actionable; the shell is named only when it is the
  // value that actually won.
  const originOf = (key: string): string => {
    if (key in devVars) return `${key} (from .dev.vars)`;
    if (shellEnv[key] !== undefined && shellEnv[key] === source[key]) return `${key} (from the shell environment)`;
    return `${key} (from .env)`;
  };

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

  // The monitoring seam, and it is the ONE assertion here that is deliberately narrower than its
  // neighbour. `src/worker.ts` is the Worker entry, so every dev request — and therefore every
  // request an e2e journey makes — runs through `withSentry`; a DSN in scope would make the run
  // report real events to a real project. The FORCING below covers `.env` and the shell, and that
  // is enough for them: an optional local DSN is the documented workflow (`src/worker.ts`), so
  // refusing on `effective` would break a legitimate setup to fix a problem the blank already
  // solves. `.dev.vars` is the exception for the same reason as OPENROUTER_API_KEY above — it
  // lands on top of the forced value INSIDE the child — so there, and only there, the assertion is
  // the whole guarantee.
  if (devVars.SENTRY_DSN) {
    refuse(
      `${originOf("SENTRY_DSN")} is set. Every dev request runs through the Worker entry's Sentry ` +
        `wrapper, so the run would report real events from test traffic — and .dev.vars is the one ` +
        `source this preflight cannot blank.`,
      SENTRY_HINT,
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
    // Same mechanism, different reader: nothing in `astro:env` sees this one — `src/worker.ts`
    // reads it off the Worker `env`, and '' is falsy there, which is the SDK's no-transport
    // branch. An absent entry would let an ambient DSN through `webServer.env`'s merge untouched.
    SENTRY_DSN: "",
    // Inert for the child (no astro:env schema entry reads it); it is here because the plan's
    // contract returns one map and the setup project needs the derivation to check that the
    // storageState it wrote could PAIR with this server. Pairing, never liveness.
    E2E_SESSION_COOKIE_NAME: sessionCookieName(url),
  };
}

/**
 * The repository root, derived from THIS module rather than from `process.cwd()`.
 *
 * The child resolves `.dev.vars` from `new URL(".dev.vars", config.root)` — the Astro project
 * root — so a runner resolving it from the working directory would assert against a file the
 * server does not read the moment `npm run e2e` is invoked from anywhere but the root. Same
 * divergence class as the parser below, one layer up: the preflight and the child have to be
 * talking about the same file before they can be talking about the same values.
 */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The thin I/O wrapper `playwright.config.ts` calls at module scope.
 *
 * Deliberately assertion-free: everything worth testing lives in `buildE2eEnv`, so nothing hides
 * behind this seam.
 */
export function resolveE2eEnv(): E2eEnv {
  return buildE2eEnv(loadEnv("development", REPO_ROOT, ""), {
    browserExists: fs.existsSync(chromium.executablePath()),
    devVars: readDevVars(path.join(REPO_ROOT, ".dev.vars")),
    // Supplied so `originOf` can tell a shell-supplied value from a `.env` one — `loadEnv` merges
    // them and the merged map alone cannot say which won. An INPUT, never read inside the pure
    // half, so the unit test can fabricate it (§6.1's C10X-34 rule).
    shellEnv: process.env,
  });
}

/**
 * Reads `.dev.vars` with `node:util`'s `parseEnv` — THE SAME FUNCTION THE CHILD USES, and that
 * identity is the entire point rather than a convenience.
 *
 * A hand-rolled parser stood here until 2026-08-09 and was bypassable by one keyword.
 * `@astrojs/cloudflare` parses this file with `parseEnv` (`dist/index.js:20,292-303`), which
 * strips a leading `export `; the hand-rolled one split on the first `=` and therefore filed
 * `export SUPABASE_URL=…` under the key `"export SUPABASE_URL"`. The assertion never saw it, the
 * preflight went green, and the child booted with whatever that line named — on the ONE source
 * `webServer.env` cannot outrank, i.e. exactly where the assertion is the whole guarantee.
 * Measured before the swap: a cloud `SUPABASE_URL` and a real `OPENROUTER_API_KEY` both passed.
 *
 * Two parsers reading one file IS the defect; borrowing the child's closes the class by
 * construction rather than by keeping two implementations in step — the same reasoning that put
 * `assertAnonKey` / `assertLocal` in one shared module instead of two copies. It also retires the
 * old docstring's "every shape it does not parse simply stays invisible": there is no longer a
 * shape this reader understands differently from the server it is protecting.
 */
function readDevVars(file: string): Record<string, string> | undefined {
  if (!fs.existsSync(file)) return undefined;

  // `parseEnv` is typed `NodeJS.Dict<string>`, so its values are `string | undefined`. Narrowing
  // by filtering rather than casting keeps `originOf`'s `key in devVars` honest: a key that
  // survives here is a key that genuinely carries a value.
  return Object.fromEntries(
    Object.entries(parseEnv(fs.readFileSync(file, "utf8"))).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
