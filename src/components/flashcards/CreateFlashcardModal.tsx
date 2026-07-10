import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/Modal";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { FRONT_MAX, BACK_MAX } from "@/lib/flashcards";
import { cn } from "@/lib/utils";

interface Props {
  deckPublicId: string;
  open: boolean;
  onClose: () => void;
  // Server-side error from the create round-trip, shown inside the modal next to
  // the client-side validation (same place, consistent UX).
  serverError?: string | null;
}

// Live character counter shown under a field: muted grey normally, red once the
// entered length passes the limit, so the user sees how much room is left.
function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <p className={cn("text-right text-xs tabular-nums", over ? "text-red-400" : "text-blue-100/50")}>
      {value.length} / {max}
    </p>
  );
}

// Two-field (front/back) manual card creation, mirroring CreateDeckModal: native
// form POST → redirect, with the error round-tripped back into the re-opened
// modal via `?open=create-card`. The open state is owned by FlashcardWorkspace;
// this component only renders the modal and validates client-side.
export function CreateFlashcardModal({ deckPublicId, open, onClose, serverError = null }: Props) {
  const [front, setFront] = React.useState("");
  const [back, setBack] = React.useState("");
  const [error, setError] = React.useState<string | null>(serverError);

  // Reset state on close so reopening starts clean.
  function close() {
    setFront("");
    setBack("");
    setError(null);
    onClose();
  }

  // Length limits are a business rule imported from the data helper (not a DB
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

  return (
    <Modal
      open={open}
      title="Nowa fiszka"
      onClose={close}
      className="custom-scrollbar max-h-[90vh] max-w-2xl overflow-y-auto"
    >
      <form
        method="POST"
        action={`/api/decks/${deckPublicId}/cards`}
        className="space-y-4"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="space-y-2">
          <Label htmlFor="card-front">Przód</Label>
          {/* field-sizing-content (from the Textarea primitive) auto-grows with
              content; min-h gives ~6 comfortable lines, max-h caps growth at
              ~20 lines and overflow-y-auto keeps the scrollbar INSIDE the field
              so the modal never expands past the cap. */}
          <Textarea
            id="card-front"
            name="front"
            value={front}
            onChange={(e) => {
              setFront(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Pytanie lub pojęcie"
            autoFocus
            aria-invalid={error ? true : undefined}
            className="custom-scrollbar max-h-[28rem] min-h-32 resize-none overflow-y-auto border-white/20 bg-white/5 text-white placeholder:text-blue-100/40"
          />
          <CharCount value={front} max={FRONT_MAX} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="card-back">Tył</Label>
          <Textarea
            id="card-back"
            name="back"
            value={back}
            onChange={(e) => {
              setBack(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Odpowiedź lub definicja"
            aria-invalid={error ? true : undefined}
            className="custom-scrollbar max-h-[28rem] min-h-40 resize-none overflow-y-auto border-white/20 bg-white/5 text-white placeholder:text-blue-100/40"
          />
          <CharCount value={back} max={BACK_MAX} />
        </div>

        <ServerError message={error} />

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onClick={close}
          >
            Anuluj
          </Button>
          <SubmitButton pendingText="Tworzenie..." icon={<Plus className="size-4" />}>
            Utwórz
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
