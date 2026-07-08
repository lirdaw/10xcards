import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SubmitButtonProps {
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
  // Opt into the destructive (red) style for confirm-delete submits; defaults to
  // the purple primary used by the auth forms.
  variant?: "default" | "destructive";
  className?: string;
}

export function SubmitButton({ pendingText, icon, children, variant, className }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      variant={variant === "destructive" ? "destructive" : undefined}
      className={cn(
        "w-full",
        variant === "destructive"
          ? "px-4 py-2 font-medium"
          : "rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500",
        className,
      )}
    >
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          {pendingText}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {icon}
          {children}
        </span>
      )}
    </Button>
  );
}
