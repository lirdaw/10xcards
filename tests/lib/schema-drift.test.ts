import { describe, expect, it } from "vitest";
// `@/*` maps to `src/*` only, and the subject here is CI tooling under `scripts/` — see
// test-plan.md §6.1 on why its test still sits in tests/lib/ beside the suite's other
// pure-function files rather than in a tests/scripts/ folder holding one file.
import { compareMigrations, versionOf } from "../../scripts/schema-drift";

// The CI gate's entire decision. It runs before `deploy` and blocks it, so the cost of this
// function being wrong is asymmetric in both directions: a false green ships a Worker
// against an un-migrated database (test-plan Risk #5, and lessons.md's "Cloud migration is
// a separate step from app deploy"), while a false red stops every release.
//
// The remote read itself is NOT covered here and cannot be: it is a live call to the
// Supabase Management API with an account credential, and preflight exists precisely to
// abort a run pointed at anything non-local. The wiring is carried by the recorded live run
// in the change's verification.md and by the CI job. What is covered here is the logic.

/** The repository's real migrations directory, as of this change. */
const REAL_LOCAL = [
  "20260705180246_init_core_schema.sql",
  "20260710195327_manual_card_source.sql",
  "20260712162349_generation_session.sql",
  "20260712162359_deck_keyword_search.sql",
  "20260724195248_srs_study_schedule.sql",
  "20260724220524_srs_study_schedule_review_fixes.sql",
  "20260725112600_search_accepted_only.sql",
  "20260725112700_flashcard_state_no_touch_updated_at.sql",
  "20260725133600_generation_idempotency_key.sql",
  "20260725150000_candidate_counts_rpc.sql",
];

const REAL_REMOTE = REAL_LOCAL.map((filename) => {
  const version = versionOf(filename);
  if (version === null) throw new Error(`fixture is malformed: ${filename}`);
  return version;
});

describe("versionOf", () => {
  it("takes the leading timestamp off a migration filename", () => {
    expect(versionOf("20260705180246_init_core_schema.sql")).toBe("20260705180246");
  });

  // A miss, never a throw: one odd filename must be reportable without aborting the whole
  // comparison, because "the schema drifted" and "the gate broke" call for opposite responses.
  it("misses rather than throws on a name carrying no version", () => {
    expect(versionOf("init_core_schema.sql")).toBeNull();
    expect(versionOf("fixup.sql")).toBeNull();
    expect(versionOf(".gitkeep")).toBeNull();
  });

  // Laxer parsing would accept these and mint a version string that can never match anything
  // the cloud reports — permanent, uncorrectable "drift" from a typo.
  it("misses on a timestamp that is not exactly 14 digits", () => {
    expect(versionOf("2026070518024_short.sql")).toBeNull();
    expect(versionOf("202607051802460_long.sql")).toBeNull();
  });
});

describe("compareMigrations", () => {
  // THE POSITIVE CONTROL, and it is load-bearing rather than decorative: without it every
  // failure assertion below is satisfied by a comparator that simply rejects all input.
  it("reports clean when the two sides agree", () => {
    expect(compareMigrations({ local: REAL_LOCAL, remote: REAL_REMOTE })).toEqual({
      clean: true,
      missingRemote: [],
      missingLocal: [],
      unparseable: [],
    });
  });

  // Drift class 1: the merge deployed the Worker and nobody ran `db push`. This is the
  // current design of this repository's pipeline, and the reason the gate exists.
  it("names a local migration the cloud has not applied, and only that", () => {
    const verdict = compareMigrations({
      local: [...REAL_LOCAL, "20260728090000_add_column.sql"],
      remote: REAL_REMOTE,
    });

    expect(verdict.missingRemote).toEqual(["20260728090000"]);
    expect(verdict.missingLocal).toEqual([]);
    expect(verdict.clean).toBe(false);
  });

  // Drift class 2: a `migration repair` desync, which this project has actually suffered on
  // production. It leaves the schema byte-identical, so a DDL diff sees nothing and only
  // this direction of the comparison catches it.
  it("names a cloud migration with no local file, and only that", () => {
    const verdict = compareMigrations({
      local: REAL_LOCAL,
      remote: [...REAL_REMOTE, "20260601120000"],
    });

    expect(verdict.missingLocal).toEqual(["20260601120000"]);
    expect(verdict.missingRemote).toEqual([]);
    expect(verdict.clean).toBe(false);
  });

  // The two directions are independent facts and must not collapse into one. A comparator
  // that stopped at the first difference would report half of this and read as diagnosed.
  it("reports both directions at once, not whichever it finds first", () => {
    const verdict = compareMigrations({
      local: [...REAL_LOCAL, "20260728090000_local_only.sql"],
      remote: [...REAL_REMOTE, "20260601120000"],
    });

    expect(verdict.missingRemote).toEqual(["20260728090000"]);
    expect(verdict.missingLocal).toEqual(["20260601120000"]);
    expect(verdict.clean).toBe(false);
  });

  // Not a hypothetical: `20260712162349_generation_session` reached main about 1.5 h AFTER
  // the later-numbered `20260712162359_deck_keyword_search`, and the cloud applied them in
  // that order. An order-based comparator would call this repository drifted today, on a
  // perfectly healthy database. Remote is deliberately passed unsorted here.
  it("treats the repository's real out-of-order pair as clean", () => {
    const verdict = compareMigrations({
      local: ["20260712162349_generation_session.sql", "20260712162359_deck_keyword_search.sql"],
      remote: ["20260712162359", "20260712162349"],
    });

    expect(verdict).toEqual({ clean: true, missingRemote: [], missingLocal: [], unparseable: [] });
  });

  // A fresh project, or — far more likely in CI — the right token pointed at the wrong ref.
  // Either way every local migration is unapplied, which is the correct reading and must
  // never be mistaken for "nothing to compare, therefore fine".
  it("puts every local version in missingRemote when the cloud reports nothing", () => {
    const verdict = compareMigrations({ local: REAL_LOCAL, remote: [] });

    expect(verdict.missingRemote).toEqual([...REAL_REMOTE].sort());
    expect(verdict.missingLocal).toEqual([]);
    expect(verdict.clean).toBe(false);
  });

  // Surfaced, never dropped. A `.sql` file the gate cannot account for is exactly the kind
  // of thing that would otherwise be averaged away into a green run.
  it("surfaces a .sql file whose name carries no version", () => {
    const verdict = compareMigrations({
      local: [...REAL_LOCAL, "hotfix_by_hand.sql"],
      remote: REAL_REMOTE,
    });

    expect(verdict.unparseable).toEqual(["hotfix_by_hand.sql"]);
    expect(verdict.clean).toBe(false);
    // It is a malformed name, not a missing migration — reporting it as drift would send the
    // reader to `db push` for a problem `db push` cannot fix.
    expect(verdict.missingRemote).toEqual([]);
    expect(verdict.missingLocal).toEqual([]);
  });

  // The counterpart to the case above: a directory holds more than migrations, and a
  // `.gitkeep` is not a broken migration. Only a file claiming to be SQL earns a report.
  it("ignores entries that are not .sql at all", () => {
    const verdict = compareMigrations({
      local: [...REAL_LOCAL, ".gitkeep", "README.md", "notes.txt"],
      remote: REAL_REMOTE,
    });

    expect(verdict).toEqual({ clean: true, missingRemote: [], missingLocal: [], unparseable: [] });
  });
});
