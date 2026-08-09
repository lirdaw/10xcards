import { describe, expect, it } from "vitest";
// `@/*` maps to `src/*` only, and the subject here is the Playwright harness's config-time
// preflight under `tests/e2e/setup/` — see test-plan.md §6.1 on why its test still sits in
// tests/lib/ beside the suite's other pure-function files rather than in a folder of its own.
import { buildE2eEnv, parseDevVars } from "../e2e/setup/env.ts";

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

// The `.dev.vars` layer above is only as good as what reads the file. This repo carries no
// `dotenv` dependency to borrow, so the parser is first-party — and it is exported rather than
// hidden inside the I/O wrapper, so nothing worth testing sits behind that seam.
describe("parseDevVars", () => {
  it.each([
    ["a bare value", "SUPABASE_URL=http://127.0.0.1:54321", { SUPABASE_URL: "http://127.0.0.1:54321" }],
    ["a double-quoted value", 'SUPABASE_KEY="sb_publishable_x"', { SUPABASE_KEY: "sb_publishable_x" }],
    ["a single-quoted value", "SUPABASE_KEY='sb_publishable_x'", { SUPABASE_KEY: "sb_publishable_x" }],
    [
      "padding around the separator",
      "  SUPABASE_URL = http://localhost:54321  ",
      { SUPABASE_URL: "http://localhost:54321" },
    ],
    ["a value containing '='", "TOKEN=abc=def==", { TOKEN: "abc=def==" }],
    ["an empty value", "OPENROUTER_API_KEY=", { OPENROUTER_API_KEY: "" }],
  ])("parses %s", (_label, text, expected) => {
    expect(parseDevVars(text)).toEqual(expected);
  });

  it("ignores comments and blank lines without losing the real entries", () => {
    const text = ["# a comment", "", "SUPABASE_URL=http://127.0.0.1:54321", "   ", "# SUPABASE_KEY=commented_out"].join(
      "\n",
    );

    expect(parseDevVars(text)).toEqual({ SUPABASE_URL: "http://127.0.0.1:54321" });
  });

  it("returns an empty map for an empty file", () => {
    // The positive control's mirror: a parser that invented entries would fail here, and a
    // parser that dropped everything would fail every case above.
    expect(parseDevVars("")).toEqual({});
  });
});
