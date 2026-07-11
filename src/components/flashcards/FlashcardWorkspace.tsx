import * as React from "react";
import type { FlashcardView } from "@/lib/flashcards";
import { DeckContentToolbar } from "./DeckContentToolbar";
import { FlashcardItem } from "./FlashcardItem";
import { CreateFlashcardModal } from "./CreateFlashcardModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

interface Props {
  deckPublicId: string;
  // Server-loaded cards in the helper's default order (created_at desc).
  cards: FlashcardView[];
  // Re-open the create modal after a server round-trip error (?open=create-card).
  defaultOpenCreate?: boolean;
  // Server-side create error, shown inside the re-opened create modal.
  serverError?: string | null;
  // The card public_id to re-enter inline-edit mode after an edit round-trip
  // error (?error=&edit=<publicId>).
  editId?: string | null;
  // Server-side edit error, shown inside the re-opened inline-edit form.
  editError?: string | null;
  // The card whose edit just saved — it plays a one-shot settle animation as it
  // renders back in read-only view (the reverse of the edit-form entrance).
  savedId?: string | null;
  // True when the loader's card query failed — renders a distinct error state
  // rather than the empty copy (lessons: SSR error-vs-empty).
  cardsError?: boolean;
}

// The single client island for the card workspace: owns the create-modal open
// state, which card (if any) is in inline-edit mode, and which card (if any) is
// pending delete confirmation. Renders the content toolbar, the card list, the
// create modal, and the delete-confirm modal. Mutations stay as native form POSTs
// from the child components, so the slice keeps S-01's no-fetch, redirect-driven
// model.
export default function FlashcardWorkspace({
  deckPublicId,
  cards,
  defaultOpenCreate = false,
  serverError = null,
  editId = null,
  editError = null,
  savedId = null,
  cardsError = false,
}: Props) {
  const [createOpen, setCreateOpen] = React.useState(defaultOpenCreate);
  // Which card is in inline-edit mode; seeded from the round-trip `edit` param.
  const [activeEditId, setActiveEditId] = React.useState<string | null>(editId);
  // Which card is pending delete confirmation (null = modal closed).
  const [deleteCard, setDeleteCard] = React.useState<FlashcardView | null>(null);

  // Consume the round-trip params once and strip them so a reload doesn't reopen
  // a stale modal/edit (as CreateDeckModal does).
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (
      url.searchParams.has("open") ||
      url.searchParams.has("edit") ||
      url.searchParams.has("error") ||
      url.searchParams.has("saved")
    ) {
      url.searchParams.delete("open");
      url.searchParams.delete("edit");
      url.searchParams.delete("error");
      url.searchParams.delete("saved");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  return (
    <div>
      {/* Sticky content toolbar: kept OUTSIDE the decorative panel because that
          panel sets `overflow: hidden` (to clip its sheen/starfield), which would
          break `position: sticky`. `top-16` sits flush under the sticky deck
          header (h-16) so the two stick as one contiguous block with no gap — any
          margin between them would reintroduce the scroll "jump" and let cards
          peek through. Breathing room is padding (inside the bar), not margin.
          bg-cosmic occludes cards scrolling underneath. The `::after` gradient
          strip below the bar fades cards out as they scroll up under it, so they
          "melt" into the toolbar instead of vanishing at a hard edge. */}
      <div className="bg-cosmic sticky top-16 z-10 pt-3 pb-2 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-gradient-to-b after:from-[#0a0e1a] after:to-transparent after:content-['']">
        <DeckContentToolbar
          onAddCard={() => {
            setCreateOpen(true);
          }}
        />
      </div>

      {/* Card grid lives inside this grouping panel, visually separated from the
          deck-level actions in the sticky header above. `mt-6` matches the toolbar's
          `::after` fade height (h-6) so at rest the fade sits in the gap ABOVE the
          panel, not over the cards — the darkening only shows once cards scroll up
          into it. */}
      <section className="flashcard-panel mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl sm:p-5">
        {cardsError ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-900/30 p-8 text-center backdrop-blur-xl">
            <p className="text-red-300">Nie udało się wczytać fiszek. Spróbuj ponownie później.</p>
          </div>
        ) : cards.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white">
            <p className="text-blue-100/70">Brak fiszek w tej talii.</p>
          </div>
        ) : (
          // Row-major grid; columns scale with viewport width: 3 at ~half a 4K
          // screen (≥xl), doubling to 6 on a full 3840px display.
          <ul className="grid grid-cols-1 gap-3 min-[2560px]:grid-cols-4 min-[3200px]:grid-cols-5 min-[3800px]:grid-cols-6 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card, i) => (
              <FlashcardItem
                key={card.publicId}
                card={card}
                index={i + 1}
                deckPublicId={deckPublicId}
                editing={activeEditId === card.publicId}
                serverError={activeEditId === card.publicId ? editError : null}
                justSaved={savedId === card.publicId}
                onEdit={() => {
                  setActiveEditId(card.publicId);
                }}
                onCancelEdit={() => {
                  setActiveEditId(null);
                }}
                onDelete={() => {
                  setDeleteCard(card);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <CreateFlashcardModal
        deckPublicId={deckPublicId}
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        serverError={serverError}
      />

      <ConfirmDeleteModal
        deckPublicId={deckPublicId}
        card={deleteCard}
        onClose={() => {
          setDeleteCard(null);
        }}
      />
    </div>
  );
}
