// The whole "is production migrated?" decision, as a pure function over two lists of
// version strings. No filesystem, no network, no console — all of that lives in the runner
// beside this file (./check-schema-drift.ts), which is what makes this half testable with
// ordinary fixtures.
//
// Why a *history* oracle and not a schema diff: the one drift this project actually lived
// through was a `supabase migration repair` that desynced the history while leaving the
// schema byte-identical (lessons.md, "Operacje migracji Supabase"). A DDL diff cannot see
// that. The two oracles are complementary, which is why the DDL one ships separately and
// off the deploy path.
//
// Why both files sit in `scripts/` rather than `src/`: the runner prints, and
// tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. Keeping the
// comparator next to it makes their import a sibling instead of the deep relative
// `../src/lib/…` path AGENTS.md's first Hard Rule forbids (the `@/*` alias does not resolve
// under Node's type stripping).

/**
 * Supabase migration filenames are `<14-digit timestamp>_<name>.sql`, and the versions the
 * cloud reports back in `supabase_migrations.schema_migrations` are exactly that timestamp.
 *
 * The digit count is pinned deliberately. The CLI's own parser is laxer, so a file with a
 * 13- or 15-digit prefix would be pushed by `db push` while producing a version string that
 * can never match anything remote — i.e. it would read here as permanent, unfixable drift.
 * Rejecting it instead surfaces it as a malformed name, which is the honest report and the
 * fail-closed direction.
 */
const MIGRATION_FILENAME = /^(\d{14})_.+\.sql$/;

/**
 * A migration filename to its version, or `null` when the name does not match.
 *
 * A miss rather than a throw, because a malformed filename is a case the gate must be able
 * to *report* — a throw here would abort the comparison and turn one odd file into a total
 * gate outage, which are two very different facts (see the runner's DRIFT vs GATE
 * UNAVAILABLE split).
 */
export function versionOf(filename: string): string | null {
  return MIGRATION_FILENAME.exec(filename)?.[1] ?? null;
}

export interface DriftVerdict {
  /** True only when there is nothing whatsoever to report — see the note below. */
  clean: boolean;
  /** Local versions the cloud has not applied. Drift class 1 (never pushed) and 3 (out-of-order skipped). */
  missingRemote: string[];
  /** Cloud versions with no local file. Drift class 2 — the `migration repair` desync. */
  missingLocal: string[];
  /** Local `.sql` entries whose name carries no usable version. Never silently dropped. */
  unparseable: string[];
}

export interface MigrationLists {
  /** The migrations directory's entries, as filenames. Non-`.sql` entries are ignored. */
  local: string[];
  /** Versions applied in the cloud, as reported by the Management API. */
  remote: string[];
}

/**
 * Compare the repository's migrations against the cloud's applied history.
 *
 * **Set-based, never order-based**, and that is load-bearing rather than a stylistic
 * preference: this repository already contains an out-of-order pair —
 * `20260712162349_generation_session` reached `main` about 1.5 h *after* the
 * later-numbered `20260712162359_deck_keyword_search`, and the cloud applied them in that
 * same order. A comparator that assumed a monotonically increasing history would call this
 * project drifted today, on its very first run, with nothing wrong.
 *
 * `clean` covers all three lists, not just the two set differences. A migrations directory
 * holding a file this gate cannot account for is not something to pass over quietly — the
 * gate exists to fail closed, and "I could not read one of the filenames" must reach a
 * human rather than being averaged away into a green run.
 *
 * Versions only, never file contents: a migration amended in place after it was pushed
 * leaves both lists identical and is invisible here by construction. That blind spot is
 * stated rather than papered over, and it is what the separate on-demand DDL diff covers.
 */
export function compareMigrations({ local, remote }: MigrationLists): DriftVerdict {
  const localVersions = new Set<string>();
  const unparseable: string[] = [];

  for (const filename of local) {
    // A directory holds more than migrations — `.gitkeep`, editor droppings, a stray README.
    // Those are not migrations and must not be reported as malformed ones; only a file that
    // claims to be SQL and then carries no version is a finding.
    if (!filename.endsWith(".sql")) continue;

    const version = versionOf(filename);
    if (version === null) {
      unparseable.push(filename);
      continue;
    }
    localVersions.add(version);
  }

  const remoteVersions = new Set(remote);

  const missingRemote = [...localVersions].filter((version) => !remoteVersions.has(version)).sort();
  const missingLocal = [...remoteVersions].filter((version) => !localVersions.has(version)).sort();

  return {
    clean: missingRemote.length === 0 && missingLocal.length === 0 && unparseable.length === 0,
    missingRemote,
    missingLocal,
    unparseable: [...unparseable].sort(),
  };
}
