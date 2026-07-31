import { CircleAlert } from "lucide-react";

interface ServerErrorProps {
  message?: string | null;
}

export function ServerError({ message }: ServerErrorProps) {
  if (!message) return null;

  return (
    // `role="alert"` — this is the only feedback a failed submit gives, and without a live
    // region it is rendered but never announced.
    //
    // Know what it does and does NOT buy here. On the two auth forms the node is present at
    // MOUNT (the message arrives via a full-page redirect and `?error=`), and a live region
    // that exists at mount is not reliably announced — behaviour varies by screen reader.
    // This is the standard approach, not a guarantee, and the manual check is what carries
    // the claim on this surface.
    //
    // Off auth it fires properly, and that is why the edit is taken on the SHARED component
    // rather than behind an opt-in prop: eight other components render this at eleven call
    // sites, every one of them DYNAMICALLY (`{status === "error" && <ServerError …/>}`) —
    // CreateDeckModal, DeckActions, CreateFlashcardModal, FlashcardItem, FlashcardWorkspace,
    // GeneratorForm, CandidateItem, CandidateReviewWorkspace, StudySession (×2). An insertion
    // into an existing live region is exactly the case `role="alert"` is specified for, so the
    // shared edit is MORE correct off this surface than on it.
    <p
      role="alert"
      className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300"
    >
      <CircleAlert className="size-4 shrink-0" />
      {message}
    </p>
  );
}
