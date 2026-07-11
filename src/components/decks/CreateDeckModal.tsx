import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/Modal";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  // Re-open the modal after a server round-trip error (?open=create).
  defaultOpen?: boolean;
  // Server-side error from the create round-trip, shown inside the modal next to
  // the client-side validation (same place, consistent UX).
  serverError?: string | null;
}

export default function CreateDeckModal({ defaultOpen = false, serverError = null }: Props) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(serverError);

  // Consume the round-trip params once and strip them from the URL so a reload
  // doesn't reopen the modal with a stale error/name.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("open") || url.searchParams.has("error")) {
      url.searchParams.delete("open");
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  // Reset state on close so reopening starts clean.
  function close() {
    setOpen(false);
    setName("");
    setError(null);
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      e.preventDefault();
      setError("Nazwa talii musi mieć od 1 do 100 znaków");
    }
  }

  return (
    <>
      <Button
        className="border border-purple-400/50 bg-purple-600/50 text-white shadow-lg shadow-purple-500/20 hover:bg-purple-600/70"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Plus className="size-4" />
        Nowa talia
      </Button>
      <Modal open={open} title="Nowa talia" onClose={close}>
        <form method="POST" action="/api/decks" className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-2">
            <Label htmlFor="deck-name">Nazwa talii</Label>
            <Input
              id="deck-name"
              name="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="np. Biologia — rozdział 3"
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
    </>
  );
}
