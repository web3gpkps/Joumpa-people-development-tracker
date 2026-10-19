"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const SHOW_MS = 3600;

/**
 * A short confirmation ("Perubahan tersimpan") that disappears by itself. The region stays in
 * the page so screen readers announce each message politely. Errors never use it: they stay
 * next to the field that failed.
 */
export function useToast(): { toast: (message: string) => void; node: ReactNode } {
  const [message, setMessage] = useState("");
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage(text);
    setShown(true);
    timer.current = setTimeout(() => setShown(false), SHOW_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const node = (
    <div className="bmi-toast" role="status" aria-live="polite" data-shown={shown || undefined}>
      {message}
    </div>
  );
  return { toast, node };
}
