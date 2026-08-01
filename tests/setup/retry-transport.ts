// Retries ONE class of failure — the local stack's Kong→PostgREST keep-alive drop — and
// nothing else. Registered as a `setupFiles` entry (vitest.config.ts), so it runs once per
// TEST FILE — not once per worker — before that file's modules are imported. The install is
// guarded by a sentinel for exactly that reason; see the bottom of this file.
//
// WHY THIS EXISTS. Measured on 2026-07-30 while enabling `sequence.shuffle` (C10X-32): the
// full suite went red on roughly 10-15% of runs, a DIFFERENT random case each time, none of
// them reproducible in isolation or at its own seed. Kong names the mechanism:
//
//   [error] upstream prematurely closed connection while reading response header from
//   upstream, request: "POST /rest/v1/deck?select=id%2Cpublic_id",
//   upstream: "http://172.18.0.5:3000/deck?…"
//   "POST /rest/v1/deck?select=id%2Cpublic_id HTTP/1.1" 502 75 "-" "node"
//
// Kong (nginx) pools keep-alive connections to PostgREST, and BOTH SIDES IDLE OUT AT THE SAME
// VALUE — 60 s. Measured 2026-08-01 (C10X-39): Kong's `upstream_keepalive_idle_timeout` is 60
// (the 2.8.1 default, no override set) and PostgREST/warp closes an idle keep-alive connection
// after 60.0 s, measured directly with Kong bypassed. **Equal timeouts are the pathological
// case, not an ordering error**: neither side reliably closes first, so whichever wins the race
// decides whether the next request finds a live socket — which is exactly why this is an
// occasional flake rather than a deterministic failure. Until 2026-08-01 this paragraph claimed
// the opposite — that Kong keeps its pooled sockets idle for LONGER than the upstream does. That
// was inference, never measured, it was wrong, and it was wrong in the direction that suggests a
// fixable ordering. (The old wording survives verbatim only in C10X-39's own change folder,
// deliberately: a grep for that phrase over `tests/ src/ context/foundation/` is the regression
// check that the wrong mechanism has not crept back, and repeating it on a live surface — even
// inside a correction — would disarm the check permanently.) The idle half survives the
// correction — a median 27 s of quiet precedes a drop-bearing burst — but the drops CLUSTER in
// that burst's first 1-2 s (43/43), rather than being "the first request after the gap".
//
// It is a transport race in the dev stack, NOT a defect in this repo and NOT a TEST-ORDERING
// problem: the red rate is the same with shuffle on and off (3/20 either way, paired
// same-session control), is unchanged by restarting `rest`+`kong`, and is unchanged by cutting
// file parallelism from ~18 workers to 4. No SUPPORTED surface exposes either timeout —
// verified against CLI v2.98.2: Kong's container env is a hardcoded Go slice with no host
// pass-through, `kong.yml` is `//go:embed`-ed, the Kong image is not settable from
// `config.toml`, `[api]` exposes only PostgREST settings, and PostgREST has never had a
// keep-alive knob in any version.
//
// THE CAUSE IS NOW REMOVED LOCALLY — AND THAT IS WHY THIS FILE STAYS, NOT WHY IT GOES.
// C10X-39 recreates the Kong container after `supabase start` with
// `KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0` (`npm run db:kong`, chained into `npm run db:start`):
// Kong then keeps no idle upstream socket it can lose. Measured the same day, same machine,
// same suite, same oracle: **0 drops across 40 spaced runs** with pooling off, against **20
// drops across 23 spaced runs** over two stock-pool controls. But the recreation is
// unsupported and per-machine, and every `npx supabase stop` wipes it — a developer on a bare
// `npx supabase start` is back on the flaky configuration, and CI carries the step as parity
// rather than necessity. So the belt that survives is this wrapper. Do not read "the cause is
// fixed" as a reason to delete it.
//
// WHY RETRYING IS SAFE HERE, INCLUDING FOR A POST. nginx reports this error after it has
// written the request and then read EOF while waiting for the response *header*. A PostgREST
// that had processed and committed the statement would have sent that header first, and the
// only way to commit without one is a crash — which did not happen (the container reports
// `RestartCount=0` and logs nothing across every observed 502). So the request never
// executed, which is exactly what the failures showed from the other side: every red found
// the row absent ("Setup failed: card … was never written"), never duplicated. The residual
// risk of a retried write landing twice is therefore accepted deliberately rather than
// overlooked. Note the predicate is about the BODY, not about idempotency — `method` is never
// inspected, and that is on purpose: the measured flake was a POST (`POST /rest/v1/deck`), so
// a GET-only gate would leave it in place.
//
// AND THE POST/PATCH CATEGORY IS THIS FILE'S ENTIRE MARGINAL VALUE — nobody had named the
// mechanism until C10X-39 went looking. Kong ships **no `proxy_next_upstream` directive**, so
// nginx's default applies and non-idempotent methods are never retried by the proxy, while
// Kong absorbs every idempotent drop itself: across 23 h of one container, not one PostgREST
// `GET` drop reached a client. So a GET-only gate would not merely weaken the wrapper, it
// would reduce it to retrying the category Kong has already retried — which is the same thing
// as deleting it, arrived at by a route that reads as caution.
//
// HOW LOUD A DOUBLE WRITE WOULD BE — NOW GUARDED, AND MEASURED RATHER THAN ARGUED (C10X-39,
// 2026-08-01; corrected twice before: impl-review F3, 2026-07-30, narrowed an unqualified "not
// a false green" to two named seams, and that list turned out to be short). The census forced
// every local non-`GET` request to replay once and read which assertion noticed. Note what that
// experiment is and is not: it replays a request that HAD executed, which is the pessimal case
// rather than the flake's own (per the paragraph above, a request answering this 502 never
// executed). It does not refute the safety argument — it measures what would happen if the
// argument were ever wrong, which is the only reason the argument is allowed to stand:
//
//   - Loud by a CONSTRAINT, no assertion needed: `deck` (`deck_user_name_unique`, 64/64
//     replays `409`) and a keyed `succeeded` `generation_session` (the partial unique index
//     S-05 added for idempotency, 5/5 `409`) — a second constraint quietly doing this job.
//   - Safe by CONSTRUCTION: `ensureSchedule` writes through
//     `upsert(onConflict: "flashcard_id", ignoreDuplicates: true)`, so its replay is a no-op.
//   - **SILENT — six seams, not two**: `createNonAcceptedCard` and `createCard`
//     (`study.test.ts`), `seedCard` and `seedGenerationSession` (`candidates.test.ts`), the
//     seeded `failed` session (`generate.test.ts`) and `insertDirect`'s `inRange` control
//     (`validation/cards.test.ts`). Each wrote a duplicate that landed and every owning case
//     stayed green.
//
// All six now carry a case-scoped count oracle immediately after the insert — one row for that
// `(deck_id, front)` / `(user_id, source_text, status)` — each proved falsifiable by writing
// the duplicate before the assertion existed, and the re-run census reports **zero** silent
// seams. So this paragraph is no longer a disclosure of unguarded risk; it is a statement of
// where the guard is. Two things it does not become: a duplicated write is made LOUD, not
// prevented, and silence is proven only for the seams that existed on the day the census ran —
// a helper added tomorrow with no count after its insert is a new silent seam, and nothing
// detects that class automatically. `.insert(...).select(...).single()` is NOT that count: it
// sees one response, and a retried duplicate arrives in another.
//
// THE PREDICATE IS DELIBERATELY NARROW — widen it only with the same kind of evidence:
//   - status 502 AND Kong's own upstream wording. No other status is retried: a 500 from an
//     endpoint, a 409, a 4xx refusal and a PostgREST error body are all real signals this
//     suite asserts on, and retrying any of them would mask a genuine failure.
//   - the local stack only (preflight already guarantees the host is 127.0.0.1/localhost).
//   - string or absent bodies only. A `Request` instance or a stream body cannot be replayed
//     without consuming it, so those are passed through untouched rather than guessed at.
//
// It composes with the one file that doubles `fetch`
// (tests/generation/failure-path.test.ts, test-plan §6.9): setup files run first, so the
// `realFetch` that file captures at module scope IS this wrapper, and the Supabase calls it
// delegates get the retry while its own synthetic OpenRouter responses — built above this
// layer, and never a 502 — never reach it.
//
// NOT covered: `globalSetup` (preflight, accounts) runs in a separate process this file
// cannot reach. Left alone on purpose — a 502 there aborts the whole run with its own
// message instead of producing a false green, which is the failure mode that matters.

// The predicate itself lives in `./retry-policy.ts`, pure and exported, so it can be
// asserted (`tests/lib/retry-transport.test.ts`) instead of only reasoned about. This file
// keeps the part that cannot be pure: reading the body and re-issuing the request.
import {
  BACKOFF_MS,
  isKongKeepAliveDrop,
  isLocalStack,
  isReplayableRequest,
  MAX_ATTEMPTS,
  RETRYABLE_STATUS,
} from "./retry-policy";

/**
 * Marks the global as already wrapped.
 *
 * `setupFiles` runs before EVERY test file, so `passthrough` captures whatever is installed
 * at that moment. Today that is always the real `fetch`, because nothing configures
 * `pool`/`isolate` and Vitest's defaults (`pool: "forks"`, `isolate: true`) give each file a
 * fresh global. The day someone sets `isolate: false` / `singleFork`, or runs `--no-isolate`
 * — a natural reflex when debugging exactly the kind of flake this file exists for — each
 * file's setup would capture the PREVIOUS wrapper and they would nest: worst-case attempts
 * become 3^N with compounding backoff, silently. One sentinel closes that, and `Symbol.for`
 * is used rather than a local symbol so the check survives a re-evaluated module registry.
 */
const INSTALLED = Symbol.for("10xcards.retryTransport");

const globals = globalThis as unknown as Record<PropertyKey, unknown>;

const passthrough = globalThis.fetch;

async function bodyTextOf(response: Response): Promise<string> {
  try {
    // `clone()` so the caller still gets an unread body when this turns out NOT to be the
    // flake and the response is handed back as-is.
    return await response.clone().text();
  } catch {
    return "";
  }
}

async function retryingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response = await passthrough(input, init);

  const url = input instanceof Request ? input.url : String(input);
  if (!isLocalStack(url) || !isReplayableRequest(input, init)) return response;

  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
    // Status first, and deliberately outside the policy call: cloning and buffering every
    // response body would be a real cost, and only this status can ever match.
    // `isKongKeepAliveDrop` re-checks it so the policy stays complete on its own.
    if (response.status !== RETRYABLE_STATUS) return response;
    if (!isKongKeepAliveDrop(response.status, await bodyTextOf(response))) return response;
    await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
    response = await passthrough(input, init);
  }
  // Three upstream failures in a row is no longer a keep-alive race; hand the 502 back and
  // let the assertion that was in flight report it.
  return response;
}

// Install once, however many times this setup file is evaluated (see INSTALLED above).
if (!globals[INSTALLED]) {
  globals[INSTALLED] = true;
  globalThis.fetch = retryingFetch;
}
