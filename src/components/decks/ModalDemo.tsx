import * as React from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";

// Temporary Phase-1 harness to verify the Modal (open/Esc/backdrop/focus-return).
// Replaced by CreateDeckModal in Phase 2.
export default function ModalDemo() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        className="bg-purple-600 text-white hover:bg-purple-500"
        onClick={() => {
          setOpen(true);
        }}
      >
        Otwórz modal (demo)
      </Button>
      <Modal
        open={open}
        title="Modal demo"
        onClose={() => {
          setOpen(false);
        }}
      >
        <p className="text-sm text-blue-100/70">
          Zamknij klawiszem <kbd>Esc</kbd> lub kliknięciem w tło — fokus powinien wrócić na przycisk.
        </p>
        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onClick={() => {
              setOpen(false);
            }}
          >
            Zamknij
          </Button>
        </div>
      </Modal>
    </>
  );
}
