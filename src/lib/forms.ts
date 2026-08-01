/**
 * Reading fields off a `FormData` without trusting their type.
 *
 * `FormData.get()` returns `FormDataEntryValue | null` — i.e. `string | File | null`. Every
 * handler in this project wants a string, and the obvious shortcut is a cast:
 *
 * ```ts
 * const front = ((form.get("front") as string | null) ?? "").trim();  // WRONG
 * ```
 *
 * A cast is a compile-time claim, not a runtime check. A multipart part of type `File`
 * survives it untouched, so `.trim()` is called on a `File` and throws a `TypeError` — an
 * uncontrolled framework `500` on a crafted body, with no project-owned response. That is a
 * "server trusts the client" defect (test-plan §2 Risk #6).
 *
 * **All six `formData()` readers under `src/pages/api/` are guarded as of 2026-07-31**, and
 * this paragraph has now said three different things — read the history, because it is the
 * point. It first claimed the class "existed on every form endpoint in this repo until
 * C10X-30", which was false: C10X-30 swept FOUR of the six (the two card endpoints and the two
 * auth routes) and its own impl-review (F1) found the deck pair still unguarded. C10X-34
 * corrected the claim to name that gap and its owner. **C10X-37 closed it**: `decks/index.ts`
 * and `decks/[publicId].ts` now read `formData()` inside a `try` and narrow the part through
 * `formString`, so the helper has six callers rather than four. Evidence, including the run
 * where neutering one of them back to a cast turns exactly one case red on the production
 * `TypeError` itself: `context/changes/deck-form-hardening/verification.md` (after archiving,
 * `context/archive/<date>-deck-form-hardening/verification.md`).
 *
 * What is still NOT closed, so the next reader does not over-read the line above: this is a
 * claim about `src/pages/api/`. Nothing here says a future endpoint will be written with the
 * guard, and no test enumerates the readers — the sweep was found incomplete twice by reading,
 * not by a red run.
 *
 * `formString` is the runtime check the cast pretended to be. It only ever **narrows**: for a
 * genuine string it is the identity function, so no valid request changes behaviour. Anything
 * else — a `File`, a missing part — reads as `""` and falls into whatever guard the endpoint
 * already owns for empty input, so no new user-facing copy enters the closed set.
 *
 * It lives here rather than beside each handler because four copies of a one-line security
 * helper is the one-rule-many-definitions drift this project has twice paid to end
 * (`generation-limits.ts`, `tests/fixtures/scoping.ts`) — and because a shared function can
 * carry the unit test the inline copies could not (`tests/lib/forms.test.ts`).
 */
export function formString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/** The two media types `Request.formData()` will even attempt to parse. */
const FORM_CONTENT_TYPES = ["multipart/form-data", "application/x-www-form-urlencoded"];

/**
 * Did the caller claim to send a form at all?
 *
 * `formData()` rejects for two causes that mean opposite things to a user, and telling them
 * apart by the ERROR is impossible — measured against this runtime, both are a plain
 * `TypeError`:
 *
 * ```
 * Content-Type: application/json           -> TypeError: Content-Type was not one of "multipart/form-data"…
 * Content-Type: multipart/…, broken body   -> TypeError: Failed to parse body as FormData.
 * ```
 *
 * So the discriminator is the **header**, not the exception — which is also where the runtime
 * itself splits, so this mirrors the real decision rather than guessing at it:
 *
 * - **not a form media type** → the request was never a form. A crafted body, a wrong client.
 *   The caller's input is the problem, and telling them to correct it is accurate.
 * - **a form media type that still failed to parse** → the body was announced as a form and
 *   arrived broken: a client abort mid-upload, a truncated body, a transport reset. Nothing
 *   the user typed is at fault, so "fix your input" is the wrong thing to say — this is a
 *   retry.
 *
 * Kept as a header test rather than an error test on purpose: error identity and message
 * wording are runtime internals that change under us, while the media types are in the fetch
 * spec and are what `formData()` is documented to accept.
 */
export function isFormContentType(request: Request): boolean {
  const contentType = (request.headers.get("Content-Type") ?? "").toLowerCase();
  return FORM_CONTENT_TYPES.some((type) => contentType.startsWith(type));
}
