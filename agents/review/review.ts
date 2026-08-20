import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  REVIEW_SCHEMA,
  REVIEW_JSON_SCHEMA,
  SYSTEM_PROMPT,
  type Review,
} from "./review-schema.ts";

/** Diff wjeżdża przez stdin: `git diff | npx tsx review.ts` */
async function readDiff(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function review(diff: string): Promise<Review> {
  const result = query({
    prompt: `Zrecenzuj ten diff:\n\n${diff}`,
    options: {
      systemPrompt: SYSTEM_PROMPT, // własna rola zamiast presetu claude_code
      model: "sonnet", // alias — dobór modelu do roli; recenzja nie potrzebuje Opusa
      tools: [], // ODCINAMY narzędzia: recenzja ma być wąska i przewidywalna
      maxTurns: 2, // tura 1: model czyta i ocenia | tura 2: emituje JSON wg schematu
      outputFormat: { type: "json_schema", schema: REVIEW_JSON_SCHEMA },
    },
  });

  for await (const message of result) {
    if (message.type !== "result") continue;

    if (message.subtype === "success") {
      // structured_output jest typowane jako unknown — parsujemy po swojemu,
      // żeby mieć gwarancję typu Review, a nie samą obietnicę SDK.
      const parsed = REVIEW_SCHEMA.safeParse(message.structured_output);
      if (!parsed.success) {
        throw new Error(`Niepoprawny structured output: ${parsed.error.message}`);
      }

      // Metryki operacyjne — na stderr, żeby nie brudzić JSON-a na stdout.
      console.error(
        [
          `[metryki] tury: ${message.num_turns}`,
          `czas: ${message.duration_ms} ms`,
          `koszt: ${message.total_cost_usd ?? "n/d"} USD`,
          `tokeny: ${message.usage?.input_tokens ?? "?"} in (bez cache)`,
          `cache: ${message.usage?.cache_creation_input_tokens ?? "?"} zapis / ${message.usage?.cache_read_input_tokens ?? "?"} odczyt`,
          `out: ${message.usage?.output_tokens ?? "?"}`,
        ].join(" | ")
      );

      return parsed.data;
    }

    // Błąd łapiemy sami — inaczej SDK rzuci surowym wyjątkiem zamiast czytelnego komunikatu.
    throw new Error(
      `Review nie powiodło się (${message.subtype}): ${message.errors?.join("; ") ?? "brak szczegółów"}`
    );
  }

  throw new Error("Agent nie zwrócił wyniku");
}

const diff = await readDiff();
if (!diff.trim()) {
  console.error("Pusty diff na wejściu. Użyj: git diff | npx tsx review.ts");
  process.exit(1);
}
console.log(JSON.stringify(await review(diff), null, 2));
