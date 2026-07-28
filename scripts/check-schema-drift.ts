/* eslint-disable no-console -- this file IS the report: it is the CI gate's only output
   surface. It deliberately lives in `scripts/`, never `src/`, because
   tests/lib/no-logging.test.ts fails the build on any `console.*` under `src/`. */

// The I/O half of the schema-drift gate. Everything decidable is next door in
// ./schema-drift.ts as a pure function with fixtures; this file reads the migrations
// directory, reads the cloud, prints, and owns the exit code.
//
// Zero runtime dependencies — `node:fs` and global `fetch` only. That is a property worth
// preserving rather than an accident: it is what lets the `drift` job in
// .github/workflows/ci.yml skip `npm ci` entirely and stay at roughly ten seconds on the
// path between merge and deploy.
//
// **Fail closed.** Every non-success path exits 1, including the ones that are not drift at
// all. A gate that goes green on its own malfunction is the unfalsifiable-assertion failure
// test-plan.md §6.6 records twice. The single exception is one retry on `429`, because the
// endpoint defines that status and a rate limit is not evidence about the schema.
//
// **But one exit code covers two different facts, and the report must say which**, because
// they call for opposite responses: DRIFT is fixed by `supabase db push`, GATE UNAVAILABLE
// by waiting out an incident or rotating a credential. The distinction is in what is
// printed, never in the exit code — nothing about the fail-closed contract is weakened by it.

import { readdirSync } from "node:fs";
import { compareMigrations } from "./schema-drift.ts";
import type { DriftVerdict } from "./schema-drift.ts";

/**
 * The endpoint Phase 1 selected by probing all three candidates against the real project.
 *
 * The Management API documents `/database/migrations` as available only to selected partner
 * OAuth apps, and the plan expected a `403` for a plain personal access token. It answers
 * **200**. That is a documented restriction which happens not to be enforced — a weaker
 * guarantee than a contract — so if this ever starts refusing, the recorded fallbacks are
 * `POST /v1/projects/{ref}/database/query` (stable, `{"query": …, "read_only": true}`) and
 * `POST …/database/query/read-only` (`[Beta]`), both of which answer **201**. See
 * context/changes/schema-drift-test/verification.md, Phase 1.
 */
const MANAGEMENT_API_ORIGIN = "https://api.supabase.com";

/**
 * Resolved from this file's own location, not from `process.cwd()`, so the gate reports on
 * the checkout it ships with no matter where it is invoked from.
 */
const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);

/** One retry on `429`, then it fails like anything else. */
const RATE_LIMIT_RETRY_MS = 5_000;

/**
 * Stated by this repository rather than inherited from a runtime default.
 *
 * Without a signal the only bound is undici's `headersTimeout`/`bodyTimeout` (300 s each), so
 * a hung API would sit on the merge→deploy path for ~5 minutes — or ~10 with the retry — in a
 * job whose whole design premise is that it costs about ten seconds. The failure direction was
 * never wrong (an abort lands in `request`'s catch and becomes GATE UNAVAILABLE, exit 1); what
 * was wrong is that the number belonged to a dependency.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The cloud's own version strings, held to the same shape the local side is held to.
 *
 * The local half is deliberately strict (`MIGRATION_FILENAME` in ./schema-drift.ts) while this
 * half used to accept any string at all — an asymmetry with a nasty report: a version carrying
 * a trailing space or a BOM appears in `missingRemote` AND `missingLocal` as two visually
 * identical 14-digit strings, sending the reader to `db push` and to the `migration repair`
 * runbook at once, and an empty string prints as a blank bullet.
 */
const REMOTE_VERSION = /^\d{14}$/;

/**
 * The comparison never ran. Distinct from a drift verdict on purpose: both block the
 * deploy, but only one of them is a statement about the database.
 */
class GateUnavailable extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLocalFilenames(): string[] {
  try {
    // `withFileTypes`, so a DIRECTORY named `<14 digits>_x.sql` cannot be counted as a
    // migration and a subdirectory cannot inflate the entry count printed below.
    return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch (err) {
    // An unreadable migrations directory is not "no migrations to check" — that reading
    // would turn a broken checkout into a green gate.
    throw new GateUnavailable(`the migrations directory could not be read (${String(err)})`);
  }
}

async function request(ref: string, token: string): Promise<Response> {
  const url = `${MANAGEMENT_API_ORIGIN}/v1/projects/${encodeURIComponent(ref)}/database/migrations`;
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new GateUnavailable(`the Management API could not be reached (${String(err)})`);
  }
}

/**
 * Pull the applied versions out of the endpoint's body, refusing anything that is not
 * recognisably the documented shape.
 *
 * Silently tolerating a row without a `version` would drop a migration from the remote set
 * and report it as drift — a false red pointing at `db push`, for a parsing bug.
 */
function versionsFrom(body: unknown): string[] {
  if (!Array.isArray(body)) {
    throw new GateUnavailable("the Management API body was not a JSON array of migrations");
  }

  return body.map((row: unknown, index) => {
    if (typeof row !== "object" || row === null || !("version" in row) || typeof row.version !== "string") {
      throw new GateUnavailable(`migration entry ${index + 1} of ${body.length} carries no string \`version\``);
    }

    // Trimmed and shape-checked, so whitespace or a BOM cannot turn one migration into a
    // matched pair of near-identical entries on opposite sides of the report.
    const version = row.version.trim();
    if (!REMOTE_VERSION.test(version)) {
      throw new GateUnavailable(
        `migration entry ${index + 1} of ${body.length} reported ${JSON.stringify(version.slice(0, 40))}, ` +
          `which is not a 14-digit timestamp`,
      );
    }
    return version;
  });
}

async function fetchRemoteVersions(ref: string, token: string): Promise<string[]> {
  let response = await request(ref, token);

  if (response.status === 429) {
    console.error(`schema-drift: rate-limited (429), retrying once in ${RATE_LIMIT_RETRY_MS / 1000}s`);
    await sleep(RATE_LIMIT_RETRY_MS);
    response = await request(ref, token);
  }

  // `res.ok`, deliberately never `status === 200`: the two documented fallback endpoints
  // answer **201**, so an equality check would fail closed on a perfectly good response the
  // day this project fell back to either of them (verification.md, Phase 1).
  if (!response.ok) {
    throw new GateUnavailable(`the Management API answered ${response.status} ${response.statusText}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GateUnavailable("the Management API answered with a body that is not JSON");
  }

  const versions = versionsFrom(body);
  if (versions.length === 0) {
    // Far more likely than a genuinely empty project: a valid token pointed at the wrong
    // ref. Reporting every local migration as unapplied would be a plausible-looking red
    // that sends the reader to `db push` against the wrong database.
    throw new GateUnavailable("the cloud reported zero applied migrations — check SUPABASE_PROJECT_ID");
  }
  return versions;
}

function bullets(versions: string[]): string {
  return versions.map((version) => `    ${version}`).join("\n");
}

function reportDrift(verdict: DriftVerdict): void {
  console.error("");
  console.error("DRIFT — the repository's migration history and the cloud database disagree.");

  if (verdict.missingRemote.length > 0) {
    console.error("");
    console.error(`  Committed here, never applied in the cloud (${verdict.missingRemote.length}):`);
    console.error(bullets(verdict.missingRemote));
    console.error("  Fix: `supabase db push` (PROD tier — run it yourself, from this branch's");
    console.error("  worktree), then `gh run rerun --failed` to re-run this gate and the deploy.");
  }

  if (verdict.missingLocal.length > 0) {
    console.error("");
    console.error(`  Applied in the cloud, with no file here (${verdict.missingLocal.length}):`);
    console.error(bullets(verdict.missingLocal));
    console.error("  This is the `migration repair` desync direction — the schema may well be");
    console.error("  correct while the history is wrong. Do NOT blindly run what the CLI suggests;");
    console.error("  see lessons.md, “Operacje migracji Supabase”.");
  }

  if (verdict.duplicate.length > 0) {
    console.error("");
    console.error(`  Claimed by more than one local file (${verdict.duplicate.length}):`);
    console.error(bullets(verdict.duplicate));
    console.error("  The cloud keys applied migrations on the version alone, so it can only ever");
    console.error("  track ONE of the colliding files — the other would be committed and never");
    console.error("  applied. `db push` cannot fix this: rename one file to a free timestamp.");
  }

  if (verdict.unparseable.length > 0) {
    console.error("");
    console.error(`  Unreadable migration filenames (${verdict.unparseable.length}):`);
    console.error(bullets(verdict.unparseable));
    console.error("  Not a missing migration and `db push` cannot fix it: rename each file to");
    console.error("  `<14-digit timestamp>_<name>.sql` so it has a version the cloud can report back.");
  }
}

function reportUnavailable(reason: string): void {
  console.error("");
  console.error("GATE UNAVAILABLE — the comparison never ran.");
  console.error("");
  console.error(`  ${reason}`);
  console.error("");
  console.error("  This is NOT evidence about the schema: the database may be perfectly in sync.");
  console.error("  The deploy is blocked because this gate fails closed. A job whose `needs`");
  console.error("  failed cannot be started on its own, so if the outage persists the escape is a");
  console.error("  commit removing `drift` from `deploy`'s `needs` in .github/workflows/ci.yml.");
}

async function main(): Promise<number> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_ID;

  // Each credential gets its own message rather than a shared one, so a red build names the
  // secret to set instead of sending the reader to check both.
  if (!token) {
    reportUnavailable("SUPABASE_ACCESS_TOKEN is not set (the Supabase personal access token).");
    return 1;
  }
  if (!ref) {
    reportUnavailable("SUPABASE_PROJECT_ID is not set (the cloud project ref).");
    return 1;
  }

  const local = readLocalFilenames();
  const remote = await fetchRemoteVersions(ref, token);

  console.log(`schema-drift: ${local.length} local entries against ${remote.length} applied cloud migrations`);

  const verdict = compareMigrations({ local, remote });
  if (verdict.clean) {
    console.log("schema-drift: OK — every migration in this repository is applied in the cloud.");
    return 0;
  }

  reportDrift(verdict);
  return 1;
}

// The token appears nowhere in any message above, and must not start doing so: GitHub masks
// registered secrets, but a gate that relies on masking to keep a credential out of a public
// log is one un-registered variable away from leaking it.
try {
  process.exitCode = await main();
} catch (err) {
  if (err instanceof GateUnavailable) {
    reportUnavailable(err.message);
  } else {
    reportUnavailable(`the gate itself threw: ${String(err)}`);
  }
  process.exitCode = 1;
}
