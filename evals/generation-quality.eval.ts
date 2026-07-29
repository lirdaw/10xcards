import { describe, expect, it } from "vitest";
import { isOpenRouterConfigured } from "@/lib/openrouter";

// TEMPORARY smoke case (Phase 1 of ai-candidate-generation-test-3) — replaced by the real
// 10-case language matrix in Phase 3. One assertion, no fetch, no cost: a true return from
// isOpenRouterConfigured() under THIS config proves the whole wiring at once — the `@/*`
// alias resolves, `astro:env/server` inlined the shell-env key, and the eval preflight ran
// first (it would have thrown before this file was collected if the key were missing).
describe("eval harness wiring", () => {
  it("sees the OpenRouter key through the production astro:env seam (no paid call)", () => {
    expect(isOpenRouterConfigured()).toBe(true);
  });
});
