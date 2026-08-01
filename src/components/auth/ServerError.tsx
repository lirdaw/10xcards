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
    // Off auth it fires properly for MOST call sites, and that is why the edit is taken on the
    // SHARED component rather than behind an opt-in prop: NINE other components render this at
    // ELEVEN call sites DYNAMICALLY (`{status === "error" && <ServerError …/>}`) —
    // CreateDeckModal, DeckActions, CreateFlashcardModal, FlashcardItem, FlashcardWorkspace,
    // GeneratorForm, CandidateItem, CandidateReviewWorkspace, StudySession (×2). An insertion
    // into an existing live region is exactly the case `role="alert"` is specified for, so the
    // shared edit is MORE correct at those eleven than on this surface.
    //
    // TWO call sites are at-mount and therefore the WEAK case, not one: this surface, and
    // `src/pages/decks/[publicId]/index.astro:170` — the page-level deck banner, which arrives
    // by a full-page redirect, so its live region exists before a screen reader could observe a
    // change. For both, the claim taken is that the node is EXPOSED AS AN ALERT in the
    // accessibility tree; announcement is NOT claimed. Do not let the "dynamically" sentence
    // above be read as covering them.
    //
    // (Counts corrected twice, both times by enumeration — `grep -rn "<ServerError" src/`,
    // discounting the two mentions inside this comment. Phase 5 of C10X-34 shipped "eight other
    // components … eleven call sites" while naming nine; its Phase 6 corrected that to twelve
    // sites across eleven components. C10X-37 then added the thirteenth — the .astro one above —
    // making it 13 SITES ACROSS 12 FILES, ten of them dynamic and off auth, and that change's
    // impl-review (F2, 2026-08-01) found this comment still reading twelve and still claiming
    // every off-auth site was dynamic. Recorded rather than quietly fixed, for the third time:
    // a miscount in a comment is what the next contributor reasons from, and here it was about
    // to license an announcement claim the plan explicitly refused.)
    <p
      role="alert"
      className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300"
    >
      <CircleAlert className="size-4 shrink-0" />
      {message}
    </p>
  );
}
