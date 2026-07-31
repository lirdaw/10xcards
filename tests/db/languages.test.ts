import { describe, expect, it } from "vitest";
import { getActiveLanguage, listActiveLanguages } from "@/lib/languages";
import { accountA } from "../fixtures/accounts";
import { clientFor } from "../fixtures/session";
import { PROMPT_LANGUAGE_NAMES } from "../fixtures/language-names";

// The `language` dictionary table: the set of languages the app offers, as DATA rather
// than as a constant in code.
//
// Two claims live here and they are separate. The SEED claim — every active row carries
// the model-facing name the prompt layer will interpolate — is what closes the gap
// described in tests/fixtures/language-names.ts: the eval proves the behaviour against
// its own literal and can never see this table, so nothing but this file connects the
// string the model is shown to the string the database holds. The READ-ONLY claim is that
// a signed-in user can read the table and cannot write it — held by TWO independent
// enforcers, revoked write privileges AND the absence of any write policy, which is why
// the breakage check for it is a PAIR (see the write case below, and the migration's own
// note). That is a deliberate step past the `flashcard_state` precedent, and it is what
// keeps the table read-only until an admin surface exists to own it.
//
// Every case here is READ-ONLY against the seeded rows — nothing mutates a seeded row and
// nothing flips `is_active`. That is what makes the file safe under the shuffled runner
// without owning a fixture (test-plan §6.2): there is no shared state for a sibling to
// move underneath another case's assertion.

const a = accountA();

/** The Polish display strings. UI copy, so deliberately NOT in the shared model-facing fixture. */
const UI_LABELS: Record<string, string> = {
  pl: "Polski",
  en: "Angielski",
  es: "Hiszpański",
  de: "Niemiecki",
  fr: "Francuski",
};

/** The prepared-but-unshipped language. Seeded inactive; every surface must ignore it. */
const INACTIVE_CODE = "it";

describe("the language dictionary table", () => {
  it("seeds every active language with the model-facing name the prompt layer consumes", async () => {
    const { data, error } = await clientFor(a.cookieHeader)
      .from("language")
      .select("code, ui_label, prompt_name, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order");

    expect(error).toBeNull();
    // Guard, not the assertion: an empty read would satisfy every per-row loop below
    // vacuously, and an unreadable table is the same shape as an unseeded one.
    expect(data?.length).toBeGreaterThan(0);

    for (const row of data ?? []) {
      // Asserted PER ROW against the fixture, not as set equality against exactly five.
      // Shipping a sixth language is then a one-line fixture edit plus a seed row, not a
      // red assertion in a file that has nothing to do with the new language.
      expect(PROMPT_LANGUAGE_NAMES[row.code], `no model-facing name for active code "${row.code}"`).toBeDefined();
      expect(row.prompt_name).toBe(PROMPT_LANGUAGE_NAMES[row.code]);
      expect(row.ui_label).toBe(UI_LABELS[row.code]);
    }

    // Ordering is a property of the seed's sort_order, so assert the sequence the UI will
    // render rather than only the membership.
    expect(data?.map((row) => row.code)).toEqual(["pl", "en", "es", "de", "fr"]);
  });

  it("refuses an authenticated write and leaves the table byte-identical", async () => {
    const supabase = clientFor(a.cookieHeader);
    const before = await supabase
      .from("language")
      .select("code, ui_label, prompt_name, sort_order, is_active")
      .order("code");
    expect(before.error).toBeNull();

    // TWO independent enforcers refuse these three, and knowing which is which is what
    // makes this case falsifiable. The migration revokes write privileges from
    // `authenticated` (needed because Supabase's default privileges `grant all` on every
    // new table in `public` — so the `grant select` line beside it narrows nothing on its
    // own), and the table carries no write policy at all.
    //
    // So the deliberate-breakage check for this case is a PAIR, per test-plan §6.10:
    // adding a write policy alone leaves the suite GREEN, because the missing grant
    // absorbs the write. Measured — policy + restored grant is what turns this case red.
    // One run cannot tell "the grant caught it" from "the policy caught it".
    //
    // The row oracle below is the assertion, not a supplement: an error alone would not
    // prove nothing landed, and under RLS a refused UPDATE/DELETE is a silent 0-row no-op
    // rather than an error.
    await supabase.from("language").insert({ code: "zz", ui_label: "Zzz", prompt_name: "Zzz", sort_order: 99 });
    await supabase.from("language").update({ prompt_name: "Klingon" }).eq("code", "de");
    await supabase.from("language").delete().eq("code", "fr");

    const after = await supabase
      .from("language")
      .select("code, ui_label, prompt_name, sort_order, is_active")
      .order("code");
    expect(after.error).toBeNull();
    expect(after.data).toEqual(before.data);
    // Positive control for the re-read itself: a client that suddenly saw nothing would
    // satisfy `toEqual` above with two empty arrays.
    expect(after.data?.some((row) => row.code === "de")).toBe(true);
    expect(after.data?.some((row) => row.code === INACTIVE_CODE)).toBe(true);
  });
});

describe("the language data-access module", () => {
  it("offers only the active languages, in sort_order, and withholds the inactive one", async () => {
    const supabase = clientFor(a.cookieHeader);

    const { data, error } = await listActiveLanguages(supabase);
    expect(error).toBeNull();
    expect(data?.map((row) => row.code)).toEqual(["pl", "en", "es", "de", "fr"]);

    // Positive control for the line above, inline as test-plan §6.2 requires. Without it
    // "omits `it`" is satisfied by a query that returns nothing at all — and the same
    // read is what proves the row exists to be withheld, since no client this harness can
    // build is permitted to create one.
    const unfiltered = await supabase.from("language").select("code");
    expect(unfiltered.error).toBeNull();
    expect(unfiltered.data?.map((row) => row.code)).toContain(INACTIVE_CODE);

    // The UI is a human surface: it must never receive the model-facing name.
    expect(Object.keys(data?.[0] ?? {})).toEqual(["code", "ui_label"]);
  });

  it("resolves an active code to its model-facing name and reads anything else as absent", async () => {
    const supabase = clientFor(a.cookieHeader);

    const hit = await getActiveLanguage(supabase, "de");
    expect(hit.error).toBeNull();
    expect(hit.data?.prompt_name).toBe(PROMPT_LANGUAGE_NAMES.de);

    // Absence, not a raised denial — §6.4's below-HTTP form of "404, never 403". Both an
    // unknown code and a deactivated one resolve the same way, which is what lets the
    // endpoint map a single `null` to one refusal and keep a query error as a separate
    // branch. Asserting `error` is null here is the load-bearing half: were absence
    // reported as an error, the endpoint could not tell a bad request from an outage.
    for (const code of ["xx", INACTIVE_CODE]) {
      const miss = await getActiveLanguage(supabase, code);
      expect(miss.error).toBeNull();
      expect(miss.data).toBeNull();
    }
  });
});
