"use client";

import { useEffect } from "react";

export function useEscapeDismiss(active: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, onDismiss]);
}
