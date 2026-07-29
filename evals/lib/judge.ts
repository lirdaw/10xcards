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
// with EVAL_JUDGE_MODEL in the same shell env as the key.
//
// Failure contract (plan "Phase 2 / Judge client"): a 429/5xx or transport error retries
// ONCE with a short backoff — a transient blip mid-run would otherwise abort after the 10
// paid generation calls. Anything else (other HTTP status, non-JSON body, schema
// mismatch) throws immediately: an unreachable judge must never read as a verdict, and a
// retry is not a substituted verdict.

const JUDGE_MODEL_DEFAULT = "google/gemini-2.5-flash";
const RETRY_BACKOFF_MS = 3_000;

export interface JudgeInput {
  front: string;
  back: string;
  /** The source text the card was generated from (grounding for the rubric). */
  sourceExcerpt: string;
  /** Human-readable language name as shown in the app's selector, e.g. "hiszpański". */
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
      response = await fetch(OPENROUTER_URL, init);
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

export async function judgeCard(input: JudgeInput): Promise<CardVerdict> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // Unreachable when the eval preflight ran; kept so a direct import fails loudly too.
    throw new Error("Judge has no OPENROUTER_API_KEY in process.env (see evals/setup/eval-preflight.ts)");
  }
  const model = process.env.EVAL_JUDGE_MODEL ?? JUDGE_MODEL_DEFAULT;

  const body = {
    model,
    messages: [
      { role: "system", content: judgeSystemPrompt(input.expectedLanguage) },
      { role: "user", content: judgeUserPrompt(input) },
    ],
    temperature: 0,
    max_tokens: 500,
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
    throw new Error(`Judge HTTP ${response.status} from ${model}: ${text.slice(0, 300)}`);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!payload) {
    throw new Error(`Judge (${model}) returned a non-JSON body`);
  }

  const content = (payload as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error(`Judge (${model}) response carries no message content`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Judge (${model}) verdict is not valid JSON: ${content.slice(0, 300)}`);
  }

  const verdict = verdictSchema.safeParse(parsed);
  if (!verdict.success) {
    throw new Error(`Judge (${model}) verdict does not match the schema: ${content.slice(0, 300)}`);
  }
  return verdict.data;
}
