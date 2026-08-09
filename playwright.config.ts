import { defineConfig, devices } from "@playwright/test";
import { AUTH_STATE_FILE, resolveE2eEnv } from "./tests/e2e/setup/env.ts";

// Called at MODULE SCOPE on purpose — this is the whole design of the phase. Playwright orders
// its startup tasks `removeOutputDirs` → plugin setup → globalTeardowns → globalSetups
// (playwright/lib/runner/index.js:6003-6010), and plugin setup is what starts `webServer`
// (:823-834). So `globalSetup` runs AFTER the dev server is already up, and a preflight placed
// there would let a `PROD_`-swapped `.env` boot a server pointed at a cloud project before the
// guard ever spoke. Config-module evaluation is the only point strictly earlier — and it is where
// the map has to be resolved anyway, because `webServer.env` is a config field.
const e2eEnv = resolveE2eEnv();

export default defineConfig({
  testDir: "./tests/e2e",

  // Playwright owns the server, rather than a human remembering to start one. That is what makes
  // the assertion above BINDING rather than descriptive: `webServer.env` outranks `process.env`,
  // which outranks `.env` (:858-862), so the child cannot boot with credentials this config did
  // not verify. The one source it cannot outrank is `.dev.vars`, which @astrojs/cloudflare merges
  // inside the child afterwards — closed by assertion instead, see `tests/e2e/setup/env.ts`.
  webServer: {
    command: "npm run dev",
    // NEVER 127.0.0.1: the dev server binds IPv6 loopback only, measured — `http://localhost:4321`
    // and `http://[::1]:4321` both answer 200 while `http://127.0.0.1:4321` is ECONNREFUSED.
    url: "http://localhost:4321",
    env: e2eEnv,
    // `reuseExistingServer` is deliberately LEFT UNSET. Attaching to a foreign server would leave
    // no oracle at all for which Supabase project it points at — research falsified the one
    // candidate (`POST /api/auth/signout` with no session answers 403 and leaks nothing) — so the
    // local-host guarantee would silently degrade to a hope. An already-listening port is a hard
    // error instead: "… is already used, make sure that nothing is running on the port/url" (:851).
    // The price is a cold Astro/workerd boot per run, and it is the price of the guarantee.
    //
    // 120 s against a MEASURED 5.8 s to HTTP 200 on this machine (2026-08-09, warm npm/vite
    // caches) — ~20x headroom, sized for a first run on a cold cache or a slower machine rather
    // than for the number observed here. Re-measure before tightening it; a webServer timeout
    // that fires is indistinguishable from a broken app to whoever reads the failure.
    timeout: 120_000,
  },

  use: {
    baseURL: "http://localhost:4321",
    // `storageState` is deliberately NOT here. In top-level `use` every project inherits it, so
    // the setup project — the one that exists to CREATE the file — fails to build a context
    // whenever the file is missing, which is exactly the state a fresh checkout is in. It lives
    // on the `chromium` project only. (`route-guard.spec.ts` overrides it locally to an empty
    // state for its signed-out cases; that override is load-bearing and stays.)
    trace: "retain-on-failure",
  },

  // `retain-on-failure`, NOT `on-first-retry`, and `retries` stays 0. The two available repairs
  // for the inert trace are not equivalent: a non-zero `retries` would hide exactly the flakes
  // this project treats as findings — C10X-39 spent a whole change MEASURING a transport flake
  // rather than retrying past it, and test-plan.md §6.2 reads a fresh red as a real defect until
  // proven otherwise. On a human-triggered layer that is never a gate (§5), a retry buys a green
  // nobody should trust.
  retries: 0,

  // ONE WORKER, and it is a MEASURED fix for a false-red class rather than a preference.
  //
  // On 2026-08-09 this layer was flaky: ten runs at the default worker count gave six green at
  // ~12 s and four red, and every red sat on a cold or freshly-invalidated `node_modules/.vite`.
  // Reproduced deliberately by removing that directory. The cause is in the run's own output, not
  // in the app:
  //
  //   [WebServer] [ERROR] [vite] Internal server error: The file does not exist at
  //   ".../node_modules/.vite/deps_ssr/chunk-UVVZ4HX5.js?v=4f8fd614" which is in the optimize deps
  //   directory. The dependency might be incompatible with the dep optimizer.
  //
  // Astro's dev server compiles routes on demand and Vite re-runs SSR dependency optimisation when
  // it discovers new ones, rewriting `deps_ssr/` under a new hash. Requests already in flight then
  // reference a chunk that no longer exists and answer 500, which reaches a spec as
  // `element(s) not found` or a `locator.click` that never becomes actionable — a defect of the
  // dev server under concurrency, arriving dressed as an application failure.
  //
  // `webServer.timeout` cannot cover it: Playwright's readiness probe hits `webServer.url` (`/`)
  // and returns the moment ONE route answers, while every other route pays its compile inside a
  // spec's own 30 s test timeout or a 5 s `expect`, in parallel workers.
  //
  // Measured, cold cache each time: default workers **5 of 7 green** even after a route warm-up
  // was tried; `--workers=1` **11 of 11 green** (5 with that warm-up, 6 without it — which is why
  // the warm-up is not in this repo: it bought nothing once the requests were serialised). The
  // price is ~12 s → ~21 s per run, paid by a human-triggered layer that is never a gate (§5).
  //
  // What this does NOT do, so the next reader does not over-read it: it does not make the layer
  // exercise concurrent users, and it is not a retry — test-plan.md §6.2's rule that a fresh red
  // is a real defect until proven otherwise is untouched. It removes a cause; it hides nothing.
  workers: 1,

  projects: [
    {
      name: "setup",
      // Explicit because Playwright's default pattern requires `.test.` or `.spec.` in the
      // filename. Without it this project collects ZERO tests — and `dependencies: ["setup"]` on
      // an empty project passes trivially, i.e. a green run that produced no session.
      testMatch: /.*\.setup\.ts/,
      use: { storageState: undefined },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE_FILE },
      dependencies: ["setup"],
      // Runs after this project finishes WHATEVER its outcome, which is the whole point: inline
      // cleanup is cleanup that only happens when nothing went wrong, and it has already failed
      // here once (`E2E deck 1785947414992`, orphaned 2026-08-05).
      teardown: "teardown",
    },
    {
      name: "teardown",
      // Same reason as `setup`'s: the default pattern needs `.test.` or `.spec.` in the filename,
      // and `cleanup.teardown.ts` carries neither — without this the project collects ZERO tests
      // and every run reports a clean teardown that never ran.
      testMatch: /.*\.teardown\.ts/,
      // It drives no browser at all (it talks to Postgres as the e2e account), so the session
      // artifact is neither needed nor read here. Explicit so a future move of `storageState` back
      // into top-level `use` cannot make this project depend on a file it never produces.
      use: { storageState: undefined },
    },
  ],
});
