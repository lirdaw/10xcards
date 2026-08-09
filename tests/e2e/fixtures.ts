// The created-row registry: where a spec DECLARES what it is about to create, so that removing it
// is the run's job rather than the test body's.
//
// WHY THIS EXISTS AT ALL. `seed.spec.ts` used to delete its own deck on its last line, and that
// pattern has already failed in practice — `E2E deck 1785947414992` has sat orphaned since
// 2026-08-05 because a failure earlier in the spec skipped the cleanup permanently. Inline cleanup
// is cleanup that only runs when nothing went wrong, which is the case it is least needed in.
//
// TWO MECHANICS, BOTH FORCED BY WORKERS BEING SEPARATE PROCESSES:
//
//   1. REGISTER THE NAME BEFORE THE ROW EXISTS, never after. The name is minted first
//      (`E2E deck ${Date.now()}`), so registering it costs nothing and closes the window that
//      produced the orphan above: a spec dying between the create and the record would orphan the
//      row exactly as before. Registering after creation reproduces the bug one layer up.
//   2. ONE FILE PER WORKER, on disk, under `outputDir`. A worker-scoped fixture cannot hand
//      anything to the teardown PROJECT in memory, and a single shared file would take concurrent
//      appends from every worker. `outputDir` is safe by Playwright's own ordering:
//      `removeOutputDirs` runs FIRST, before any worker starts (runner/index.js:6003-6010), so the
//      directory is empty at the start of a run and nothing wipes it mid-run — the teardown reads
//      only what THIS run registered.
//
// THE RESIDUAL RISK, named rather than papered over: a worker killed between the registration call
// and its flush still loses that entry. That is strictly narrower than the pattern it replaces —
// which lost the row on ANY failure, not only a hard kill — but it is not zero, and it belongs in
// test-plan.md §6.6's does-NOT-prove list.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test as base } from "@playwright/test";

/** Sits inside `outputDir`, so the run's own start wipes it. Read by the teardown project. */
export function registryDir(outputDir: string): string {
  return join(outputDir, ".e2e-registry");
}

/**
 * One JSON object per line. Two kinds, because the teardown has to reach TWO tables and only one
 * of them hangs off the deck:
 *
 * - `deck` — a deck NAME. `flashcard` cascades from `deck` (`init_core_schema.sql:60`) and
 *   `flashcard_schedule` cascades from `flashcard` (`srs_study_schedule.sql:36`), so deleting the
 *   deck takes the cards and their schedules with it.
 * - `generation` — a short leading marker inside `source_text`. `generation_session` has NO deck
 *   foreign key at all — it references `auth.users` only (`generation_session.sql:24`) and
 *   `flashcard.generation_id` is `on delete set null` (`:47`) — so a deck-scoped teardown leaves
 *   one session row behind per generation, permanently, on a stable account. A SHORT marker
 *   because a PostgREST filter carrying a long value answers 414 before the query runs
 *   (test-plan.md §6.6's C10X-28 trap) and a journey's source text is deliberately long.
 */
export type RegistryEntry = { kind: "deck"; name: string } | { kind: "generation"; marker: string };

export interface E2eRegistry {
  /** Call BEFORE creating the deck. See mechanic 1 above. */
  deck: (name: string) => void;
  /** Call BEFORE generating. The marker must be the LEADING characters of `source_text`. */
  generation: (marker: string) => void;
}

/**
 * The project's `test`. A spec that creates rows imports from here instead of from
 * `@playwright/test`, and declares `registry` among its fixtures.
 */
export const test = base.extend<object, { registry: E2eRegistry }>({
  registry: [
    // The empty `{}` is REQUIRED, not a style choice: Playwright discovers a fixture's
    // dependencies by PARSING this parameter's destructuring pattern and rejects anything else
    // outright — "First argument must use the object destructuring pattern"
    // (playwright/lib/common/index.js:1761). Do not "tidy" it into `_unused`.
    async ({}, use, workerInfo) => {
      const file = join(registryDir(workerInfo.project.outputDir), `worker-${workerInfo.workerIndex}.jsonl`);
      // workerIndex, not parallelIndex: a worker restarted after a crash takes a fresh index, so
      // two processes can never append to one file.
      mkdirSync(dirname(file), { recursive: true });

      // Synchronous and unbuffered on purpose — an entry that is queued rather than written is an
      // entry a crash loses, which is the whole failure this registry exists to narrow.
      const append = (entry: RegistryEntry): void => {
        appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
      };

      await use({
        deck: (name) => {
          append({ kind: "deck", name });
        },
        generation: (marker) => {
          append({ kind: "generation", marker });
        },
      });
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
