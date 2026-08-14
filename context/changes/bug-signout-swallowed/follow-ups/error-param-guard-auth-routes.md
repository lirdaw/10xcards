# Follow-up: `signin.ts` and `signup.ts` stay outside the `?error=` membership sweep

**Raised by**: C10X-51 (`bug-signout-swallowed`), Phase 3, 2026-08-14.
**Status**: open, unticketed. **To be ticketed via `/jira-backlog-sync`.**
**Owner of the gap today**: nothing — that is the point of writing it down.

## What is covered after C10X-51, and what is not

`tests/lib/form-endpoint-guards.test.ts` carries three sweeps. The `formData()` sweep covers
`src/pages/api/` entire. The two `?error=` sweeps cover the **registered surfaces** in that file's
`ERROR_PARAM_SURFACES` table:

| surface     | paths                           | vouching module         | decision module         |
| ----------- | ------------------------------- | ----------------------- | ----------------------- |
| deck routes | `src/pages/api/decks/**`        | `@/lib/redirect-errors` | —                       |
| sign-out    | `src/pages/api/auth/signout.ts` | `@/lib/auth-errors`     | `@/lib/signout-outcome` |

`src/pages/api/auth/signin.ts` and `src/pages/api/auth/signup.ts` are **not** registered. Their
`?error=` emissions are correct today and are enforced by nothing — the same "closed by
construction, guarded by a careful reader" state the deck routes were in before C10X-40, and the
state this guard's own header records as having needed three reviews to notice once already.

## Why they were not simply added — measured, not argued

The plan for C10X-51 called for widening the root from `src/pages/api/decks` to `src/pages/api`.
Running the guard's `rejection()` logic verbatim against the two files a widened root newly sweeps
in, keyed on `@/lib/auth-errors`, refuses **four of their six** emissions (measured 2026-08-14):

| site                           | emission                                                                    | verdict                                                        |
| ------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `signin.ts:29`, `signup.ts:20` | `encodeURIComponent(message)` over a `isFormContentType(...) ? A : B` local | `local \`message\` mixes the closed set with a computed value` |
| `signin.ts:43`, `signup.ts:33` | `encodeURIComponent(authErrorMessage(error))`                               | `not an identifier: authErrorMessage(error)`                   |
| `signin.ts:36`, `signup.ts:27` | `encodeURIComponent(AUTH_UNAVAILABLE_MESSAGE)`                              | accepted                                                       |

Both refusals are **false positives against correct code**: `authErrorMessage` is total into
`AUTH_MESSAGES` and the ternary selects between two set members. So a widening is not a
registration change — it is two new exemptions to `rejection()`:

1. **A call to a mapper that is total into the vouching set.** Accept
   `encodeURIComponent(f(x))` where `f` is imported from the vouching module and is total into its
   closed set. Note what this borrows: `authErrorMessage`'s totality is asserted in
   `tests/auth/errors.test.ts`, not by this guard — so the exemption imports a property from
   another file's claims, and deleting that case would silently unback it.
2. **A ternary whose non-member residue is a predicate call.** `computedResidue` rejects the
   `isFormContentType(context.request)` discriminator because it is a call, and calls are exactly
   what that residue check exists to refuse. Distinguishing "a predicate whose result is
   discarded" from "a value that gets emitted" is the whole difficulty.

This is the one guard in this repo where **every previous exemption turned out to be a defect**:
`computedResidue` exists because "mentions an owned name" waved through `err.message` in three
shapes (C10X-40 F1), and `localDeclarations` scans every declaration because first-match-wins hid
a shadowed leak (F2). So each of the two above needs its own falsification run and its own written
defence — a ticket, not a sub-phase.

## The third exemption, which C10X-51 did take

Registering `signout.ts` needed one of its own, and it is recorded here because it is the
precedent the next person will cite.

`signout.ts` names no message at all: it does `const { path, message } = signOutLanding(outcome);`
and interpolates `message`. That is neither an import nor a `const <name> = …;`, so the unchanged
rules refuse it — measured 2026-08-14, before any edit:

```
signout.ts:77  encodeURIComponent(message)
  -> `message` is neither imported from the closed set nor declared here
```

i.e. registering the file under the untouched rules would have turned the guard **red on correct
code**. The exemption granted is `decisionBoundNames`: a name destructured from a call to a
function this file imported from the surface's **declared** `decisionModule`. Three properties
keep it narrow, and all three have a control in the guard file:

- it is **declared per surface**, so the deck surface (which declares none) gets an empty set and
  its verdicts are byte-identical — evidenced numerically rather than asserted: the emission
  totals moved 29 → 30 and the producing-file count 6 → 7, i.e. `signout.ts` contributes exactly
  one and nothing about the deck subtree moved;
- it sits **after** the bare-identifier test, so it can never vouch for a member access off the
  same binding;
- it is backed by a **borrowed** claim, named in the docblock:
  `tests/lib/signout-outcome.test.ts`'s "emits only messages the sign-in page will vouch for"
  asserts `signOutLanding`'s totality into `AUTH_MESSAGES` by equality. Delete that case and this
  exemption stops being backed by anything.

Note the exemption does **not** help `signin.ts`/`signup.ts`: their values are not destructured
bindings.

## What closing this would look like

1. Ticket it. Add the two exemptions above, each with its own breakage run recorded with the
   observed failure string and split, in the style this guard's existing controls use.
2. Extend `ERROR_PARAM_SURFACES` with an `auth forms` row covering `signin.ts` and `signup.ts`,
   vouching module `@/lib/auth-errors`, no decision module.
3. Re-measure both floors by running, never by arithmetic.
4. Add the two new shapes to the detector's own positive-control case, in both directions —
   accepted for the shipped shape, refused for the leak it must still refuse (`authErrorMessage`
   swapped for a function that is _not_ total, a ternary whose residue is a value rather than a
   predicate).

Until then: the two routes' `?error=` values are correct, unenforced, and this file is the record
of that.
