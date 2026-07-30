/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";
import type { Plugin, PluginOption } from "vite";

// Eval-only Vitest config: the LLM-as-judge run path (test-plan §3 Phase 5). This is a
// SEPARATE config from vitest.config.ts on purpose — the ordinary suite's include glob
// (tests/**/*.test.ts) replaces Vitest's default, so evals/**/*.eval.ts is invisible to
// `npm test` structurally, by collection, with zero edits to the config that the whole
// green suite depends on. The ~15 lines of withoutCloudflarePlugins below are a deliberate
// duplication of vitest.config.ts's wrapper (see the rationale comment there); if the two
// ever drift, this config breaks loudly (alias / astro:env resolution fails), not silently.
//
// INVOCATION — the key must be in the SHELL environment, not in .env:
//
//   bash:       OPENROUTER_API_KEY=sk-... npx vitest run -c vitest.eval.config.ts
//   PowerShell: $env:OPENROUTER_API_KEY="sk-..."; npx vitest run -c vitest.eval.config.ts
//
// (or `npm run eval` with the same env var set beforehand.)
//
// Why shell-env is the one supported form: the generator reaches the key through
// `astro:env/server`, which under Vitest is a TRANSFORM-TIME inlined literal — the key has
// to exist in the environment when this config loads. The judge client reads
// `process.env.OPENROUTER_API_KEY` directly. One shell export feeds both seams in the same
// invocation. A key placed in .env reaches only the first seam (Vite does not put .env
// values into process.env), so evals/setup/eval-preflight.ts rejects it — and a key left
// in .env additionally makes the next ordinary `npm test` fail loudly, by design
// (tests/setup/preflight.ts assertMockGeneration).
const CLOUDFLARE_PLUGIN_PREFIX = "vite-plugin-cloudflare";

function withoutCloudflarePlugins(plugins: PluginOption[]): PluginOption[] {
  return plugins.flat(Infinity as 1).filter((plugin) => {
    const name = (plugin as Plugin | null)?.name;
    return !name?.startsWith(CLOUDFLARE_PLUGIN_PREFIX);
  });
}

const astroViteConfig = getViteConfig({
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    // The INVERSE of the main preflight: fail when the key is ABSENT (mock mode would
    // pass a PL fidelity case vacuously). Never reference tests/setup/* here — that
    // preflight asserts Supabase seams the eval does not touch, and it fails when the
    // key IS set.
    globalSetup: ["evals/setup/eval-preflight.ts"],
    // Real LLM latency: one generation call plus per-card judge calls per case.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Same policy as vitest.config.ts, kept structurally parallel with it (C10X-32). The
    // 10 matrix cases are independent by construction — each generates its own cards and
    // grades only those — so shuffle changes nothing about what they measure; it is on so
    // the two runners cannot drift into different ordering regimes. Note this eval's red
    // baseline (forced `niemiecki`/`francuski` → Polish cards, C10X-31) is a REAL generation
    // defect and has nothing to do with ordering: `npm run eval` exits 1 on it either way.
    // `setupFiles` is deliberately NOT mirrored from vitest.config.ts, so "parallel" stops
    // here: that entry is the local-stack transport retry, and this run path never touches
    // the local stack (nothing under evals/ builds a Supabase client) — its own
    // 127.0.0.1/localhost gate would make it a no-op anyway. Do not "restore parity".
    sequence: { shuffle: true },
  },
});

export default async function config(env: Parameters<typeof astroViteConfig>[0]) {
  const resolved = await astroViteConfig(env);
  return { ...resolved, plugins: withoutCloudflarePlugins(resolved.plugins ?? []) };
}
