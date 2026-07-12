import * as React from "react";
import { Sparkles, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";

// Source-text hard cap (FR-003) — a business rule enforced on the client and
// re-validated by the endpoint after trim. Count bounds mirror the endpoint.
const SOURCE_MAX = 10_000;
const COUNT_MIN = 1;
const COUNT_MAX = 15;
const NEW_DECK = "__new__";

// Client-side fetch timeout. MUST be longer than the server's OpenRouter timeout
// (~40s) so the server almost always answers first (see the endpoint comment) —
// otherwise a client abort races a server-side save and a retry can double cards.
const CLIENT_TIMEOUT_MS = 55_000;

const LANGUAGES = [
  { value: "auto", label: "Ten sam co tekst" },
  { value: "polski", label: "Polski" },
  { value: "angielski", label: "Angielski" },
  { value: "hiszpański", label: "Hiszpański" },
  { value: "niemiecki", label: "Niemiecki" },
  { value: "francuski", label: "Francuski" },
] as const;

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

const fieldClass = "border-white/20 bg-white/5 text-white placeholder:text-blue-100/40 focus-visible:border-white/40";

// The AI generator island: collect input, POST /api/generate, show progress, a
// retriable error (FR-018) and a READ-ONLY list of saved candidates. Accept/edit/
// reject is deliberately NOT here — that's S-05 (candidate-review).
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
  // The last payload actually sent — "Ponów" re-issues it verbatim (FR-018).
  const lastPayload = React.useRef<GeneratePayload | null>(null);

  const isNewDeck = deckChoice === NEW_DECK;
  const pending = status === "pending";

  function validate(): GeneratePayload | string {
    const text = sourceText.trim();
    if (text.length < 1) return "Wklej tekst źródłowy do wygenerowania fiszek.";
    if (text.length > SOURCE_MAX) return `Tekst źródłowy może mieć najwyżej ${SOURCE_MAX} znaków.`;
    if (count < COUNT_MIN || count > COUNT_MAX) return `Liczba kart musi być w zakresie ${COUNT_MIN}–${COUNT_MAX}.`;

    const base = { sourceText: text, language, count };
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
                <option key={l.value} value={l.value} className="bg-slate-900">
                  {l.label}
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

      {/* Read-only results (S-05 adds accept/edit/reject) */}
      {status === "done" && result && (
        <section aria-label="Wygenerowane fiszki" className="space-y-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-900/20 px-4 py-2 text-sm text-emerald-200">
            Zapisano {result.counts.saved}
            {result.counts.skipped > 0 ? ` / pominięto ${result.counts.skipped}` : ""} — kandydaci trafili do talii jako
            karty do przeglądu.
          </div>
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
