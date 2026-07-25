import * as React from "react";

// Multi-select over a list of card public_ids, for the review screen's bulk actions.
//
// DELIBERATELY REVIEW-LOCAL, not a shared primitive: this slice has exactly one
// consumer, and with one consumer there is nothing to keep an abstraction honest. It
// lives under components/review/ rather than components/selection/ for that reason —
// C10X-16 promotes it (unchanged in shape) when it adds the deck-view consumer, which
// is the point at which the contract is actually validated by a second caller.
export function useSelection(ids: string[]) {
  const [raw, setRaw] = React.useState<Set<string>>(() => new Set());

  // Pruning happens during render, not in an effect: `ids` changes whenever the server
  // re-renders the list (a card accepted elsewhere, a reload after a batch call), and an
  // effect would leave one painted frame in which a vanished id still counted towards
  // `count` — i.e. a toolbar offering an action on a card that is no longer on screen.
  // The list caps at a generation's 15 cards, so rebuilding the set per render is free.
  const present = new Set(ids);
  const selected = new Set<string>();
  for (const id of raw) {
    if (present.has(id)) selected.add(id);
  }

  const count = selected.size;
  const allSelected = ids.length > 0 && count === ids.length;

  function toggle(id: string) {
    setRaw((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setRaw(allSelected ? new Set() : new Set(ids));
  }

  function clear() {
    setRaw(new Set());
  }

  return {
    selected,
    isSelected: (id: string) => selected.has(id),
    toggle,
    toggleAll,
    clear,
    count,
    allSelected,
    someSelected: count > 0 && !allSelected,
  };
}
