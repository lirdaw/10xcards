import type { Event as SentryEvent } from "@sentry/cloudflare";

// The decision `src/worker.ts`'s `beforeSend` makes on every captured event, extracted here so it
// can be exercised without a Worker, a DSN or a network (C10X-54, 2026-08-12). The extraction is
// semantics-preserving: same branches, same order, same strict `<`. What changed is that the
// randomness is now the CALLER's — see `sampleSentryEvent` below.
//
// Why it moved: the only instrument that would ever have surfaced a regression here was the public
// `/api/shipprobe` route, and that route is deleted by this change. A production probe is an
// expensive place to hold a property that a pure function can hold for free.

// Sampling applied ONLY to dependency-emitted warn/error events, never to real exceptions.
//
// The storm is structural rather than hypothetical: `src/middleware.ts` authenticates on EVERY
// request, so a Supabase outage makes `@supabase/auth-js` emit one error-level line per inbound
// request, site-wide. Unsampled, that is one event per request until the outage ends, and
// exhausting the plan's quota is self-masking — once the cap is hit, UNRELATED errors stop
// arriving and this project has no notification channel to say so.
//
// A blanket `sampleRate` would be the wrong instrument, because it cannot tell the storm from the
// signal: it would also drop 90% of the rare, unique, uncaught exception this monitoring exists to
// surface.
//
// **`logger === "console"` is NOT a usable discriminator here, and that was measured rather than
// reasoned (2026-08-12, during the C10X-53 ship).** The first version of this code sampled on
// exactly that stamp, on the premise that only dependency output arrives through the console
// integration. It does not: **Astro catches route errors and re-emits them through its own
// logger**, so a genuine first-party exception reaches Sentry stamped `logger = "console"` like any
// dependency warning. Measured against the built Worker: 21 deliberate uncaught errors thrown from
// a temporary route produced **3** events (~14 %, i.e. the 0.1 rate), each tagged `console`. Since
// this app has no route that throws PAST Astro, the unsampled branch would essentially never fire
// in production — so the old discriminator silently dropped ~90 % of real application errors, which
// is the exact opposite of what this monitoring exists to do. `tests/lib/sentry-sampling.test.ts`
// pins that shape: its load-bearing case is a first-party error at a roll of `0.99` still being
// sent.
//
// The discriminator is therefore the noise's own SIGNATURE, not its transport. It is deliberately
// **fail-open**: an event that cannot be positively identified as known dependency noise passes
// through untouched. The asymmetry is the point — an unrecognised event costs quota, a dropped one
// costs blindness, and only the second failure is invisible. Adding a pattern here is a decision
// to accept losing 90 % of that message, so add one only for output a dependency emits per-request.
//
// The patterns carry no `g` flag, so `.test()` is stateless and safe to call repeatedly.
const DEPENDENCY_NOISE = [/@supabase\/ssr/, /@supabase\/auth-js/];

// Why sampling this class loses little: the dependency conditions worth acting on PERSIST — a
// corrupt session cookie keeps firing until the cookie is overwritten, an outage lasts minutes —
// so a survivor arrives quickly. What sampling drops is the one-off, which is also the least
// actionable. Re-tune on measured volume after the first weeks in production; this value is
// reasoned, not measured, and the comment says so deliberately.
const DEPENDENCY_EVENT_SAMPLE_RATE = 0.1;

/**
 * Decide whether a captured Sentry event is sent or dropped.
 *
 * Everything that is not RECOGNISED dependency noise passes through untouched — including every
 * first-party error, which reaches here through the console integration too (see DEPENDENCY_NOISE
 * for the measurement that forced this shape). Both halves of the test are required: the transport
 * stamp alone would catch first-party errors, and the signature alone would catch a first-party
 * error that merely mentions a Supabase package by name.
 *
 * **The residual that sentence does NOT cover, measured 2026-08-12 (C10X-54 impl-review F2).** The
 * transport half only protects the NON-console subclass — and the measurement above is that Astro
 * re-emits route errors through its own logger, which leaves that subclass nearly empty in
 * production. So a genuine first-party error whose OWN TEXT names a noise package IS sampled:
 * `{ logger: "console", message: "…via @supabase/ssr client" }` is dropped at a roll of `0.99`.
 * What keeps this narrow rather than serious is the haystack's own shape — only `message` and each
 * `exception.values` entry's `type`/`value` enter it, never the stack frames — so an ordinary
 * exception thrown near a Supabase call does not match. Pinned by a case in
 * `tests/lib/sentry-sampling.test.ts`, so the behaviour is documented rather than rediscovered;
 * narrowing the patterns is the re-tuning this module already defers to measured volume.
 *
 * **The roll is a PARAMETER, and that is the whole reason this function exists.** `Math.random()`
 * inside the decision makes the decision untestable; the project's established fix is to pass the
 * value in, exactly as `rateCard` takes `now` (test-plan.md §6.7) and `visibleConfigStatuses` takes
 * its entries (§6.1). `src/worker.ts` is the one line that supplies it.
 *
 * Pure and total: no env, no clock, no I/O. It reads only its arguments, which is also what keeps
 * it inside AGENTS.md's rule that `src/worker.ts` is the ONLY module under `src/` permitted to touch
 * the Cloudflare `env`.
 *
 * @param event the event Sentry is about to send
 * @param roll a value in `[0, 1)` drawn by the caller — compared with `<`, so a roll equal to the
 *   rate is a DROP
 * @returns the event to send, or `null` to drop it
 */
export function sampleSentryEvent<T extends SentryEvent>(event: T, roll: number): T | null {
  if (event.logger !== "console") return event;
  const haystack = [
    typeof event.message === "string" ? event.message : "",
    ...(event.exception?.values ?? []).map((value) => `${value.type ?? ""} ${value.value ?? ""}`),
  ].join("\n");
  if (!DEPENDENCY_NOISE.some((pattern) => pattern.test(haystack))) return event;
  return roll < DEPENDENCY_EVENT_SAMPLE_RATE ? event : null;
}
