# Verification — remove-sentry-probe (C10X-54)

> Evidence log. Every reading is recorded with its host, its timestamp and the command that produced
> it, so a later reader can tell a measurement from an assertion.

## Phase 1 — production baseline, then the deletion

### The production host, established rather than derived

`wrangler.jsonc` gives the shape only (`"name": "10xcards"` + `"workers_dev": true`). The full host was
read from the last successful `deploy` job's wrangler output rather than inferred from that shape:

```
$ gh run view 31622221974 --log --job=<deploy>
deploy  Run cloudflare/wrangler-action@v4  Deployed 10xcards triggers (0.63 sec)
deploy  Run cloudflare/wrangler-action@v4    https://10xcards.lirdaw.workers.dev
deploy  Run cloudflare/wrangler-action@v4  Current Version ID: 1d12e051-a595-4e2f-a2d4-47c57e7e7f2d
```

Run `31622221974` is the merge of PR #31 (`e7b538d`, C10X-53) — the deploy that put the probe on
production in the first place. **Host: `10xcards.lirdaw.workers.dev`.** Phase 4 must use this same
host verbatim, or the pair is void.

### 1.6 — the baseline reading (UNREPEATABLE)

Taken **before** any merge, against the deployed Worker as it stood:

```
$ date -u +%Y-%m-%dT%H:%M:%SZ
2026-08-12T18:41:25Z
$ curl -s -o /dev/null -w "STATUS: %{http_code}\n" https://10xcards.lirdaw.workers.dev/api/shipprobe
STATUS: 500
```

| Field     | Value                         |
| --------- | ----------------------------- |
| Host      | `10xcards.lirdaw.workers.dev` |
| Path      | `/api/shipprobe`              |
| Method    | `GET`                         |
| Status    | **500** (expected `500`)      |
| Timestamp | 2026-08-12T18:41:25Z          |

This is half of the Phase 4 pair.

**Repeated live during the manual gate (2026-08-12T18:45:46Z), with the response headers captured**, so
the reading is attributable to the deployed Worker rather than to a cache or an intermediary:

```
HTTP/1.1 500 Internal Server Error
Content-Length: 0
Server: cloudflare
CF-RAY: a2a1a39adf9e526b-PRG
```

`Server: cloudflare` plus a `CF-RAY` is the Worker answering; `Content-Length: 0` is the empty body of an
uncaught throw. Two readings, same host, same status.

**Positive controls on the SAME host, taken in the same series** — without these a `500` is equally
compatible with "the host is broken", which is the failure the Phase 4 pair exists to exclude:

| Request                | Status  | What it establishes                                                        |
| ---------------------- | ------- | -------------------------------------------------------------------------- |
| `GET /`                | **200** | The host is alive and serving the app                                      |
| `GET /auth/signin`     | **200** | A second real route renders — not a single lucky path                      |
| `GET /api/nonexistent` | **404** | **The deployed Worker already answers `404` for an absent `/api/*` route** |
| `GET /api/shipprobe`   | **500** | The `500` belongs to this route specifically                               |

The third row is worth more than it looks and was not something the plan anticipated. Phase 1's local
pre-check exists because nothing in this project had ever produced a `404` from a deleted `/api/*` route,
so the fall-through was reasoning rather than measurement. That control settles it **on production, on
the exact host the pair uses, before the change ships**: `404` is the established shape of "no such API
route" here. Phase 4 is therefore no longer asserting a status nobody has seen on this host — it is
asserting that `/api/shipprobe` joins a class already demonstrated.

Cost: two unsampled Sentry events, the documented price of the measurement, and the last this route will
ever produce.

### The deletion

```
$ git rm src/pages/api/shipprobe.ts
rm 'src/pages/api/shipprobe.ts'
$ git ls-files src/pages/api/shipprobe.ts
(no output)
```

### 1.7 — the local post-deletion pre-check

**This is a PRE-CHECK and explicitly NOT half of the production pair.** A local `404` says nothing
about the deployed Worker; the pair in Phase 4 is against production for exactly that reason. What
this buys is one measurement instead of one inference: nothing in this project had ever produced a
`404` from a deleted `/api/*` route (no `404.astro`, no catch-all, and `wrangler.jsonc` declares
`assets.not_found_handling: "404-page"` over `./dist`), so the plan's reasoning that the path falls
through to Astro's default 404 was untested until now.

Run 1 started a server that reported `Local http://localhost:4321/` — no port bump, so 4321 was free and
the reading was its own server's. `GET /api/shipprobe` → **404**.

**Run 2, during the manual gate, exposed a hazard worth recording rather than smoothing over.** The
second `npm run dev` reported `Local http://localhost:4322/` — a **port bump**, which means 4321 was
still held. `TaskStop` had killed the `npm` wrapper of run 1 but left the `astro`/`workerd` child
listening (confirmed: `netstat` showed PID 6332 on 4321). So the three requests issued to `localhost:4321`
in that second series reached the **orphan**, not the server just started. Same working tree and same
deletion, so the answers were not wrong — but "which server answered?" was momentarily unestablished,
which is not a claim this project accepts on trust.

Re-measured against the port the fresh server actually reported, whose identity is unambiguous
(PID 12988 on 4322), with a positive control beside it:

| Request                | Status  | What it establishes                            |
| ---------------------- | ------- | ---------------------------------------------- |
| `GET /`                | **200** | The server is up and rendering                 |
| `GET /api/nonexistent` | **404** | The fall-through shape for an absent API route |
| `GET /api/shipprobe`   | **404** | The deleted route now joins that class         |

Both servers were then terminated by PID (`taskkill /T /F`) and both ports confirmed free, so nothing
from this phase is left listening to confuse a later `npm run e2e` — which refuses to attach to a
foreign server on 4321 by design (`reuseExistingServer` deliberately unset, `test-plan.md` §6.11).

The general lesson is the e2e layer's own, met here at the dev-server layer: **a port bump is the
signal that the server you are talking to may not be the server you started.** Read the reported port,
never assume the default.

| Field  | Value                                    |
| ------ | ---------------------------------------- |
| Host   | `localhost:4322` (dev server, PID 12988) |
| Path   | `/api/shipprobe`                         |
| Status | **404** (expected `404`)                 |
| Date   | 2026-08-12                               |

Boundary, noted at the site as the plan requires: `npm run dev` does not execute `src/worker.ts` at
all (roadmap H-14's correction), so this observes **routing only** and says nothing about Sentry —
which is all this criterion needs.

### 1.1–1.5 — automated verification

| #   | Check                                     | Result                                                                                                                           |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | `npm run typecheck`                       | OK — **146 files**, 0 errors, 0 warnings (floor 50)                                                                              |
| 1.2 | `npm run lint`                            | exit 0 — 0 errors, **3** pre-existing `no-console` warnings, all in `evals/generation-quality.eval.ts` (unchanged by this phase) |
| 1.3 | `npm run build`                           | exit 0 — server built; the standing `@astrojs/sitemap` `site` warning is unchanged                                               |
| 1.4 | `npm test`                                | **405 passed / 405, 33 files**, seed `1786560253846`                                                                             |
| 1.5 | `git ls-files src/pages/api/shipprobe.ts` | no output — the route is gone from the tree                                                                                      |

**The file-count drop was measured as a PAIR rather than asserted**, because the plan predicts "exactly
1" and a single reading cannot show a delta. The probe was restored from `HEAD`, the gate re-run, and
the probe deleted again:

| Tree state    | `Result (N files)` |
| ------------- | ------------------ |
| probe present | **147**            |
| probe deleted | **146**            |

Delta **exactly 1**, as predicted, with the total staying far above the floor of 50 — which is why the
gate asserts a floor and not an equality (`test-plan.md` has recorded this number going stale at 130,
133, 135, 145; it is 146 today and no document should pin it).

No guard test went red. In particular the tightest tree-walking scan
(`tests/lib/error-param-guard.test.ts`, `>= 69` against a measured 71 → 70) keeps its spare, and the
three name-pinning guards (`no-logging`, `no-env-access`, `form-endpoint-guards`) name other files.
