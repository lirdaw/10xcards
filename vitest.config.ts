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
    // Sign-in plus endpoint round-trips against local Postgres exceed the 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

export default async function config(env: Parameters<typeof astroViteConfig>[0]) {
  const resolved = await astroViteConfig(env);
  return { ...resolved, plugins: withoutCloudflarePlugins(resolved.plugins ?? []) };
}
