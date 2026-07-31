import { describe, expect, it } from "vitest";
import { visibleConfigStatuses, type ConfigStatus } from "@/lib/config-status";

// The banner gate's decision, tested without a renderer — the pattern C10X-27 established
// when it pulled `readJsonResponse` and `rateOutcome` out of islands (test-plan §7): the JSX
// stays unreachable, the DECISION does not have to be.
//
// Every entry here is FABRICATED. The real `missingConfigs` is computed at import time from
// `astro:env/server` (config-status.ts:28,37), so under the runner it always reflects the
// local stack — Supabase configured, OpenRouter not — and the one entry whose gating matters
// most (an UNCONFIGURED Supabase) would be unreachable. That is why the function takes its
// list as a parameter rather than closing over the constant.
const entry = (name: string, requiresSession: boolean): ConfigStatus => ({
  name,
  configured: false,
  message: `${name} nie jest skonfigurowany.`,
  requiresSession,
});

const GATED = entry("OpenRouter", true);
const UNGATED = entry("Supabase", false);

describe("visibleConfigStatuses", () => {
  it("hides a session-gated entry from an anonymous visitor", () => {
    expect(visibleConfigStatuses([GATED], false)).toEqual([]);
  });

  it("shows a session-gated entry to a signed-in visitor", () => {
    expect(visibleConfigStatuses([GATED], true)).toEqual([GATED]);
  });

  // THE case. An unconfigured Supabase forces `locals.user = null` on every path
  // (supabase.ts:6-9 + middleware.ts:50,52), so a gate applied to the BLOCK instead of to
  // each ENTRY would hide this warning exactly when Supabase is the thing that is broken.
  // The invariant is that this entry's visibility does not depend on the session flag at all.
  it("shows an ungated entry in both session states", () => {
    expect(visibleConfigStatuses([UNGATED], false)).toEqual([UNGATED]);
    expect(visibleConfigStatuses([UNGATED], true)).toEqual([UNGATED]);
  });

  // What separates per-entry from per-block: signed out, the list is filtered, not dropped.
  it("returns only the ungated entry from a mixed list when signed out", () => {
    expect(visibleConfigStatuses([UNGATED, GATED], false)).toEqual([UNGATED]);
  });

  // The positive control. Without it every assertion above is satisfied by a function that
  // returns nothing, and "the gate works" would read green over a banner surface that never
  // renders anything.
  it("shows every entry to a signed-in visitor, whatever its gating", () => {
    expect(visibleConfigStatuses([UNGATED, GATED], true)).toEqual([UNGATED, GATED]);
  });

  it("returns an empty list unchanged", () => {
    expect(visibleConfigStatuses([], false)).toEqual([]);
    expect(visibleConfigStatuses([], true)).toEqual([]);
  });
});
