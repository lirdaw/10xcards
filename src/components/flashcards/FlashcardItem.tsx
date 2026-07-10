import type { FlashcardView } from "@/lib/flashcards";

// A single card in the deck workspace. Phase 2 renders front/back read-only; the
// inline-edit form and the per-card delete control are added in Phase 3, in this
// same file, behind the workspace's `editId` round-trip.
interface Props {
  card: FlashcardView;
  // 1-based position in the displayed list (created_at desc) — the "Lp." ordinal.
  index: number;
}

export function FlashcardItem({ card, index }: Props) {
  return (
    <li className="rounded-2xl border border-white/10 bg-white/10 p-5 text-white backdrop-blur-xl">
      {/* Meta row: ordinal on the left, timestamps on the right, kept visually
          secondary to the front/back content below. */}
      <div className="mb-3 flex items-start justify-between gap-3 border-b border-white/10 pb-3">
        <span className="inline-flex shrink-0 items-center rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium text-blue-100/70">
          Lp. {index}
        </span>
        <div className="text-right text-xs leading-snug text-blue-100/50">
          <div>Utworzono: {card.createdAtLabel}</div>
          {card.edited && <div>Edytowano: {card.updatedAtLabel}</div>}
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-wide text-blue-100/50 uppercase">Przód</p>
        <p className="break-words whitespace-pre-wrap">{card.front}</p>
      </div>
      <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
        <p className="text-xs font-medium tracking-wide text-blue-100/50 uppercase">Tył</p>
        <p className="break-words whitespace-pre-wrap text-blue-100/90">{card.back}</p>
      </div>
    </li>
  );
}
