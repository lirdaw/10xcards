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
  const outcome = await removeRegisteredRows(registryDir(teardown.info().project.outputDir));

  // The POST-CONDITION is the assertion, not the absence of an error. A delete that silently
  // matched nothing — wrong predicate, wrong account, a registry read from the wrong directory —
  // reports no error at all, and this layer's whole reason for existing is that a green run must
  // not be compatible with rows left behind. Residue rather than "rows deleted > 0", because a
  // registered row legitimately may not exist: registration happens BEFORE creation on purpose,
  // so a spec that died in between registered a name nothing ever wrote.
  expect(outcome.failures).toEqual([]);
  expect({ decks: outcome.deckResidue, sessions: outcome.sessionResidue }).toEqual({ decks: 0, sessions: 0 });
});

interface CleanupOutcome {
  failures: string[];
  deckResidue: number;
  sessionResidue: number;
}

async function removeRegisteredRows(dir: string): Promise<CleanupOutcome> {
  const entries = readRegistry(dir);
  const deckNames = unique(entries.flatMap((entry) => (entry.kind === "deck" ? [entry.name] : [])));
  const markers = unique(entries.flatMap((entry) => (entry.kind === "generation" ? [entry.marker] : [])));

  const failures: string[] = [];
  let deckResidue = 0;
  let sessionResidue = 0;

  // Idempotent, and silent when there is nothing to do: a run that registered nothing (journey B
  // is entirely read-only) must not fail, and must not spend a sign-in either.
  if (deckNames.length === 0 && markers.length === 0) return { failures, deckResidue, sessionResidue };

  const env = resolveE2eEnv();
  const supabase = await signInE2eAccount(env.SUPABASE_URL, env.SUPABASE_KEY);

  if (deckNames.length > 0) {
    const { error } = await supabase.from("deck").delete().in("name", deckNames);
    if (error) failures.push(`deck delete: ${error.message}`);
    deckResidue = await countDecks(supabase, deckNames);
  }

  for (const marker of markers) {
    // `like` on a SHORT leading marker, never on the whole `source_text`: PostgREST carries its
    // filters in the query string and Kong caps the request line at ~8 KB, so a long value answers
    // 414 before the query runs (test-plan.md §6.6's C10X-28 trap).
    const { error } = await supabase.from("generation_session").delete().like("source_text", `${marker}%`);
    if (error) failures.push(`generation_session delete (${marker}): ${error.message}`);
    sessionResidue += await countSessions(supabase, marker);
  }

  return { failures, deckResidue, sessionResidue };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Every worker's JSONL file, unioned. A missing directory means nothing was registered. */
function readRegistry(dir: string): RegistryEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((file) =>
    readFileSync(join(dir, file), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as RegistryEntry),
  );
}

async function countDecks(supabase: SupabaseClient<Database>, names: string[]): Promise<number> {
  const { count } = await supabase.from("deck").select("name", { count: "exact", head: true }).in("name", names);
  return count ?? 0;
}

async function countSessions(supabase: SupabaseClient<Database>, marker: string): Promise<number> {
  const { count } = await supabase
    .from("generation_session")
    .select("id", { count: "exact", head: true })
    .like("source_text", `${marker}%`);
  return count ?? 0;
}
