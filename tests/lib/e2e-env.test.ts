import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
// `@/*` maps to `src/*` only, and the subject here is the Playwright harness's config-time
// preflight under `tests/e2e/setup/` — see test-plan.md §6.1 on why its test still sits in
// tests/lib/ beside the suite's other pure-function files rather than in a folder of its own.
import { buildE2eEnv } from "../e2e/setup/env.ts";

// The decidable half of the e2e preflight. `resolveE2eEnv()` beside it reads `.env` through
// vite's `loadEnv`, parses `.dev.vars` and stats the chromium binary; this half owns every
// assertion, which is what lets each case below be FABRICATED.
//
// That split is the point, not a tidiness preference (test-plan.md §6.1, the C10X-34 rule:
// extract the decision AND its inputs). A no-arg function reading this machine's `.env` is
// only ever testable in the state this machine happens to be in — and the state that matters
// is the one it is not in. Two cases here are unreachable any other way: a `.dev.vars` layer
// (no such file exists on this machine, measured 2026-08-09) and a cloud `SUPABASE_URL`.
//
// WHAT THIS MODULE EXISTS FOR. Playwright orders `removeOutputDirs` → plugin setup →
// globalTeardowns → globalSetups (playwright/lib/runner/index.js:6003-6010), and
// `WebServerPlugin.setup()` starts the app server (:823-834). So a check placed in
// `globalSetup` runs AFTER `npm run dev` has already booted — and a `PROD_`-swapped `.env`
// would have reached a cloud project before the guard spoke. Config-module evaluation is the
// only point strictly earlier, which is why these assertions live in a plain function the
// config calls at import time.

const LOCAL_KEY = "sb_publishable_abcdefghijklmnopqrstuv";
const BROWSER_PRESENT = { browserExists: true };

/** A valid local `.env`, as `loadEnv` would hand it over. Every case starts from this. */
function localSource(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_KEY: LOCAL_KEY, ...overrides };
}

/** A legacy-format key carrying an arbitrary role claim. Decoded, never verified. */
function jwtWithRole(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `header.${payload}.signature`;
}

describe("buildE2eEnv", () => {
  // THE POSITIVE CONTROL. Without it every rejection case below is satisfied by a function
  // that throws on all input, which reads as perfect protection and enforces nothing.
  it("resolves a valid local environment into the map the child server is given", () => {
    const env = buildE2eEnv(localSource(), BROWSER_PRESENT);

    expect(env.SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.SUPABASE_KEY).toBe(LOCAL_KEY);
  });

  it.each([
    ["127.0.0.1", "http://127.0.0.1:54321"],
    ["localhost", "http://localhost:54321"],
  ])("accepts the local host %s", (_hostname, url) => {
    expect(() => buildE2eEnv(localSource({ SUPABASE_URL: url }), BROWSER_PRESENT)).not.toThrow();
  });

  it("refuses a cloud SUPABASE_URL, naming the host", () => {
    const source = localSource({ SUPABASE_URL: "https://abcdefgh.supabase.co" });

    expect(() => buildE2eEnv(source, BROWSER_PRESENT)).toThrow(/abcdefgh\.supabase\.co/);
  });

  it.each([
    ["a secret key", "sb_secret_abcdefghijklmnop"],
    ["a service_role JWT", jwtWithRole("service_role")],
  ])("refuses %s in SUPABASE_KEY", (_label, key) => {
    expect(() => buildE2eEnv(localSource({ SUPABASE_KEY: key }), BROWSER_PRESENT)).toThrow(/RLS/);
  });

  it.each([["SUPABASE_URL"], ["SUPABASE_KEY"]])("refuses a missing %s", (name) => {
    expect(() => buildE2eEnv(localSource({ [name]: undefined }), BROWSER_PRESENT)).toThrow(
      new RegExp(`${name} is not set`),
    );
  });

  // Mock generation is the seam that keeps the journeys deterministic and unbilled. The
  // ASSERTION covers a key that is present; the FORCING below covers a key that is ambient.
  it("refuses a set OPENROUTER_API_KEY", () => {
    const source = localSource({ OPENROUTER_API_KEY: "sk-or-v1-deadbeef" });

    expect(() => buildE2eEnv(source, BROWSER_PRESENT)).toThrow(/OPENROUTER_API_KEY/);
  });

  it("forces OPENROUTER_API_KEY to the empty string in the returned map", () => {
    // astro/templates/env.mjs maps '' → undefined, so the child cannot receive a key whatever
    // the ambient environment holds. The empty string IS the guarantee; an absent entry would
    // let `process.env` flow through `webServer.env`'s merge untouched.
    const env = buildE2eEnv(localSource(), BROWSER_PRESENT);

    expect(env.OPENROUTER_API_KEY).toBe("");
  });

  // The monitoring seam. `src/worker.ts` is the Worker entry, so every dev request an e2e journey
  // makes runs through `withSentry` — an ambient DSN would report real events from test traffic.
  it("forces SENTRY_DSN to the empty string in the returned map", () => {
    // '' is falsy where the wrapper reads it, which is the SDK's no-transport branch. Pinned so
    // that removing the blank is a RED rather than a silent return to emitting events.
    const env = buildE2eEnv(localSource({ SENTRY_DSN: "https://fake@fake.ingest.example/1" }), BROWSER_PRESENT);

    expect(env.SENTRY_DSN).toBe("");
  });

  // The deliberate ASYMMETRY with OPENROUTER_API_KEY above, pinned so it cannot be "tidied" into
  // symmetry. A key is refused wherever it comes from; a DSN is refused only from `.dev.vars`,
  // because an optional local DSN in `.env` is the documented workflow (`src/worker.ts`) and the
  // forcing already covers it. Without this case, tightening the assertion to `effective` would
  // break that workflow with every test still green.
  it("blanks a .env or shell SENTRY_DSN rather than refusing it", () => {
    const dsn = "https://fake@fake.ingest.example/1";
    const opts = { ...BROWSER_PRESENT, shellEnv: { SENTRY_DSN: dsn } };

    expect(() => buildE2eEnv(localSource({ SENTRY_DSN: dsn }), opts)).not.toThrow();
  });

  it.each([
    ["http://127.0.0.1:54321", "sb-127-auth-token"],
    ["http://localhost:54321", "sb-localhost-auth-token"],
  ])("derives the session cookie name for %s", (url, expected) => {
    // Derived from the SAME asserted URL, so the setup project can check that the artifact it
    // wrote could pair with this server. It proves PAIRING, never liveness.
    const env = buildE2eEnv(localSource({ SUPABASE_URL: url }), BROWSER_PRESENT);

    expect(env.E2E_SESSION_COOKIE_NAME).toBe(expected);
  });

  // The browser check is LAST on purpose: a missing binary must never mask a data-safety seam.
  it("refuses a missing chromium binary, naming the install command", () => {
    expect(() => buildE2eEnv(localSource(), { browserExists: false })).toThrow(/npx playwright install chromium/);
  });

  it("reports the cloud host rather than the missing browser when both are wrong", () => {
    const source = localSource({ SUPABASE_URL: "https://abcdefgh.supabase.co" });

    expect(() => buildE2eEnv(source, { browserExists: false })).toThrow(/abcdefgh\.supabase\.co/);
  });

  // THE ORIGIN IS PART OF THE VERDICT. vite's `loadEnv` with an empty prefix overlays
  // `process.env` on top of the parsed files, so a shell-supplied value arrives inside `source`
  // and — checked only against `.dev.vars` — would be blamed on `.env`, sending the reader to edit
  // a file that does not contain it (the C10X-43 trap: correct verdict, wrong diagnosis).
  describe("names WHERE the offending value came from", () => {
    const cloud = "https://abcdefgh.supabase.co";

    it("blames the shell when the shell is what loadEnv let win", () => {
      const opts = { ...BROWSER_PRESENT, shellEnv: { SUPABASE_URL: cloud } };

      expect(() => buildE2eEnv(localSource({ SUPABASE_URL: cloud }), opts)).toThrow(/from the shell environment/);
    });

    it("blames .env when the shell carries no such value", () => {
      const opts = { ...BROWSER_PRESENT, shellEnv: { SOMETHING_ELSE: "x" } };

      expect(() => buildE2eEnv(localSource({ SUPABASE_URL: cloud }), opts)).toThrow(/SUPABASE_URL \(from \.env\)/);
    });

    it("blames .dev.vars ahead of both, because it outranks both inside the child", () => {
      const opts = { ...BROWSER_PRESENT, devVars: { SUPABASE_URL: cloud }, shellEnv: { SUPABASE_URL: cloud } };

      expect(() => buildE2eEnv(localSource(), opts)).toThrow(/from \.dev\.vars/);
    });
  });

  // `.dev.vars` OUTRANKS everything this preflight controls. @astrojs/cloudflare runs
  // `Object.assign(process.env, parsed)` at `astro:config:done` INSIDE the child
  // (@astrojs/cloudflare/dist/index.js:292-303) — after `webServer.env` has already landed.
  // The runner's `loadEnv` never sees that file, so without this layer the preflight would be
  // asserting against a file the server does not read.
  describe("with a .dev.vars layer", () => {
    it("refuses a cloud SUPABASE_URL that only .dev.vars carries", () => {
      const opts = { ...BROWSER_PRESENT, devVars: { SUPABASE_URL: "https://abcdefgh.supabase.co" } };

      expect(() => buildE2eEnv(localSource(), opts)).toThrow(/abcdefgh\.supabase\.co/);
    });

    it("names .dev.vars, not .env, when .dev.vars is what carries the offending value", () => {
      // A refusal that points at the wrong file sends the reader to edit the innocent one —
      // the C10X-43 `pre-push` trap, where a correct exit code carried a wrong diagnosis.
      const opts = { ...BROWSER_PRESENT, devVars: { SUPABASE_URL: "https://abcdefgh.supabase.co" } };

      // Asserted on the PROBLEM LINE, not on a bare `.dev.vars` match: the credentials hint
      // mentions that file on every credential failure, so `toThrow(/\.dev\.vars/)` would be
      // satisfied whatever `originOf` decided — an assertion that cannot go red. Proved by
      // breakage: pinning `originOf` to ".env" turns exactly this case red.
      expect(() => buildE2eEnv(localSource(), opts)).toThrow(/SUPABASE_URL \(from \.dev\.vars\)/);
      expect(() => buildE2eEnv(localSource(), opts)).not.toThrow(/SUPABASE_URL \(from \.env\)/);
    });

    it("refuses an OPENROUTER_API_KEY that only .dev.vars carries", () => {
      // This is the one source the FORCING cannot reach: `.dev.vars` lands on top of the
      // forced empty string inside the child, so here the assertion is the whole guarantee.
      const opts = { ...BROWSER_PRESENT, devVars: { OPENROUTER_API_KEY: "sk-or-v1-deadbeef" } };

      expect(() => buildE2eEnv(localSource(), opts)).toThrow(/OPENROUTER_API_KEY/);
    });

    it("refuses a SENTRY_DSN that only .dev.vars carries", () => {
      // The assertion half of the pair. The forcing blanks `.env` and the shell; this file lands
      // on top of the forced `""` inside the child, so here refusing is the only guarantee — and
      // it is why the DSN seam is asserted at all despite `.env` being allowed to carry one.
      const opts = { ...BROWSER_PRESENT, devVars: { SENTRY_DSN: "https://fake@fake.ingest.example/1" } };

      expect(() => buildE2eEnv(localSource(), opts)).toThrow(/SENTRY_DSN \(from \.dev\.vars\)/);
    });

    it("resolves clean when .dev.vars carries only local values", () => {
      // A developer who legitimately keeps a local `.dev.vars` gets the same protection, not a
      // blanket refusal — which is why the file is PARSED rather than merely detected.
      const opts = { ...BROWSER_PRESENT, devVars: { SUPABASE_URL: "http://localhost:54321" } };
      const env = buildE2eEnv(localSource(), opts);

      expect(env.SUPABASE_URL).toBe("http://localhost:54321");
      expect(env.E2E_SESSION_COOKIE_NAME).toBe("sb-localhost-auth-token");
    });
  });
});

// The `.dev.vars` layer above is only as good as what READS the file, and until 2026-08-09 this
// block tested a first-party parser that read it differently from the server it was protecting.
//
// That divergence was the defect (impl-review F1). `@astrojs/cloudflare` parses `.dev.vars` with
// `node:util`'s `parseEnv` (`dist/index.js:20,292-303`), which strips a leading `export `; the
// hand-rolled parser split on the first `=` and filed `export SUPABASE_URL=…` under the key
// `"export SUPABASE_URL"`. `buildE2eEnv` therefore never saw it and returned GREEN while the
// child booted against a cloud project with a real OPENROUTER_API_KEY — on the one source
// `webServer.env` cannot outrank, where the assertion is the entire guarantee.
//
// `readDevVars` now calls `parseEnv` itself, so there is no first-party parser left to unit-test
// and testing Node's would be testing Node. What replaces it is the claim that actually matters
// and that no case above could make: text in the file's REAL syntax, parsed the way the server
// parses it, reaches the assertions. The `export` rows are the regression pins for F1.
describe("a .dev.vars file is refused in every syntax the child understands", () => {
  const CLOUD_URL = "https://abcdefgh.supabase.co";

  /** Exactly what `readDevVars` does to the file's bytes, so these cases enter by the real door. */
  const devVarsFrom = (text: string): Record<string, string> =>
    Object.fromEntries(
      Object.entries(parseEnv(text)).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );

  it.each([
    ["a bare assignment", `SUPABASE_URL=${CLOUD_URL}`],
    ["an `export` prefix — the F1 bypass", `export SUPABASE_URL=${CLOUD_URL}`],
    ["a double-quoted value", `SUPABASE_URL="${CLOUD_URL}"`],
    ["a single-quoted value", `SUPABASE_URL='${CLOUD_URL}'`],
    ["padding around the separator", `  SUPABASE_URL = ${CLOUD_URL}  `],
    ["an `export` prefix under a comment", `# local override\nexport SUPABASE_URL=${CLOUD_URL}`],
  ])("rejects a cloud SUPABASE_URL written as %s", (_label, text) => {
    const opts = { ...BROWSER_PRESENT, devVars: devVarsFrom(text) };

    expect(() => buildE2eEnv(localSource(), opts)).toThrow(/SUPABASE_URL \(from \.dev\.vars\)/);
  });

  it("rejects an `export`-prefixed OPENROUTER_API_KEY, which the forcing cannot reach", () => {
    // The other half of F1: this key lands on top of the forced `""` INSIDE the child, so the
    // assertion is the only thing covering it — and the bypass made the assertion blind.
    const opts = { ...BROWSER_PRESENT, devVars: devVarsFrom("export OPENROUTER_API_KEY=sk-or-v1-real") };

    expect(() => buildE2eEnv(localSource(), opts)).toThrow(/OPENROUTER_API_KEY \(from \.dev\.vars\)/);
  });

  it("still accepts a .dev.vars that carries nothing this preflight objects to", () => {
    // The positive control. Without it every case above is satisfied by a function that refuses
    // any `.dev.vars` at all, which would be a different bug wearing this one's costume.
    const opts = { ...BROWSER_PRESENT, devVars: devVarsFrom("export SOME_UNRELATED_FLAG=1\n# nothing else here") };

    expect(buildE2eEnv(localSource(), opts)).toMatchObject({
      SUPABASE_URL: "http://127.0.0.1:54321",
      OPENROUTER_API_KEY: "",
      SENTRY_DSN: "",
    });
  });
});
