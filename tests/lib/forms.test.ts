import { describe, expect, it } from "vitest";
import { formString, isFormContentType } from "@/lib/forms";

// The narrowing half of the malformed-input handling on the FOUR endpoints that call this
// helper, tested once here instead of four times over HTTP.
//
// "Four" is the number of CALLERS, not the number of form endpoints in this repo — there are
// six `formData()` readers under `src/pages/api/`. `decks/index.ts:23` and
// `decks/[publicId].ts:32` still carry the raw `as string | null` cast and an unguarded
// `formData()`; that is known, deferred, and owned by **C10X-37**. Corrected 2026-07-31
// (C10X-34): this comment used to say "the four form endpoints", which read as a sweep that
// had covered them all.
//
// Why this file exists at all: `formString` was inlined verbatim in all four handlers, so the
// only way to observe it was to drive an endpoint, and only two of the eight branches ever
// were (**C10X-30** impl-review F4/F5 — not C10X-28's, whose own F4 is unrelated; the two
// tickets' reviews coexist for one branch, which is how these citations rotted). It is a pure
// function — the endpoint tests in tests/validation/cards.test.ts and tests/auth/errors.test.ts
// still prove that each handler actually CALLS it and answers with owned copy; this file
// proves what it returns.
describe("formString", () => {
  // The identity half. This is the claim that matters for "no valid request changed
  // behaviour" when the `as string | null` casts were replaced.
  it("returns a genuine string part unchanged", () => {
    for (const value of ["", "a", "  padded  ", "Przód fiszki", "x".repeat(1000), "0", "null"]) {
      expect(formString(value)).toBe(value);
    }
  });

  // The narrowing half, and the defect it exists to stop: a File survives `as string | null`
  // and makes the caller's `.trim()` throw a TypeError -> uncontrolled 500.
  it("reads a File part as empty instead of letting it reach the caller", () => {
    const file = new File(["nie-jestem-stringiem"], "front.txt", { type: "text/plain" });

    expect(formString(file)).toBe("");
    // The positive control for the claim above: the raw value really would have broken the
    // caller, so the narrowing is load-bearing rather than decorative.
    expect(() => (file as unknown as string).trim()).toThrow(TypeError);
  });

  it("reads a missing part as empty", () => {
    expect(formString(null)).toBe("");
  });

  // Callers immediately `.trim()` the result and compare its length, so the composed
  // behaviour is what the endpoints actually rely on: every non-string collapses into the
  // guard that already owns empty input, and no new message enters the closed set.
  it("collapses every non-string into the caller's existing empty-input branch", () => {
    const file = new File([""], "back.txt");

    expect(formString(file).trim().length).toBe(0);
    expect(formString(null).trim().length).toBe(0);
    expect(formString("   \t \n ").trim().length).toBe(0);
  });

  // `[cardPublicId].ts` routes `from` through this helper before comparing it to a literal.
  // A File must not accidentally satisfy that switch.
  it("cannot make a non-string satisfy an equality switch", () => {
    expect(formString(new File(["review"], "from.txt")) === "review").toBe(false);
    expect(formString("review") === "review").toBe(true);
  });
});

// The discriminator the auth routes use to decide WHICH owned message a formData() rejection
// deserves. It is a header test rather than an error test because both causes throw the same
// thing — measured against this runtime:
//
//   Content-Type: application/json          -> TypeError: Content-Type was not one of "multipart/form-data"…
//   Content-Type: multipart/…, broken body  -> TypeError: Failed to parse body as FormData.
//
// so `e instanceof TypeError` separates nothing and the media type is the only stable signal.
describe("isFormContentType", () => {
  const request = (contentType?: string): Request =>
    new Request("http://localhost:4321/api/auth/signin", {
      method: "POST",
      headers: contentType === undefined ? {} : { "Content-Type": contentType },
      body: "x",
    });

  it("accepts the two media types formData() will parse", () => {
    expect(isFormContentType(request("multipart/form-data; boundary=abc"))).toBe(true);
    expect(isFormContentType(request("application/x-www-form-urlencoded"))).toBe(true);
  });

  // A form-typed body that still failed to parse is a TRUNCATED form, not a crafted one —
  // this is the branch that must answer "retry", not "correct your input".
  it("accepts a form media type regardless of its parameters or casing", () => {
    expect(isFormContentType(request("MULTIPART/FORM-DATA; BOUNDARY=ABC"))).toBe(true);
    expect(isFormContentType(request("application/x-www-form-urlencoded; charset=utf-8"))).toBe(true);
  });

  it("rejects everything formData() refuses outright", () => {
    for (const type of ["application/json", "text/plain", "application/octet-stream", ""]) {
      expect(isFormContentType(request(type)), type).toBe(false);
    }
    expect(isFormContentType(request(undefined))).toBe(false);
  });

  // The near-miss that would make a prefix test wrong in the other direction: a media type
  // that merely CONTAINS a form type must not pass, or a crafted body could claim the
  // transport-failure branch and be told to retry instead of to fix its request.
  it("does not accept a type that merely mentions a form type", () => {
    expect(isFormContentType(request("application/json+multipart/form-data"))).toBe(false);
    expect(isFormContentType(request("x-application/x-www-form-urlencoded"))).toBe(false);
  });
});
