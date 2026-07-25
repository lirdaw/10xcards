import * as React from "react";
import { ClipboardList } from "lucide-react";
import type { FlashcardView } from "@/lib/flashcards";
import { ServerError } from "@/components/auth/ServerError";
import { DeckContentToolbar } from "./DeckContentToolbar";
import { FlashcardItem } from "./FlashcardItem";
import { CreateFlashcardModal } from "./CreateFlashcardModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { ConfirmRejectModal } from "./ConfirmRejectModal";

interface BatchResponse {
  ok: true;
  changed: string[];
  skipped: string[];
}

// Polish plural for "wynik" (result): 1 → wynik; 2-4 (except the 12-14 teens) →
// wyniki; everything else → wyników. Slice-local until a test runner exists (F-03).
function pluralizeWyniki(n: number): string {
  if (n === 1) return "wynik";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "wyniki";
  return "wyników";
}

interface Props {
  deckPublicId: string;
  // Server-loaded cards in the helper's default order (created_at desc).
  cards: FlashcardView[];
  // The active keyword query (already trimmed by the loader). Empty = not searching.
  query: string;
  // Whether the deck holds ANY card (unfiltered) — distinguishes an empty deck from
  // a search that matched nothing, so the zero-cards state shows the right copy.
  deckHasCards: boolean;
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
// pending delete or reject confirmation. Renders the content toolbar, the permanent
// review link, the card list, and the three modals. Create/edit/delete stay native
// form POSTs from the child components, keeping S-01's redirect-driven model; only
// the S-05 reject goes over JSON, because it shares the batch endpoint with the
// review screen's bulk path — one transition, one code path.
export default function FlashcardWorkspace({
  deckPublicId,
  cards,
  query,
  deckHasCards,
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
  // Which card is pending reject confirmation, and the state of the one request
  // this island makes. Reject is NOT delete: the card keeps its content and stays
  // reachable under the review screen's rejected view (S-02's rule).
  const [rejectCard, setRejectCard] = React.useState<FlashcardView | null>(null);
  const [rejecting, setRejecting] = React.useState(false);
  const [rejectError, setRejectError] = React.useState<string | null>(null);
  const [rejectMessage, setRejectMessage] = React.useState<string | null>(null);
  // Whether a keyword search is active — drives the count line and the distinct
  // "no matches" empty state (vs. the plain "deck is empty" copy).
  const isSearching = query.length > 0;

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

  // accepted → rejected, through the same batch endpoint the review screen's bulk path
  // uses (a one-element array, so there is exactly one code path and one error contract).
  // A zero-row write is not an error under RLS, so the outcome is derived from `changed`,
  // never from the absence of an error. On success we reload, as the review island does:
  // the server re-renders the authoritative list and no optimistic state has to be
  // reconciled. `rejecting` stays true through the reload so the controls stay inert.
  async function runReject(card: FlashcardView) {
    if (rejecting) return;
    setRejecting(true);
    setRejectError(null);
    setRejectMessage(null);
    try {
      const res = await fetch(`/api/decks/${deckPublicId}/cards/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setState", cardPublicIds: [card.publicId], state: "rejected" }),
      });
      const data = (await res.json()) as BatchResponse | { error?: string };
      if (!res.ok) {
        setRejectError("error" in data ? (data.error ?? null) : "Nie udało się odrzucić fiszki.");
        setRejecting(false);
        setRejectCard(null);
        return;
      }
      if ((data as BatchResponse).changed.length > 0) {
        window.location.reload();
        return;
      }
      // Nothing moved — the card was already rejected, or is no longer this account's.
      // Three cases the server deliberately cannot tell apart, so the copy stays neutral.
      setRejectMessage("Nic nie zmieniono — ta fiszka nie jest już w tej talii.");
      setRejecting(false);
      setRejectCard(null);
    } catch {
      setRejectError("Błąd sieci. Spróbuj ponownie.");
      setRejecting(false);
      setRejectCard(null);
    }
  }

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
          deckPublicId={deckPublicId}
          query={query}
          onAddCard={() => {
            setCreateOpen(true);
          }}
        />
        {/* A PERMANENT way into the review screen — a sibling of the toolbar, never
            inside it, so DeckContentToolbar stays untouched. Permanent is the whole
            point: the other two routes in (the generator's success link and the deck
            list's chip) both disappear once nothing is pending, which is exactly the
            state a freshly rejected card lands in — without this, "Odrzuć" would be a
            one-way trap and "Przywróć" unreachable. The copy names the archive as well
            as the queue, and carries no count, so it never reads as broken at zero. A
            post-action message is no substitute: the reject reloads the page. */}
        <div className="mt-2 flex justify-end">
          <a
            href={`/decks/${deckPublicId}/review`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-blue-100/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ClipboardList className="size-4" aria-hidden="true" />
            Przegląd / odrzucone
          </a>
        </div>
      </div>

      {rejectError && <ServerError message={rejectError} />}
      {rejectMessage && (
        <p
          className="mt-3 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-blue-100/80"
          role="status"
        >
          {rejectMessage}
        </p>
      )}

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
          isSearching && deckHasCards ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white">
              <p className="text-blue-100/70">Brak fiszek pasujących do „{query}”.</p>
              <a
                href={`/decks/${deckPublicId}`}
                className="mt-4 inline-block text-purple-300 transition-colors hover:text-purple-100"
              >
                Wyczyść
              </a>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white">
              <p className="text-blue-100/70">Brak fiszek w tej talii.</p>
            </div>
          )
        ) : (
          <>
            {isSearching && (
              <p className="mb-3 text-sm text-blue-100/70">
                {cards.length} {pluralizeWyniki(cards.length)}
              </p>
            )}
            {/* Row-major grid; columns scale with viewport width: 3 at ~half a 4K
                screen (≥xl), doubling to 6 on a full 3840px display. */}
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
                  pending={rejecting}
                  onEdit={() => {
                    setActiveEditId(card.publicId);
                  }}
                  onCancelEdit={() => {
                    setActiveEditId(null);
                  }}
                  onDelete={() => {
                    setDeleteCard(card);
                  }}
                  onReject={() => {
                    setRejectCard(card);
                  }}
                />
              ))}
            </ul>
          </>
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

      <ConfirmRejectModal
        card={rejectCard}
        pending={rejecting}
        onConfirm={() => {
          if (rejectCard) void runReject(rejectCard);
        }}
        onClose={() => {
          if (!rejecting) setRejectCard(null);
        }}
      />
    </div>
  );
}
