# Verification record — C10X-28 / C10X-34 / C10X-30

> Written incrementally, one section per phase, as each phase's checks are run — not
> reconstructed at the end. Plan Phase 6 §1 owns the finished document; this file exists from
> Phase 1 so no observed output has to be remembered.
>
> Every deliberate-breakage entry records: the edit made, the **observed** failure string, the
> red/green split with its denominator, and the verified restore. A count with no run behind it
> is worse than no count — see `test-plan.md` §6.6, where two-day-old figures were already stale.

Environment for every run below unless stated otherwise: local Supabase stack up,
`OPENROUTER_API_KEY` unset, branch `C10X-28-ai-candidate-generation-test-2`.

## Phase 1 — auth error copy (C10X-34)

### Automated

| Check | Command | Result |
| --- | --- | --- |
| 1.1 Lint | `npm run lint` | clean (only the pre-existing `astro-eslint-parser` `projectService` notices) |
| 1.2 Full suite | `npm test` | **148 passed / 148, 12 files** (was 115/11 before this phase; the file adds 33) |
| 1.3 New file alone | `npx vitest run tests/auth/errors.test.ts` | **33 passed / 33** |
| 1.4 Stryker on the mapper | `npx stryker run --mutate "src/lib/auth-errors.ts"` | **93.33%** — 42 killed, 3 survived, 0 no-coverage |

**The Stryker run's three survivors are equivalent mutants, and each was checked rather than
assumed.** None of them changes which class a code maps to, which is the criterion Phase 1 sets.

| Survivor | Why it is equivalent |
| --- | --- |
| `status !== undefined && status >= SERVER_ERROR_FLOOR` → `true && …` | `undefined >= 500` evaluates to `false` (NaN comparison), so the guard's removal cannot change the branch taken. The guard exists for TypeScript, not for the runtime. Verified: `node -e "console.log(undefined >= 500)"` → `false` |
| `error.code === undefined ? undefined : MESSAGE_BY_CODE[error.code]` → `false ? …` | `MESSAGE_BY_CODE[undefined]` looks up the property name `"undefined"`, which the table does not carry, so the value is `undefined` either way. Verified: `node -e "const M={a:'x'}; console.log(M[undefined], ('undefined' in M))"` → `undefined false` |
| the same mutant on `MESSAGE_BY_NAME` | identical reasoning; same table shape |

**One assertion was added because of this run**, not to raise the score for its own sake: the
first pass scored 86.67% with three `StringLiteral -> ""` survivors on `AUTH_UNAVAILABLE_MESSAGE`,
`AUTH_GENERIC_MESSAGE` and `AUTH_NETWORK_MESSAGE`. Those three are the constants no case compares
against a literal — a test asserting `toBe(AUTH_GENERIC_MESSAGE)` mutates on **both** sides at
once and stays green. An empty constant is a real user-visible defect (`ServerError.tsx:8`
renders nothing for a falsy message, so a failed sign-in would show no reason at all), so the
test now walks the exported closed set and asserts every member is non-empty. That is
well-formedness, not copy: no test in this file pins a single word of Polish.

### 1.7 Deliberate-breakage check

**Edit**: in `src/lib/auth-errors.ts`, repoint one key of `MESSAGE_BY_CODE` —
`user_banned: AUTH_USER_BANNED_MESSAGE` → `user_banned: AUTH_INVALID_CREDENTIALS_MESSAGE`.

**Observed**: `npx vitest run tests/auth/errors.test.ts` → **exactly 1 of 33 red**, and it is the
matching class:

```
FAIL  tests/auth/errors.test.ts > authErrorMessage — code chain > maps user_banned to its own constant
AssertionError: expected 'Nieprawidłowy e-mail lub hasło.' to be 'To konto zostało zablokowane.'
```

That split is the point: the other 32 cases — including the eleven sibling code mappings and the
distinctness check — stayed green, so the red one observes **that key** rather than an incidental
property of the table. Note what did **not** fire: "keeps the distinct code classes distinct"
compares the constants directly, not the mapping, so it is blind to a repointed key by
construction. Only the per-code case catches this.

**Restore**: key reverted; `npx vitest run tests/auth/errors.test.ts` → 33/33 green;
`git status --porcelain src/` shows only the phase's three intended paths
(`signin.ts`, `signup.ts` modified, `auth-errors.ts` new). No breakage edit was committed.

### 1.5 / 1.6 Manual checks — run in a real browser against `npm run dev`

Dev server on `http://localhost:4326` (4321-4325 were already taken by other running servers).

**1.5 — wrong password.** Signed out, `/auth/signin`, submitted
`leak-probe-manual@example.com` with a wrong password. The address bar became:

```
/auth/signin?error=Nieprawid%C5%82owy%20e-mail%20lub%20has%C5%82o.
```

i.e. `AUTH_INVALID_CREDENTIALS_MESSAGE` and nothing else — **the submitted address does not
appear in the URL**, which is the whole point of the phase. The form rendered "Nieprawidłowy
e-mail lub hasło." inside the card. Before this change the same submit produced
`?error=Invalid+login+credentials`.

**1.6 — already-registered address.** `dup-probe-c10x34@example.com` was registered through the
UI (redirect to `/auth/confirm-email`, "Registration successful"), then submitted again on
`/auth/signup`. Result:

```
/auth/signup?error=Konto%20z%20tym%20adresem%20e-mail%20ju%C5%BC%20istnieje.%20Zaloguj%20si%C4%99.
```

rendered as "Konto z tym adresem e-mail już istnieje. Zaloguj się." — its own constant, **not**
the generic fallback, which is what the check asks for. Confirmed independently at the endpoint,
because the browser read raced the redirect twice and read the pre-redirect URL:

```
$ curl -s -i -X POST http://localhost:4326/api/auth/signup \
    -H "Origin: http://localhost:4326" \
    -F "email=dup-probe-c10x34@example.com" -F "password=probe-passw0rd"
HTTP/1.1 302 Found
location: /auth/signup?error=Konto%20z%20tym%20adresem%20e-mail%20ju%C5%BC%20istnieje.%20Zaloguj%20si%C4%99.
```

Two notes for whoever repeats this. The `Origin` header is **required** — Astro's dev server
answers a form POST without it with `403 Cross-site POST form submissions are forbidden`, which
looks like an auth failure and is not. And 1.6 is reachable **locally only**:
`supabase/config.toml:209` sets `enable_confirmations = false`; with confirmations on (the
production default) GoTrue answers 200 with an obfuscated user and no error at all, so
`signup.ts:15` is never entered. That is anti-enumeration behaviour in the server, not something
the mapper can change — do not treat its absence in production as a regression.

Left behind on the local dev DB, deliberately: the one `dup-probe-c10x34@example.com` row
(`auth.users`, verified exactly 1 row). Harmless, and re-running 1.6 needs an already-registered
address anyway.
