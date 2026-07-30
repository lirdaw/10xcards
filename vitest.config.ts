/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
import type { Plugin, PluginOption } from "vite";

// Vitest is configured *through* Astro so tests resolve the `@/*` tsconfig alias (via the
// astro:tsconfig-alias plugin) and the `astro:env/server` virtual module the way the app
// does. A bare vite.config would resolve neither.
//
// But getViteConfig() also pulls in whatever the adapter contributes, and @astrojs/cloudflare
// contributes @cloudflare/vite-plugin. That plugin asserts it owns the "ssr" environment and
// rejects the `resolve.external` list Astro itself puts there, so config resolution dies before
// a single test runs. Tests target Node, not workerd — the Worker runtime is a deploy concern —
// so the plugin is dropped here. Everything the tests actually need from Astro survives.
const CLOUDFLARE_PLUGIN_PREFIX = "vite-plugin-cloudflare";

function withoutCloudflarePlugins(plugins: PluginOption[]): PluginOption[] {
  return plugins.flat(Infinity as 1).filter((plugin) => {
    const name = (plugin as Plugin | null)?.name;
    return !name?.startsWith(CLOUDFLARE_PLUGIN_PREFIX);
  });
}

const astroViteConfig = getViteConfig({
  test: {
    // Node only: no component tests in this suite, so no DOM environment is needed.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Ordered. preflight aborts the whole run once, before any test, when the environment
    // is not configured (setupFiles would run per-file and surface as ordinary test
    // failures instead). accounts then provisions the run's two accounts once and hands
    // them to every file via provide/inject, keeping the suite under the auth rate limit.
    globalSetup: ["tests/setup/preflight.ts", "tests/setup/accounts.ts"],
    // Per-file, in the worker — which is the point: it wraps the `globalThis.fetch` every
    // test and every rendered endpoint reaches the local stack through, to retry Kong's
    // keep-alive 502 and nothing else. It is NOT a second preflight; read the header of that
    // file before widening what it retries.
    setupFiles: ["tests/setup/retry-transport.ts"],
    // Sign-in plus endpoint round-trips against local Postgres exceed the 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Permanent shuffle (files AND tests within a file): an inter-`it()` dependency is a
    // real defect that declaration order hides, so it must fail loudly here rather than
    // wait for someone to pass a flag (C10X-32). The seed is deliberately UN-pinned
    // (default `Date.now()`) — a pinned seed would test one permutation forever, while
    // un-pinned accumulates permutations across CI runs. Every run's banner prints
    // `Running tests with seed "<n>"`, so a red is replayable exactly:
    // `npx vitest run --sequence.seed=<n>`. Hooks are unaffected — `beforeAll`/`beforeEach`
    // still run before the tests in their scope — and so is `globalSetup` ordering above
    // (preflight before accounts).
    sequence: { shuffle: true },
  },
});

export default async function config(env: Parameters<typeof astroViteConfig>[0]) {
  const resolved = await astroViteConfig(env);
  return { ...resolved, plugins: withoutCloudflarePlugins(resolved.plugins ?? []) };
}
