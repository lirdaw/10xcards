// The PR comment's body, as pure string functions. No filesystem, no network, no console —
// the runner beside this file (./run-review-verdict.ts) writes the result to a file, and the
// workflow POSTs or PATCHes it. Same pure/runner split, and the same reason, as
// ./review-verdict.ts ↔ ./run-review-verdict.ts.
//
// The bar for this module is higher than "render a table". The run itself always ends green
// on a `fail` verdict — review is advisory and blocks nothing — so the ENTIRE signal rests on
// this text and on the result label. A comment that has to be unfolded to see why the change
// failed is exactly as mute as a run nobody clicks, which is why the failing criteria are
// named in the HEADING and repeated above the table, never only inside it.

import type { FailingCriterion, ScoreRow, SkippedCriterion } from "./review-verdict.ts";

/**
 * The hidden marker every variant of this comment starts with, and the property the whole
 * "one comment, updated in place" behaviour hangs on: the workflow finds its own comment by
 * searching for THIS string plus the author, not with `gh pr comment --edit-last` (which
 * takes the actor's last comment regardless of content, so the first other workflow posting
 * as the same bot would have it overwrite the wrong one).
 *
 * The marker lives here, in one constant, in all three variants at once — never as a string
 * repeated in YAML. The `v1` is the comment contract's version: change the shape of the body
 * enough that an old comment must not be patched in place, and this is what bumps.
 */
export const COMMENT_MARKER = "<!-- ai-code-review v1 -->";

/**
 * Delimiters of the failure block, so ./renderFailureHeader can be applied twice without
 * stacking two headers. They are HTML comments, so they are invisible in the rendered
 * comment while still being addressable in its source.
 */
const FAILURE_OPEN = "<!-- ai-code-review:failure -->";
const FAILURE_CLOSE = "<!-- /ai-code-review:failure -->";

/** Literal, and asserted by tests/lib/review-comment.test.ts — this is the contract word. */
const NOT_APPLICABLE = "nie dotyczy";

export interface RenderCommentInput {
  readonly verdict: "pass" | "fail";
  readonly failing: readonly FailingCriterion[];
  readonly skipped: readonly SkippedCriterion[];
  /** Every criterion in `criteria.json` order — including the skipped ones. */
  readonly scores: readonly ScoreRow[];
  readonly summary: string;
  /**
   * The head commit of the PR — `github.event.pull_request.head.sha`, never `github.sha`,
   * which at a `pull_request` event points at the synthetic merge commit the author can see
   * nowhere on the PR.
   */
  readonly sha: string;
  /**
   * The RESOLVED model id, supplied by the harness that ran the agent — never a field of the
   * result JSON. The result JSON is produced by an LLM, and a model has no business
   * reporting its own identity: it could invent one and nobody would check.
   */
  readonly model: string;
  /** Rendered as a link when present; local runs have no run to link to. */
  readonly runUrl?: string | null;
  /** Rendered for the reader only. The value itself lives in `SCORE_THRESHOLD`. */
  readonly threshold: number;
}

export interface FailureHeaderInput {
  /** What actually broke — the agent's stderr tail or the step that failed. */
  readonly reason: string;
  readonly runUrl?: string | null;
}

/**
 * Make a model-authored string safe inside a Markdown table cell.
 *
 * A note is free text from an LLM: a `|` in it silently shifts every following column, and a
 * newline ends the row outright. Both would corrupt the table without any error anywhere.
 */
function escapeCell(text: string): string {
  return neutraliseMarkers(text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim());
}

/**
 * Defang HTML comment openers in model-authored text.
 *
 * This file's control plane IS an HTML comment: `COMMENT_MARKER` is how the workflow finds the
 * comment to edit, and `FAILURE_OPEN`/`FAILURE_CLOSE` are how a failure header is stripped
 * before the next one is pasted on. All three live in text we write — but the summary and the
 * per-criterion notes are written by an LLM, and the diff that LLM read is written by the author
 * of the pull request being judged.
 *
 * So a change carrying `<!-- ai-code-review:failure -->` in a comment could have it echoed into
 * the summary, and `stripFailureBlock` would then cut the surviving verdict off at that point on
 * the next failing run. Replacing the opener with a look-alike keeps the text readable while
 * making it inert: what a reader sees is unchanged, what the parser sees can no longer be steered.
 */
function neutraliseMarkers(text: string): string {
  return text.replace(/<!--/g, "<!\u2011\u2011");
}

function renderScore(score: number | null): string {
  return score === null ? `**${NOT_APPLICABLE}**` : `${score}/10`;
}

function renderRunLink(runUrl: string | null | undefined): string {
  return runUrl ? ` · [przebieg](${runUrl})` : "";
}

/**
 * The full review comment.
 *
 * Line order is the requirement, not a preference: the heading names the verdict AND the
 * criteria that produced it, so a reader who reads three lines and stops already knows both.
 * The per-criterion reasons come next, still ABOVE the table. The table is the detail, not
 * the signal.
 */
export function renderComment({
  verdict,
  failing,
  skipped,
  scores,
  summary,
  sha,
  model,
  runUrl,
  threshold,
}: RenderCommentInput): string {
  // The two sources of `fail` are an ALTERNATIVE, so the heading has to be able to name
  // EITHER. Measured while verifying this phase: a single "— poniżej progu N: " branch leaves
  // a dangling colon on the agent-verdict-only fail — and, worse, it ASSERTS that a criterion
  // fell below the threshold when none did, in the one line most readers read.
  const reason =
    failing.length > 0
      ? `poniżej progu ${threshold}: ${failing.map((criterion) => criterion.label).join(", ")}`
      : `werdykt całościowy agenta — żadne pojedyncze kryterium nie spadło poniżej progu ${threshold}`;

  const headline =
    verdict === "fail" ? `## Code review agenta: ❌ \`fail\` — ${reason}` : "## Code review agenta: ✅ `pass`";

  const summarySection = `**Podsumowanie agenta**\n\n${neutraliseMarkers(summary.trim())}`;
  // On that same branch the summary is the ONLY statement of why, so it moves above the table
  // rather than sitting below it. Everywhere else the per-criterion reasons carry the signal
  // and the summary stays where a reader expects it, after the detail.
  const summaryLeads = verdict === "fail" && failing.length === 0;

  const sections: string[] = [COMMENT_MARKER, headline];

  if (summaryLeads) {
    sections.push(summarySection);
  }

  if (failing.length > 0) {
    sections.push(
      failing
        .map((criterion) => `- **${criterion.label}** — ${criterion.score}/10 — ${escapeCell(criterion.note)}`)
        .join("\n"),
    );
  }

  if (skipped.length > 0) {
    // Named explicitly rather than left as an empty cell to be noticed: "the agent judged
    // this not to apply" and "the agent said nothing about this" must never look alike.
    sections.push(`**${NOT_APPLICABLE}:** ${skipped.map((criterion) => criterion.label).join(", ")}`);
  }

  sections.push(
    [
      "| Kryterium | Ocena | Uzasadnienie |",
      "| --- | --- | --- |",
      ...scores.map((row) => `| ${row.label} | ${renderScore(row.score)} | ${escapeCell(row.note)} |`),
    ].join("\n"),
  );

  if (!summaryLeads) {
    sections.push(summarySection);
  }

  sections.push(
    "---\n\n" +
      `Commit \`${sha}\` · model \`${model}\`${renderRunLink(runUrl)}\n\n` +
      "Review jest **doradcze** — nie blokuje merge'a i nie wchodzi na listę wymaganych sprawdzeń.",
  );

  return `${sections.join("\n\n")}\n`;
}

/**
 * The fourth state from the workflow: the filtered diff is empty while the unfiltered one is
 * not — a documentation-only PR. The agent never ran, so there is no verdict, no score and no
 * summary to render, and `renderComment` cannot express this.
 *
 * It carries the SAME marker, and that is the easy thing to leave out: without it the
 * workflow's comment lookup would miss this body and the next run would append a SECOND
 * comment — a break in stickiness that the "bot comment count stays 1" success criterion
 * cannot catch, because that criterion is measured on a PR with code, which never walks this
 * path.
 */
/**
 * The FIFTH state: there is code to review and deliberately none of it was sent.
 *
 * Kept distinct from `renderNoCodeComment` on purpose — "nothing to review" and "too much to
 * review" look the same on the pull request list (green, no label) and mean opposite things to
 * the author. One needs no action; this one needs a human to decide whether to split the change
 * or run review by hand.
 *
 * Carries the SAME marker as every other variant, which is what keeps the sticky comment sticky:
 * a body the phase-5 lookup cannot find gets a SECOND comment appended instead of an edit.
 */
export function renderTooLargeComment({
  sha,
  bytes,
  limit,
  runUrl,
}: {
  sha: string;
  bytes: number;
  limit: number;
  runUrl?: string | null;
}): string {
  return (
    [
      COMMENT_MARKER,
      "## Code review agenta: zmiana za duża na automatyczne review",
      `Diff po odfiltrowaniu ma **${bytes.toLocaleString("pl-PL")} bajtów**, a próg automatycznego ` +
        `review wynosi **${limit.toLocaleString("pl-PL")}**. Agent nie został uruchomiony i ` +
        "**żadna etykieta wyniku nie została nałożona** — brak oceny to nie jest ocena pozytywna.",
      "Próg istnieje po to, żeby o rachunku nie decydował rozmiar pull requesta: koszt przebiegu " +
        "rośnie z rozmiarem diffa po obu stronach naraz (wejście i wypisane uzasadnienia). " +
        "Zwykle właściwą odpowiedzią jest podzielenie zmiany; jeśli ma zostać w całości, " +
        "uruchom review ręcznie przez `workflow_dispatch`.",
      `Commit \`${sha}\`${renderRunLink(runUrl)}`,
    ].join("\n\n") + "\n"
  );
}

export function renderNoCodeComment({ sha, runUrl }: { sha: string; runUrl?: string | null }): string {
  return (
    [
      COMMENT_MARKER,
      "## Code review agenta: brak kodu do oceny",
      "Po odfiltrowaniu plików generowanych, lockfile'ów i `context/**` w tej zmianie nie zostało nic, " +
        "co dałoby się zrecenzować. To nie jest awaria zbierania wejścia — pustka jest tu oczekiwana, " +
        "więc przebieg jest zielony i **żadna etykieta wyniku nie została nałożona**.",
      `Commit \`${sha}\`${renderRunLink(runUrl)}`,
    ].join("\n\n") + "\n"
  );
}

/**
 * Paste a failure block over whatever the comment said last, keeping the previous verdict
 * underneath it.
 *
 * Two facts have to survive at once: review did not run this time, and the last thing it did
 * say is still on the page (stale, and labelled as such). Replacing the body would destroy
 * the second; appending would bury the first.
 *
 * **Idempotent by construction**: an existing failure block is stripped before the new one is
 * prepended, so two consecutive failures leave one header rather than two. That matters
 * because the workflow's publish step runs `if: !cancelled()`, i.e. every failing run walks this
 * path again over its own previous output.
 */
export function renderFailureHeader(
  previousBody: string | null | undefined,
  { reason, runUrl }: FailureHeaderInput,
): string {
  const previous = stripFailureBlock(previousBody ?? "");

  const header = [
    FAILURE_OPEN,
    "> [!WARNING]",
    "> **Review się NIE odbyło** — poniższy werdykt (jeśli jest) pochodzi z wcześniejszego przebiegu",
    "> i może być nieaktualny. Brak etykiety wyniku znaczy „review się nie odbyło”, nie „pass”.",
    ">",
    `> Przyczyna: ${neutraliseMarkers(reason.replace(/\r?\n/g, " ").trim())}${renderRunLink(runUrl)}`,
    FAILURE_CLOSE,
  ].join("\n");

  const body = previous.length > 0 ? previous : "_Brak wcześniejszego werdyktu — to pierwszy przebieg na tym PR-ze._";

  return `${COMMENT_MARKER}\n\n${header}\n\n${body}\n`;
}

/**
 * Take the marker and any previous failure block off a body, leaving the verdict content.
 *
 * The marker is stripped too, because every variant re-adds it as its first line — leaving it
 * in place would bury a second copy in the middle of the body on each failing run.
 */
function stripFailureBlock(body: string): string {
  const withoutMarker = body.split(COMMENT_MARKER).join("");
  const openIndex = withoutMarker.indexOf(FAILURE_OPEN);
  if (openIndex === -1) return withoutMarker.trim();

  const closeIndex = withoutMarker.indexOf(FAILURE_CLOSE, openIndex);
  if (closeIndex === -1) {
    // An opening delimiter with no closing one means the body was edited by hand or truncated
    // in transit. Dropping everything from the opener is the fail-closed direction: it can
    // lose a stale verdict, while the alternative would stack failure headers forever.
    return withoutMarker.slice(0, openIndex).trim();
  }

  return (withoutMarker.slice(0, openIndex) + withoutMarker.slice(closeIndex + FAILURE_CLOSE.length)).trim();
}
