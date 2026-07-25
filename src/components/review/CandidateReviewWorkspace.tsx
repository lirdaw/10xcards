import * as React from "react";
import { Check, Undo2, X } from "lucide-react";
import type { FlashcardView } from "@/lib/flashcards";
import { ServerError } from "@/components/auth/ServerError";
import { CandidateItem } from "./CandidateItem";
import { CandidateSelectionBar, type SelectionAction } from "./CandidateSelectionBar";
import { useSelection } from "./useSelection";

type TargetState = "accepted" | "rejected";
type Status = "idle" | "pending" | "error";

interface BatchResponse {
  ok: true;
  changed: string[];
  skipped: string[];
}

// Mirrors IDS_MAX in api/decks/[publicId]/cards/batch.ts — change one and this has to
// follow, the same way SIZE_MAX and the session_size CHECK are paired.
//
// Chunking is required, not defensive: the endpoint's cap is there to stop a hand-crafted
// body, but THIS screen can legitimately exceed it. Only the `?generation=` view is bounded
// by a generation's 15 cards — the deck-list chip and the deck view's permanent link both
// open the screen unscoped, and the rejected view is an ever-growing archive because reject
// is not delete. Without this loop "Zaznacz wszystkie" over 101+ cards would post one
// oversized array and get back a 400 for an action this UI itself offered.
const BATCH_MAX = 100;

interface Props {
  deckPublicId: string;
  // Server-loaded cards in the view's state (created_at desc), already narrowed to
  // one generation when the screen is scoped.
  cards: FlashcardView[];
  // Which lifecycle state this screen is showing — drives the actions and the copy.
  view: "generated" | "rejected";
  // The `?generation=` scope, carried into edit round-trips. Null = whole deck.
  generationPublicId: string | null;
  // The card public_id to re-enter inline-edit mode after an edit round-trip error.
  editId?: string | null;
  editError?: string | null;
  // The card whose edit just saved — plays a one-shot settle animation.
  savedId?: string | null;
  // True when the loader's card query failed — a distinct error state, never the
  // empty copy (lessons: SSR error-vs-empty).
  cardsError?: boolean;
}

// Polish plural for "fiszka": 1 → fiszkę; 2-4 (except the 12-14 teens) → fiszki;
// everything else → fiszek. Accusative, as in "Zaakceptowano 3 fiszki".
function pluralizeFiszki(n: number): string {
  if (n === 1) return "fiszkę";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "fiszki";
  return "fiszek";
}

// The single client island for the review screen: owns the selection, which card (if
// any) is in inline-edit mode, and the one fetch this slice makes. Edits stay native
// form POSTs from the child (S-01's redirect-driven model); only the state transition
// goes over JSON, because a bulk result — which ids moved and which did not — is a
// structured body a redirect cannot carry.
export default function CandidateReviewWorkspace({
  deckPublicId,
  cards,
  view,
  generationPublicId,
  editId = null,
  editError = null,
  savedId = null,
  cardsError = false,
}: Props) {
  const [activeEditId, setActiveEditId] = React.useState<string | null>(editId);
  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const ids = cards.map((c) => c.publicId);
  const selection = useSelection(ids);
  const pending = status === "pending";

  // Consume the round-trip params once and strip them, so a reload doesn't re-enter a
  // stale edit form or replay an old error (same as FlashcardWorkspace). `state` and
  // `generation` are NOT stripped — they are the screen's own scope, not a one-shot.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("edit") || url.searchParams.has("error") || url.searchParams.has("saved")) {
      url.searchParams.delete("edit");
      url.searchParams.delete("error");
      url.searchParams.delete("saved");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  async function runBatch(cardPublicIds: string[], state: TargetState) {
    if (cardPublicIds.length === 0 || pending) return;
    setStatus("pending");
    setError(null);
    setMessage(null);
    try {
      // Sequential, not Promise.all: these are writes to the same table and a failure has
      // to stop the run rather than race the rest of it.
      const changedTotal: string[] = [];
      let failure: string | null = null;
      for (let i = 0; i < cardPublicIds.length; i += BATCH_MAX) {
        const res = await fetch(`/api/decks/${deckPublicId}/cards/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "setState",
            cardPublicIds: cardPublicIds.slice(i, i + BATCH_MAX),
            state,
          }),
        });
        const data = (await res.json()) as BatchResponse | { error?: string };
        if (!res.ok) {
          failure = "error" in data ? (data.error ?? null) : "Nie udało się zapisać zmian.";
          break;
        }
        changedTotal.push(...(data as BatchResponse).changed);
      }
      if (failure !== null && changedTotal.length === 0) {
        setError(failure);
        setStatus("error");
        return;
      }
      // A partial failure still reloads. The message is lost either way — the reload
      // destroys it, which is why the success path renders nothing before navigating —
      // and a list still showing cards that have already moved is the worse of the two
      // wrongs. What actually moved is visible in the re-rendered list.
      if (changedTotal.length > 0) {
        // Reload so the server re-renders the authoritative list: selection can never
        // go stale, and no optimistic state has to be reconciled with a partial result
        // (the response IS structured — it is read right here — but the moved cards
        // vanishing from the list is the feedback that survives the reload).
        // `status` stays "pending" on purpose, keeping the controls inert until the
        // navigation lands.
        window.location.reload();
        return;
      }
      // Nothing moved: every id was already in the target state, illegal for it, or not
      // this account's — three cases the server deliberately cannot tell apart. There is
      // nothing new to render, so we show the benign message INSTEAD of reloading.
      setMessage("Nic nie zmieniono — te fiszki są już w tym stanie.");
      setStatus("idle");
    } catch {
      setError("Błąd sieci. Spróbuj ponownie.");
      setStatus("error");
    }
  }

  function actionsFor(cardPublicIds: string[]): SelectionAction[] {
    if (view === "rejected") {
      return [
        {
          label: "Przywróć",
          icon: <Undo2 className="size-4" aria-hidden="true" />,
          className: "border border-emerald-500/40 bg-emerald-600/25 text-emerald-100 hover:bg-emerald-600/40",
          onRun: () => void runBatch(cardPublicIds, "accepted"),
        },
      ];
    }
    return [
      {
        label: "Akceptuj",
        icon: <Check className="size-4" aria-hidden="true" />,
        className: "border border-emerald-500/40 bg-emerald-600/25 text-emerald-100 hover:bg-emerald-600/40",
        onRun: () => void runBatch(cardPublicIds, "accepted"),
      },
      {
        label: "Odrzuć",
        icon: <X className="size-4" aria-hidden="true" />,
        className: "border border-red-500/40 bg-red-600/25 text-red-100 hover:bg-red-600/40",
        onRun: () => void runBatch(cardPublicIds, "rejected"),
      },
    ];
  }

  const reviewPath = `/decks/${deckPublicId}/review`;

  // Three distinct empty states, because they mean three different things and only one
  // of them is a dead end.
  function emptyCopy() {
    if (view === "rejected") {
      return <p className="text-blue-100/70">Brak odrzuconych fiszek w tej talii.</p>;
    }
    if (generationPublicId) {
      return (
        <>
          <p className="text-blue-100/70">Wszystkie fiszki z tej generacji zostały przejrzane.</p>
          <a href={reviewPath} className="mt-4 inline-block text-purple-300 transition-colors hover:text-purple-100">
            Pokaż wszystkie kandydatki w talii
          </a>
        </>
      );
    }
    return (
      <>
        <p className="text-blue-100/70">Brak fiszek do przeglądu w tej talii.</p>
        <a href="/generate" className="mt-4 inline-block text-purple-300 transition-colors hover:text-purple-100">
          Wygeneruj nowe fiszki
        </a>
      </>
    );
  }

  return (
    <div>
      {status === "error" && <ServerError message={error} />}
      {message && (
        <p
          className="mb-3 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-blue-100/80"
          role="status"
        >
          {message}
        </p>
      )}

      <CandidateSelectionBar
        count={selection.count}
        total={cards.length}
        allSelected={selection.allSelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clear}
        pending={pending}
        actions={actionsFor([...selection.selected]).map((action) => ({
          ...action,
          // Bulk runs exactly the same per-row writes as the single-card path — one
          // request, one row per card — so the acceptance metric survives bulk by
          // construction. Never a shortcut that skips the per-card record.
          label: `${action.label} (${String(selection.count)} ${pluralizeFiszki(selection.count)})`,
        }))}
      />

      <section className="flashcard-panel rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl sm:p-5">
        {cardsError ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-900/30 p-8 text-center backdrop-blur-xl">
            <p className="text-red-300">Nie udało się wczytać fiszek. Spróbuj ponownie później.</p>
          </div>
        ) : cards.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white">{emptyCopy()}</div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 min-[2560px]:grid-cols-4 min-[3200px]:grid-cols-5 min-[3800px]:grid-cols-6 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card, i) => (
              <CandidateItem
                key={card.publicId}
                card={card}
                index={i + 1}
                deckPublicId={deckPublicId}
                generationPublicId={generationPublicId}
                editing={activeEditId === card.publicId}
                serverError={activeEditId === card.publicId ? editError : null}
                justSaved={savedId === card.publicId}
                selected={selection.isSelected(card.publicId)}
                onToggleSelect={() => {
                  selection.toggle(card.publicId);
                }}
                onEdit={() => {
                  setActiveEditId(card.publicId);
                }}
                onCancelEdit={() => {
                  setActiveEditId(null);
                }}
                actions={actionsFor([card.publicId])}
                pending={pending}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
