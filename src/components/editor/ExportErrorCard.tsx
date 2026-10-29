"use client";

import { AlertTriangle, X } from "lucide-react";

interface ExportErrorCardProps {
  message: string;
  onDismiss: () => void;
}

/** Why an export failed, shown where the Export menu opens. */
export function ExportErrorCard({ message, onDismiss }: ExportErrorCardProps) {
  return (
    <div
      role="alert"
      className="oc-enter-pop absolute right-0 top-full mt-2 z-30 w-80 rounded-lg border border-destructive/30 bg-surface p-3 shadow-lg"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-destructive">
            Export failed
          </p>
          <p className="text-xs text-muted-foreground mt-1 break-words">
            {message}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
          aria-label="Dismiss export error"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
