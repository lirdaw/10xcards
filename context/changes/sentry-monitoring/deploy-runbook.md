# Sentry — deploy + prod sanity runbook (C10X-53)

> The code half of this change is complete and merged-ready. **Nothing here has been run.**
> The steps below are yours: creating the Sentry project, setting the Cloudflare secret,
> deploying, and proving an event actually arrives.
>
> **Read this first, because it is the whole reason the runbook exists.** A falsy `SENTRY_DSN`
> puts the SDK on its no-transport branch — deliberately, so the same code ships to environments
> with and without Sentry. The cost is that **a missing production secret is completely silent**:
> the deploy is green, the app works, the Sentry project stays empty, and nothing anywhere says
> "monitoring is off". This is the same class as `OPENROUTER_API_KEY` and mock mode
> (`lessons.md`, "Zweryfikuj, że feature DZIAŁA na PROD"), where a green CI deploy hid a
> production feature silently running in the wrong mode.
>
> **A green deploy proves nothing about Sentry. Only an arrived event does.** Step 5 is not
> optional — and step 2 exists so that step 5's _silence_ is diagnosable instead of ambiguous.

## Prerequisites

**P1 and P3 are the two that can block for days** — they depend on someone else granting you
access, so check them first and today. The rest you can obtain as you go, and the table says how.

| #   | What                                                             | How to confirm you have it                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | A Sentry login with rights to create a project in the target org | Log in and check that **Projects → Create Project** is not greyed out                                                                                                                                                                                                                                                                                                                             |
| P2  | An authenticated wrangler                                        | `npx wrangler whoami` prints your account. If not: `npx wrangler login`                                                                                                                                                                                                                                                                                                                           |
| P3  | Rights to merge to `main`                                        | The repo's branch protection decides this, not this document                                                                                                                                                                                                                                                                                                                                      |
| P4  | The branch                                                       | `C10X-53-sentry-monitoring`                                                                                                                                                                                                                                                                                                                                                                       |
| P5  | The prod hostname                                                | Not recorded in this repo. Take it from the last successful `deploy` job's log (wrangler prints the `*.workers.dev` URL), or from the Cloudflare dashboard → Workers → `10xcards`                                                                                                                                                                                                                 |
| P6  | The prod Supabase project ref                                    | Needed for step 5's cookie name. Open the Supabase dashboard for the **production** project; the ref is the first label of its API URL. This repo records `bhwnautkdfzrhepkuozx` as of 2026-08-12 — **confirm it rather than trusting this line**, because the prod `SUPABASE_URL` is a Cloudflare secret nobody can read back, so a stale ref here would make step 5 silently prove nothing      |
| P7  | An authenticated `gh` with access to this repo's Actions         | `gh run list --limit 1` prints a run. Step 4 uses it to confirm the deploy, and the retry path uses `gh run rerun`                                                                                                                                                                                                                                                                                |
| P8  | A working local checkout — step 2 actually runs the app          | `npm install` done; Docker running (the local Supabase stack needs it, ~7 GB RAM); port 4321 free for `npm run dev`; and **no `.dev.vars` file** (`Test-Path .dev.vars` → `False`) — if one exists, Cloudflare ignores `.env` entirely and step 2's DSN is silently dropped, which presents as "the warning fires but no event arrives" and sends you hunting a typo in a DSN that was never read |

**What Sentry will receive, so you can sign this off rather than discover it.** The wrapper sets
no `sendDefaultPii`, so the SDK's PII defaults apply (off): no cookie header, no request body, no
user identity is attached. There is no tracing and no Logs product. What is sent is uncaught
exceptions at the `fetch` boundary plus `warn`/`error` output emitted by dependencies. The one
thing worth knowing precisely: `@supabase/auth-js` logs a fetch `TypeError` (message + stack) on
transport failure, never the request `init` — measured, and recorded in
`tests/lib/no-logging.test.ts`. **Pasted source text is not on any of these paths**; first-party
code under `src/` emits no log output at all, and a test enforces that.

## 0. What must NOT happen

- **No DSN VALUE in any tracked file in this repo.** Not `wrangler.jsonc`, not a comment, not a
  test fixture. The DSN reaches the Worker only as a Cloudflare secret (prod) or via a gitignored
  `.env` (local, step 2). `src/worker.ts` reads it off the Worker `env` and there is no
  `process.env` fallback on Workers, so there is no other channel to be tempted by.
  The rule is about the **value**, not the key name: `.env.example` carries a documented, empty
  `SENTRY_DSN=` row, which is the template telling a developer the variable exists — it is not a
  DSN and is not an exception being carved out here. What must never appear is a real
  `https://<key>@…ingest…` string, in that file or any other.
- **Never create `.dev.vars`.** `.env` and `.dev.vars` are mutually exclusive in Cloudflare's
  local tooling — if `.dev.vars` exists, `.env` is silently ignored (`lessons.md`). It is also
  the one source the e2e preflight cannot blank, which is why `tests/e2e/setup/env.ts` refuses
  outright when a `SENTRY_DSN` comes from there.
- **No local `npx wrangler deploy`.** This Worker has exactly one deploy pipeline: the `deploy`
  job in `.github/workflows/ci.yml`, which runs on push to `main` after `ci` and `drift` are
  green. A second pipeline is the "two competing deploys" lesson.
- **No `SENTRY_AUTH_TOKEN`.** It exists only for source-map upload, which this change
  deliberately does not do.

## 1. Create the Sentry project and copy the DSN

1. In Sentry: **Projects → Create Project**, platform **Cloudflare Workers** (the platform choice
   only affects the docs Sentry shows you; the wiring is already done in this repo).
2. Sentry creates a default alert rule that notifies on every new issue. Decide now whether you
   want it — `captureConsoleIntegration` on dependency `warn`/`error` can be chatty, and the
   dependency warning you are about to provoke in step 5 will itself raise an issue.
3. Copy the DSN. It looks like `https://<key>@<org>.ingest.<region>.sentry.io/<project-id>`.
   **Do not paste it into a file in this repo.**

4. **Create a second, scratch project the same way. This is REQUIRED, not a nicety** — step 2 uses
   the scratch DSN, step 5 watches the real project. Note both DSNs; they are not
   interchangeable.

**Why a scratch project is mandatory.** Step 2 provokes the _identical_ warning message step 5
does, and Sentry groups repeats of one message into one issue. If both steps pointed at the same
project, step 5's oracle ("a new event appeared") would be satisfied by the issue step 2 already
created — and the natural way to check, scanning the issue list, would show nothing new even when
prod is completely silent. You would then read your own half-hour-old local event as proof that
production monitoring works, sign the ticket, and ship exactly the silent failure this whole
runbook exists to prevent. Two projects make that impossible by construction.

## 2. Prove it locally FIRST — the step that makes step 5 diagnosable

Do this before merging. It costs five minutes and it is the difference between "no event
arrived, and I know why" and "no event arrived, and I have five suspects".

Put the **scratch** DSN in the gitignored `.env` (never `.dev.vars`). Confirm the file really is
ignored before pasting a secret into it — section 0 asserts it, and an assertion about a secret is
worth one command:

```bash
git check-ignore .env && echo "ignored — safe to paste"
```

```
SENTRY_DSN=https://<key>@<org>.ingest.<region>.sentry.io/<project-id>
```

Start the app and provoke the same dependency warning step 5 uses, against the LOCAL Supabase
ref (`127.0.0.1` → cookie name `sb-127-auth-token`):

```bash
npm run db:start          # if the local stack is not already up
npm run dev
```

```bash
# bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Cookie: sb-127-auth-token=base64-bm90anNvbg" \
  http://localhost:4321/decks
```

```powershell
# PowerShell — call curl.exe by its full name. Bare `curl` is an ALIAS for Invoke-WebRequest,
# whose -H/-w are not the same flags; and on Windows PowerShell 5.1 (this machine)
# -SkipHttpErrorCheck does not exist and -MaximumRedirection 0 throws on the 302 you expect.
curl.exe -s -o NUL -w "%{http_code}`n" -H "Cookie: sb-127-auth-token=base64-bm90anNvbg" http://localhost:4321/decks
```

**Two things must both be true, and check them in this order:**

1. **The terminal running `npm run dev` prints the warning** —
   `@supabase/ssr: chunked cookie decoded to invalid JSON, treating as absent`. This is the
   stimulus itself, and it is what tells you the provocation fired at all.
2. **A `warning` event with that same message appears in Sentry** within a minute.

If both hold you have proved four things that step 5 would otherwise leave as suspects: the
wrapper is wired, the console integration captures dependency output, the provocation actually
fires, and your DSN is valid. **The only things still unproven in prod are the secret and the
prod cookie name (P6).**

### If step 2 fails

The whole design of this runbook is that step 2 shrinks step 5's suspect list, so a failure here
must not be improvised past. Split it by which of the two checks failed:

- **No warning in the dev terminal** — the provocation never fired. The cookie name is wrong for
  your local stack (it derives from `SUPABASE_URL`: `127.0.0.1` → `sb-127-auth-token`,
  `localhost` → `sb-localhost-auth-token`), or the value lost its `base64-` prefix, or the local
  Supabase stack is down (`npm run db:start`). Nothing about Sentry is implicated yet.
- **Warning in the terminal, but no event in Sentry** — the provocation fired and the transport
  did not. Suspect the DSN (typo, wrong project, trailing whitespace on paste), then the Sentry
  project's inbound filters or quota. This is the one case where you should not proceed: the
  identical failure in prod would be indistinguishable from a missing secret.

### 2b. The negative control — run it now, on the same provocation

Remove `SENTRY_DSN` from `.env`, restart `npm run dev`, and issue **the exact same request
again**.

**Before you issue it, write down the current event count and "last seen" timestamp** of the
issue step 2 created. Then:

- the dev terminal **must still print the warning** — otherwise you are proving nothing, only
  that the stimulus stopped happening;
- the Sentry issue's **event count and "last seen" must not move**, checked after waiting at
  least as long as step 2's event took to arrive.

Both halves are load-bearing and each closes a different way of passing this check vacuously.
Watching the ISSUE LIST is not enough: Sentry groups a repeat of the same message into the
existing issue, so "no new issue appeared" would read green even if the event did arrive — which
is why the oracle is the counter, not the list. And "start dev, browse a bit, see no events"
would be satisfied by never provoking the condition at all — an assertion that cannot go red.
Only the same stimulus, provably fired, with and without a DSN, separates "the no-op branch
works" from "nothing was ever tested".

**Then close the loop, because "the counter did not move" still has two meanings.** It also does
not move when the Sentry project has stopped accepting anything at all — quota exhausted, spike
protection, a rate limit you tripped while testing. Put the scratch DSN back, restart, fire the
same request once more, and confirm the counter **does** move again. Only that third reading turns
the pair into evidence about the no-op branch rather than about the project's health.

Then remove `SENTRY_DSN` from `.env` for good: local dev is meant to be silent, and the e2e
harness blanks it anyway.

## 3. Set the Cloudflare secret

Use the **real** DSN here (not the scratch one from step 2).

**Two things to get right before you run it, because neither is detectable afterwards:**

- **Paste the value at the prompt; never pipe it in.** Piping through some Windows shells prepends
  a BOM, which makes the DSN non-empty but malformed — so the SDK initialises, takes no no-op
  branch, and silently sends nothing. `wrangler secret list` is structurally blind to it. **This
  project has already lost a deploy to exactly that class** (C10X-42, a repository secret carrying
  a BOM while every listing command showed it as fine).
- **Confirm you are on the account CI deploys to.** `npx wrangler secret put` resolves the account
  from `npx wrangler whoami`, while the deploy runs under the `CLOUDFLARE_ACCOUNT_ID` repository
  secret, which you cannot read. Compare the account name `whoami` prints against the one in the
  last `deploy` job's wrangler-action output. Get this wrong and the secret lands on a Worker
  nobody deploys: `secret list` looks perfect and step 5 is silent.

```bash
npx wrangler secret put SENTRY_DSN
```

The command prompts for the value interactively and stores it on the Worker — it lands in no
file, so it cannot be committed by accident. A secret set now survives later deploys; the `deploy`
job does not clear it. Confirm afterwards:

```bash
npx wrangler secret list
```

`SENTRY_DSN` should appear. This lists secret **names only**, never values — so it confirms the
secret exists, never that it is correct. Step 2 is what confirmed the DSN itself.

**Which Worker does this target?** `wrangler secret put` resolves the Worker name from
`wrangler.jsonc`, while `wrangler deploy` runs against the generated `dist/server/wrangler.json`.
Those are two different files and they could in principle disagree — measured 2026-08-12, they do
not: both say `name: "10xcards"`. If the adapter is ever upgraded, re-check that they still agree:

```powershell
Select-String '"name"' wrangler.jsonc, dist\server\wrangler.json
```

## 4. Deploy through the normal pipeline

Merge `C10X-53-sentry-monitoring` to `main`. The `deploy` job ships the Worker after `ci` and
`drift` pass.

**Confirm the deploy actually succeeded before going on.** If you skip this, step 5's silence
looks like a missing secret when it really means "you are testing the previous Worker":

```bash
gh run list --branch main --limit 1        # grab the run id
gh run watch <run-id>                      # wait for it — right after a merge it is still running
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

Read the `deploy` job's `conclusion` from that last command rather than the colours in the web UI:
it must be `success`. `skipped` means `ci` or `drift` did not pass and **nothing shipped** — step
5 would then be testing the previous Worker.

This change carries **no migration**, so `drift` has nothing new to compare and there is no
`supabase db push` step. If `drift` fails anyway, `deploy` is skipped and nothing ships: that gate
is fail-closed and its own log labels the reason — `DRIFT` means the schema really diverged,
`GATE UNAVAILABLE` means the check could not run (missing secret, API error) and says nothing
about the schema. Neither is caused by this change; the recovery procedure lives in `README.md`'s
CI section.

Two things worth knowing for later: `wrangler deploy` reads the **generated**
`dist/server/wrangler.json`, so an edit to `wrangler.jsonc` that is not followed by a build never
reaches a deploy (`lessons.md`; CI builds, so this is automatic here). And `ci.yml` carries
`paths-ignore: ["**/*.md", "context/**"]` — a docs-only commit runs no jobs at all, so it cannot
be used to trigger a redeploy.

## 5. Prod sanity — provoke a real event and confirm it ARRIVES

Same provocation as step 2, now against production and the **prod** ref from P6.

**Open a log tail in a second terminal FIRST and leave it running.** This is the independent
oracle, and without it the whole step has one failure observation with two incompatible meanings:

```bash
npx wrangler tail 10xcards
```

Then, in the first terminal:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Cookie: sb-<prod-ref>-auth-token=base64-bm90anNvbg" \
  https://<prod-host>/decks
```

```powershell
# PowerShell — curl.exe by full name (see step 2 for why bare `curl` will not do)
curl.exe -s -o NUL -w "%{http_code}`n" -H "Cookie: sb-<prod-ref>-auth-token=base64-bm90anNvbg" https://<prod-host>/decks
```

- **Why this provocation and not a crash:** the app deliberately has no route that throws
  uncaught — every API `catch` answers with owned copy. So the thing to provoke is the other half
  of what this change captures: `warn`/`error` output emitted by **dependencies**.
- **The value must start with `base64-`, and this was measured rather than assumed.** A plain
  value like `garbage` produces **zero** warnings: `decodeChunkedCookieValue` returns anything
  without the `base64-` prefix unchanged, so it never reaches the warning path. Measured against
  the installed `@supabase/ssr` on 2026-08-12: `garbage` → 0 warns; `base64-bm90anNvbg` → 1 warn
  (it decodes to the text `notjson`, which is not valid JSON). Use the value verbatim.
- **The cookie name is derived, not guessed:** `@supabase/ssr` names it
  `sb-${hostname.split(".")[0]}-auth-token`. A wrong name is simply ignored and you learn nothing
  — which is why P6 says to confirm the ref rather than trust this repo's copy of it.
- Expect a `302` to `/auth/signin`: the malformed session reads as "signed out". **The HTTP
  response is not the oracle.** If you get a `500` or a `200` instead, stop and investigate — the
  app is not behaving as this runbook assumes.

**Read the two oracles together — that pairing is what makes a failure diagnosable:**

- **`wrangler tail` must print the `@supabase/ssr` warning.** This says the stimulus fired on the
  deployed Worker. It is available because `wrangler.jsonc` sets `observability.enabled`, and it
  is completely independent of Sentry.
- **The REAL Sentry project must show a new event** at level `warning` with that same message.
  Because step 2 used the scratch project, this project has never seen this message before, so a
  first-ever issue here is unambiguous. Find it by searching `message:"chunked cookie"` and
  sorting by last seen; give it **up to 5 minutes** before treating silence as a result.
- **That event should carry the deploy's version id as its `release`** (shown on the event under
  Release / in the tag list), which comes from the `CF_VERSION_METADATA` binding and confirms the
  binding reached the deployed Worker rather than just the source config. An event with **no**
  release is not a rollback, but do not wave it through either: confirm it is genuinely yours
  (timestamp within the last few minutes, and the URL on the event is your prod host) before
  concluding "monitoring works, binding did not take". A stray event you did not cause is the one
  way this step can read green while prod is silent.

### If no event arrives

The tail decides which half of the system to suspect, so read it before anything else:

**The tail printed the warning, but Sentry is empty** — the provocation worked and the transport
did not. The fault is on the Sentry side of the wrapper:

1. **The secret is missing.** The no-op branch is silent by design, so this is the first suspect.
   `npx wrangler secret list` shows whether the NAME exists.
2. **The secret exists but its VALUE is corrupted.** A non-empty but malformed DSN does not take
   the no-op branch — the SDK initialises and quietly sends nothing. `secret list` is structurally
   blind to this, and **this project has hit exactly that class before**: a repository secret that
   carried a BOM, invisible to every listing command, which took a whole deploy to diagnose
   (C10X-42). Re-run `npx wrangler secret put SENTRY_DSN`, pasting the DSN rather than piping it —
   piping through some Windows shells is what prepends the BOM.
3. **Wrong account or wrong Worker.** `wrangler secret put` resolves the Worker from
   `wrangler.jsonc` (`name: "10xcards"`), under whatever account `npx wrangler whoami` prints —
   which is not necessarily the account CI deploys to, since that one comes from the
   `CLOUDFLARE_ACCOUNT_ID` repository secret you cannot read. Compare the account name from
   `whoami` against the account named in the `deploy` job's wrangler-action output.
4. **Sentry-side** — open the project's **Stats / Usage** page: it shows accepted vs dropped
   events and whether the quota is exhausted or spike protection kicked in. This is the one
   suspect you can settle in thirty seconds, so check it before starting a secret-and-redeploy
   loop.

**The tail printed nothing** — the provocation never reached the warning path, and **this says
nothing at all about monitoring**. Do not roll back on this observation:

1. **The prod ref (P6) is stale**, so the cookie name is wrong and was ignored. Confirm the ref in
   the Supabase dashboard — this is the most likely cause, and it is the one thing step 2 could
   not pre-verify.
2. **You are testing the old Worker** — re-check the `deploy` job from step 4.
3. **Wrong hostname (P5)** — a 404 or a DNS error on the `curl` rather than the expected `302`.

To redeploy after fixing the secret, **do not run `wrangler deploy` locally** (step 0). Re-run the
pipeline: `gh run rerun <run-id>` on the last `main` run, or push a commit that touches a
non-markdown path. Give each attempt about 5 minutes.

**When to roll back, stated precisely, because the honest answer is "rarely".** This change is
inert without a DSN — a Worker whose monitoring never initialises behaves exactly as it did
before. So an unresolved step 5 is a _monitoring_ problem, not a _production_ problem, and
debugging it costs users nothing. Roll back only if the app itself misbehaves (the `curl` returns
`500`, or the tail shows errors the previous version did not). **Never roll back on "the tail
printed nothing"** — that branch says the provocation missed, not that the deploy is bad.

## 6. Close out

The event you provoked is a test artifact, not a signal. Leaving it open means the next person to
look at this project starts from a false alarm.

- **Resolve** the issue step 5 created, in the real project.
- **Settle the alert rule** you deferred in step 1.2 — either keep Sentry's default (notifies on
  every new issue) or narrow it. Nobody is on call for this, so decide who the notification is
  actually for.
- **Record that monitoring was verified, and when.** The `deploy-runbook` cannot say it for you:
  the whole premise here is that nothing in the system reports its own monitoring status.
- The scratch project can stay; it is where the next person repeats step 2.

## Rollback

Revert on `main`, pushed through the normal PR flow — prod only changes when the `deploy` job runs
on `main`. Which command depends on how the branch landed:

```bash
git log --merges -1 --format=%H main    # if this prints a sha, it was a merge commit
git revert -m 1 <merge-sha>             # merge commit
git revert <commit-sha>                 # squash merge — plain revert, -m 1 errors here
```

That restores the adapter's own entrypoint and removes the package. The Cloudflare secret can stay
set; after a revert nothing reads it.

## What this buys, and what it does not

**Does:** uncaught exceptions at the Worker's `fetch` boundary, plus `warn`/`error` output from
dependencies (`@supabase/ssr` cookie parsing, `@supabase/auth-js` fetch failures) — the "in scope
but unowned" boundary `test-plan.md` §7 records for Risk #4 finally has a monitored sink. Every
event carries the deploy's version id.

**Does not:**

- **Client-side errors.** `@sentry/astro` is not installed, so errors thrown inside the React
  islands never reach Sentry. Adding it is an independent install.
- **Readable stack traces.** No source-map upload (it follows from server-only), so production
  frames are minified.
- **The swallowed-error audit class (C10X-48…52).** Those five findings are _dropped results_
  with no logging call at all — `tests/lib/no-logging.test.ts` guarantees first-party code under
  `src/` emits none — so `captureConsoleIntegration` captures exactly zero of them. Each of the
  five tickets still owns checking its own error. Do not read "Sentry is live" as "the audit class
  is monitored".
- **Tracing or the Logs product.** Errors only, by choice: no `tracesSampleRate`, no `enableLogs`,
  minimal quota surface.
- **Alerting you can rely on.** Whatever alert rule Sentry created by default is the whole of it;
  nobody has tuned it, and no one is on call. Deciding who gets notified is a separate task.
