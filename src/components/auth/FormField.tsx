import type { InputHTMLAttributes, ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// The focus ring here is the shared one: same trigger (`focus-visible:`) and same
// colour token (`ring-ring`, see src/styles/global.css) as the ui/ primitives. Only
// the width differs (2px, to keep the auth layout unchanged). Do not reintroduce a
// local colour — the token is the single source for the whole app.
const inputBase =
  "w-full rounded-lg bg-white/10 border px-3 py-2 pl-10 text-white placeholder-white/40 focus-visible:outline-none focus-visible:ring-2 transition-colors";

interface FormFieldProps {
  id: string;
  name?: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: ReactNode;
  icon: ReactNode;
  endContent?: ReactNode;
  /** Pass-through to the input, so password managers and browser fill stop working blind. */
  autoComplete?: InputHTMLAttributes<HTMLInputElement>["autoComplete"];
}

export function FormField({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  error,
  hint,
  icon,
  endContent,
  autoComplete,
}: FormFieldProps) {
  // Derived from the field id, so the error paragraph and the input that points at it cannot
  // drift apart. Both `aria-*` attributes are emitted ONLY while an error is present — a
  // `aria-describedby` pointing at a node that is not rendered is worse than none, and a
  // permanent `aria-invalid="false"` is noise a screen reader reads on every field.
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-blue-100/80">
        {label}
      </label>
      <div className="relative">
        <span className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40">{icon}</span>
        <input
          id={id}
          name={name ?? id}
          type={type}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          autoComplete={autoComplete}
          // No visual change comes with these: the `aria-invalid:ring-destructive` styling
          // AGENTS.md describes lives on the shared `ui/` primitives, and this component is
          // not one of them. Its red ring is the documented local one on the line below.
          aria-invalid={error ? true : undefined}
          // Only while an error is present — a dangling `aria-describedby` is worse than none,
          // and the condition here is deliberately the SAME expression that renders the `<p>`
          // below, so the two cannot drift into pointing at nothing.
          //
          // `hint` is NOT described (impl-review F4, 2026-07-31, decided rather than overlooked).
          // The two are mutually exclusive — `hint` is the `else` branch below — so its absence
          // costs no dangling reference, but it does mean `SignUpForm`'s live "N more characters
          // needed" is visible-only: a screen-reader user meets the guidance only after
          // triggering the error it would have prevented. Closing it is not a one-liner: `hint`
          // arrives as an opaque `ReactNode` from the parent, so an id has to come from a prop
          // contract change or a `cloneElement`, and the manual screen-reader check that closed
          // 5.6 would have to be re-run. Left open on purpose; the shape if it is ever taken is
          // `aria-describedby={error ? errorId : hint ? hintId : undefined}`.
          aria-describedby={error ? errorId : undefined}
          className={cn(
            inputBase,
            error ? "border-red-400/60 focus-visible:ring-red-400" : "focus-visible:ring-ring border-white/20",
          )}
        />
        {endContent}
      </div>
      {error ? (
        <p id={errorId} className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : (
        hint
      )}
    </div>
  );
}
