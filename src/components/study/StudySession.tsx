import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import { readJsonResponse } from "@/lib/http";
import type { DueCardView } from "@/lib/study";

// The study session island: reveal the back, rate recall, advance. It holds NO
// scheduling logic — the batch and the four preview intervals are computed
// server-side by the loader (src/pages/study/[publicId].astro), so this component
// only sends the grade and moves on. Mirrors the fetch-JSON state machine of
// GeneratorForm.tsx; there is no timeout apparatus because /api/study is DB-only.
type Status = "idle" | "pending" | "error";

// The success shape of POST /api/study { action: "rate" } (src/pages/api/study.ts:113).
interface RateResponse {
  ok: boolean;
  alreadyApplied: boolean;
}

// Mirrors the endpoint's Zod bound (SIZE_MAX in src/pages/api/study.ts).
const SIZE_MIN = 1;
const SIZE_MAX = 100;

// 1..4 = Again/Hard/Good/Easy, the ts-fsrs Grade values the endpoint whitelists.
// Colour carries the meaning here: the shadcn cva has no Again/Hard/Good/Easy set,
// so each button brings its own palette via className (cn merges it over the base).
const RATINGS = [
  {
    grade: 1,
    label: "Powtórz",
    key: "again",
    className: "border border-red-500/40 bg-red-600/25 text-red-100 hover:bg-red-600/40",
  },
  {
    grade: 2,
    label: "Trudne",
    key: "hard",
    className: "border border-amber-500/40 bg-amber-600/25 text-amber-100 hover:bg-amber-600/40",
  },
  {
    grade: 3,
    label: "Dobre",
    key: "good",
    className: "border border-emerald-500/40 bg-emerald-600/25 text-emerald-100 hover:bg-emerald-600/40",
  },
  {
    grade: 4,
    label: "Łatwe",
    key: "easy",
    className: "border border-sky-500/40 bg-sky-600/25 text-sky-100 hover:bg-sky-600/40",
  },
] as const;

interface Props {
  deckPublicId: string;
  cards: DueCardView[];
  sessionSize: number;
}

const panelClass = "rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl";
const fieldClass = "border-white/20 bg-white/5 text-white placeholder:text-blue-100/40";

// Per-deck session cap. It governs how the NEXT session is built (the current batch
// was already capped server-side), so saving it never disturbs the cards in hand.
function SessionSizeControl({ deckPublicId, sessionSize }: { deckPublicId: string; sessionSize: number }) {
  const [size, setSize] = React.useState(sessionSize);
  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  async function save() {
    if (!Number.isInteger(size) || size < SIZE_MIN || size > SIZE_MAX) {
      setError(`Rozmiar sesji musi być liczbą od ${SIZE_MIN} do ${SIZE_MAX}.`);
      setStatus("error");
      return;
    }
    setStatus("pending");
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setSessionSize", deckPublicId, size }),
      });
      const data = (await res.json()) as { size?: number; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Nie udało się zapisać rozmiaru sesji.");
        setStatus("error");
        return;
      }
      if (typeof data.size === "number") setSize(data.size);
      setSaved(true);
      setStatus("idle");
    } catch {
      setError("Błąd sieci. Spróbuj ponownie.");
      setStatus("error");
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white backdrop-blur-xl">
      <div className="space-y-1">
        <Label htmlFor="session-size" className="text-xs text-blue-100/70">
          Kart na sesję
        </Label>
        <Input
          id="session-size"
          type="number"
          min={SIZE_MIN}
          max={SIZE_MAX}
          value={size}
          onChange={(e) => {
            setSize(Number(e.target.value));
            setSaved(false);
            if (error) setError(null);
          }}
          disabled={status === "pending"}
          className={cn("w-24", fieldClass)}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => void save()}
        disabled={status === "pending"}
        className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
      >
        {status === "pending" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Zapisz
      </Button>
      <p className="text-xs text-blue-100/50" role="status">
        {saved ? "Zapisano — obowiązuje od następnej sesji." : "Obowiązuje od następnej sesji."}
      </p>
      {status === "error" && (
        <div className="w-full">
          <ServerError message={error} />
        </div>
      )}
    </div>
  );
}

export default function StudySession({ deckPublicId, cards, sessionSize }: Props) {
  const [index, setIndex] = React.useState(0);
  const [revealed, setRevealed] = React.useState(false);
  const [reviewed, setReviewed] = React.useState(0);
  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);

  // `finished` (not a null card) is the end-of-session signal: tsconfig has no
  // noUncheckedIndexedAccess, so cards[index] is typed non-nullable and a `!card`
  // guard would be a lie the linter rightly rejects.
  const finished = index >= cards.length;
  const card = cards[index];
  const pending = status === "pending";

  async function rate(grade: number) {
    if (finished) return;
    setStatus("pending");
    setError(null);
    try {
      const res = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rate",
          deckPublicId,
          cardPublicId: card.publicId,
          grade,
          // The optimistic-lock version the card was served with. The server applies
          // the transition only if it still matches, so a double-click or a retried
          // submit can never advance the schedule twice (it answers a benign 200).
          expectedReps: card.reps,
        }),
      });
      const result = await readJsonResponse<RateResponse>(res, "Nie udało się zapisać oceny. Spróbuj ponownie.");
      if (!result.ok) {
        setError(result.message);
        setStatus("error");
        return;
      }
      // Advance only on a genuine JSON success — a client-side guard layered over the
      // server's idempotency, never a substitute for it. This used to branch on `!res.ok`
      // alone, which read a signed-out redirect (followed by fetch to a 200 HTML page) as a
      // successful rating: the card advanced and the counter climbed with no write at all.
      setReviewed((n) => n + 1);
      setRevealed(false);
      setIndex((i) => i + 1);
      setStatus("idle");
    } catch {
      setError("Błąd sieci. Spróbuj ponownie.");
      setStatus("error");
    }
  }

  if (cards.length === 0) {
    return (
      <div className="space-y-4">
        <SessionSizeControl deckPublicId={deckPublicId} sessionSize={sessionSize} />
        <div className={cn(panelClass, "text-center")}>
          <p className="text-blue-100/70">Brak kart należnych dziś.</p>
          <a href="/study" className="mt-4 inline-block text-purple-300 transition-colors hover:text-purple-100">
            Wróć do wyboru talii
          </a>
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className={cn(panelClass, "text-center")}>
        <Check className="mx-auto size-8 text-emerald-300" aria-hidden="true" />
        <p className="mt-3 text-lg font-medium">Sesja zakończona</p>
        <p className="mt-1 text-blue-100/70">
          Powtórzono kart: <span className="tabular-nums">{reviewed}</span>
        </p>
        <a href="/study" className="mt-4 inline-block text-purple-300 transition-colors hover:text-purple-100">
          Wróć do wyboru talii
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SessionSizeControl deckPublicId={deckPublicId} sessionSize={sessionSize} />

      <p className="text-sm text-blue-100/50 tabular-nums" role="status">
        Karta {index + 1} z {cards.length}
      </p>

      <div className={panelClass}>
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-blue-100/50 uppercase">Przód</p>
          <p className="break-words whitespace-pre-wrap">{card.front}</p>
        </div>

        {revealed && (
          <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
            <p className="text-xs font-medium tracking-wide text-blue-100/50 uppercase">Tył</p>
            <p className="break-words whitespace-pre-wrap text-blue-100/90">{card.back}</p>
          </div>
        )}
      </div>

      {status === "error" && <ServerError message={error} />}

      {revealed ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {RATINGS.map((rating) => (
            <Button
              key={rating.grade}
              type="button"
              onClick={() => void rate(rating.grade)}
              disabled={pending}
              className={cn("h-auto flex-col gap-0.5 py-3", rating.className)}
            >
              <span className="font-medium">{rating.label}</span>
              <span className="text-xs opacity-80">{card.intervals[rating.key]}</span>
            </Button>
          ))}
        </div>
      ) : (
        <Button
          type="button"
          onClick={() => {
            setRevealed(true);
          }}
          className="w-full"
        >
          Pokaż odpowiedź
        </Button>
      )}
    </div>
  );
}
