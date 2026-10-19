"use client";

import { Button, type ButtonVariant } from "./Button";

type ReloadButtonProps = {
  /** Default "Muat ulang halaman". */
  children?: React.ReactNode;
  variant?: ButtonVariant;
};

/** Reloads the page, for server-rendered error states (inside error.tsx use `retry`). */
export function ReloadButton({ children = "Muat ulang halaman", variant = "secondary" }: ReloadButtonProps) {
  return (
    <Button variant={variant} onClick={() => window.location.reload()}>
      {children}
    </Button>
  );
}
