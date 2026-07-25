import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";

interface Props {
  // The card to reject, or null when the modal is closed. Its open state lives in
  // the parent workspace so a single dialog instance serves the whole list, exactly
  // as ConfirmDeleteModal does.
  card: { publicId: string } | null;
  // True while the batch request is in flight — keeps the confirm inert.
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

// Reject is NOT delete (S-02's rule, realised here for the first time): the card keeps
// its content and stays reachable under the review screen's rejected view. It still gets
// a confirm step, because sitting next to "Usuń" in the same footer it would otherwise
// read as a destructive twin — the copy is what tells the two apart.
//
// Unlike ConfirmDeleteModal this is NOT a form POST: the transition goes through the JSON
// batch endpoint (a bulk result is a structured body a redirect cannot carry), so the
// confirm delegates up to the workspace, which owns the single fetch.
export function ConfirmRejectModal({ card, pending = false, onConfirm, onClose }: Props) {
  return (
    <Modal open={card !== null} title="Odrzuć fiszkę" onClose={onClose}>
      {card && (
        <div className="space-y-4">
          <p className="text-sm text-blue-100/80">
            Fiszka zniknie z tej talii i nie pojawi się w nauce, ale jej treść zostaje — znajdziesz ją w przeglądzie, w
            zakładce „Odrzucone”, i możesz ją stamtąd przywrócić.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={onClose}
            >
              Anuluj
            </Button>
            <Button type="button" variant="destructive" className="w-full" disabled={pending} onClick={onConfirm}>
              <X className="size-4" />
              {pending ? "Odrzucanie..." : "Odrzuć"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
