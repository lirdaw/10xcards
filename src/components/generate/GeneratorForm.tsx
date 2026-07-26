import * as React from "react";
import { Sparkles, Loader2, RotateCw, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import { SOURCE_MAX, COUNT_MIN, COUNT_MAX, LANGUAGES, type Language } from "@/lib/generation-limits";

// SOURCE_MAX / COUNT_MIN / COUNT_MAX / LANGUAGES are IMPORTED, not redeclared: this file
// used to carry its own copies of all four against src/pages/api/generate.ts, so the
// client guard and the server schema could drift apart silently (test-plan §2 Risk #6).
// The endpoint imports the same module, so the two ends now move together.
const NEW_DECK = "__new__";

// Client-side fetch timeout. MUST be longer than the server's OpenRouter timeout (~40s)
// so the server almost always answers first (see the endpoint comment). The residual
// window — client aborts while the server is still committing — is closed by the
// idempotency key below, not by this ordering, which only ever narrowed it.
const CLIENT_TIMEOUT_MS = 55_000;

// The lib exports VALUES; the labels are UI and stay here. Typing the map by the
// `Language` union is what keeps them in step: add a language to generation-limits.ts
// without a label and this object stops compiling.
const LANGUAGE_LABELS: Record<Language, string> = {
  auto: "Ten sam co tekst",
  polski: "Polski",
  angielski: "Angielski",
  hiszpański: "Hiszpański",
  niemiecki: "Niemiecki",
  francuski: "Francuski",
};

interface DeckOption {
  publicId: string;
  name: string;
}

interface Props {
  decks: DeckOption[];
}

interface Candidate {
  front: string;
  back: string;
}

interface Counts {
  generated: number;
  saved: number;
  skipped: number;
}

interface GeneratePayload {
  deckPublicId?: string;
  newDeckName?: string;
  sourceText: string;
  language: string;
  count: number;
  /**
   * One key per ATTEMPT, not per request — minted on submit and replayed unchanged by
   * "Ponów", which is what lets the server recognise the retry as the same attempt and
   * answer with the cards it already saved (test-plan §2 Risk #2). A fresh submit mints
   * a fresh key: regenerating the same text on purpose is not a duplicate.
   */
  idempotencyKey: string;
}

interface SuccessResponse {
  candidates: Candidate[];
  counts: Counts;
  deckPublicId: string;
  sessionPublicId: string;
}

interface ErrorResponse {
  error: string;
  retriable?: boolean;
}

type Status = "idle" | "pending" | "error" | "done";

// Live character counter: muted normally, red once over the limit — same pattern as
// the manual-card modal so the two flows read consistently.
function CharCount({ value, max }: { value: string; max: number }) {
  const len = value.trim().length;
  const over = len > max;
  return (
    <p className={cn("text-right text-xs tabular-nums", over ? "text-red-400" : "text-blue-100/50")}>
      {len} / {max}
    </p>
  );
}

const fieldClass = "border-white/20 bg-white/5 text-white placeholder:text-blue-100/40";

// The AI generator island: collect input, POST /api/generate, show progress, a
// retriable error (FR-018) and a READ-ONLY list of saved candidates, with a link to
// the review screen where they are accepted, edited or rejected. Curation itself is
// deliberately NOT here — the results below live in React state only, so anything
// actionable had to move to a server-rendered screen (S-05, /decks/<id>/review).
export function GeneratorForm({ decks }: Props) {
  const hasDecks = decks.length > 0;
  const [deckChoice, setDeckChoice] = React.useState<string>(hasDecks ? decks[0].publicId : NEW_DECK);
  const [newDeckName, setNewDeckName] = React.useState("");
  const [language, setLanguage] = React.useState<string>("auto");
  const [count, setCount] = React.useState(5);
  const [sourceText, setSourceText] = React.useState("");

  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SuccessResponse | null>(null);
  // True once a real generation was attempted, so "Ponów" shows only for generation
  // failures — never for a pure client-side validation error (a ref, read below,
  // must not be accessed during render, hence a separate flag).
  const [canRetry, setCanRetry] = React.useState(false);
  // The last payload actually sent — "Ponów" re-issues it VERBATIM (FR-018), which is
  // load-bearing twice over: it is what makes the retry a retry for the user, and what
  // carries the same idempotencyKey so the server can recognise it as one attempt rather
  // than two. Do not rebuild the payload on retry.
  const lastPayload = React.useRef<GeneratePayload | null>(null);

  const isNewDeck = deckChoice === NEW_DECK;
  const pending = status === "pending";

  function validate(): GeneratePayload | string {
    const text = sourceText.trim();
    if (text.length < 1) return "Wklej tekst źródłowy do wygenerowania fiszek.";
    if (text.length > SOURCE_MAX) return `Tekst źródłowy może mieć najwyżej ${SOURCE_MAX} znaków.`;
    if (count < COUNT_MIN || count > COUNT_MAX) return `Liczba kart musi być w zakresie ${COUNT_MIN}–${COUNT_MAX}.`;

    // The key is minted here, once per submit, so both branches below carry it and
    // "Ponów" (which re-sends lastPayload.current verbatim) reuses the same one.
    const base = { sourceText: text, language, count, idempotencyKey: crypto.randomUUID() };
    if (isNewDeck) {
      const name = newDeckName.trim();
      if (name.length < 1 || name.length > 100) return "Nazwa nowej talii musi mieć od 1 do 100 znaków.";
      return { ...base, newDeckName: name };
    }
    if (!deckChoice) return "Wybierz talię docelową.";
    return { ...base, deckPublicId: deckChoice };
  }

  async function runGeneration(payload: GeneratePayload) {
    lastPayload.current = payload;
    setCanRetry(true);
    setStatus("pending");
    setError(null);
    setResult(null);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, CLIENT_TIMEOUT_MS);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = (await res.json()) as SuccessResponse | ErrorResponse;
      if (!res.ok) {
        setError("error" in data ? data.error : "Nie udało się wygenerować fiszek. Spróbuj ponownie.");
        setStatus("error");
        return;
      }
      setResult(data as SuccessResponse);
      setStatus("done");
    } catch {
      // AbortError (client timeout) or a network failure — both retriable.
      setError("Przekroczono czas oczekiwania lub błąd sieci. Spróbuj ponownie.");
      setStatus("error");
    } finally {
      clearTimeout(timer);
    }
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const validated = validate();
    if (typeof validated === "string") {
      setCanRetry(false);
      setError(validated);
      setStatus("error");
      return;
    }
    void runGeneration(validated);
  }

  function handleRetry() {
    if (lastPayload.current) void runGeneration(lastPayload.current);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Deck target */}
          <div className="space-y-2">
            <Label htmlFor="gen-deck">Talia docelowa</Label>
            <select
              id="gen-deck"
              value={deckChoice}
              onChange={(e) => {
                setDeckChoice(e.target.value);
                if (error) setError(null);
              }}
              disabled={pending}
              className={cn("h-9 w-full rounded-md border px-3 text-sm", fieldClass)}
            >
              {decks.map((d) => (
                <option key={d.publicId} value={d.publicId} className="bg-slate-900">
                  {d.name}
                </option>
              ))}
              <option value={NEW_DECK} className="bg-slate-900">
                + Nowa talia
              </option>
            </select>
          </div>

          {/* Language */}
          <div className="space-y-2">
            <Label htmlFor="gen-language">Język fiszek</Label>
            <select
              id="gen-language"
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
              }}
              disabled={pending}
              className={cn("h-9 w-full rounded-md border px-3 text-sm", fieldClass)}
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l} className="bg-slate-900">
                  {LANGUAGE_LABELS[l]}
                </option>
              ))}
            </select>
          </div>

          {/* Count */}
          <div className="space-y-2">
            <Label htmlFor="gen-count">Liczba kart</Label>
            <Input
              id="gen-count"
              type="number"
              min={COUNT_MIN}
              max={COUNT_MAX}
              value={count}
              onChange={(e) => {
                setCount(Number(e.target.value));
              }}
              disabled={pending}
              className={fieldClass}
            />
          </div>
        </div>

        {/* Inline new-deck name */}
        {isNewDeck && (
          <div className="space-y-2">
            <Label htmlFor="gen-new-deck">Nazwa nowej talii</Label>
            <Input
              id="gen-new-deck"
              value={newDeckName}
              onChange={(e) => {
                setNewDeckName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="np. Biologia — fotosynteza"
              autoComplete="off"
              maxLength={100}
              disabled={pending}
              className={fieldClass}
            />
          </div>
        )}

        {/* Source text */}
        <div className="space-y-2">
          <Label htmlFor="gen-source">Tekst źródłowy</Label>
          <Textarea
            id="gen-source"
            value={sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Wklej notatki, fragment podręcznika lub artykułu…"
            // Two different mechanisms on two different strings, deliberately (impl-review
            // F6 asked whether this is a bug — it is not, but it was undocumented).
            // `maxLength` is the browser's INPUT STOP and can only count raw characters;
            // everything that VALIDATES counts the trimmed string, because trimmed is what
            // `validate()` actually submits (`sourceText: text`) and therefore what the
            // server's cap will see: this attribute, `CharCount`, and validate()'s own
            // check all agree on `.trim()`. Consequence worth knowing before writing a test
            // against it: with `maxLength` in place neither the aria-invalid state nor
            // CharCount's red state is reachable through the UI — they are a second belt,
            // not the visible guard (test-plan §7).
            maxLength={SOURCE_MAX}
            disabled={pending}
            aria-invalid={sourceText.trim().length > SOURCE_MAX ? true : undefined}
            className={cn("custom-scrollbar max-h-[28rem] min-h-48 resize-none overflow-y-auto", fieldClass)}
          />
          <CharCount value={sourceText} max={SOURCE_MAX} />
        </div>

        {status === "error" && <ServerError message={error} />}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending} className="gap-2">
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" aria-hidden="true" />
            )}
            {pending ? "Generuję…" : "Generuj"}
          </Button>
          {status === "error" && canRetry && (
            <Button
              type="button"
              variant="outline"
              onClick={handleRetry}
              disabled={pending}
              className="gap-2 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <RotateCw className="size-4" aria-hidden="true" />
              Ponów
            </Button>
          )}
          {pending && (
            <span role="status" className="text-sm text-blue-100/70">
              Trwa generacja — to może potrwać kilka sekund.
            </span>
          )}
        </div>
      </form>

      {/* An immediate read-only preview of what was saved, plus the link that closes
          the loop: accept/edit/reject happens on the review screen, which is
          server-rendered and therefore survives the reload this list does not. */}
      {status === "done" && result && (
        <section aria-label="Wygenerowane fiszki" className="space-y-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-900/20 px-4 py-2 text-sm text-emerald-200">
            Zapisano {result.counts.saved}
            {result.counts.skipped > 0 ? ` / pominięto ${result.counts.skipped}` : ""} — kandydaci trafili do talii jako
            karty do przeglądu.
          </div>
          <a
            href={`/decks/${result.deckPublicId}/review?generation=${result.sessionPublicId}`}
            className="inline-flex items-center gap-2 rounded-md border border-purple-400/50 bg-purple-600/50 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-purple-500/20 transition-colors hover:bg-purple-600/70"
          >
            <ListChecks className="size-4" aria-hidden="true" />
            Przejrzyj kandydatów
          </a>
          <ul className="space-y-3">
            {result.candidates.map((c, i) => (
              <li key={i} className="rounded-2xl border border-white/10 bg-white/10 p-4 text-white backdrop-blur-xl">
                <p className="font-medium break-words">{c.front}</p>
                <p className="mt-1 break-words text-blue-100/70">{c.back}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
