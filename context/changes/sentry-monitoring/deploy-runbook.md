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
>
> **Corrected 2026-08-12, during the ship, by measurement — read this before running any step
> below.** This document was written in `6c637ad`; the impl-review then added dependency-event
> sampling in `9ab2978` and nobody came back here. Steps 2 and 5 provoke a **dependency console
> warning**, which is exactly the class that `src/worker.ts` samples at a rate of
> `DEPENDENCY_EVENT_SAMPLE_RATE = 0.1`.
> So **one provocation is a coin flip, not a certainty**: one request to `/decks` emits
> **three** warnings (measured), giving `1 - 0.9³ ≈ 27 %` that any event survives. Both steps
> below now fire a **series**, and their oracle is a **count**, never "did something appear".
> A single silent request is not evidence of anything.

### The three things this runbook got wrong, measured 2026-08-12

Kept as a list rather than folded into the steps, because each one produced hours of false
suspicion and the next reader deserves them up front.

1. **`npm run dev` does not exercise the wrapper.** Measured: dev emitted **45** warnings with a
   valid, unquoted DSN in `.env` and sent **zero** events, while the built Worker under
   `npm run preview` sent immediately on the same code. The DSN was independently proved good —
   a raw envelope POSTed straight at the ingest endpoint, bypassing the SDK, returned **HTTP
   200**. The likely mechanism is that `@astrojs/cloudflare` hands `@cloudflare/vite-plugin` a
   `viteEnvironment: { name: "ssr" }`, so `astro dev` runs Astro's SSR environment rather than
   `wrangler.jsonc`'s `main` — **the effect is measured, the mechanism is a hypothesis.** Step 2
   therefore runs against `npm run preview`, not `npm run dev`.
2. **`dist/server/.dev.vars` is written with QUOTED values, and wrangler does not strip them.**
   The SDK then receives a DSN containing literal `"` characters, treats it as malformed, and
   takes its silent no-op branch — indistinguishable from a missing secret. Measured as a pair:
   quoted → 30 warnings, **0** envelopes; the same file unquoted → 30 warnings, **2** envelopes,
   which is the 10 % sampling working exactly as designed. `verification.md` noticed the quoting
   but only as a nuisance for reading the file, not as something that invalidates the value.
   **This is a preview-harness artifact and NOT a production defect**: `wrangler secret put`
   stores the raw pasted value, unquoted.
3. **The oracle must be a count over a series.** See the sampling note above.

## Prerequisites

**P1 and P3 are the two that can block for days** — they depend on someone else granting you
access, so check them first and today. The rest you can obtain as you go, and the table says how.

| #   | What                                                             | How to confirm you have it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | A Sentry login with rights to create a project in the target org | Log in and check that **Projects → Create Project** is not greyed out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P2  | An authenticated wrangler                                        | `npx wrangler whoami` prints your account. If not: `npx wrangler login`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P3  | Rights to merge to `main`                                        | The repo's branch protection decides this, not this document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P4  | The branch                                                       | `C10X-53-sentry-monitoring`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P5  | The prod hostname                                                | Not recorded in this repo. Take it from the last successful `deploy` job's log (wrangler prints the `*.workers.dev` URL), or from the Cloudflare dashboard → Workers → `10xcards`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P6  | The prod Supabase project ref                                    | Needed for step 5's cookie name. Open the Supabase dashboard for the **production** project; the ref is the first label of its API URL. This repo records `bhwnautkdfzrhepkuozx` as of 2026-08-12 — **confirm it rather than trusting this line**, because the prod `SUPABASE_URL` is a Cloudflare secret nobody can read back, so a stale ref here would make step 5 silently prove nothing                                                                                                                                                                                                                                                                   |
| P7  | An authenticated `gh` with access to this repo's Actions         | `gh run list --limit 1` prints a run. Step 4 uses it to confirm the deploy, and the retry path uses `gh run rerun`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P8  | A working local checkout — step 2 actually runs the app          | `npm install` done; Docker running (the local Supabase stack needs it, ~7 GB RAM); a free port for `npm run preview` (step 2 builds and serves `dist/`, so 4321 does **not** have to be free and a `npm run dev` you already have running is irrelevant to it); and **no root `.dev.vars` file** (`Test-Path .dev.vars` → `False`) — if one exists, Cloudflare ignores `.env` entirely and the build's DSN is silently dropped, which presents as "the warning fires but no event arrives" and sends you hunting a typo in a DSN that was never read. Note this is the ROOT file; `dist/server/.dev.vars` is a build artifact and step 2 edits it deliberately |

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

Now build and serve the **built Worker**, because `npm run dev` does not run it (finding 1 above),
and strip the quotes the build writes (finding 2 above). All three commands, in this order:

```bash
npm run db:start          # if the local stack is not already up
npm run build             # regenerates dist/server/.dev.vars FROM .env
```

Then open `dist/server/.dev.vars` and remove the surrounding quotes from the `SENTRY_DSN` row so
it reads `SENTRY_DSN=https://…` and not `SENTRY_DSN="https://…"`. This is the **build artifact**
under `dist/server/`, not the root `.dev.vars` that section 0 forbids — creating that one is
still prohibited. A one-command check that you got it right, which prints no secret:

```bash
awk -F= '/^SENTRY_DSN=/{v=substr($0,index($0,"=")+1); print (v ~ /^"/ ? "STILL QUOTED - fix it" : "unquoted - ok"), length(v)}' dist/server/.dev.vars
```

```bash
npm run preview           # serves dist/, i.e. the real wrapper; NOT npm run dev
```

Note the port: `astro preview` does not use 4321. Take the URL it prints (`--port 4323` if you
want it fixed) and use that host in the provocation below.

Fire a **series of 20**, not one — sampling is why (see the correction at the top). Twenty
requests emit ~60 warnings, so at a 0.1 rate roughly 6 events should survive and the chance of
seeing **none** is `0.9⁶⁰ ≈ 0.2 %`. That is what turns silence into a result instead of noise.

```bash
# bash
for i in $(seq 1 20); do
  curl -s -o /dev/null -H "Cookie: sb-127-auth-token=base64-bm90anNvbg" http://localhost:4323/decks
done
```

```powershell
# PowerShell — call curl.exe by its full name. Bare `curl` is an ALIAS for Invoke-WebRequest,
# whose -H/-w are not the same flags; and on Windows PowerShell 5.1 (this machine)
# -SkipHttpErrorCheck does not exist and -MaximumRedirection 0 throws on the 302 you expect.
1..20 | ForEach-Object { curl.exe -s -o NUL -H "Cookie: sb-127-auth-token=base64-bm90anNvbg" http://localhost:4323/decks }
```

Run one of them singly first with ``-w "%{http_code}`n"`` if you want to see the status: expect a
`302`. The HTTP code is **not** the oracle — a request with no cookie at all returns `302` too.

**Two things must both be true, and check them in this order:**

1. **The terminal running `npm run preview` prints the warning ~60 times** —
   `@supabase/ssr: chunked cookie decoded to invalid JSON, treating as absent`. This is the
   stimulus itself, and it is what tells you the provocation fired at all. Count it rather than
   glance at it; three warnings per request is the measured ratio.
2. **Several `warning` events with that same message appear in Sentry** within a minute. Expect
   roughly a tenth of the warnings, not all of them.

If both hold you have proved four things that step 5 would otherwise leave as suspects: the
wrapper is wired, the console integration captures dependency output, the provocation actually
fires, and your DSN is valid. **The only things still unproven in prod are the secret and the
prod cookie name (P6).**

### If step 2 fails

The whole design of this runbook is that step 2 shrinks step 5's suspect list, so a failure here
must not be improvised past. Split it by which of the two checks failed:

- **No warning in the preview terminal** — the provocation never fired. The cookie name is wrong
  for your local stack (it derives from `SUPABASE_URL`: `127.0.0.1` → `sb-127-auth-token`,
  `localhost` → `sb-localhost-auth-token`), or the value lost its `base64-` prefix, or the local
  Supabase stack is down (`npm run db:start`). Nothing about Sentry is implicated yet.
- **Warnings in the terminal, but no event in Sentry** — the provocation fired and the transport
  did not. Work the suspects in this order, because the first two are the ones that actually
  happened on 2026-08-12:
  1. **The quotes are still on the `dist/server/.dev.vars` value.** Re-run the `awk` check above.
     This is silent by construction and looks exactly like a missing secret.
  2. **You are running `npm run dev` rather than `npm run preview`.** The wrapper is not in that
     path at all.
  3. The DSN itself — typo, wrong project, trailing whitespace on paste. **Settle this
     independently instead of guessing**: POST a raw envelope straight at the ingest endpoint,
     bypassing the SDK entirely. A `200` with an `id` means the DSN, the network and the
     project's quota are all fine and the fault is on the SDK side of the wrapper.

     ```bash
     # reads the DSN from .env, prints no secret
     python - <<'PY'
     import re,json,urllib.request,uuid,datetime
     dsn=[l.split("=",1)[1].strip().strip('"') for l in open(".env",encoding="utf-8") if l.startswith("SENTRY_DSN=")][0]
     key,host,proj=re.match(r"https://([^@]+)@([^/]+)/(\d+)$",dsn).groups()
     eid=uuid.uuid4().hex; now=datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z")
     body="\n".join([json.dumps({"event_id":eid,"sent_at":now}),json.dumps({"type":"event"}),
       json.dumps({"event_id":eid,"timestamp":now,"platform":"other","level":"warning","message":"raw envelope probe"})])
     r=urllib.request.urlopen(urllib.request.Request(f"https://{host}/api/{proj}/envelope/",data=body.encode(),method="POST",
       headers={"Content-Type":"application/x-sentry-envelope","X-Sentry-Auth":f"Sentry sentry_version=7, sentry_key={key}, sentry_client=probe/1.0"}),timeout=20)
     print("HTTP",r.status,r.read().decode()[:120])
     PY
     ```

  4. The Sentry project's inbound filters or quota — **Stats / Usage** settles it in thirty
     seconds.

  If the raw envelope arrives and the SDK still sends nothing, do not proceed: the identical
  failure in prod would be indistinguishable from a missing secret. To see whether the SDK even
  attempts a send, point the DSN at a local sink (`http://k@localhost:4444/1`) and watch for a
  `POST /api/1/envelope/` — no POST means the client never initialised.

### 2b. The negative control — run it now, on the same provocation

Blank the `SENTRY_DSN` row in `dist/server/.dev.vars`, restart `npm run preview`, and issue **the
exact same series of 20 again**. Do not rebuild in between — a rebuild would rewrite that file
from `.env` and quietly restore the DSN.

**Before you issue it, write down the current event count and "last seen" timestamp** of the
issue step 2 created. Then:

- the preview terminal **must still print ~60 warnings** — otherwise you are proving nothing,
  only that the stimulus stopped happening;
- the Sentry issue's **event count and "last seen" must not move**, checked after waiting at
  least as long as step 2's events took to arrive.

The series matters here as much as in step 2, and for the opposite reason: with one request, "the
counter did not move" is the _expected_ outcome about 73 % of the time even when the DSN is
working perfectly, so a single-shot negative control passes vacuously.

Both halves are load-bearing and each closes a different way of passing this check vacuously.
Watching the ISSUE LIST is not enough: Sentry groups a repeat of the same message into the
existing issue, so "no new issue appeared" would read green even if the event did arrive — which
is why the oracle is the counter, not the list. And "start dev, browse a bit, see no events"
would be satisfied by never provoking the condition at all — an assertion that cannot go red.
Only the same stimulus, provably fired, with and without a DSN, separates "the no-op branch
works" from "nothing was ever tested".

**Then close the loop, because "the counter did not move" still has two meanings.** It also does
not move when the Sentry project has stopped accepting anything at all — quota exhausted, spike
protection, a rate limit you tripped while testing. Put the scratch DSN back **unquoted**,
restart, fire the same series once more, and confirm the counter **does** move again. Only that
third reading turns the pair into evidence about the no-op branch rather than about the project's
health.

Then remove `SENTRY_DSN` from `.env` for good — **if that is what you want**. Local dev is meant
to be silent and the e2e harness blanks it anyway, so this is the tidy default; but `.env` is
your own gitignored file and keeping a scratch DSN there costs nothing. What you should **not**
leave there is the REAL project's DSN, for the reason step 5's oracle depends on: that project
must never have seen the chunked-cookie message before.

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

A **series of 20 again**, and for the same reason as step 2 — this is the step where a sampled-away
single request would send you hunting a secret that is perfectly fine:

```bash
for i in $(seq 1 20); do
  curl -s -o /dev/null -H "Cookie: sb-<prod-ref>-auth-token=base64-bm90anNvbg" https://<prod-host>/decks
done
```

```powershell
# PowerShell — curl.exe by full name (see step 2 for why bare `curl` will not do)
1..20 | ForEach-Object { curl.exe -s -o NUL -H "Cookie: sb-<prod-ref>-auth-token=base64-bm90anNvbg" https://<prod-host>/decks }
```

Fire one singly first, with ``-w "%{http_code}`n"``, to confirm the `302` before committing to the
series.

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

- **`wrangler tail` must print the `@supabase/ssr` warning ~60 times.** This says the stimulus
  fired on the deployed Worker. It is available because `wrangler.jsonc` sets
  `observability.enabled`, and it is completely independent of Sentry. Count them: if the tail
  shows far fewer than three per request, the provocation is only partly landing and the Sentry
  side cannot be read yet.
- **The REAL Sentry project must show several new events** at level `warning` with that same
  message — expect roughly a tenth of what the tail printed, not all of it. Because step 2 used
  the scratch project, this project has never seen this message before, so a first-ever issue
  here is unambiguous. Find it via **Issues** (the plain issue stream — not the `/issues/warnings/`
  sub-view, which is a different feed and showed nothing on 2026-08-12) by searching
  `message:"chunked cookie"` or clearing the search entirely and sorting by last seen; give it
  **up to 5 minutes** before treating silence as a result.
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

0. **You fired fewer than the full series.** Check this before anything else, because it is the
   cheapest and it is the mistake this document itself used to instruct. At a 0.1 sample rate a
   handful of requests can legitimately produce nothing. Sixty tail warnings is the threshold at
   which silence becomes evidence.
1. **The secret is missing.** The no-op branch is silent by design, so this is the next suspect.
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

**Does:** errors thrown by first-party code (routes, middleware), plus `warn`/`error` output from
dependencies (`@supabase/ssr` cookie parsing, `@supabase/auth-js` fetch failures) — the "in scope
but unowned" boundary `test-plan.md` §7 records for Risk #4 finally has a monitored sink. Every
event carries the deploy's version id.

**How a first-party error actually gets there is worth one sentence, because it is not what it
looks like and it decides how the sampling had to be written** (measured 2026-08-12). It does
**not** propagate to the Worker's `fetch` boundary: **Astro catches route errors** and re-emits
them through its own logger, so they reach Sentry through the same console integration as
dependency output, stamped `logger = "console"`. That is why `src/worker.ts` samples on the noise's
**signature** (`DEPENDENCY_NOISE`) rather than on that stamp — an earlier version sampled on the
stamp and thereby dropped ~90 % of real application errors, silently. The two classes now behave
differently on purpose: **first-party errors arrive at 100 %, dependency noise is thinned to ~10 %.**

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
