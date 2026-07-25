import type * as React from "react";
import { Button } from "@/components/ui/button";

// One bulk action offered over the current selection. `onRun` gets the selected ids
// from the workspace's closure — the bar never reads selection state itself.
export interface SelectionAction {
  label: string;
  icon?: React.ReactNode;
  className?: string;
  onRun: () => void;
}

interface Props {
  count: number;
  total: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  actions: SelectionAction[];
  // True while a batch call is in flight — the whole bar goes inert so a second
  // click can't fire the same transition twice (the endpoint is idempotent anyway,
  // but a double-fire would report "nic nie zmieniono" and read as a failure).
  pending?: boolean;
}

// Presentational only: no state, no fetch, no knowledge of what the actions do. It
// renders nothing at all when nothing is selected — the per-card checkboxes are what
// start a selection, and "zaznacz wszystkie" is reachable from the bar once the first
// card is checked.
export function CandidateSelectionBar({
  count,
  total,
  allSelected,
  onToggleAll,
  onClear,
  actions,
  pending = false,
}: Props) {
  if (count === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Akcje na zaznaczonych fiszkach"
      className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-purple-400/30 bg-purple-900/20 px-4 py-3 text-white backdrop-blur-xl"
    >
      <label className="flex items-center gap-2 text-sm text-blue-100/80">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          disabled={pending}
          className="size-4 accent-purple-500"
        />
        Zaznacz wszystkie ({total})
      </label>
      <span className="text-sm text-blue-100/70 tabular-nums" role="status">
        Zaznaczono: {count}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            type="button"
            onClick={action.onRun}
            disabled={pending}
            className={action.className}
          >
            {action.icon}
            {action.label}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={onClear}
          disabled={pending}
          className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
        >
          Wyczyść
        </Button>
      </div>
    </div>
  );
}
