import * as React from "react";
import { Pencil, Save, X } from "lucide-react";
import type { FlashcardView } from "@/lib/flashcards";
import { FRONT_MAX, BACK_MAX } from "@/lib/flashcards";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";
import type { SelectionAction } from "./CandidateSelectionBar";

// One candidate on the review screen. Same fixed-height, three-region shape as the
// deck view's FlashcardItem (meta / scrolling content / action footer) so the two
// screens read as one product — but a distinct component, because what a candidate
// carries differs: a selection checkbox, state + source badges, and lifecycle actions
// instead of delete.
//
// The inline edit form is the SAME native POST → redirect round-trip the deck view
// uses (no fetch), with two extra hidden fields: `from=review` and the generation
// scope. The endpoint builds the redirect target from its own validated route params,
// so `from` is a switch, never a URL (see cards/[cardPublicId].ts).
interface Props {
  card: FlashcardView;
  // 1-based position in the displayed list (created_at desc) — the "Lp." ordinal.
  index: number;
  deckPublicId: string;
  // The `?generation=` scope to carry through an edit round-trip, so the save lands
  // back on the same narrowed review screen. Null when the screen is unscoped.
  generationPublicId: string | null;
  editing: boolean;
  // Seeded once when this card re-enters edit mode after a server round-trip error
  // (?error=&edit=<publicId>); shown inside the edit form.
  serverError?: string | null;
  // True right after this card's edit saved (?saved=<publicId>) — plays the one-shot
  // settle animation as it renders back in read-only view.
  justSaved?: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  // Lifecycle actions for the current view (Akceptuj/Odrzuć, or Przywróć), applied to
  // this card alone. Same shape as the bulk bar's, because they are the same writes —
  // a single-card action is a one-element batch, so the per-card record that produces
  // the acceptance metric is identical on both paths.
  actions: SelectionAction[];
  // True while a batch call is in flight anywhere on the screen.
  pending?: boolean;
}

const STATE_BADGE: Record<NonNullable<FlashcardView["state"]>, { label: string; className: string }> = {
  generated: { label: "Do przeglądu", className: "border-amber-400/40 bg-amber-500/15 text-amber-100" },
  accepted: { label: "Zaakceptowana", className: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100" },
  rejected: { label: "Odrzucona", className: "border-red-400/40 bg-red-500/15 text-red-100" },
};

const SOURCE_BADGE: Record<NonNullable<FlashcardView["source"]>, string> = {
  ai: "AI",
  manual: "Ręczna",
};

// Live character counter shown under an edit field (mirrors FlashcardItem's).
function CharCount({ value, max }: { value: string; max: number }) {
  const len = value.trim().length;
  const over = len > max;
  return (
    <p className={cn("text-right text-xs tabular-nums", over ? "text-red-400" : "text-blue-100/50")}>
      {len} / {max}
    </p>
  );
}

export function CandidateItem({
  card,
  index,
  deckPublicId,
  generationPublicId,
  editing,
  serverError = null,
  justSaved = false,
  selected,
  onToggleSelect,
  onEdit,
  onCancelEdit,
  actions,
  pending = false,
}: Props) {
  const [front, setFront] = React.useState(card.front);
  const [back, setBack] = React.useState(card.back);
  const [error, setError] = React.useState<string | null>(serverError);

  function handleCancel() {
    setFront(card.front);
    setBack(card.back);
    setError(null);
    onCancelEdit();
  }

  // Length limits are the business rule imported from the data helper (not a DB
  // CHECK); the endpoint re-validates after trim as the real backstop.
  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    const f = front.trim();
    if (f.length < 1 || f.length > FRONT_MAX) {
      e.preventDefault();
      setError(`Przód fiszki musi mieć od 1 do ${FRONT_MAX} znaków`);
      return;
    }
    const b = back.trim();
    if (b.length < 1 || b.length > BACK_MAX) {
      e.preventDefault();
      setError(`Tył fiszki musi mieć od 1 do ${BACK_MAX} znaków`);
    }
  }

  const containerClass = "rounded-2xl border border-white/10 bg-white/10 p-5 text-white backdrop-blur-xl";

  if (editing) {
    return (
      // Same fixed height as the read-only view, so switching in and out of edit mode
      // never changes the card's footprint.
      <li className={`${containerClass} flex h-[40rem] flex-col`}>
        <form
          method="POST"
          action={`/api/decks/${deckPublicId}/cards/${card.publicId}`}
          className="animate-in fade-in zoom-in-95 flex flex-1 flex-col gap-3 duration-200 ease-out motion-reduce:animate-none"
          onSubmit={handleSubmit}
          noValidate
        >
          {/* The redirect switch: the endpoint accepts exactly the literal "review"
              and rebuilds the target from its own route params, so nothing here can
              steer the Location header. */}
          <input type="hidden" name="from" value="review" />
          {generationPublicId && <input type="hidden" name="generation" value={generationPublicId} />}

          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-3">
            <span className="inline-flex shrink-0 items-center rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium text-blue-100/70">
              Lp. {index}
            </span>
            <span className="text-xs text-blue-100/50">Edycja fiszki</span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <Label htmlFor={`candidate-front-${card.publicId}`}>Przód</Label>
            <Textarea
              id={`candidate-front-${card.publicId}`}
              name="front"
              value={front}
              onChange={(e) => {
                setFront(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              aria-invalid={error ? true : undefined}
              className="custom-scrollbar min-h-20 flex-1 resize-none overflow-y-auto border-white/20 bg-white/5 text-white placeholder:text-blue-100/40"
            />
            <CharCount value={front} max={FRONT_MAX} />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <Label htmlFor={`candidate-back-${card.publicId}`}>Tył</Label>
            <Textarea
              id={`candidate-back-${card.publicId}`}
              name="back"
              value={back}
              onChange={(e) => {
                setBack(e.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error ? true : undefined}
              className="custom-scrollbar min-h-24 flex-1 resize-none overflow-y-auto border-white/20 bg-white/5 text-white placeholder:text-blue-100/40"
            />
            <CharCount value={back} max={BACK_MAX} />
          </div>

          <ServerError message={error} />

          <div className="mt-3 grid shrink-0 grid-cols-2 gap-2 border-t border-white/10 pt-4">
            <Button
              type="button"
              variant="outline"
              className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={handleCancel}
            >
              <X className="size-4" />
              Anuluj
            </Button>
            <SubmitButton pendingText="Zapisywanie..." icon={<Save className="size-4" />}>
              Zapisz
            </SubmitButton>
          </div>
        </form>
      </li>
    );
  }

  const stateBadge = card.state ? STATE_BADGE[card.state] : null;
  const sourceBadge = card.source ? SOURCE_BADGE[card.source] : null;

  return (
    <li
      className={cn(
        containerClass,
        "flex h-[40rem] flex-col",
        selected && "border-purple-400/60 ring-1 ring-purple-400/40",
        justSaved && "animate-in fade-in zoom-in-95 duration-200 ease-out motion-reduce:animate-none",
      )}
    >
      {/* Meta row (fixed): checkbox + ordinal on the left, badges and timestamps on
          the right. A bare <input type="checkbox"> on purpose — consistent with the
          bare <select> elsewhere, and no ui/ primitive is vendored for one consumer. */}
      <div className="mb-3 flex shrink-0 items-start justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            disabled={pending}
            aria-label={`Zaznacz fiszkę ${String(index)}`}
            className="size-4 accent-purple-500"
          />
          <span className="inline-flex shrink-0 items-center rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium text-blue-100/70">
            Lp. {index}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap items-center justify-end gap-1">
            {stateBadge && (
              <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", stateBadge.className)}>
                {stateBadge.label}
              </span>
            )}
            {sourceBadge && (
              <span className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-medium text-blue-100/70">
                {sourceBadge}
              </span>
            )}
          </div>
          <div className="grid grid-cols-[auto_auto] gap-x-2 text-xs leading-snug text-blue-100/50">
            <span className="text-right">Utworzono:</span>
            <span>{card.createdAtLabel}</span>
            <span className="text-right">Edytowano:</span>
            <span>{card.edited ? card.updatedAtLabel : "—"}</span>
          </div>
        </div>
      </div>

      {/* Only this front/back region scrolls when the content overflows the fixed
          card height; header and footer stay fixed. */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-blue-100/50 uppercase">Przód</p>
          <p className="break-words whitespace-pre-wrap">{card.front}</p>
        </div>
        <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
          <p className="text-xs font-medium tracking-wide text-blue-100/50 uppercase">Tył</p>
          <p className="break-words whitespace-pre-wrap text-blue-100/90">{card.back}</p>
        </div>
      </div>

      {/* Footer (fixed): the lifecycle actions for this view, plus Edytuj. Same
          border-t + grid shape as the edit view, so toggling modes doesn't shift it. */}
      <div
        className={cn(
          "mt-3 grid shrink-0 gap-2 border-t border-white/10 pt-4",
          actions.length >= 2 ? "grid-cols-3" : "grid-cols-2",
        )}
      >
        {actions.map((action) => (
          <Button
            key={action.label}
            type="button"
            onClick={action.onRun}
            disabled={pending}
            className={cn("w-full", action.className)}
          >
            {action.icon}
            {action.label}
          </Button>
        ))}
        <Button
          variant="outline"
          className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          onClick={onEdit}
          disabled={pending}
        >
          <Pencil className="size-4" />
          Edytuj
        </Button>
      </div>
    </li>
  );
}
