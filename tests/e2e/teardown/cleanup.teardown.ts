import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test as teardown } from "@playwright/test";
import { registryDir, type RegistryEntry } from "../fixtures.ts";
import { resolveE2eEnv } from "../setup/env.ts";
import { signInE2eAccount } from "../setup/account.ts";
import type { Database } from "@/db/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Removes the rows this run created — including when a spec died before its last line, which is
// the exact mode that orphaned `E2E deck 1785947414992` on 2026-08-05.
//
// A PROJECT, not an `afterEach`. Wired as the `chromium` project's `teardown`, so Playwright runs
// it after that project finishes whatever its outcome. `afterAll` inside a spec still lives inside
// the spec's own process and its own failure surface; a teardown project is a separate phase that
// reads what every worker registered.
//
// RLS-AWARE, and that is a data-safety property rather than a stylistic one. It acts as the SAME
// account that owns the rows, holding the anon key — never a service/secret key, which
// `assertAnonKey` refuses at config time. RLS is the only lock in this app, so a BYPASSRLS
// credential here would let a typo'd predicate delete rows belonging to somebody else.
//
// TWO TABLES, and the second is the one a deck-scoped teardown structurally cannot reach:
// `generation_session` has no deck foreign key at all (`generation_session.sql:24` references
// `auth.users` only, and `flashcard.generation_id` is `on delete set null` at `:47`). Deleting the
// deck therefore takes its cards and their schedules — both cascade — and leaves the session row
// behind forever, on a stable account, which is unbounded growth on exactly the axis this phase
// exists to stop. The owner already has a DELETE policy (`generation_session.sql:73-74`), so this
// needs no migration and no privilege change.
//
// SCOPE IS ALWAYS THIS RUN'S OWN REGISTRY, never a broad `E2E %` predicate. The account is shared
// across runs by decision (change.md D-01), and the dev database holds 5459 decks against
// `max_rows = 1000` — the condition test-plan.md §6.6 records as having already turned an
// assertion unfalsifiable while it stayed green. This teardown stops the growth from here; it
// deliberately does NOT repay the existing debt (plan, "What We're NOT Doing").

// The removal itself lives OUTSIDE the test body — deliberately, and for a reason worth keeping.
// `playwright/no-conditional-in-test` is right that a branch inside a test makes it unclear which
// path the assertion actually exercised, and a teardown is nothing but branches. Extracting them
// leaves the test itself as the only thing that should be there: an outcome, and the post-condition
// it has to satisfy.
teardown("removes every row this run registered", async () => {
  // EVERY project's registry directory, not just this one's. The writer resolves the path from
  // the CHROMIUM project's `outputDir` (`fixtures.ts:70`) and this teardown is a DIFFERENT project;
  // they agree today only because no project sets `outputDir`, so all three inherit the config
  // default. Giving `chromium` its own — an ordinary way to separate artifacts — would silently
  // point the writer somewhere this reader never looks, and the failure would be invisible: an
  // empty registry short-circuits below and the residue is then computed from that same empty
  // list, so `{decks:0, sessions:0}` would be VACUOUSLY true and the run would report a clean
  // teardown having deleted nothing. Reading every project's directory removes the coupling
  // instead of documenting it. `FullProject.outputDir` is public API.
  const dirs = teardown.info().config.projects.map((project) => registryDir(project.outputDir));
  const outcome = await removeRegisteredRows(unique(dirs));

  // The POST-CONDITION is the assertion, not the absence of an error. A delete that silently
  // matched nothing — wrong predicate, wrong account — reports no error at all, and this layer's
  // whole reason for existing is that a green run must not be compatible with rows left behind.
  // Residue rather than "rows deleted > 0", because a registered row legitimately may not exist:
  // registration happens BEFORE creation on purpose, so a spec that died in between registered a
  // name nothing ever wrote.
  //
  // What it still does NOT cover, stated rather than implied: a run that registered nothing at all
  // is indistinguishable from a run that cleaned up perfectly. That is correct for journey B, which
  // is entirely read-only, and it is why the directory scan above matters — it is what stops "the
  // registry was somewhere else" from arriving disguised as "there was nothing to do".
  expect(outcome.failures).toEqual([]);
  expect({ decks: outcome.deckResidue, sessions: outcome.sessionResidue }).toEqual({ decks: 0, sessions: 0 });
});

interface CleanupOutcome {
  failures: string[];
  deckResidue: number;
  sessionResidue: number;
}

async function removeRegisteredRows(dirs: string[]): Promise<CleanupOutcome> {
  // Declared before the read: `readRegistry` records a torn line here rather than throwing, so a
  // partial registry costs only the entries it actually lost.
  const failures: string[] = [];
  let deckResidue = 0;
  let sessionResidue = 0;

  const entries = dirs.flatMap((dir) => readRegistry(dir, failures));
  const deckNames = unique(entries.flatMap((entry) => (entry.kind === "deck" ? [entry.name] : [])));
  const markers = unique(entries.flatMap((entry) => (entry.kind === "generation" ? [entry.marker] : [])));

  // Idempotent, and silent when there is nothing to do: a run that registered nothing (journey B
  // is entirely read-only) must not fail, and must not spend a sign-in either. A torn line already
  // on `failures` still surfaces, because the caller asserts that list rather than this return.
  if (deckNames.length === 0 && markers.length === 0) return { failures, deckResidue, sessionResidue };

  const env = resolveE2eEnv();
  const supabase = await signInE2eAccount(env.SUPABASE_URL, env.SUPABASE_KEY);

  if (deckNames.length > 0) {
    const { error } = await supabase.from("deck").delete().in("name", deckNames);
    if (error) failures.push(`deck delete: ${error.message}`);
    deckResidue = tally(await countDecks(supabase, deckNames), "deck count", failures);
  }

  for (const marker of markers) {
    // `like` on a SHORT leading marker, never on the whole `source_text`: PostgREST carries its
    // filters in the query string and Kong caps the request line at ~8 KB, so a long value answers
    // 414 before the query runs (test-plan.md §6.6's C10X-28 trap).
    const { error } = await supabase.from("generation_session").delete().like("source_text", `${marker}%`);
    if (error) failures.push(`generation_session delete (${marker}): ${error.message}`);
    sessionResidue += tally(await countSessions(supabase, marker), `generation_session count (${marker})`, failures);
  }

  return { failures, deckResidue, sessionResidue };
}

/**
 * Turns a count round-trip into a residue, and a FAILED round-trip into a recorded failure.
 *
 * Never `count ?? 0`. PostgREST reports a failed count as `count: null`, which that spelling would
 * launder into "zero rows left" — and the residue assertion is this layer's ENTIRE cleanup
 * guarantee, so a transport blip would turn rows-left-behind into a green teardown. Not
 * hypothetical here: C10X-39 measured a Kong keep-alive `502` on this very stack, and the wrapper
 * that absorbs it (`tests/setup/retry-transport.ts`) is a Vitest `setupFiles` entry — this layer
 * runs under Playwright and does not load it. Same shape as §6.6's `listDueCounts` false pass: a
 * denial asserted as absence decays into a pass when the set is empty for an unrelated reason.
 *
 * The failure goes onto the list `:51` already asserts empty, so an unreadable count is loud
 * rather than reassuring; the sentinel keeps the residue non-zero if that assertion is ever
 * loosened.
 */
function tally(
  { count, error }: { count: number | null; error: { message: string } | null },
  label: string,
  failures: string[],
): number {
  if (error) {
    failures.push(`${label}: ${error.message}`);
    return -1;
  }
  if (count === null) {
    failures.push(`${label}: returned no count, so residue is unknown rather than zero`);
    return -1;
  }
  return count;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Every worker's JSONL file, unioned. A missing directory means nothing was registered.
 *
 * PARSED PER LINE, AND A BAD LINE MUST NOT COST THE GOOD ONES. `appendFileSync` is not atomic
 * against a hard kill, so a worker killed mid-append can leave a torn final line — precisely the
 * residual risk `fixtures.ts:22-25` names and `verification.md`'s 5.8 reached by abrupt
 * termination. A single `JSON.parse` over the whole file would throw there and abandon the run's
 * ENTIRE cleanup, turning the one entry that mechanism was built to lose into every row the run
 * created: an emergency mechanism with a mode that amplifies the emergency it mitigates.
 *
 * So a torn line is skipped and RECORDED — it lands on `failures`, which `:51` asserts empty, so
 * it stays loud — while every well-formed entry above it is still deleted.
 */
function readRegistry(dir: string, failures: string[]): RegistryEntry[] {
  if (!existsSync(dir)) return [];

  // `withFileTypes` so a subdirectory under the registry dir is skipped rather than answering
  // EISDIR from `readFileSync` — the same "abandon everything" outcome by a different route.
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .flatMap((entry) =>
      readFileSync(join(dir, entry.name), "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as RegistryEntry];
          } catch {
            failures.push(
              `${entry.name}: unparseable registry line, rows it named are NOT removed: ${line.slice(0, 120)}`,
            );
            return [];
          }
        }),
    );
}

/** Both counters hand the WHOLE response to `tally` — discarding `error` here is the defect. */
interface CountResult {
  count: number | null;
  error: { message: string } | null;
}

async function countDecks(supabase: SupabaseClient<Database>, names: string[]): Promise<CountResult> {
  return await supabase.from("deck").select("name", { count: "exact", head: true }).in("name", names);
}

async function countSessions(supabase: SupabaseClient<Database>, marker: string): Promise<CountResult> {
  return await supabase
    .from("generation_session")
    .select("id", { count: "exact", head: true })
    .like("source_text", `${marker}%`);
}
