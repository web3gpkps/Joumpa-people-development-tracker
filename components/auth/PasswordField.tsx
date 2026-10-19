"use client";

import { useId, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/Field";

type PasswordFieldProps = Omit<ComponentProps<"input">, "type" | "children"> & {
  label: string;
  error?: string;
  help?: string;
};

/**
 * Password input with a "Tampilkan" toggle (typing a new password blind on a phone is how people
 * lock themselves out). The button's text says what it will do next ("Tampilkan" / "Sembunyikan",
 * plus the field name for screen readers, so the visible text is part of the accessible name).
 * Label, help and error are wired to the input itself (Field would attach them to the wrapper,
 * which holds the toggle button too). The toggle is a real button, 44px on phones, and never
 * submits the form.
 */
export function PasswordField({ label, error, help, id, ...rest }: PasswordFieldProps) {
  const autoId = useId();
  const inputId = id ?? `password-${autoId}`;
  const helpId = help ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  const [shown, setShown] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {help ? (
        <p id={helpId} className="text-xs text-ink-muted">
          {help}
        </p>
      ) : null}
      <span className="relative block">
        <Input
          {...rest}
          id={inputId}
          type={shown ? "text" : "password"}
          className="pr-32"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-controls={inputId}
          className="absolute inset-y-0 right-0 min-w-28 rounded-r-control px-3 text-sm font-semibold text-brand hover:bg-brand-tint"
        >
          {shown ? "Sembunyikan" : "Tampilkan"}
          <span className="sr-only"> {label.toLowerCase()}</span>
        </button>
      </span>
      {error ? (
        <p id={errorId} className="text-xs font-semibold text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}
