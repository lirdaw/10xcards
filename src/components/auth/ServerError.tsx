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
    // rather than behind an opt-in prop: NINE other components render this at TEN call sites,
    // every one of them DYNAMICALLY (`{status === "error" && <ServerError …/>}`) —
    // CreateDeckModal, DeckActions, CreateFlashcardModal, FlashcardItem, FlashcardWorkspace,
    // GeneratorForm, CandidateItem, CandidateReviewWorkspace, StudySession (×2). An insertion
    // into an existing live region is exactly the case `role="alert"` is specified for, so the
    // shared edit is MORE correct off this surface than on it.
    //
    // (Counts corrected 2026-07-31 by enumeration — `grep -rn "<ServerError" src/`. This
    // comment shipped in Phase 5 reading "eight other components … eleven call sites" while
    // naming nine of them; twelve sites across eleven components is the whole picture, ten of
    // them off auth. Recorded rather than quietly fixed: a miscount in a comment is what the
    // next contributor reasons from, which is the class C10X-34's Phase 6 exists to end.)
    <p
      role="alert"
      className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300"
    >
      <CircleAlert className="size-4 shrink-0" />
      {message}
    </p>
  );
}
