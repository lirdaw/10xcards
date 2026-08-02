import { z } from "zod";
import { OPENROUTER_URL } from "@/lib/openrouter";
import type { CardVerdict } from "./scoring";

// LLM-as-judge client: grades ONE card per call against the language expectation and the
// usability rubric. Lives in evals/ on purpose — it reads `process.env` and may log, both
// of which are src/-only prohibitions (no-logging guard and astro:env both scope to src/).
// The endpoint URL is imported from @/lib/openrouter so the two clients cannot drift.
//
// The judge model is pinned to a DIFFERENT family from the generator's openai/gpt-4o-mini
// (self-grading bias), `temperature: 0` for verdict stability. Override for experiments
// with EVAL_JUDGE_MODEL in the same shell env as the key. An EMPTY EVAL_JUDGE_MODEL means
// "unset" — resolveJudgeModel coerces with `||`, never `??`, and that is not a tidy-up
// waiting to be reverted: `model: ""` is a guaranteed 400 from OpenRouter, which
// postWithOneRetry classes as neither 429 nor >= 500, so it throws on the first card of
// the first case with no retry. The reachable route is a workflow input — GitHub Actions
// resolves an unprovided input to the empty STRING, not to unset — so the default dispatch
// would hit exactly that. .github/workflows/eval.yml guards its own end by exporting the
// variable only when non-empty; neither guard is redundant, because this one also covers a
// developer who exports EVAL_JUDGE_MODEL= in a local shell.
//
// Failure contract (plan "Phase 2 / Judge client", widened by Phase 3 measurement): a
// 429/5xx or transport error retries ONCE with a short backoff — a transient blip
// mid-run would otherwise abort after the 10 paid generation calls. A TRUNCATED verdict
// body (HTTP 200, content cut mid-string, finish=error) joined the transient class during
// the first calibration runs — see TruncatedVerdictError below for the measurement.
// Anything else (other HTTP status, non-JSON envelope, schema mismatch on well-formed
// JSON) throws immediately: an unreachable judge must never read as a verdict, and a
// retry is not a substituted verdict.

const JUDGE_MODEL_DEFAULT = "google/gemini-2.5-flash";
const RETRY_BACKOFF_MS = 3_000;
// Per-request cap so a stalled socket fails as a labelled judge error (and gets the
// transient retry) instead of eating the case's whole 120 s testTimeout as a generic
// "Test timed out". A verdict is a short classification; 30 s is generous.
const JUDGE_TIMEOUT_MS = 30_000;

/** The judge model this run will use — also printed in the eval's summary header. */
export function resolveJudgeModel(): string {
  // `||`, never `??` — an empty override means "unset". See the header note. The rule
  // disabled here calls `??` "safer", and on this one line that is exactly backwards: `??`
  // passes `""` through as a chosen model and kills every judge call with an unretried 400.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- "" must fall through to the default
  return process.env.EVAL_JUDGE_MODEL || JUDGE_MODEL_DEFAULT;
}

export interface JudgeInput {
  front: string;
  back: string;
  /** The source text the card was generated from (grounding for the rubric). */
  sourceExcerpt: string;
  /**
   * The ENGLISH name of the language the card must be in, e.g. "Spanish" — the same wording
   * the rubric asks `detected_language` to come back in, so the verdict's two language
   * fields are stated in one vocabulary. It is deliberately NOT the app selector's label:
   * that is a Polish exonym for a human, and its wire value is now a two-letter code.
   */
  expectedLanguage: string;
}

const verdictSchema = z.object({
  language_ok: z.boolean(),
  detected_language: z.string(),
  usable: z.boolean(),
  reason: z.string(),
});

// Structured-outputs schema (strict: every property required, no extras) — the same
// request shape the generator uses. If the judge model via OpenRouter rejects it at the
// first live call, the documented fallback is prompt-enforced JSON + tolerant parsing;
// which shape shipped is recorded in the change's verification.md.
function verdictJsonSchema() {
  return {
    type: "object",
    properties: {
      language_ok: { type: "boolean" },
      detected_language: { type: "string" },
      usable: { type: "boolean" },
      reason: { type: "string" },
    },
    required: ["language_ok", "detected_language", "usable", "reason"],
    additionalProperties: false,
  };
}

// The rubric (plan "Critical Implementation Details"): front is a clear question/prompt,
// back actually answers it, the pair is self-contained and grounded in the source text,
// no truncation artifacts. The expected language is stated explicitly.
function judgeSystemPrompt(expectedLanguage: string) {
  return [
    `You are a strict evaluator of study flashcards. You judge ONE flashcard at a time`,
    `against the source text it was generated from. Answer ONLY through the provided JSON schema.`,
    `Fields:`,
    `- language_ok: true only if BOTH the front and the back are written in this language: ${expectedLanguage}.`,
    `  Proper nouns, titles quoted from the source, and established technical loanwords do not count against it.`,
    `- detected_language: the language the card is actually written in (English name, e.g. "Polish", "Spanish").`,
    `- usable: true only if ALL of the following hold: the front is a clear question or prompt;`,
    `  the back actually answers the front; the pair is self-contained (understandable without reading`,
    `  the source text); the content is grounded in the source text (no fabricated facts);`,
    `  there are no truncation artifacts (cut-off sentences, dangling fragments, stray JSON or markup).`,
    `- reason: one short sentence justifying the verdict.`,
  ].join("\n");
}

function judgeUserPrompt(input: JudgeInput) {
  return [
    `Expected language: ${input.expectedLanguage}`,
    ``,
    `Source text:`,
    `"""`,
    input.sourceExcerpt,
    `"""`,
    ``,
    `Flashcard front: ${input.front}`,
    `Flashcard back: ${input.back}`,
  ].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One POST with a single retry confined to the transient class (transport, 429, 5xx).
async function postWithOneRetry(init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      // Fresh signal per attempt — one signal spanning the loop would keep counting
      // through the backoff sleep and starve the retry of its budget. A timeout abort
      // lands in this catch as a transport error, i.e. inside the transient class.
      response = await fetch(OPENROUTER_URL, { ...init, signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS) });
    } catch (err) {
      if (attempt === 1) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      const reason = err instanceof Error ? err.message : "fetch failed";
      throw new Error(`Judge fetch failed after retry: ${reason}`);
    }
    if ((response.status === 429 || response.status >= 500) && attempt === 1) {
      await sleep(RETRY_BACKOFF_MS);
      continue;
    }
    return response;
  }
}

// A truncated verdict body — the second TRANSIENT class, measured on the first
// calibration day: ~10% of judge calls came back as HTTP 200 with `finish_reason:
// "error"` and the content cut mid-string at a varying point (mid-key or mid-`reason`),
// while a probe repeating one identical prompt was 30/30 clean (provider-side caching
// masks it). It is a provider blip, not a contract mismatch: with ~50 judge calls per
// run and no tolerance the eval could NEVER complete. The blips arrive in BURSTS (a
// single 3 s retry was observed to fail twice in a row), so this class gets two retries
// with a growing backoff, then a loud throw — the same fail-loudly endpoint as 429/5xx.
class TruncatedVerdictError extends Error {}

const TRUNCATION_BACKOFFS_MS = [3_000, 10_000];

export async function judgeCard(input: JudgeInput): Promise<CardVerdict> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestVerdict(input);
    } catch (err) {
      if (err instanceof TruncatedVerdictError && attempt < TRUNCATION_BACKOFFS_MS.length) {
        await sleep(TRUNCATION_BACKOFFS_MS[attempt]);
        continue;
      }
      throw err;
    }
  }
}

async function requestVerdict(input: JudgeInput): Promise<CardVerdict> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // Unreachable when the eval preflight ran; kept so a direct import fails loudly too.
    throw new Error("Judge has no OPENROUTER_API_KEY in process.env (see evals/setup/eval-preflight.ts)");
  }
  const model = resolveJudgeModel();

  const body = {
    model,
    messages: [
      { role: "system", content: judgeSystemPrompt(input.expectedLanguage) },
      { role: "user", content: judgeUserPrompt(input) },
    ],
    temperature: 0,
    // gemini-2.5-flash is a REASONING model and its thinking tokens draw from the SAME
    // max_tokens budget as the visible content — measured on the first calibration day:
    // with the default (dynamic) thinking the verdict JSON came back truncated mid-key
    // (`"usable`) on several calls of one run while an earlier identical run was fine,
    // and raising max_tokens 500 → 4000 did not help (the model just thinks more).
    // Reasoning is therefore DISABLED for the judge (OpenRouter `reasoning.enabled`,
    // maps to Gemini thinkingBudget 0): a verdict is a short classification, not a
    // derivation, and determinism (temperature 0) matters more than depth here.
    max_tokens: 1000,
    reasoning: { enabled: false },
    response_format: {
      type: "json_schema",
      json_schema: { name: "card_verdict", strict: true, schema: verdictJsonSchema() },
    },
  };

  const response = await postWithOneRetry({
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // The excerpt can echo upstream request metadata (never the key — it travels only in
    // the Authorization header). The deferred workflow_dispatch leg landed in C10X-42
    // (2026-08-02) and the instruction this comment used to carry is MET: under
    // .github/workflows/eval.yml the eval step redirects both streams into
    // eval-console.log, which is uploaded as an artifact — only eval-summary.log is echoed
    // into the job log, and this message never reaches it. The honest qualification,
    // because "artifact" reads as private and is not: on a public repository an artifact is
    // downloadable by any signed-in user, and GitHub's secret masking applies to LOGS, not
    // to artifacts. So this narrows the exposure surface rather than removing it.
    throw new Error(`Judge HTTP ${response.status} from ${model}: ${text.slice(0, 300)}`);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!payload) {
    throw new Error(`Judge (${model}) returned a non-JSON body`);
  }

  const choice = (
    payload as { choices?: { finish_reason?: string; native_finish_reason?: string; message?: { content?: string } }[] }
  ).choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error(`Judge (${model}) response carries no message content`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // finish_reason is in the message because the observed truncations arrive with
    // finish=stop — without it a future reader assumes a max_tokens cut and "fixes" that.
    throw new TruncatedVerdictError(
      `Judge (${model}) verdict is not valid JSON (finish=${choice?.finish_reason}/${choice?.native_finish_reason}): ${content.slice(0, 300)}`,
    );
  }

  const verdict = verdictSchema.safeParse(parsed);
  if (!verdict.success) {
    throw new Error(`Judge (${model}) verdict does not match the schema: ${content.slice(0, 300)}`);
  }
  return verdict.data;
}
