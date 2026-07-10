import * as React from "react";
import type { FlashcardView } from "@/lib/flashcards";
import { DeckContentToolbar } from "./DeckContentToolbar";
import { FlashcardItem } from "./FlashcardItem";
import { CreateFlashcardModal } from "./CreateFlashcardModal";

interface Props {
  deckPublicId: string;
  // Server-loaded cards in the helper's default order (created_at desc).
  cards: FlashcardView[];
  // Re-open the create modal after a server round-trip error (?open=create-card).
  defaultOpenCreate?: boolean;
  // Server-side create error, shown inside the re-opened create modal.
  serverError?: string | null;
  // True when the loader's card query failed — renders a distinct error state
  // rather than the empty copy (lessons: SSR error-vs-empty).
  cardsError?: boolean;
}

// The single client island for the card workspace: owns the create-modal open
// state and renders the content toolbar, the card list, and the create modal.
// Mutations stay as native form POSTs from the child components, so the slice
// keeps S-01's no-fetch, redirect-driven model.
export default function FlashcardWorkspace({
  deckPublicId,
  cards,
  defaultOpenCreate = false,
  serverError = null,
  cardsError = false,
}: Props) {
  const [createOpen, setCreateOpen] = React.useState(defaultOpenCreate);

  // Consume the round-trip params once and strip them so a reload doesn't reopen
  // a stale modal/edit (as CreateDeckModal does). `edit` is stripped here too so
  // Phase 3's inline-edit round-trip never re-enters on refresh.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("open") || url.searchParams.has("edit") || url.searchParams.has("error")) {
      url.searchParams.delete("open");
      url.searchParams.delete("edit");
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  return (
    <div>
      {/* Everything card-related lives inside this grouping panel, visually
          separating it from the deck-level rename/delete actions in the page
          header above. */}
      <section className="flashcard-panel rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl sm:p-5">
        <DeckContentToolbar
          onAddCard={() => {
            setCreateOpen(true);
          }}
        />

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
              <FlashcardItem key={card.publicId} card={card} index={i + 1} />
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
    </div>
  );
}
