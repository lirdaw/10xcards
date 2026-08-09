import { readFileSync, rmSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";
import { AUTH_STATE_FILE, resolveE2eEnv } from "./env.ts";
import { E2E_EMAIL, E2E_PASSWORD, ensureE2eAccount } from "./account.ts";

// The half of the e2e preflight that needs a running server — and the producer of
// `playwright/.auth/user.json`, which until Phase 3 was a HAND-MADE artifact nobody could
// reproduce (created 2026-08-04 against an account whose password was recorded nowhere).
//
// WHY THROUGH THE REAL UI AND NOT ASSEMBLED. lessons.md is categorical: never hand-assemble an
// `@supabase/ssr` session cookie. The format is internal — the name derives from the SUPABASE_URL
// hostname, the value is `"base64-" + base64url(JSON)`, and the documented chunking is wrong — but
// the reason that matters here is the FAILURE MODE: the read path swallows a value it cannot parse
// with a `console.warn` and reports the session as ABSENT, so every way of getting it wrong
// produces the same observable, a logged-out browser, surfacing as a locator timeout rather than
// as an error. Driving the real form makes name, value, encoding, chunking, domain, path and
// expiry all come out of the app and the browser, correct by construction rather than by care.
//
// ON DURABILITY, for whoever is reading a red run rather than building on it: research established
// that the previous artifact survived four days because the stored refresh token was a REVOKED
// PARENT and GoTrue answers its reuse with the pre-existing child, minting no rows. That is not a
// contract this project owns, and any `npx supabase stop` / `npm run db:reset` kills the session
// outright. The producer is the answer to that, not the mechanism.
//
// Playwright's default `testMatch` requires `.test.` or `.spec.` in the filename, which
// `auth.setup.ts` does not carry — hence the explicit `testMatch` on the `setup` project. Without
// it the project collects ZERO tests and `dependencies: ["setup"]` passes trivially: a green run
// that produced no session.

setup("the local Supabase stack is reachable", async () => {
  // Re-running the config's assertions costs nothing and is idempotent; what this call is FOR is
  // the verified SUPABASE_URL, which must not be re-read from an unasserted source.
  const env = resolveE2eEnv();

  const response = await fetch(new URL("/auth/v1/health", env.SUPABASE_URL), {
    signal: AbortSignal.timeout(5_000),
  });

  // Ordered after the config's local-host assertion, never before it. The rule is the one
  // `tests/setup/preflight.ts` states at its `assertLocal` call — no request may reach a host the
  // harness has not already established as local. Cited by symbol, not by line number.
  expect(
    response.ok,
    `the Supabase stack at ${env.SUPABASE_URL} answered ${response.status}. Run: npm run db:start`,
  ).toBe(true);
});

setup("mints a signed-in session by driving the sign-in form", async ({ page, context }) => {
  // A dev-mode first navigation compiles routes on demand, so this one test is allowed more than
  // the 30 s default. It is the only place in the layer that pays that cost.
  setup.setTimeout(60_000);

  const env = resolveE2eEnv();

  // Delete FIRST, so the artifact this run consumes can only be the one this run wrote. Without
  // it a failed sign-in leaves yesterday's file in place, and criterion 3.4's "no `user.json` is
  // written" becomes unfalsifiable — the very shape §6.6 records as a denial that decays into a
  // pass. `force` because a fresh checkout has no such file at all, which is the normal case.
  rmSync(AUTH_STATE_FILE, { force: true });

  await ensureE2eAccount(env.SUPABASE_URL, env.SUPABASE_KEY);

  await page.goto("/auth/signin");

  // The sign-in page is still ENGLISH — C10X-19's Polish sweep is open and deliberately out of
  // this change's scope (`signin.astro:14`).
  //
  // `exact: true` is REQUIRED on the password field and is not decoration: Playwright's accessible
  // name matching is substring + case-insensitive by default, so `getByLabel("Password")` also
  // matches `PasswordToggle`'s `aria-label="Show password"` button and fails on a strict-mode
  // violation (measured, first run of this file). Same hazard as the `Akceptuj` / `Akceptuj (3
  // fiszki)` pair journey A has to honour — assume it applies to every name in this layer rather
  // than discovering it one locator at a time.
  const email = page.getByLabel("Email", { exact: true });
  const password = page.getByLabel("Password", { exact: true });

  // THE HYDRATION GATE, and it is the load-bearing correction of this file's first attempt.
  //
  // Both fields are React-CONTROLLED (`value={email}` in `SignInForm.tsx`) with their state
  // initialised to `""`. A `fill()` landing before the island is live writes the DOM value with no
  // listener to observe it, React's first render then wipes it, and the form's own `validate()`
  // refuses to submit an empty state — `preventDefault()`, so NO request is made at all. What
  // makes this worth a paragraph is that the obvious wait does not catch it: `fill()` followed by
  // `toHaveValue` PASSES, because at that instant the DOM value really is set. Measured rather
  // than reasoned — three runs died 30 s later at the URL assertion while GoTrue's own log showed
  // no `/token` request whatsoever, which is what separates "the credentials were refused" from
  // "the form never submitted". A value poll is a race dressed as a wait.
  //
  // The toggle is the cheapest honest signal that the island's handlers are ATTACHED: its effect —
  // the password input's `type` flipping — cannot happen without React. Retry the ACTION until the
  // effect is observable, exactly as `seed.spec.ts`'s `openModal` does for a modal, guard included
  // so a retry after a successful click does not toggle back and hang forever.
  await expect(async () => {
    if ((await password.getAttribute("type")) === "text") return;
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  // Back to a masked field. The second label is also the proof that the first click was real
  // rather than a coincidence of initial state.
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");

  await email.fill(E2E_EMAIL);
  await password.fill(E2E_PASSWORD);
  // A post-condition now, not a wait: with the island proven live, a value that does not stick is
  // a real defect rather than a timing artefact.
  await expect(email).toHaveValue(E2E_EMAIL);
  await expect(password).toHaveValue(E2E_PASSWORD);

  // Role, not text: "Sign in" is the document title, the `h1` and this button at once.
  await page.getByRole("button", { name: "Sign in" }).click();

  // `/api/auth/signin` answers a native form POST with a redirect to /decks. Wait for the STATE,
  // never for time.
  //
  // `expect(page).toHaveURL` rather than `waitForURL`, and the difference is the MESSAGE. Both
  // poll identically; `waitForURL`'s failure reads "Timeout 30000ms exceeded. waiting for
  // navigation to '**/decks'" and says nothing about the actual URL or the cause — measured, on
  // this file's own 3.4 breakage run. A correct verdict carrying no diagnosis is the C10X-43
  // `pre-push` trap, and the reader it strands is the one whose stack was reset an hour ago.
  await expect(
    page,
    "the sign-in form did not land on /decks. If the browser is still on /auth/signin, GoTrue " +
      "refused these credentials: the constants in tests/e2e/setup/account.ts are out of step " +
      "with the account on this stack. `npm run db:reset` drops that account — the next run " +
      "re-creates it, so simply re-running is usually the fix.",
  ).toHaveURL(/\/decks$/, { timeout: 30_000 });

  // ASSERT SIGNED IN BEFORE WRITING — the load-bearing line of this file. `context.storageState()`
  // happily serialises `{"cookies":[],"origins":[]}`; every downstream test would then run signed
  // out, and journey B's signed-in positive control would be the only thing to notice, reporting
  // a harness defect AS a guard defect. Two facts, because they say different things: the
  // authenticated shell exists at all, and it belongs to THIS account rather than to whoever the
  // browser happened to be.
  await expect(page.getByRole("button", { name: "Wyloguj" })).toBeVisible();
  await expect(page.getByText(E2E_EMAIL, { exact: true })).toBeVisible();

  await context.storageState({ path: AUTH_STATE_FILE });

  // PAIRING, NOT LIVENESS. The cookie name is derived from SUPABASE_URL
  // (`sb-127-auth-token` for 127.0.0.1, a DIFFERENT name for localhost), so a session minted
  // against one project is simply unreadable by a server pointed at another — protective by
  // accident and misleading in practice, because the symptom is a locator timeout whose natural
  // remedy is to re-mint against the swapped server, disarming the protection. This offline check
  // says the artifact just written COULD pair with the server this config verified. That the
  // session is live is what the assertions above establish.
  const base = env.E2E_SESSION_COOKIE_NAME;
  const state = JSON.parse(readFileSync(AUTH_STATE_FILE, "utf8")) as {
    cookies: { name: string; domain: string }[];
  };

  expect(state.cookies.length, `${AUTH_STATE_FILE} was written with no cookies at all`).toBeGreaterThan(0);
  // `startsWith`, not equality: @supabase/ssr chunks a session that outgrows the cookie limit into
  // `<name>.0`, `<name>.1`, … so the count is an observation, never a contract.
  expect(state.cookies.filter((cookie) => !cookie.name.startsWith(base)).map((cookie) => cookie.name)).toEqual([]);
  expect([...new Set(state.cookies.map((cookie) => cookie.domain))]).toEqual(["localhost"]);
});
