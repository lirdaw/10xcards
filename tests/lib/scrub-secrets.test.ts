import { describe, expect, it } from "vitest";
// `@/*` maps to `src/*` only, and the subject here is CI tooling under `scripts/` — same reason
// and same shape as tests/lib/schema-drift.test.ts and tests/lib/review-prompt-sources.test.ts.
import { KEY_SHAPES, MIN_SECRET_LENGTH, REDACTION, scrubSecrets } from "../../scripts/scrub-secrets.ts";

// The gate between the review agent's stderr and a comment on a PUBLIC pull request.
//
// It replaced `sed -i "s|${API_KEY}|***|g" … 2>/dev/null || true`, whose defect was not that it
// was wrong on the happy path — it was right there — but that it could not FAIL VISIBLY. A key
// containing `|` or `\` broke the s-command, both channels of that failure were discarded, and
// the unscrubbed line went on to be pasted into the comment body. So the cases below are not
// about substitution working; they are about the two things that line could not do: survive a
// metacharacter, and say so when it cannot vouch for the result.

const KEY = "sk-or-v1-0123456789abcdef0123456789abcdef";

function logWith(secret: string): string {
  return [
    "Error: API Error: 401 Unauthorized",
    `  request used key ${secret} against https://openrouter.ai/api`,
    "  at async main (/home/runner/work/review.ts:12:3)",
  ].join("\n");
}

describe("scrubSecrets", () => {
  // THE positive control. Without it every assertion below would still pass for an
  // implementation that redacted the entire input and called it clean.
  it("leaves text that never contained the secret untouched, and vouches for it", () => {
    const text = "Error: API Error: 400 model not found\n  at async main";

    const result = scrubSecrets({ text, secret: KEY });

    expect(result.text).toBe(text);
    expect(result.clean).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("removes every occurrence of the literal key", () => {
    const text = `${logWith(KEY)}\nretrying with ${KEY}`;

    const result = scrubSecrets({ text, secret: KEY });

    expect(result.text).not.toContain(KEY);
    expect(result.text.split(REDACTION)).toHaveLength(3); // two redactions
    expect(result.clean).toBe(true);
  });

  // The case the old `sed` got wrong, and the reason this module exists. `|` was the s-command
  // delimiter and `\` starts an escape, so either one turned the substitution into a syntax
  // error that `2>/dev/null || true` then swallowed — and the key reached the comment intact.
  // Literal replacement cannot be broken this way, so the requirement is the STRONGER one: not
  // "the failure is flagged" but "there is no failure and the key is gone".
  it.each([
    ["pipe", "sk-or-v1-aaaa|bbbb|cccc-dddd-eeee"],
    ["backslash", "sk-or-v1-aaaa\\bbbb\\cccc-dddd"],
    ["regex metacharacters", "sk-or-v1-a.*b$c^d[e]f(g)h+i?j"],
    ["ampersand", "sk-or-v1-aaaa&bbbb&cccc-dddd"],
  ])("removes a key containing %s instead of passing the line through", (_label, awkwardKey) => {
    const result = scrubSecrets({ text: logWith(awkwardKey), secret: awkwardKey });

    expect(result.text).not.toContain(awkwardKey);
    expect(result.text).toContain(REDACTION);
    expect(result.clean).toBe(true);
  });

  // `eval-ci-dispatch` had a repository secret with a BOM that passed every "is it set?" check
  // and failed on the first real call. The value that reaches the provider — and therefore the
  // one that can appear in its error — is the trimmed one.
  it("removes the key even when the configured secret carries a BOM or surrounding whitespace", () => {
    const result = scrubSecrets({ text: logWith(KEY), secret: `\uFEFF  ${KEY}\n` });

    expect(result.text).not.toContain(KEY);
    expect(result.clean).toBe(true);
  });

  it("redacts a key-shaped string that is NOT the secret we hold", () => {
    // A rotated key still quoted in a cached error, or a second provider's. The literal pass
    // cannot catch these and they leak exactly as badly.
    const other = "sk-ant-99887766554433221100aabbccddeeff";

    const result = scrubSecrets({ text: logWith(other), secret: KEY });

    expect(result.text).not.toContain(other);
    expect(result.clean).toBe(true);
  });

  describe("refuses to vouch", () => {
    it("when no secret was supplied at all", () => {
      const result = scrubSecrets({ text: "Error: something", secret: "" });

      expect(result.clean).toBe(false);
      expect(result.reason).toContain("nie podano klucza");
    });

    it("when the supplied secret is too short to remove safely", () => {
      const result = scrubSecrets({ text: "Error: a", secret: "abc" });

      expect(result.clean).toBe(false);
      expect(result.reason).toContain(String(MIN_SECRET_LENGTH));
    });

    it("still redacts by shape on the paths where it refuses, so the file is never left worse", () => {
      const result = scrubSecrets({ text: logWith(KEY), secret: "" });

      expect(result.clean).toBe(false);
      expect(result.text).not.toContain(KEY);
    });
  });

  // KEY_SHAPES carry the `g` flag, and `g` regexes are stateful through `lastIndex`. Sharing one
  // across calls would make the SECOND scrub of a run skip matches — an order-dependent leak,
  // which `vitest.config.ts`'s permanent `sequence: { shuffle: true }` would surface as a flake
  // rather than as an answer. This pins the freshness of the regex, not just today's output.
  it("gives the same answer on a repeated call", () => {
    const first = scrubSecrets({ text: logWith(KEY), secret: KEY });
    const second = scrubSecrets({ text: logWith(KEY), secret: KEY });

    expect(second).toEqual(first);
  });

  it("keeps the surrounding diagnosis readable — the point is redaction, not deletion", () => {
    const result = scrubSecrets({ text: logWith(KEY), secret: KEY });

    expect(result.text).toContain("401 Unauthorized");
    expect(result.text).toContain("https://openrouter.ai/api");
  });
});

describe("KEY_SHAPES", () => {
  it("are declared global, which is what the fresh-regex handling above compensates for", () => {
    for (const shape of KEY_SHAPES) {
      expect(shape.flags).toContain("g");
    }
  });
});
