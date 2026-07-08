import * as React from "react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open?: boolean;
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

export function Modal({ open = false, title, children, onClose, className }: ModalProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Native `close` fires on Esc and on programmatic close — sync parent state.
  function handleClose() {
    onClose?.();
  }

  // Clicking the backdrop lands on the <dialog> element itself (children are wrapped).
  function handleClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) {
      dialogRef.current.close();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleClose}
      onClick={handleClick}
      className={cn(
        "m-auto w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1529] p-6 text-white shadow-lg backdrop:bg-black/60",
        className,
      )}
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </dialog>
  );
}
