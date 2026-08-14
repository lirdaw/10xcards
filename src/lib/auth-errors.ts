/**
 * Auth failure -> one fixed Polish message, drawn from the closed set below.
 *
 * Why this module exists (Risk #4, test-plan §2). `signin.ts` and `signup.ts` used to relay
 * `error.message` verbatim into `?error=`, i.e. into the address bar — and therefore into
 * browser history and the Cloudflare access log. Two upstream behaviours make that a leak
 * rather than a style problem:
 *
 *   - GoTrue interpolates the submitted address into its own copy (`Email address %q is
 *     invalid`), so the relay put user input into a URL;
 *   - `_getErrorMessage` (@supabase/auth-js/dist/module/lib/fetch.js:5-18) falls back to
 *     `JSON.stringify(err)` when the body carries no string message, so an unexpected
 *     GoTrue response is stringified wholesale into `error.message`.
 *
 * The invariant this module establishes: **no part of the input is ever interpolated into
 * the output.** Every return value is one of the module-level constants below. `message` is
 * not read at any link of the chain — it is not even part of the accepted shape.
 *
 * Keying, and why it is a chain (`code` -> `name` -> `status` -> default):
 *
 *   - `code` is the stable identifier, but it is **absent for five error classes**
 *     (`AuthUnknownError`, `AuthRetryableFetchError`, `AuthSessionMissingError`,
 *     `AuthInvalidTokenResponseError`, `AuthInvalidCredentialsError`) — it is read off the
 *     response body (`fetch.js:39-50`), so anything raised client-side or below HTTP has none.
 *   - `name` is assigned by every class constructor (`errors.js:15,44,69,86`), so it separates
 *     a transport failure from a rejected password without any import.
 *   - `status` catches what neither names.
 *
 * The parameter is typed **structurally** on purpose: `ErrorCode` and the `isAuthApiError`
 * family are reachable only from `@supabase/auth-js`, which is a hoisted transitive dep of
 * `@supabase/supabase-js` and carries no version range this repo controls. So this module
 * imports nothing, and a typo in a key is not a compile error — `code` is typed
 * `ErrorCode | (string & {}) | undefined` upstream, which gives no exhaustiveness checking.
 * That is what the Stryker run on this file (see the change's verification record) is for.
 */

/** The shape this mapper reads. `message` is deliberately absent — see the header. */
export interface AuthErrorLike {
  code?: string;
  name?: string;
  status?: number;
}

export const AUTH_UNAVAILABLE_MESSAGE = "Uwierzytelnianie jest chwilowo niedostępne. Spróbuj ponownie później.";
export const AUTH_GENERIC_MESSAGE = "Nie udało się dokończyć operacji. Spróbuj ponownie.";
export const AUTH_NETWORK_MESSAGE = "Brak połączenia z serwerem uwierzytelniania. Spróbuj ponownie za chwilę.";
export const AUTH_RATE_LIMIT_MESSAGE = "Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.";
export const AUTH_INVALID_CREDENTIALS_MESSAGE = "Nieprawidłowy e-mail lub hasło.";
export const AUTH_MISSING_CREDENTIALS_MESSAGE = "Podaj adres e-mail i hasło.";
export const AUTH_EMAIL_NOT_CONFIRMED_MESSAGE = "Potwierdź adres e-mail — otwórz link z wiadomości, którą wysłaliśmy.";
export const AUTH_EMAIL_EXISTS_MESSAGE = "Konto z tym adresem e-mail już istnieje. Zaloguj się.";
export const AUTH_WEAK_PASSWORD_MESSAGE = "Hasło jest zbyt słabe. Użyj dłuższego hasła z cyfrą i wielką literą.";
export const AUTH_SAME_PASSWORD_MESSAGE = "Nowe hasło musi różnić się od dotychczasowego.";
export const AUTH_INVALID_EMAIL_MESSAGE = "Podaj poprawny adres e-mail.";
export const AUTH_VALIDATION_MESSAGE = "Popraw dane w formularzu i spróbuj ponownie.";
export const AUTH_SIGNUP_DISABLED_MESSAGE = "Rejestracja jest obecnie wyłączona.";
export const AUTH_USER_BANNED_MESSAGE = "To konto zostało zablokowane.";
export const AUTH_SESSION_MISSING_MESSAGE = "Twoja sesja wygasła. Zaloguj się ponownie.";
// The four below exist because the catch-all's "Spróbuj ponownie" is a LIE on their branches:
// a retry cannot authorise a rejected address or switch e-mail auth back on. Retry semantics,
// not wording, is what makes them separate constants.
export const AUTH_EMAIL_NOT_AUTHORIZED_MESSAGE =
  "Ten adres e-mail nie może otrzymać wiadomości z potwierdzeniem. Użyj innego adresu.";
export const AUTH_EMAIL_PROVIDER_DISABLED_MESSAGE = "Logowanie i rejestracja e-mailem są obecnie wyłączone.";
export const AUTH_CAPTCHA_FAILED_MESSAGE =
  "Weryfikacja bezpieczeństwa nie powiodła się. Odśwież stronę i spróbuj ponownie.";
export const AUTH_CONFLICT_MESSAGE = "Trwa inna operacja na tym koncie. Spróbuj ponownie za chwilę.";
// C10X-51. What `/api/auth/signout` puts in `?error=` when `signOut()` comes back with an error
// or throws. It is the ENTIRE observability surface of that failure for the person affected —
// the three sign-out triggers are native form POSTs, so there is no island and no "Ponów"
// button to carry anything else (C10X-49 D-02, one route over).
//
// DELIBERATELY LONGER THAN EVERY OTHER MEMBER, and the length is the content. The user has just
// been told, by every other signal on screen, that they are signed out; the only sentence that
// matters is the one saying they are not. So it names three things and a tidier must not
// shorten it back to "Nie udało się wylogować": (a) the sign-out did not go through and the
// session is STILL ACTIVE, (b) the immediate physical exit on a shared computer — close the
// browser — and (c) the way to actually clear it, sign in again and retry. It must NOT say
// "use the Wyloguj button on this page": the landing page is `/auth/signin`, which has none.
//
// THE ADJACENCY HAZARD, and it is the sharpest thing about this constant.
// `AUTH_SESSION_MISSING_MESSAGE` above says the OPPOSITE ("Twoja sesja wygasła"), joins the SAME
// closed set, and renders in the SAME banner on the SAME page. Two members of one set that
// contradict each other is a copy hazard rather than a bug, and the mitigation is wording: this
// message has to be unmistakable on its own, never a variation on its neighbour. A case in
// tests/auth/errors.test.ts pins the two as distinct, because the hand-built distinctness Set in
// that file covers the code-keyed classes only and would not see it.
export const SIGNOUT_FAILED_MESSAGE =
  "Wylogowanie nie powiodło się — Twoja sesja nadal jest aktywna. Jeśli korzystasz ze wspólnego komputera, zamknij okno przeglądarki. Aby ją zakończyć, zaloguj się ponownie i wyloguj jeszcze raz.";

/**
 * Every value this module can ever return, including the unconfigured-Supabase constant the
 * two routes use before they reach an auth call. A test asserts membership against this set,
 * which is what makes "the URL carries only project-owned copy" checkable rather than asserted
 * case by case.
 */
export const AUTH_MESSAGES: readonly string[] = [
  AUTH_UNAVAILABLE_MESSAGE,
  AUTH_GENERIC_MESSAGE,
  AUTH_NETWORK_MESSAGE,
  AUTH_RATE_LIMIT_MESSAGE,
  AUTH_INVALID_CREDENTIALS_MESSAGE,
  AUTH_MISSING_CREDENTIALS_MESSAGE,
  AUTH_EMAIL_NOT_CONFIRMED_MESSAGE,
  AUTH_EMAIL_EXISTS_MESSAGE,
  AUTH_WEAK_PASSWORD_MESSAGE,
  AUTH_SAME_PASSWORD_MESSAGE,
  AUTH_INVALID_EMAIL_MESSAGE,
  AUTH_VALIDATION_MESSAGE,
  AUTH_SIGNUP_DISABLED_MESSAGE,
  AUTH_USER_BANNED_MESSAGE,
  AUTH_SESSION_MISSING_MESSAGE,
  AUTH_EMAIL_NOT_AUTHORIZED_MESSAGE,
  AUTH_EMAIL_PROVIDER_DISABLED_MESSAGE,
  AUTH_CAPTCHA_FAILED_MESSAGE,
  AUTH_CONFLICT_MESSAGE,
  SIGNOUT_FAILED_MESSAGE,
];

/**
 * The READ side of the same closed set: an untrusted `?error=` value in, one of this
 * project's own messages or nothing out.
 *
 * `AUTH_MESSAGES` used to be enforced only where a message is produced. Both auth pages read
 * `Astro.url.searchParams.get("error")` straight into `serverError`, and `ServerError.tsx:8`
 * renders any non-empty string — so a crafted link rendered attacker-chosen text inside a
 * trust-carrying red banner on this project's own sign-in page. Not XSS (React escapes), but
 * content injection: a low-grade phishing vector.
 *
 * Membership by EQUALITY, never containment. The attack is not inventing trusted copy from
 * scratch — it is appending to copy the user already trusts, which any "does it look like one
 * of ours?" test would wave through.
 *
 * `null` is the deliberate rejection value: `ServerError` renders nothing for a falsy message,
 * so a value this app cannot vouch for degrades to NO BANNER rather than to a banner with
 * hedged copy. An error the app cannot vouch for must not be shown as one.
 *
 * It lives here, beside the set it enforces, so the producer and the consumer cannot drift.
 */
export function ownedAuthMessage(raw: string | null): string | null {
  if (raw === null) return null;
  return AUTH_MESSAGES.includes(raw) ? raw : null;
}

/** Codes GoTrue returns in the response body. Plain string keys — `ErrorCode` is not exported. */
const MESSAGE_BY_CODE: Record<string, string> = {
  invalid_credentials: AUTH_INVALID_CREDENTIALS_MESSAGE,
  email_not_confirmed: AUTH_EMAIL_NOT_CONFIRMED_MESSAGE,
  email_exists: AUTH_EMAIL_EXISTS_MESSAGE,
  user_already_exists: AUTH_EMAIL_EXISTS_MESSAGE,
  weak_password: AUTH_WEAK_PASSWORD_MESSAGE,
  same_password: AUTH_SAME_PASSWORD_MESSAGE,
  // The one code whose upstream copy interpolates the submitted address — the concrete leak.
  email_address_invalid: AUTH_INVALID_EMAIL_MESSAGE,
  validation_failed: AUTH_VALIDATION_MESSAGE,
  signup_disabled: AUTH_SIGNUP_DISABLED_MESSAGE,
  user_banned: AUTH_USER_BANNED_MESSAGE,
  over_request_rate_limit: AUTH_RATE_LIMIT_MESSAGE,
  over_email_send_rate_limit: AUTH_RATE_LIMIT_MESSAGE,
  // GoTrue reads an empty address on /signup as an ANONYMOUS sign-in attempt, so this — not
  // AuthInvalidCredentialsError — is what the single most common ordinary error produces.
  // Measured against the local stack; see the reachability record below.
  anonymous_provider_disabled: AUTH_MISSING_CREDENTIALS_MESSAGE,
  // Config-flip codes: unreachable against this project's local stack, so their presence is
  // INFERENCE from the auth-js typings, not measurement (reachability record below). They are
  // here for the retry semantics — the catch-all would tell a user to retry something a retry
  // can never fix.
  email_address_not_authorized: AUTH_EMAIL_NOT_AUTHORIZED_MESSAGE,
  email_provider_disabled: AUTH_EMAIL_PROVIDER_DISABLED_MESSAGE,
  captcha_failed: AUTH_CAPTCHA_FAILED_MESSAGE,
  conflict: AUTH_CONFLICT_MESSAGE,
  request_timeout: AUTH_NETWORK_MESSAGE,
};

/**
 * REACHABILITY RECORD — which of the above is live on THESE TWO ROUTES, and which is
 * defensive redundancy. Written down once so it is not re-derived, and so nobody deletes a
 * constant that guards a config flip believing it is unused. Scope: `signin.ts` (POST
 * /auth/v1/token?grant_type=password) and `signup.ts` (POST /auth/v1/signup). Nothing here is
 * a claim about other GoTrue surfaces.
 *
 * MEASURED against the local stack (2026-07-30, and 2026-07-28 for the two empty-address
 * probes): `invalid_credentials`, `validation_failed`, `anonymous_provider_disabled`,
 * `user_already_exists`, `over_request_rate_limit`.
 *
 * INFERENCE, not measurement — the five config-flip / upstream-condition codes
 * (`email_address_not_authorized`, `email_provider_disabled`, `captcha_failed`, `conflict`,
 * `request_timeout`) cannot be produced against this project's local stack: they need a GoTrue
 * configuration this repo does not run, or a condition (a row lock, a timeout) that cannot be
 * staged here. Their `it.each` rows in tests/auth/errors.test.ts use the same literal as the
 * map key, so the suite proves only that this module agrees with itself — a typo'd or renamed
 * code is invisible to it AND to Stryker, exactly as this file's header warns ("a typo in a
 * key is not a compile error … which gives no exhaustiveness checking"). A runtime guard is
 * not available: @supabase/auth-js/dist/module/lib/error-codes.js is `export {}` — the codes
 * exist only as a type. So the artifact is named instead of trusted prose: ALL SIX codes added
 * by C10X-34 were checked, character for character, against the `ErrorCode` union in
 *
 *   node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts
 *
 * at auth-js **2.105.3** (a hoisted transitive of `@supabase/supabase-js`, so this repo pins
 * no range for it — re-derive from that file rather than from this sentence).
 *
 * DEAD BY CONSTRUCTION on these two routes, and deliberately kept:
 *
 *   - `AUTH_SAME_PASSWORD_MESSAGE` / `same_password` — an `updateUser` concern. No
 *     password-change flow exists in this app, so nothing can reach it here.
 *   - `AUTH_SESSION_MISSING_MESSAGE` / `AuthSessionMissingError` — `session_not_found` does
 *     not come back from `/token` or `/signup`.
 *   - `MESSAGE_BY_NAME.AuthInvalidCredentialsError` — see the entry below; no HTTP input on
 *     these routes can produce that class.
 *
 * PRODUCTION-ONLY DIVERGENCES (inference — this project's local stack cannot show either):
 *
 *   - `user_already_exists` is answered locally because `supabase/config.toml` sets
 *     `enable_confirmations = false`. With confirmations ON, GoTrue answers **200 with an
 *     obfuscated user** instead (anti-enumeration), so on production the "account already
 *     exists" copy is not reached by that path at all.
 *   - `email_address_invalid` appears to be hosted-only: locally the same input produces
 *     `validation_failed`. The entry stays because it is the one code whose upstream copy
 *     interpolates the submitted address — i.e. the concrete leak this module exists for.
 */

/** The classes that carry no code at all. `name` is set by every constructor. */
const MESSAGE_BY_NAME: Record<string, string> = {
  // Transport, not credentials: raised on a network failure and on 502/503/504/520-524/530.
  AuthRetryableFetchError: AUTH_NETWORK_MESSAGE,
  // Raised CLIENT-side by supabase-js before any request goes out, when the credentials it
  // was handed are unusable as such.
  //
  // This comment used to say it was "what an empty form field produces, since
  // `form.get("email") as string` hands `""` straight to supabase-js". Both halves are now
  // wrong: that cast was replaced by `formString` (C10X-30), and — measured against the local
  // stack, 2026-07-28 — an empty address does NOT land here at all. It reaches GoTrue, which
  // answers differently per route and never with this class:
  //
  //   POST /auth/v1/token?grant_type=password  {"error_code":"validation_failed",           400}
  //   POST /auth/v1/signup                     {"error_code":"anonymous_provider_disabled", 422}
  //
  // (the second because GoTrue reads an empty address as an anonymous sign-in attempt).
  //
  // C10X-34 carried that measurement to its consequence, which the version of this comment
  // above stopped short of: BOTH codes are now in MESSAGE_BY_CODE. `validation_failed` maps
  // to AUTH_VALIDATION_MESSAGE as before, and `anonymous_provider_disabled` — which used to
  // fall to the catch-all — maps to AUTH_MISSING_CREDENTIALS_MESSAGE, i.e. to the very
  // constant this dead entry was written for. So the empty-field story is told by the CODE
  // table now; both routes are pinned in tests/auth/errors.test.ts.
  //
  // This NAME entry is therefore dead by construction on these two routes, and kept as
  // defensive redundancy rather than as the empty-field path. The proof it is unreachable is
  // in `formString`: supabase-js raises AuthInvalidCredentialsError only when the credentials
  // object LACKS the `email` key (`GoTrueClient.js:667,835`, an `'email' in credentials`
  // test), while `formString` (`src/lib/forms.ts:27-29`) always returns a string — so the key
  // is always present and no HTTP input can produce the class. Do not re-derive an
  // empty-field story from this entry.
  AuthInvalidCredentialsError: AUTH_MISSING_CREDENTIALS_MESSAGE,
  AuthSessionMissingError: AUTH_SESSION_MISSING_MESSAGE,
};

const RATE_LIMITED = 429;
const SERVER_ERROR_FLOOR = 500;

function messageByStatus(status: number | undefined): string | null {
  if (status === RATE_LIMITED) return AUTH_RATE_LIMIT_MESSAGE;
  if (status !== undefined && status >= SERVER_ERROR_FLOOR) return AUTH_NETWORK_MESSAGE;
  return null;
}

/**
 * Translates an auth failure into fixed Polish copy safe to put in a URL.
 *
 * Never falls through to `error.message` — that is the relay this module exists to remove.
 */
export function authErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return AUTH_GENERIC_MESSAGE;

  // `Object.hasOwn`, never a bare lookup. Both maps are plain object literals, so
  // `MESSAGE_BY_CODE["constructor"]` walks the prototype chain and yields a native
  // function — truthy, returned as if it were copy, and NOT a member of the closed set
  // this module promises. `code` is read off the GoTrue response body (see the header),
  // i.e. it is upstream-controlled, which is exactly the input class this module exists to
  // keep out of a URL. Same for `name`. Found by impl-review F1.
  const byCode =
    error.code !== undefined && Object.hasOwn(MESSAGE_BY_CODE, error.code) ? MESSAGE_BY_CODE[error.code] : undefined;
  if (byCode) return byCode;

  const byName =
    error.name !== undefined && Object.hasOwn(MESSAGE_BY_NAME, error.name) ? MESSAGE_BY_NAME[error.name] : undefined;
  if (byName) return byName;

  return messageByStatus(error.status) ?? AUTH_GENERIC_MESSAGE;
}
