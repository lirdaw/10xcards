import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  // Opens the create-card modal, whose state lives in the parent workspace.
  onAddCard: () => void;
  // Deck the search form posts back to (GET → /decks/<publicId>?q=…).
  deckPublicId: string;
  // Current keyword query, seeds the (uncontrolled) input and toggles "Wyczyść".
  query: string;
}

// The header row of the per-deck flashcard section (distinct from the top user
// bar and from the deck-level rename/delete actions). Carries the section
// heading, the S-06 keyword search (C10X-9, FR-015), and the add-card trigger.
//
// Search is a native `GET` form: pressing Enter (or the submit button) reloads the
// page at /decks/<publicId>?q=<phrase>, matching S-01's no-fetch, redirect-driven
// model — no client-side JS beyond the browser's own form submit. The loader reads
// `q` and filters server-side. "Wyczyść" is a plain link back to the deck without
// `q`, shown only while a search is active.
export function DeckContentToolbar({ onAddCard, deckPublicId, query }: Props) {
  const isSearching = query.length > 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-white">Fiszki</h2>
      <div className="flex flex-wrap items-center gap-2">
        <form method="GET" action={`/decks/${deckPublicId}`} role="search" className="flex items-center gap-2">
          <label htmlFor="deck-search" className="sr-only">
            Szukaj w fiszkach
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-blue-100/50"
              aria-hidden="true"
            />
            <Input
              id="deck-search"
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Szukaj w fiszkach…"
              aria-label="Szukaj w fiszkach"
              className="w-48 border-white/15 pl-8 text-white placeholder:text-blue-100/40 sm:w-64"
            />
          </div>
          <Button type="submit" className="border border-white/15 bg-white/5 text-white hover:bg-white/10">
            Szukaj
          </Button>
          {isSearching && (
            <a
              href={`/decks/${deckPublicId}`}
              className="text-sm text-purple-300 transition-colors hover:text-purple-100"
            >
              Wyczyść
            </a>
          )}
        </form>
        <Button
          className="border border-purple-400/50 bg-purple-600/50 text-white shadow-lg shadow-purple-500/20 hover:bg-purple-600/70"
          onClick={onAddCard}
        >
          <Plus className="size-4" />
          Dodaj fiszkę
        </Button>
      </div>
    </div>
  );
}
