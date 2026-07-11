import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";
import { SubmitButton } from "@/components/auth/SubmitButton";

interface Props {
  deckPublicId: string;
  // The card to delete, or null when the modal is closed. Its open state lives in
  // the parent workspace so a single dialog instance serves the whole list.
  card: { publicId: string } | null;
  onClose: () => void;
}

// Guards permanent single-card deletion behind an explicit confirm (FR-010
// stresses permanence), mirroring the deck delete modal. Native form POST →
// redirect to the delete endpoint; errors surface as a page banner (no re-open).
export function ConfirmDeleteModal({ deckPublicId, card, onClose }: Props) {
  return (
    <Modal open={card !== null} title="Usuń fiszkę" onClose={onClose}>
      {card && (
        <form method="POST" action={`/api/decks/${deckPublicId}/cards/${card.publicId}/delete`} className="space-y-4">
          <p className="text-sm text-blue-100/80">Czy na pewno usunąć tę fiszkę? Tej operacji nie można cofnąć.</p>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={onClose}
            >
              Anuluj
            </Button>
            <SubmitButton variant="destructive" pendingText="Usuwanie..." icon={<Trash2 className="size-4" />}>
              Usuń
            </SubmitButton>
          </div>
        </form>
      )}
    </Modal>
  );
}
