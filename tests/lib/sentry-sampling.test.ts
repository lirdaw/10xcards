import type { Event as SentryEvent } from "@sentry/cloudflare";
import { describe, expect, it } from "vitest";
import { sampleSentryEvent } from "@/lib/sentry-sampling";

// The Sentry sampling discriminator's truth table (C10X-54, 2026-08-12).
//
// WHY THIS FILE EXISTS, and it is not general hygiene. This decision had ZERO coverage at any
// layer, and its first version was WRONG in the silent direction: it sampled on the
// `logger === "console"` stamp alone, on the premise that only dependency output arrives through
// the console integration. Astro re-emits route errors through its own logger, so first-party
// exceptions carry that stamp too — 21 deliberate uncaught errors produced 3 events, i.e. ~90 % of
// real application errors were being dropped. Nothing went red; it was caught by MEASURING
// production during the C10X-53 ship and fixed in `d381c07`. The instrument that measured it was
// the public `/api/shipprobe` route, and this change deletes that route — so this file is the
// compensating guard, at a layer that costs nothing to run.
//
// The load-bearing case is "a first-party error at a roll of 0.99 is still SENT". The load-bearing
// CONTROL is "recognised dependency noise at 0.5 is DROPPED", without which a function that
// returns its input unconditionally satisfies every other assertion here and reads as perfect
// protection.
//
// The real function is imported and the real `DEPENDENCY_NOISE` array is what decides — the
// `tests/middleware.test.ts` idiom of driving the real `PROTECTED_ROUTES` rather than a copy. The
// patterns are deliberately NOT exported and NOT re-declared here: a test that carried its own copy
// would stay green while production's array was emptied.
//
// WHAT THIS DOES NOT PROVE, stated so nobody reads it as more. It says nothing about whether
// `src/worker.ts` still calls this function (that is `tests/lib/sentry-wiring.test.ts`, and the two
// are one claim split in half), and nothing about whether Sentry invokes `beforeSend` at all —
// after the probe's removal, nothing in this project can assert that.

/** Fabricated events. Every field is optional on `Event`, so each case carries only what it means. */
function event(fields: SentryEvent): SentryEvent {
  return fields;
}

/** The message a dependency actually emits, near enough: a package specifier inside a longer line. */
const NOISE_MESSAGE = (pkg: string) => `Failed to parse cookie string from ${pkg}/dist/module/cookies.js`;

/** A roll that would DROP anything reaching the sampled branch — the rate is 0.1. */
const ROLL_DROP = 0.99;
/** A roll that survives sampling. */
const ROLL_SURVIVE = 0.05;

describe("sampleSentryEvent", () => {
  describe("a first-party error is never sampled", () => {
    // THE REGRESSION ASSERTION. The roll is 0.99 on purpose: under the pre-`d381c07` shape this
    // event took the sampled branch and was dropped 90 % of the time. If this ever goes red again,
    // real application errors are vanishing silently.
    it("sends an error stamped logger: console at a roll that would drop a sampled event", () => {
      const first = event({ logger: "console", message: "Cannot read properties of undefined (reading 'id')" });

      // Identity, not just truthiness: the contract is "passes through UNTOUCHED".
      expect(sampleSentryEvent(first, ROLL_DROP)).toBe(first);
    });

    // The same claim on the other half of the haystack. A real uncaught exception arrives with an
    // empty `message` and its text under `exception.values`, so a discriminator reading only
    // `message` would look correct here and be blind in production.
    it("sends an error carried in exception.values rather than message", () => {
      const first = event({
        logger: "console",
        exception: { values: [{ type: "TypeError", value: "flashcard.front is not a function" }] },
      });

      expect(sampleSentryEvent(first, ROLL_DROP)).toBe(first);
    });

    // Fail-open, which is the deliberate asymmetry the module documents: an event that cannot be
    // positively identified as known dependency noise costs quota; one wrongly dropped costs
    // blindness, and only the second failure is invisible.
    it("sends an event with neither a message nor an exception", () => {
      const bare = event({ logger: "console" });

      expect(sampleSentryEvent(bare, ROLL_DROP)).toBe(bare);
    });

    // A non-string `message` must not throw or be treated as a match. Sentry types it as `string`,
    // but the production code guards it with `typeof`, so the guard gets a case rather than being
    // asserted by its own absence.
    it("sends an event whose message is not a string", () => {
      const odd = event({ logger: "console", message: undefined });

      expect(sampleSentryEvent(odd, ROLL_DROP)).toBe(odd);
    });
  });

  // THE POSITIVE CONTROL FOR THE WHOLE FILE, per member of the real array. One case per pattern is
  // what makes deleting EITHER pattern turn a case red — a single case naming one package would
  // leave the other member unguarded, which is the "incomplete sweep left unstated" class this
  // project has recorded repeatedly.
  describe.each(["@supabase/ssr", "@supabase/auth-js"])("recognised dependency noise from %s", (pkg) => {
    it("is dropped at a roll above the rate", () => {
      const noise = event({ logger: "console", message: NOISE_MESSAGE(pkg) });

      expect(sampleSentryEvent(noise, 0.5)).toBeNull();
    });

    it("survives at a roll below the rate", () => {
      const noise = event({ logger: "console", message: NOISE_MESSAGE(pkg) });

      expect(sampleSentryEvent(noise, ROLL_SURVIVE)).toBe(noise);
    });

    // The haystack's other half again, this time on the noise side: `@supabase/auth-js` emits its
    // fetch failures as a thrown `TypeError`, so this is the shape the storm actually arrives in.
    it("is dropped when carried in exception.values rather than message", () => {
      const noise = event({
        logger: "console",
        exception: { values: [{ type: "TypeError", value: `fetch failed in ${pkg}/dist/module/lib/fetch.js` }] },
      });

      expect(sampleSentryEvent(noise, 0.5)).toBeNull();
    });
  });

  describe("both halves of the discriminator are required", () => {
    // The transport stamp is necessary. An event that mentions a Supabase package but did NOT
    // arrive through the console integration is not the storm — dropping it would be the
    // signature-only mistake, and `src/worker.ts`'s own comment says both halves are required.
    it("sends a non-console event even when its message matches a noise pattern", () => {
      const firstParty = event({ message: "deck creation failed while calling @supabase/ssr" });

      expect(sampleSentryEvent(firstParty, ROLL_DROP)).toBe(firstParty);
    });

    // …and the signature is necessary, which is the pre-`d381c07` half. Covered by the first
    // describe block above; asserted here too against an event that is unambiguously first-party
    // and unambiguously console-stamped, so the pairing is legible in one place.
    it("sends a console event whose text matches no noise pattern", () => {
      const firstParty = event({ logger: "console", message: "Zod validation failed for sourceText" });

      expect(sampleSentryEvent(firstParty, ROLL_DROP)).toBe(firstParty);
    });

    // THE RESIDUAL, pinned as behaviour rather than left to be rediscovered (impl-review F2). The
    // case directly above pairs with a NON-console event, and that is the only subclass the
    // transport half actually protects — while the measurement this module documents is that Astro
    // re-emits route errors through its own logger, which leaves that subclass nearly empty in
    // production. So a first-party error whose OWN TEXT names a noise package IS sampled. This
    // asserts the shipped behaviour, not the desirable one: if the discriminator is ever narrowed
    // (the re-tuning the module defers to measured volume), this case is the one that must change,
    // and its failure is the reminder that the boundary moved.
    it("DROPS a console-stamped first-party error whose own text names a noise package", () => {
      const firstParty = event({ logger: "console", message: "Failed to create deck via @supabase/ssr client" });

      expect(sampleSentryEvent(firstParty, ROLL_DROP)).toBeNull();
    });

    // …and the boundary that keeps that residual narrow: the haystack is built from `message` and
    // each `exception.values` entry's `type`/`value` only, never from the stack frames. An ordinary
    // exception thrown near a Supabase call therefore does NOT match, even though its stack would.
    it("sends a first-party exception whose stack would mention a noise package but whose text does not", () => {
      const firstParty = event({
        logger: "console",
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Cannot read properties of undefined (reading 'id')",
              stacktrace: { frames: [{ filename: "/node_modules/@supabase/ssr/dist/module/cookies.js" }] },
            },
          ],
        },
      });

      expect(sampleSentryEvent(firstParty, ROLL_DROP)).toBe(firstParty);
    });
  });

  // The comparison is strict `<`, so a roll EQUAL to the rate drops. Pinning the boundary is what
  // stops a `<` → `<=` edit (or a rate change) from passing unnoticed; the exact rate is
  // deliberately not re-declared as a constant here — the literal is the assertion.
  describe("the rate boundary", () => {
    it("drops at a roll exactly equal to the rate", () => {
      const noise = event({ logger: "console", message: NOISE_MESSAGE("@supabase/ssr") });

      expect(sampleSentryEvent(noise, 0.1)).toBeNull();
    });

    it("sends just below the rate", () => {
      const noise = event({ logger: "console", message: NOISE_MESSAGE("@supabase/ssr") });

      expect(sampleSentryEvent(noise, 0.0999)).toBe(noise);
    });
  });
});
