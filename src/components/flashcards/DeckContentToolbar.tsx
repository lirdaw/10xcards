import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  // Opens the create-card modal, whose state lives in the parent workspace.
  onAddCard: () => void;
}

// The header row of the per-deck flashcard section (distinct from the top user
// bar and from the deck-level rename/delete actions). Carries the section
// heading and the add-card trigger; the S-06 keyword search box (C10X-9, FR-015)
// will mount alongside them here — no search input ships in S-02.
export function DeckContentToolbar({ onAddCard }: Props) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-white">Fiszki</h2>
      {/* S-06 (C10X-9): keyword search input mounts in this row (FR-015). */}
      <Button className="bg-purple-600 text-white hover:bg-purple-500" onClick={onAddCard}>
        <Plus className="size-4" />
        Dodaj fiszkę
      </Button>
    </div>
  );
}
