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
];

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
};

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
  // (the second because GoTrue reads an empty address as an anonymous sign-in attempt). So
  // the first maps through CODE_MESSAGES to AUTH_VALIDATION_MESSAGE and the second, being
  // absent from that table, falls to AUTH_GENERIC_MESSAGE. Both are pinned in
  // tests/auth/errors.test.ts. Do not re-derive an empty-field story from this entry.
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
