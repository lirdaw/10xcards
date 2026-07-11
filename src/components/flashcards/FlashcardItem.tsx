import * as React from "react";
import { Pencil, Trash2, Save, X } from "lucide-react";
import type { FlashcardView } from "@/lib/flashcards";
import { FRONT_MAX, BACK_MAX } from "@/lib/flashcards";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { cn } from "@/lib/utils";

// A single card in the deck workspace. Read-only by default; toggles into an
// inline edit form (front/back textareas + Save/Cancel) when `editing` is true.
// The edit save is a native form POST → redirect, so the S-01 error round-trip and
// RLS still apply. Per-card delete is delegated up to the workspace via `onDelete`.
interface Props {
  card: FlashcardView;
  // 1-based position in the displayed list (created_at desc) — the "Lp." ordinal.
  index: number;
  deckPublicId: string;
  // True when this card is the one in inline-edit mode (workspace owns which).
  editing: boolean;
  // Seeded once when this card re-enters edit mode after a server round-trip
  // error (?error=&edit=<publicId>); shown inside the edit form.
  serverError?: string | null;
  // True right after this card's edit saved (?saved=<publicId>) — plays a one-shot
  // settle animation as it renders back in read-only view (reverse of the edit
  // entrance), so the post-save page reload lands smoothly instead of snapping.
  justSaved?: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

// Live character counter shown under an edit field: muted normally, red once the
// entered length passes the limit (mirrors CreateFlashcardModal's counter).
function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <p className={cn("text-right text-xs tabular-nums", over ? "text-red-400" : "text-blue-100/50")}>
      {value.length} / {max}
    </p>
  );
}

export function FlashcardItem({
  card,
  index,
  deckPublicId,
  editing,
  serverError = null,
  justSaved = false,
  onEdit,
  onCancelEdit,
  onDelete,
}: Props) {
  const [front, setFront] = React.useState(card.front);
  const [back, setBack] = React.useState(card.back);
  // Seeded once from the round-trip error; cleared on edit or cancel.
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
      // Same fixed-height flex column as the read-only view, so switching in and
      // out of edit mode never changes the card's footprint.
      <li className={`${containerClass} flex h-[40rem] flex-col`}>
        <form
          method="POST"
          action={`/api/decks/${deckPublicId}/cards/${card.publicId}`}
          // Quick, smooth entrance (fade + subtle scale-up) so switching into edit
          // mode — where the fields equalise height — reads as a gentle reveal
          // rather than a hard jump. Disabled under prefers-reduced-motion.
          className="animate-in fade-in zoom-in-95 flex flex-1 flex-col gap-3 duration-200 ease-out motion-reduce:animate-none"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-3">
            <span className="inline-flex shrink-0 items-center rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium text-blue-100/70">
              Lp. {index}
            </span>
            <span className="text-xs text-blue-100/50">Edycja fiszki</span>
          </div>

          {/* Front + back share the remaining height (flex-1) so the fields fill
              the card and the buttons stay pinned to the bottom — no dead space. */}
          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <Label htmlFor={`card-front-${card.publicId}`}>Przód</Label>
            <Textarea
              id={`card-front-${card.publicId}`}
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
            <Label htmlFor={`card-back-${card.publicId}`}>Tył</Label>
            <Textarea
              id={`card-back-${card.publicId}`}
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

          {/* Identical footer shape to the read-only view (shrink-0 + border-t +
              grid-cols-2) so the button row occupies the same area in both modes. */}
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

  return (
    // Fixed-height card so every row is uniform regardless of content length. The
    // header (meta) and footer (actions) stay put; only the front/back area between
    // them scrolls when the text overflows. `justSaved` plays the same fade+zoom
    // entrance as the edit form, so returning to read-only after a save settles
    // smoothly. Disabled under reduced-motion.
    <li
      className={cn(
        containerClass,
        "flex h-[40rem] flex-col",
        justSaved && "animate-in fade-in zoom-in-95 duration-200 ease-out motion-reduce:animate-none",
      )}
    >
      {/* Meta row (fixed): ordinal on the left, timestamps on the right, kept
          visually secondary to the front/back content below. */}
      <div className="mb-3 flex shrink-0 items-start justify-between gap-3 border-b border-white/10 pb-3">
        <span className="inline-flex shrink-0 items-center rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium text-blue-100/70">
          Lp. {index}
        </span>
        {/* Two-column mini-table pinned to the right of the card: labels right-
            aligned (colons line up), dates left-aligned (values start on the same
            column). Both rows always render (Edytowano shows „—" until first edit)
            so the block is a constant height. */}
        <div className="grid grid-cols-[auto_auto] gap-x-2 text-xs leading-snug text-blue-100/50">
          <span className="text-right">Utworzono:</span>
          <span>{card.createdAtLabel}</span>
          <span className="text-right">Edytowano:</span>
          <span>{card.edited ? card.updatedAtLabel : "—"}</span>
        </div>
      </div>
      {/* Only this front/back region scrolls (custom-scrollbar) when the content
          overflows the fixed card height; header and footer stay fixed. */}
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
      {/* Footer (fixed) mirrors the edit view (border-t + grid-cols-2 with
          full-width buttons) so toggling edit mode doesn't shift the button row. */}
      <div className="mt-3 grid shrink-0 grid-cols-2 gap-2 border-t border-white/10 pt-4">
        <Button
          variant="outline"
          className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          onClick={onEdit}
        >
          <Pencil className="size-4" />
          Edytuj
        </Button>
        <Button variant="destructive" className="w-full" onClick={onDelete}>
          <Trash2 className="size-4" />
          Usuń
        </Button>
      </div>
    </li>
  );
}
