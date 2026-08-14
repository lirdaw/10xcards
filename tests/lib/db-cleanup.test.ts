import { describe, expect, it } from "vitest";
// `@/*` maps to `src/*` only, and the subject here is local-stack tooling under `scripts/` —
// see test-plan.md §6.1 on why its test still sits in tests/lib/ beside the suite's other
// pure-function files rather than in a tests/scripts/ folder holding one file.
import {
  CENSUS_TABLES,
  HARNESS_EMAIL_PATTERN,
  censusStatement,
  dbContainerName,
  deleteStatement,
  harnessRemnants,
  isHarnessEmail,
  matchesLikePattern,
  nonHarnessDrift,
  parseArgs,
  parseCensus,
  readProjectId,
  totalHarnessRows,
} from "../../scripts/db-cleanup.ts";
import type { Census } from "../../scripts/db-cleanup.ts";

// Everything about `npm run db:clean` that can be decided WITHOUT touching Docker. The runner
// beside it (./run-db-cleanup.ts) issues an irreversible `delete from auth.users` whose cascade
// removes decks, flashcards, schedules and generation sessions, so this half has veto power over
// what survives on a developer's machine — which is why the predicate deciding WHICH accounts
// match is a separate, assertable module rather than a SQL string inside a runner.
//
// The `docker exec` calls themselves are NOT covered here and cannot be: they are live operations
// against a running container. Their evidence is the recorded run in this change's
// verification.md plus the runner's own refusal to report success on a census it could not parse
// or on a delete whose read-back disagrees with what it claimed.

/**
 * EVERY non-harness account on this machine, read out of `auth.users` on 2026-08-14:
 *
 *     docker exec supabase_db_10x-astro-starter psql -U postgres -d postgres -t -A \
 *       -c "select email from auth.users where email not like 'harness-%' order by created_at;"
 *
 * This is the load-bearing fixture of the whole file. These fourteen accounts own the eight decks
 * that are the artifacts of recorded manual verification runs — including the two `C10X-49 orphan`
 * decks that `test-plan.md` describes as "left in the local dev DB **as the artifact of record**",
 * a sentence a wrong pattern would make unverifiable. Real addresses, not fabricated ones, because
 * the question the fixture answers is "does the shipped pattern spare the accounts that actually
 * exist", and a fabricated set can only answer "does it spare the accounts I imagined".
 *
 * `e2e-harness@example.com` is the sharp one and the reason the pattern is anchored rather than a
 * containment match: it CONTAINS `harness`, it is C10X-46's dedicated e2e identity, and
 * `npm run e2e` signs in as it. A `%harness%` pattern deletes it and the e2e layer's session
 * producer silently starts minting a new account every run.
 */
const REAL_NON_HARNESS_ACCOUNTS = [
  "c10x41-phase4@example.com",
  "c10x37-p4-manual@example.com",
  "test@mail.com",
  "e2e-harness@example.com",
  "c10x49-phase3@example.com",
  "c10x50-phase4@example.com",
  "probe-signout-mssmajwp@example.com",
  "probe-subject-mssmb5ak@example.com",
  "probe-control-mssmb5ey@example.com",
  "manual-c10x51-1786692936@example.com",
  "manual-c10x51-p5-1786703279@example.com",
  "manual-c10x51-browser-1786704600@example.com",
  "c10x52-probe-1786714276@example.com",
  "manual-c10x52-p5-1786720259@example.com",
];

/**
 * Real harness addresses, in the shape `tests/fixtures/accounts.ts` mints them —
 * `harness-${label}-${runId}@example.com` with `runId = Date.now().toString(36)`. The third is
 * the sign-out file's own account (`tests/auth/signout.test.ts`), which uses a different label
 * for a reason unrelated to this script and must be matched all the same.
 */
const REAL_HARNESS_ACCOUNTS = [
  "harness-a-mst9r1sz@example.com",
  "harness-b-mst9r1sz@example.com",
  "harness-signout-mssmajwp@example.com",
];

describe("the harness email pattern", () => {
  // THE WHOLE-SET POSITIVE CONTROL, and the case this file exists for. Without BOTH directions a
  // pattern matching everything and a pattern matching nothing are indistinguishable: the first
  // destroys every artifact in the database, the second reports "0 harness rows" and reads as a
  // debt already repaid. Each direction alone is satisfied by one of those two failures.
  it("matches every per-run harness account and NONE of the accounts that must survive", () => {
    for (const email of REAL_HARNESS_ACCOUNTS) expect(isHarnessEmail(email)).toBe(true);
    for (const email of REAL_NON_HARNESS_ACCOUNTS) expect(isHarnessEmail(email)).toBe(false);
  });

  // Named separately from the sweep above because it is the one address whose survival a
  // reasonable-looking pattern actually threatens, and a reader scanning failures should meet it
  // by name rather than as element 4 of an array.
  it("spares `e2e-harness@example.com`, which contains `harness` but does not begin with it", () => {
    expect(isHarnessEmail("e2e-harness@example.com")).toBe(false);
    // The pattern a containment read would have shipped, shown to be the wrong one.
    expect(matchesLikePattern("%harness%", "e2e-harness@example.com")).toBe(true);
  });

  // Pinned as a value for the same reason `KONG_KEEPALIVE_ENV` is: the failure mode of a typo is
  // a `delete` that runs perfectly and matches nothing, i.e. a silent "already clean".
  it("is anchored at the start and pinned as a value", () => {
    expect(HARNESS_EMAIL_PATTERN).toBe("harness-%");
  });
});

describe("matchesLikePattern", () => {
  // The predicate above is derived from the SQL pattern rather than hand-written as a second
  // `startsWith`, so these cases pin the translation the derivation rests on.
  it("translates `%` as any run including the empty one", () => {
    expect(matchesLikePattern("a%", "a")).toBe(true);
    expect(matchesLikePattern("a%", "abc")).toBe(true);
    expect(matchesLikePattern("a%", "b")).toBe(false);
  });

  it("translates `_` as exactly one character", () => {
    expect(matchesLikePattern("a_c", "abc")).toBe(true);
    expect(matchesLikePattern("a_c", "ac")).toBe(false);
    expect(matchesLikePattern("a_c", "abbc")).toBe(false);
  });

  // A pattern is anchored at BOTH ends — SQL `LIKE` matches the whole value, not a substring. A
  // translator that forgot the anchors would make `harness-%` match
  // `not-a-harness-account@example.com`.
  it("matches the whole value, never a substring", () => {
    expect(matchesLikePattern("harness-%", "x-harness-a@example.com")).toBe(false);
    expect(matchesLikePattern("%b", "abc")).toBe(false);
  });

  // Postgres `LIKE` is case-SENSITIVE (`ILIKE` is the other one). Getting this backwards would
  // widen the delete rather than narrow it.
  it("is case-sensitive, like `LIKE` and unlike `ILIKE`", () => {
    expect(matchesLikePattern("harness-%", "Harness-a@example.com")).toBe(false);
  });

  // A regex metacharacter inside the pattern is data, not syntax. `.` is the one that would bite:
  // untranslated it matches any character, so `a.c` would match `abc`.
  it("treats regex metacharacters in the pattern as literals", () => {
    expect(matchesLikePattern("a.c", "abc")).toBe(false);
    expect(matchesLikePattern("a.c", "a.c")).toBe(true);
  });
});

describe("readProjectId", () => {
  /**
   * `supabase/config.toml` as it really is, reduced to the two lines that matter — and it carries
   * a **decoy**: a SECOND `project_id`, commented out, under `[auth.third_party.firebase]` at
   * `:328`. Verbatim from the file, including the comment marker and spacing.
   *
   * A first-match read resolves the real id. A `matchAll`/last-wins read resolves
   * `my-firebase-project`, and the failure surfaces as `docker exec` refusing an unknown container
   * — a message that tells the reader nothing at all about parsing.
   */
  const REAL_CONFIG_TOML = `# For detailed configuration reference documentation, visit:
# https://supabase.com/docs/guides/local-development/cli/config
# A string used to distinguish different Supabase projects on the same host. Defaults to the
# working directory name when running \`supabase init\`.
project_id = "10x-astro-starter"

[api]
enabled = true
max_rows = 1000

# Use Firebase Auth as a third-party provider alongside Supabase Auth.
[auth.third_party.firebase]
enabled = false
# project_id = "my-firebase-project"
`;

  it("reads the project id out of real config.toml text", () => {
    expect(readProjectId(REAL_CONFIG_TOML)).toBe("10x-astro-starter");
  });

  // The decoy, as its own case: the assertion above passes over a last-wins parser only because
  // it also passes over a first-match one, so it cannot tell them apart on its own.
  it("ignores the commented-out `project_id` further down the file", () => {
    expect(readProjectId(REAL_CONFIG_TOML)).not.toBe("my-firebase-project");
    expect(readProjectId('# project_id = "commented"\nproject_id = "real"\n')).toBe("real");
  });

  // Throws rather than defaulting: a missing id means this is not the project's config.toml, and
  // guessing a container name at that point is how a script operates on something else's stack.
  it("refuses a file with no project id rather than guessing one", () => {
    expect(() => readProjectId("[api]\nenabled = true\n")).toThrow(/project_id/);
    expect(() => readProjectId('# project_id = "only-a-comment"\n')).toThrow(/project_id/);
  });
});

describe("dbContainerName", () => {
  // Derived from `project_id` rather than hardcoded, which is what makes the script local-only by
  // construction: it holds no URL and no key, so there is no cloud project it could address.
  it("derives the Postgres container name from the project id", () => {
    expect(dbContainerName("10x-astro-starter")).toBe("supabase_db_10x-astro-starter");
    expect(dbContainerName("other-project")).toBe("supabase_db_other-project");
  });
});

describe("censusStatement / deleteStatement", () => {
  // THE POSITIVE CONTROL for "the statements are built from the pattern, not from hardcoded
  // text". Every assertion that reads the default statement is blind to this, because the default
  // pattern IS the literal a hardcoding implementation would inline — the same blindness
  // `OTHER_SPEC` exists to close in tests/lib/kong-keepalive.test.ts.
  it("threads its pattern argument through instead of inlining the shipped one", () => {
    const fabricated = "fabricated-prefix-%";

    expect(deleteStatement(fabricated)).toContain(fabricated);
    expect(deleteStatement(fabricated)).not.toContain(HARNESS_EMAIL_PATTERN);
    expect(censusStatement(fabricated)).toContain(fabricated);
    expect(censusStatement(fabricated)).not.toContain(HARNESS_EMAIL_PATTERN);
  });

  it("defaults to the shipped harness pattern", () => {
    expect(deleteStatement()).toContain(HARNESS_EMAIL_PATTERN);
    expect(censusStatement()).toContain(HARNESS_EMAIL_PATTERN);
  });

  // The delete's scope is `auth.users` and nothing else — every other row goes by cascade. A
  // statement naming `public.deck` directly would be a second, unreviewed deletion path.
  it("deletes from auth.users only, leaving the cascade to remove the rest", () => {
    const sql = deleteStatement();

    expect(sql).toContain("delete from auth.users");
    for (const table of ["deck", "flashcard", "flashcard_schedule", "generation_session"]) {
      expect(sql).not.toContain(`delete from public.${table}`);
    }
  });

  // The census must ask about all five measures, or the "non-harness counts unchanged" invariant
  // silently stops covering whichever one went missing.
  it("counts every measure the invariant is checked over", () => {
    const sql = censusStatement();

    for (const table of CENSUS_TABLES) expect(sql).toContain(`'${table}'`);
  });
});

/**
 * A real census, verbatim from `psql -t -A -F'|'` against the live stack on 2026-08-14 —
 * INCLUDING its row order, which is the point. The statement is written
 * `users, deck, flashcard, flashcard_schedule, generation_session`; the five-branch `UNION ALL`
 * came back in a different order, because `UNION ALL` guarantees none. A positional parser would
 * have reported `flashcard` counts under `generation_session` and nothing would have looked wrong.
 */
const REAL_CENSUS = `users|1546|14
deck|21814|8
generation_session|9659|11
flashcard_schedule|7380|3
flashcard|37666|41`;

describe("parseCensus", () => {
  it("reads a real census, keying rows by label rather than by position", () => {
    expect(parseCensus(REAL_CENSUS)).toEqual({
      users: { harness: 1546, other: 14 },
      deck: { harness: 21814, other: 8 },
      flashcard: { harness: 37666, other: 41 },
      flashcard_schedule: { harness: 7380, other: 3 },
      generation_session: { harness: 9659, other: 11 },
    });
  });

  it("tolerates the trailing newline and blank lines psql may emit", () => {
    expect(parseCensus(`\n${REAL_CENSUS}\n\n`).deck.harness).toBe(21814);
  });

  // A GENUINE ZERO is a census, not a failure — and it must stay distinguishable from the
  // malformed cases below, which is the whole contract. This is the shape a repaid database
  // returns, and the runner reads it as "nothing to clean".
  it("reads a genuinely empty database as zeros rather than as a failure", () => {
    const empty = CENSUS_TABLES.map((table) => `${table}|0|0`).join("\n");

    expect(totalHarnessRows(parseCensus(empty))).toBe(0);
  });

  // THE FAIL-CLOSED CONTRACT. A census that cannot be parsed must not read as zero: `0 harness
  // rows` means "nothing to clean", so a truncated or failed query would report the debt as
  // already repaid. Same class as `parseKongEnv`'s "a missing key is not a key that is zero" —
  // and the reason each case below throws rather than returning a partial record.
  it("refuses a short result instead of reporting the missing tables as zero", () => {
    expect(() => parseCensus("users|1546|14\ndeck|21814|8")).toThrow(/no row for/);
    expect(() => parseCensus("")).toThrow(/no row for/);
  });

  it("refuses a row with the wrong number of fields", () => {
    expect(() => parseCensus(`users|1546\n${REAL_CENSUS}`)).toThrow(/3 pipe-separated fields/);
  });

  it("refuses a count that is not a number", () => {
    expect(() => parseCensus(REAL_CENSUS.replace("21814", "ERROR"))).toThrow(/not a number/);
    // The empty field is the one a bare `Number(...)` reads as 0 — i.e. as a genuine zero.
    expect(() => parseCensus(REAL_CENSUS.replace("|21814|", "||"))).toThrow(/not a number/);
  });

  it("refuses an unknown table label rather than ignoring it", () => {
    expect(() => parseCensus(`${REAL_CENSUS}\nsomething_else|1|2`)).toThrow(/unknown table/);
  });

  it("refuses a duplicated table label", () => {
    expect(() => parseCensus(`${REAL_CENSUS}\ndeck|1|2`)).toThrow(/duplicate row/);
  });

  // psql without `ON_ERROR_STOP` prints its error and exits 0; the runner sets that flag, and this
  // is the second layer — an error message reaching the parser is refused rather than counted.
  it("refuses a psql error message", () => {
    expect(() => parseCensus('ERROR:  relation "auth.users" does not exist')).toThrow();
  });
});

/**
 * A census with the same pair on every measure, so a case can vary exactly one table.
 *
 * Spelled out rather than built with `Object.fromEntries` + a cast: the cast would be the one
 * place in this file where the compiler stops checking that a `Census` really carries all five
 * measures, which is the property `parseCensus` above exists to guarantee.
 */
function censusOf(harness: number, other: number): Census {
  return {
    users: { harness, other },
    deck: { harness, other },
    flashcard: { harness, other },
    flashcard_schedule: { harness, other },
    generation_session: { harness, other },
  };
}

describe("the runner's two oracles", () => {
  it("counts the rows the delete would remove, across every measure", () => {
    expect(totalHarnessRows(parseCensus(REAL_CENSUS))).toBe(1546 + 21814 + 37666 + 7380 + 9659);
  });

  // ORACLE 1. `delete … where email like '<pattern>'` exits 0 and prints `DELETE 0` when it
  // matches nothing, so the statement's own success is not evidence that anything was removed.
  // Only a read-back is, and it has to cover every measure — a delete that emptied `deck` but
  // left `generation_session` (no deck FK on that table) is exactly the partial the cascade
  // reasoning could get wrong.
  it("reports every measure that still holds harness rows after a delete", () => {
    expect(harnessRemnants(censusOf(0, 5))).toEqual([]);
    expect(harnessRemnants({ ...censusOf(0, 5), generation_session: { harness: 3, other: 5 } })).toEqual([
      "generation_session",
    ]);
    // …and the whole set when the delete matched nothing at all.
    expect(harnessRemnants(censusOf(10, 5))).toEqual([...CENSUS_TABLES]);
  });

  // ORACLE 2 — the safety invariant, and the reason the manual-run artifact decks survive as a
  // property of the tooling rather than of the operator's attention. A future edit that widens
  // the pattern reddens here instead of destroying evidence.
  it("reports any measure whose NON-harness count moved across the delete", () => {
    const before = censusOf(10, 5);
    const lost = { ...censusOf(0, 5), deck: { harness: 0, other: 4 } };

    expect(nonHarnessDrift(before, lost)).toEqual(["deck"]);
  });

  // The positive control for that invariant: a detector firing on everything is indistinguishable
  // from one firing on the right thing, and it would refuse every correct run. Note the harness
  // counts here go 21814 → 0 — a large, correct delete — while `other` holds.
  it("reports no drift when only harness rows moved", () => {
    const before = { ...censusOf(10, 5), deck: { harness: 21814, other: 8 } };
    const after = { ...censusOf(0, 5), deck: { harness: 0, other: 8 } };

    expect(nonHarnessDrift(before, after)).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("reports only when given no arguments", () => {
    expect(parseArgs([])).toEqual({ confirmed: false });
  });

  it("deletes only on an exact `--yes`", () => {
    expect(parseArgs(["--yes"])).toEqual({ confirmed: true });
  });

  // REFUSED IN BOTH DIRECTIONS. A mistyped flag read as "report only" is harmless; one read as
  // "delete" is not — and a parser that ignores what it does not recognise cannot tell a reader
  // which of the two it just did.
  //
  // Note the reach of this guard, measured on npm 11.16.0 and stated at the export: npm eats a
  // bare `--yess` (and a bare `--yes`) before the script sees it, so through `npm run db:clean`
  // this branch is unreachable and the failure is fail-safe. It fires under a direct
  // `node --experimental-strip-types scripts/run-db-cleanup.ts --yess`, which is how the manual
  // check exercises it.
  it("refuses an unrecognised flag rather than silently ignoring it", () => {
    expect(() => parseArgs(["--yess"])).toThrow(/unrecognised argument/);
    expect(() => parseArgs(["--force"])).toThrow(/unrecognised argument/);
    expect(() => parseArgs(["-y"])).toThrow(/unrecognised argument/);
    expect(() => parseArgs(["yes"])).toThrow(/unrecognised argument/);
    // …including when it rides alongside a valid one, so a typo cannot be absorbed by a
    // neighbouring flag that happens to parse.
    expect(() => parseArgs(["--yes", "--force"])).toThrow(/unrecognised argument/);
  });
});
