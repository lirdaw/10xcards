// Everything about the local dev-DB cleanup that can be decided WITHOUT touching Docker. No
// child_process, no filesystem, no console — all of that lives in the runner beside this file
// (./run-db-cleanup.ts), which is what makes this half testable with ordinary fixtures. Same
// split as scripts/kong-keepalive.ts and scripts/schema-drift.ts, and here the reason is the
// sharpest of the three: the runner issues an irreversible `delete from auth.users`, so the
// predicate deciding WHICH users match is the one thing in this change that must be assertable
// without a database.
//
// Why the cleanup exists at all: the local dev database accumulates ~68 decks and 2 auth users
// per `vitest` invocation and nothing has ever removed them (C10X-47 research §1-2). The cost is
// not disk and not runtime — ~20 MB across five tables, every filtered column indexed. It is
// FALSIFIABILITY: PostgREST truncates any result set at `max_rows = 1000` (supabase/config.toml),
// so once the database holds tens of thousands of decks, an assertion of the form "the foreign
// deck is ABSENT from this result set" passes because the deck fell outside the truncation
// window rather than because the guard held. That is measured, not argued — see this change's
// verification.md §3.1, where the four-policy neuter recipe from test-plan.md §6.6 leaves a
// cross-account denial GREEN with all four policies set `using (true)`. The accumulation disarms
// the project's deliberate-breakage procedure, which is the instrument every §6.6 coverage claim
// rests on.
//
// Why a script beside the suite rather than a hook inside it: `assertAnonKey`
// (tests/setup/env-assertions.ts) rejects any non-anon key with no env opt-out, deliberately. So
// an in-suite teardown reaches only its own run's rows under RLS and can never touch `auth.users`
// at all — it could not repay the existing debt even in principle, and it would destroy the rows
// a developer wants to read after a red run.
//
// Why both files sit in `scripts/` rather than `src/`: the runner prints, and
// tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. Keeping this half
// next to it makes their import a sibling instead of the deep relative `../src/lib/…` path
// AGENTS.md's first Hard Rule forbids (the `@/*` alias does not resolve under Node's type
// stripping).

/**
 * The harness account pattern, as a SQL `LIKE` pattern.
 *
 * Pinned as a value rather than inlined for the reason `KONG_KEEPALIVE_ENV` is pinned, and the
 * failure mode here is worse: a typo produces a `delete` statement that runs perfectly, reports
 * success, and matches **nothing** — so the script would print "0 harness rows" and a developer
 * would read the debt as already repaid. It is also the value the JS mirror below is derived
 * from, so there is exactly one place to get it wrong.
 *
 * `harness-%` and not `%harness%`, and the difference is not cosmetic: `e2e-harness@example.com`
 * is a real, surviving account on this machine (C10X-46's dedicated e2e identity) and a
 * containment pattern would delete it. Accounts are minted as
 * `harness-${label}-${runId}@example.com` (tests/fixtures/accounts.ts), so the anchor is exact.
 *
 * The value is a module constant interpolated into SQL by {@link censusStatement} and
 * {@link deleteStatement}. The parameterisation exists so a TEST can prove the statements are
 * built from their argument rather than from hardcoded text, not so a runtime caller can supply
 * one — and as of impl-review F1 (2026-08-15) that is ENFORCED by {@link assertPatternIsSafe}
 * rather than asserted here. The paragraph this replaces defended the interpolation on the
 * grounds that no caller supplies an argument, which is true of today's callers and is exactly
 * the shape `tests/lib/no-env-access.test.ts` opens by rejecting: a prose rule nothing enforces
 * is not a rule. The parameter is exported and already exercised with a caller-supplied value.
 */
export const HARNESS_EMAIL_PATTERN = "harness-%";

/**
 * SQL `LIKE`, evaluated in JS.
 *
 * This exists so the delete's predicate can be asserted against real email addresses in a unit
 * test — the whole-set positive control in tests/lib/db-cleanup.test.ts fixtures every
 * non-harness account measured on this machine and requires the pattern to match **none** of
 * them, alongside a real harness address it does match. Without both directions a pattern
 * matching everything and a pattern matching nothing are indistinguishable.
 *
 * Deriving the predicate FROM {@link HARNESS_EMAIL_PATTERN} rather than hand-writing a second
 * `startsWith("harness-")` is the point: two spellings of one rule is the drift this project has
 * recorded more than once (test-plan.md's `IDS_MAX` mirror, and `LANGUAGES` serving three roles
 * at once). One value, two consumers.
 *
 * SCOPE, stated because a translator invites over-reading: `%` (any run, including empty) and
 * `_` (any single character) only, and case-SENSITIVE, which is Postgres's `LIKE` (`ILIKE` is the
 * case-insensitive one). Both properties match the one pattern this module ships; a pattern
 * needing more would need this function revisited, not merely reused.
 *
 * **Backslash is NOT modelled, and it is refused rather than mistranslated** (impl-review F2,
 * 2026-08-15). An earlier draft of this paragraph said "No `ESCAPE` clause" as though that made
 * backslash inert; it is the opposite. Postgres `LIKE` has a **default escape character of
 * backslash** — `LIKE 'a\%'` matches a literal `a%` with no `ESCAPE` clause anywhere — while this
 * translator escapes `\` as a regex literal and then translates `%` unconditionally, so the two
 * would disagree about which rows match. No live defect: {@link HARNESS_EMAIL_PATTERN} carries no
 * backslash. It is refused anyway because this function is the ONLY assertable proxy for the
 * delete's predicate: the whole-set positive control is evidence about the delete only while the
 * mirror is faithful, and a pattern change is exactly when someone would lean on it hardest.
 */
export function matchesLikePattern(pattern: string, value: string): boolean {
  if (pattern.includes("\\")) {
    throw new Error(
      "matchesLikePattern: backslash is LIKE's default escape character and this mirror does not model it",
    );
  }
  // Escape every regex metacharacter first. `%` and `_` are deliberately absent from the class,
  // so they survive to be translated below — the order is load-bearing.
  const body = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  // `s` so `.` spans a newline, matching `LIKE`'s treatment of an embedded newline.
  return new RegExp(`^${body}$`, "s").test(value);
}

/**
 * Characters a LIKE pattern may carry before it is interpolated into SQL. Deliberately narrow:
 * everything an e-mail-shaped pattern needs, plus LIKE's two wildcards, and nothing that can end
 * a string literal or start a second statement.
 */
const SAFE_PATTERN = /^[A-Za-z0-9%_@.-]+$/;

/**
 * Refuse a pattern that must not reach a SQL string literal (impl-review F1, 2026-08-15).
 *
 * {@link censusStatement} and {@link deleteStatement} interpolate their argument with no escaping,
 * and `psql -c` executes multiple statements, so `deleteStatement("'; delete from public.deck; --")`
 * would build a valid statement-splitting payload against `auth.users`. No runtime caller passes an
 * argument today — both call sites in ./run-db-cleanup.ts call bare — so this closes a LATENT hole
 * rather than a live one. It is closed anyway because the parameter is exported, is already
 * exercised with a caller-supplied value by the tests, and sits on the one irreversible path in
 * this tooling; a comment saying "no caller does this" is not a mechanism that stops one.
 */
function assertPatternIsSafe(pattern: string): void {
  if (!SAFE_PATTERN.test(pattern)) {
    throw new Error(`unsafe LIKE pattern for SQL interpolation: ${JSON.stringify(pattern)}`);
  }
}

/** Is this a per-run harness account, i.e. a row the cleanup deletes? */
export function isHarnessEmail(email: string): boolean {
  return matchesLikePattern(HARNESS_EMAIL_PATTERN, email);
}

/**
 * `project_id` out of supabase/config.toml text, by regex.
 *
 * No TOML parser, deliberately: the zero-runtime-dependency property is what keeps this script
 * invokable by bare `node --experimental-strip-types`, and one quoted scalar at the top of a file
 * does not justify giving that up. Same call this project already makes in
 * ./disable-kong-keepalive.ts.
 *
 * TWO properties are load-bearing and both have a case in the tests, because this file has a
 * **decoy**: `supabase/config.toml` carries a SECOND `project_id`, commented out, under
 * `[auth.third_party.firebase]` (`# project_id = "my-firebase-project"`).
 *
 * - **Commented keys are ignored.** `^\s*project_id` requires the key at the start of the line
 *   after whitespace only, so a leading `#` disqualifies it.
 * - **First match wins.** `RegExp.exec` on a non-global pattern returns the first match, so the
 *   real key at the top of the file resolves. A `matchAll`/last-wins read would resolve a
 *   container name that does not exist, and the failure would surface as `docker exec` refusing
 *   an unknown container — telling a reader nothing about parsing.
 *
 * Throws rather than defaulting: a missing id means the file is not this project's
 * `config.toml`, and guessing a container name at that point is how a script operates on
 * something that is not the caller's.
 */
export function readProjectId(toml: string): string {
  const projectId = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (projectId === undefined) throw new Error("no `project_id` found in supabase/config.toml");
  return projectId;
}

/**
 * The Postgres container name the Supabase CLI derives from `project_id`.
 *
 * Kept as a function over the id rather than as a literal so the runner reads the id out of THIS
 * checkout's `supabase/config.toml`. That is what makes the script local-only **by
 * construction**: it reaches Postgres solely through `docker exec` on a locally-named container,
 * so it cannot address a cloud project at all — a stronger safety property than a runtime host
 * assertion, and the same one ./disable-kong-keepalive.ts relies on.
 */
export function dbContainerName(projectId: string): string {
  return `supabase_db_${projectId}`;
}

/**
 * The five measures the census reports, in the order the report prints them.
 *
 * `users` is `auth.users`; the other four are the public tables that cascade from it
 * (`deck.user_id` and `generation_session.user_id` are `ON DELETE CASCADE` to `auth.users`,
 * `flashcard.deck_id` from `deck`, `flashcard_schedule.flashcard_id` from `flashcard` — read off
 * `pg_constraint`, not `information_schema`, which reports cross-schema FKs as absent).
 */
export const CENSUS_TABLES = ["users", "deck", "flashcard", "flashcard_schedule", "generation_session"] as const;

export type CensusTable = (typeof CENSUS_TABLES)[number];

/** One table, split by whether the owning account matches the harness pattern. */
export interface TableCensus {
  /** Rows the delete WILL remove. */
  harness: number;
  /** Rows the delete must leave EXACTLY as they are — the safety invariant. */
  other: number;
}

export type Census = Record<CensusTable, TableCensus>;

/**
 * The census statement: one row per table, `label|harness|other`.
 *
 * Every join is a LEFT join and the "other" bucket is `email is null or email not like <pattern>`,
 * which is the safe direction on both counts: a row whose owner could not be resolved is counted
 * as non-harness, i.e. as something the delete must not touch, so a hypothetical orphan can only
 * ever make the invariant STRICTER. (There are none today — a direct check found 0 decks with a
 * missing owner — but an allowlist that silently drops what it does not name is the class this
 * project has already been bitten by.)
 *
 * Emitted with `-t -A -F'|'` so the output is exactly N lines of pipe-separated scalars with no
 * header, no alignment padding and no row count.
 */
export function censusStatement(pattern: string = HARNESS_EMAIL_PATTERN): string {
  assertPatternIsSafe(pattern);

  const split = (alias: string) =>
    `count(*) filter (where ${alias}.email like '${pattern}'), ` +
    `count(*) filter (where ${alias}.email is null or ${alias}.email not like '${pattern}')`;

  return [
    `select 'users', ${split("u")} from auth.users u`,
    "union all",
    `select 'deck', ${split("u")} from public.deck d left join auth.users u on u.id = d.user_id`,
    "union all",
    `select 'flashcard', ${split("u")} from public.flashcard f` +
      " left join public.deck d on d.id = f.deck_id left join auth.users u on u.id = d.user_id",
    "union all",
    `select 'flashcard_schedule', ${split("u")} from public.flashcard_schedule s` +
      " left join public.flashcard f on f.id = s.flashcard_id" +
      " left join public.deck d on d.id = f.deck_id left join auth.users u on u.id = d.user_id",
    "union all",
    `select 'generation_session', ${split("u")} from public.generation_session g` +
      " left join auth.users u on u.id = g.user_id",
    ";",
  ].join("\n");
}

/**
 * The delete. One statement; the cascade does the rest.
 *
 * Deliberately NOT parameterised by anything else, and deliberately NOT carrying the one-time
 * orphan `E2E deck 1785947414992` this change also removes: that deck is owned by
 * `test@mail.com`, is not matched by the harness pattern and never will be, and baking a
 * 2026-08-05 artifact into a permanent tool is dead weight forever after its first run. It is
 * deleted separately, as a recorded act (plan Phase 4 §2).
 */
export function deleteStatement(pattern: string = HARNESS_EMAIL_PATTERN): string {
  assertPatternIsSafe(pattern);
  return `delete from auth.users where email like '${pattern}';`;
}

/**
 * Parse `psql -t -A -F'|'` output into a {@link Census}.
 *
 * **A census that cannot be parsed must not read as zero**, and that is this function's whole
 * contract. A malformed or short result means the query failed, and reporting `0 harness rows`
 * there says "nothing to clean" — the exact false green the script exists to prevent, and the
 * same shape as `parseKongEnv`'s "a missing key is not a key that is zero". So every failure
 * throws, and a genuine zero is a `Census` full of zeros: the two are distinguishable by
 * construction rather than by the caller's care.
 *
 * **Rows are keyed by LABEL, never by position**, and that is measured rather than defensive: run
 * against the live stack on 2026-08-14 the five-branch `UNION ALL` came back in the order
 * `users, deck, generation_session, flashcard_schedule, flashcard` — not the order it is written
 * in. `UNION ALL` guarantees no ordering, and a positional parser would have silently reported
 * `flashcard` counts under `generation_session`.
 *
 * Every one of {@link CENSUS_TABLES} must appear exactly once; a duplicate or a missing label
 * throws.
 */
export function parseCensus(stdout: string): Census {
  const seen = new Map<string, TableCensus>();

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;

    const fields = line.split("|");
    if (fields.length !== 3) {
      throw new Error(`census: expected 3 pipe-separated fields, got ${fields.length} in: ${line}`);
    }

    const [label, harnessRaw, otherRaw] = fields;
    // `noUncheckedIndexedAccess` types these `string | undefined`; the length check above already
    // guarantees all three, and narrowing here is what keeps that guarantee visible to the reader
    // as well as to the compiler.
    if (label === undefined || harnessRaw === undefined || otherRaw === undefined) {
      throw new Error(`census: malformed row: ${line}`);
    }
    if (!(CENSUS_TABLES as readonly string[]).includes(label)) {
      throw new Error(`census: unknown table \`${label}\` in: ${line}`);
    }
    if (seen.has(label)) throw new Error(`census: duplicate row for \`${label}\``);

    seen.set(label, { harness: countOf(harnessRaw, label), other: countOf(otherRaw, label) });
  }

  const missing = CENSUS_TABLES.filter((table) => !seen.has(table));
  if (missing.length > 0) {
    throw new Error(`census: no row for ${missing.join(", ")} — the query did not run to completion`);
  }

  // Built by lookup rather than by `Object.fromEntries`, so the result is typed as a total
  // `Census` rather than as a partial record the caller has to re-check.
  const at = (table: CensusTable): TableCensus => {
    const counts = seen.get(table);
    if (counts === undefined) throw new Error(`census: no row for ${table}`);
    return counts;
  };

  return {
    users: at("users"),
    deck: at("deck"),
    flashcard: at("flashcard"),
    flashcard_schedule: at("flashcard_schedule"),
    generation_session: at("generation_session"),
  };
}

/**
 * A count field, refused unless it is a non-negative integer.
 *
 * `Number("")` is `0` and `Number(" 12 ")` is `12`, so a bare `Number(...)` would read a
 * truncated result as a genuine zero — which is the one reading this module may never produce.
 */
function countOf(raw: string, label: string): number {
  if (!/^\d+$/.test(raw.trim())) throw new Error(`census: \`${label}\` count is not a number: ${JSON.stringify(raw)}`);
  return Number(raw.trim());
}

/** Total rows the delete will remove, across all five measures. */
export function totalHarnessRows(census: Census): number {
  return CENSUS_TABLES.reduce((sum, table) => sum + census[table].harness, 0);
}

/**
 * The safety invariant: which measures' NON-harness counts moved across the delete.
 *
 * Returns the offending tables, so an empty array is "nothing but harness rows was touched". This
 * is what makes the surviving manual-run artifacts — the decks archived documents cite as the
 * record of a recorded verification run — a property of the TOOLING rather than of the operator's
 * attention. A future edit that widens {@link HARNESS_EMAIL_PATTERN} reddens here instead of
 * destroying evidence.
 */
export function nonHarnessDrift(before: Census, after: Census): CensusTable[] {
  return CENSUS_TABLES.filter((table) => before[table].other !== after[table].other);
}

/** Which measures still hold harness rows after the delete — empty means the delete landed. */
export function harnessRemnants(after: Census): CensusTable[] {
  return CENSUS_TABLES.filter((table) => after[table].harness !== 0);
}

/** Parsed command line. */
export interface CleanupArgs {
  /** `--yes` was passed. Without it the script counts, prints, and deletes nothing. */
  confirmed: boolean;
}

/**
 * Parse the runner's argv tail (`process.argv.slice(2)`).
 *
 * **An unrecognised flag is refused, not ignored.** A mistyped `--yess` that silently reads as
 * "report only" is harmless; one that silently reads as "delete" is not — so the refusal is
 * symmetric, and it costs nothing on the safe side.
 *
 * **Know what npm does to that flag before reading the guard's reach.** npm parses `-`-prefixed
 * arguments itself unless they follow a `--` separator, and `yes` is a real npm config key.
 * Measured on npm 11.16.0: `npm run db:clean --yes` and `npm run db:clean --yess` BOTH hand the
 * script an empty `process.argv`; only `npm run db:clean -- --yes` forwards anything. Two
 * consequences: **the invocation is `npm run db:clean -- --yes`, everywhere**, and this refusal is
 * unreachable through the npm script — a mistyped flag never arrives at all, which is fail-safe
 * (report-only) but means the guard fires only under a direct
 * `node --experimental-strip-types scripts/run-db-cleanup.ts --yess`.
 */
export function parseArgs(argv: readonly string[]): CleanupArgs {
  let confirmed = false;

  for (const arg of argv) {
    if (arg === "--yes") {
      confirmed = true;
      continue;
    }
    throw new Error(`unrecognised argument \`${arg}\` — the only accepted flag is \`--yes\``);
  }

  return { confirmed };
}
