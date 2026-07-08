import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/Modal";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  publicId: string;
  // Current deck name — prefills the rename field.
  name: string;
  // Re-open the rename modal after a server round-trip error (?open=rename).
  defaultOpenRename?: boolean;
  // Server-side error from the rename round-trip, shown inside the rename modal.
  serverError?: string | null;
}

// Rename/delete actions living ONLY on the single-deck page (`/decks/[publicId]`):
// one modal, one error context. Native form POST → redirect, same pattern as
// CreateDeckModal.
export default function DeckActions({ publicId, name, defaultOpenRename = false, serverError = null }: Props) {
  const [renameOpen, setRenameOpen] = React.useState(defaultOpenRename);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [value, setValue] = React.useState(name);
  const [error, setError] = React.useState<string | null>(serverError);

  // Consume the round-trip params once and strip them so a reload doesn't reopen
  // the modal with a stale error/name.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("open") || url.searchParams.has("error")) {
      url.searchParams.delete("open");
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  function closeRename() {
    setRenameOpen(false);
    setValue(name);
    setError(null);
  }

  function handleRenameSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    const trimmed = value.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      e.preventDefault();
      setError("Nazwa talii musi mieć od 1 do 100 znaków");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
        onClick={() => {
          setRenameOpen(true);
        }}
      >
        <Pencil className="size-4" />
        Zmień nazwę
      </Button>
      <Button
        variant="destructive"
        onClick={() => {
          setDeleteOpen(true);
        }}
      >
        <Trash2 className="size-4" />
        Usuń
      </Button>

      <Modal open={renameOpen} title="Zmień nazwę talii" onClose={closeRename}>
        <form
          method="POST"
          action={`/api/decks/${publicId}`}
          className="space-y-4"
          onSubmit={handleRenameSubmit}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="deck-rename">Nazwa talii</Label>
            <Input
              id="deck-rename"
              name="name"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              autoComplete="off"
              autoFocus
              aria-invalid={error ? true : undefined}
              className="border-white/20 bg-white/5 text-white placeholder:text-blue-100/40"
            />
          </div>

          <ServerError message={error} />

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={closeRename}
            >
              Anuluj
            </Button>
            <SubmitButton pendingText="Zapisywanie..." icon={<Pencil className="size-4" />}>
              Zapisz
            </SubmitButton>
          </div>
        </form>
      </Modal>

      <Modal
        open={deleteOpen}
        title="Usuń talię"
        onClose={() => {
          setDeleteOpen(false);
        }}
      >
        <form method="POST" action={`/api/decks/${publicId}/delete`} className="space-y-4">
          <p className="text-sm text-blue-100/80">
            Czy na pewno chcesz trwale usunąć talię „{name}”? Tej operacji nie można cofnąć.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => {
                setDeleteOpen(false);
              }}
            >
              Anuluj
            </Button>
            <SubmitButton variant="destructive" pendingText="Usuwanie..." icon={<Trash2 className="size-4" />}>
              Usuń
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
