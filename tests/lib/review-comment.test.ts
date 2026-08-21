import { describe, expect, it } from "vitest";
// `@/*` maps to `src/*` only, and the subject here is CI tooling under `scripts/` — see the
// note in review-verdict.test.ts and test-plan §6.1.
import {
  COMMENT_MARKER,
  renderComment,
  renderFailureHeader,
  renderNoCodeComment,
} from "../../scripts/review-comment.ts";
import type { RenderCommentInput } from "../../scripts/review-comment.ts";

// The comment is the ENTIRE signal on a `fail`: the run stays green (review is advisory), so
// nothing else on the PR says which criterion fell and why. That makes two properties
// testable-and-load-bearing rather than cosmetic — the reasons sit above the table, and a
// skipped criterion says "nie dotyczy" in words.
//
// The third property is stickiness: all three bodies must open with the same hidden marker,
// because that marker is how the workflow finds its own comment to PATCH. The variant that
// makes this easy to get wrong is the no-code one — it walks a path no "comment count stays
// 1" criterion is measured on.

const TABLE_HEADER = "| Kryterium | Ocena | Uzasadnienie |";

/** Owned by this file and rebuilt per case; nothing here is shared or mutated in place. */
function passingInput(): RenderCommentInput {
  return {
    verdict: "pass",
    failing: [],
    skipped: [],
    scores: [
      { key: "alpha", label: "Alfa", score: 8, note: "Sprawdzone w src/lib/decks.ts." },
      { key: "beta", label: "Beta", score: 9, note: "Importy przez @/*." },
    ],
    summary: "Zmiana wygląda dobrze.",
    sha: "0123456789abcdef0123456789abcdef01234567",
    model: "anthropic/claude-sonnet-4.6",
    runUrl: "https://github.com/lirdaw/repo/actions/runs/1",
    threshold: 5,
  };
}

function failingInput(): RenderCommentInput {
  return {
    ...passingInput(),
    verdict: "fail",
    failing: [
      { key: "beta", label: "Bezpieczeństwo", score: 2, note: "Klucz service-role w src/pages/api/generate.ts." },
    ],
    skipped: [{ key: "gamma", label: "Integralność bramki", note: "Diff nie dodaje żadnego sprawdzenia." }],
    scores: [
      { key: "alpha", label: "Alfa", score: 8, note: "Sprawdzone w src/lib/decks.ts." },
      { key: "beta", label: "Bezpieczeństwo", score: 2, note: "Klucz service-role w src/pages/api/generate.ts." },
      { key: "gamma", label: "Integralność bramki", score: null, note: "Diff nie dodaje żadnego sprawdzenia." },
    ],
    summary: "Zmiana wnosi sekret do repozytorium.",
  };
}

describe("renderComment", () => {
  it("says fail and names the criterion within the first three lines", () => {
    const lines = renderComment(failingInput()).split("\n").slice(0, 3).join("\n");

    expect(lines).toContain(COMMENT_MARKER);
    expect(lines).toContain("fail");
    expect(lines).toContain("Bezpieczeństwo");
  });

  // The requirement is ordering, not presence: a reason visible only after the table is as
  // mute as an unread run, because the table is what a reader scrolls past.
  it("puts the failing criteria and their notes ABOVE the table", () => {
    const body = renderComment(failingInput());

    expect(body.indexOf("Klucz service-role")).toBeGreaterThan(-1);
    expect(body.indexOf("Klucz service-role")).toBeLessThan(body.indexOf(TABLE_HEADER));
  });

  // A skipped criterion must be readable as a decision. An empty cell would be
  // indistinguishable from a score the agent forgot to give.
  it("renders a null score as the literal „nie dotyczy”", () => {
    const body = renderComment(failingInput());

    expect(body).toContain("nie dotyczy");
    expect(body).toContain("| Integralność bramki | **nie dotyczy** |");
  });

  it("carries the head SHA and the resolved model", () => {
    const input = passingInput();
    const body = renderComment(input);

    expect(body).toContain(input.sha);
    expect(body).toContain(input.model);
  });

  it("renders every criterion as one table row, skipped ones included", () => {
    const input = failingInput();
    const rows = renderComment(input)
      .split("\n")
      .filter((line) => line.startsWith("| ") && line !== TABLE_HEADER && !line.startsWith("| --- "));

    expect(rows).toHaveLength(input.scores.length);
  });

  // The note is free text from an LLM. A `|` shifts every following column and a newline ends
  // the row outright — both corrupt the table with no error anywhere.
  it("keeps a note containing a pipe or a newline inside its own cell", () => {
    const input = passingInput();
    const withPipe: RenderCommentInput = {
      ...input,
      scores: [{ key: "alpha", label: "Alfa", score: 8, note: "Sprawdzone: a | b\noraz druga linia." }],
    };

    const row = renderComment(withPipe)
      .split("\n")
      .find((line) => line.startsWith("| Alfa |"));

    expect(row).toBeDefined();
    expect(row).toContain("a \\| b");
    // Three cells between four unescaped separators → five chunks. An unescaped pipe in the
    // note, or a newline splitting the row, breaks this count.
    expect(row?.split(/(?<!\\)\|/)).toHaveLength(5);
  });

  // The two sources of `fail` are an alternative, so the heading must name EITHER. Measured
  // while verifying phase 3: a single "poniżej progu N:" branch left a dangling colon here and
  // claimed a criterion had fallen below the threshold when none had — a false statement in
  // the one line most readers read.
  it("names the agent's own verdict as the reason when no criterion fell below the threshold", () => {
    const input: RenderCommentInput = {
      ...passingInput(),
      verdict: "fail",
      summary: "Dwie niezależne zmiany zlepione w jedną — nie da się cofnąć jednej bez drugiej.",
    };

    const body = renderComment(input);
    const headline = body.split("\n")[2] ?? "";

    expect(headline).toContain("fail");
    expect(headline).toContain("werdykt całościowy agenta");
    expect(headline).not.toMatch(/:\s*$/);
    // With no per-criterion reason to list, the summary IS the reason — so it leads instead of
    // sitting below the table where a reader arrives only after the detail.
    expect(body.indexOf("Dwie niezależne zmiany")).toBeLessThan(body.indexOf(TABLE_HEADER));
    expect(body).toContain(TABLE_HEADER);
  });

  it("keeps the summary below the table when the failing criteria already carry the reason", () => {
    const body = renderComment(failingInput());

    expect(body.indexOf("Podsumowanie agenta")).toBeGreaterThan(body.indexOf(TABLE_HEADER));
  });

  it("omits the run link when there is no run to link to", () => {
    const body = renderComment({ ...passingInput(), runUrl: null });

    expect(body).not.toContain("[przebieg]");
  });
});

describe("renderFailureHeader", () => {
  const failure = { reason: "model `nope/nope-1` nie istnieje (api_error)", runUrl: "https://example.test/run/2" };

  it("keeps the previous verdict underneath the failure block", () => {
    const previous = renderComment(failingInput());

    const body = renderFailureHeader(previous, failure);

    expect(body).toContain("Bezpieczeństwo");
    expect(body).toContain(failure.reason);
  });

  // The publish step runs `if: always()`, so every failing run re-renders over its own
  // previous output. Two headers would stack forever.
  it("is idempotent — two consecutive failures leave one header", () => {
    const once = renderFailureHeader(renderComment(failingInput()), failure);
    const twice = renderFailureHeader(once, failure);

    const count = (body: string) => body.split("Review się NIE odbyło").length - 1;
    expect(count(once)).toBe(1);
    expect(count(twice)).toBe(1);
    // …and the verdict it was pasted over survives the second pass too.
    expect(twice).toContain("Bezpieczeństwo");
  });

  it("carries a newer reason on the second failure rather than the stale one", () => {
    const once = renderFailureHeader(renderComment(failingInput()), failure);

    const twice = renderFailureHeader(once, { reason: "pusty diff na wejściu", runUrl: failure.runUrl });

    expect(twice).toContain("pusty diff na wejściu");
    expect(twice).not.toContain(failure.reason);
  });

  it("renders on a PR that has no previous comment at all", () => {
    const body = renderFailureHeader(null, failure);

    expect(body).toContain("Review się NIE odbyło");
    expect(body).toContain("Brak wcześniejszego werdyktu");
  });
});

// The single assertion that defends stickiness on every path at once. The no-code variant is
// the one that needs it: without the marker the workflow's lookup misses that body and the
// next run appends a SECOND comment — and no "comment count stays 1" criterion is measured on
// the path that produces it.
describe("comment marker", () => {
  it("opens all three variants", () => {
    const bodies = [
      renderComment(passingInput()),
      renderNoCodeComment({ sha: "0123456", runUrl: null }),
      renderFailureHeader(renderComment(passingInput()), { reason: "cokolwiek", runUrl: null }),
    ];

    for (const body of bodies) {
      expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    }
  });

  // Exactly one copy: the failure variant strips the marker off the body it pastes over, and
  // a duplicate would surface as a stray comment fragment in the rendered Markdown.
  it("appears exactly once, including after a failure is pasted over a verdict", () => {
    const body = renderFailureHeader(renderComment(failingInput()), { reason: "cokolwiek", runUrl: null });

    expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  });
});

describe("renderNoCodeComment", () => {
  it("says there was nothing to review and carries the SHA", () => {
    const body = renderNoCodeComment({ sha: "abcdef1", runUrl: null });

    expect(body).toContain("brak kodu do oceny");
    expect(body).toContain("abcdef1");
    // No verdict and no table: the agent never ran, so there is nothing to score.
    expect(body).not.toContain(TABLE_HEADER);
  });
});
