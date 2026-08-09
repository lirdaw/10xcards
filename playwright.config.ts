import { defineConfig, devices } from "@playwright/test";
import { resolveE2eEnv } from "./tests/e2e/setup/env.ts";

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
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
});
