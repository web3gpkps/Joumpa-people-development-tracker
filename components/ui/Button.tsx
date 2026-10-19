import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

/**
 * primary: deep emerald, at most one per view. secondary: white with a --line-strong border.
 * ghost: emerald text, no border. danger: critical fill, confirmations only.
 * delete: critical text, no fill: the "Hapus …" that opens a confirmation, at the left of a dialog footer.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "delete";
/** md: 44px below 1024px, 40px from 1024px. sm: 44px below 1024px, 32px from 1024px (dense tables). */
export type ButtonSize = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-control text-sm font-semibold whitespace-nowrap select-none " +
  "transition-colors duration-120 " +
  "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const sizes: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 lg:min-h-10",
  sm: "min-h-11 px-3 lg:min-h-8",
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-strong active:bg-brand-strong " +
    "disabled:bg-neutral-tint disabled:text-ink-muted",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-bg active:bg-neutral-tint " +
    "disabled:border-line disabled:text-ink-muted",
  ghost: "bg-transparent text-brand hover:bg-brand-tint active:bg-brand-tint disabled:text-ink-muted",
  danger:
    "bg-critical text-white hover:bg-critical-strong active:bg-critical-strong " +
    "disabled:bg-neutral-tint disabled:text-ink-muted",
  delete: "bg-transparent text-critical hover:bg-critical-tint active:bg-critical-tint disabled:text-ink-muted",
};

/** Button classes for elements that are not a <Button> (e.g. a <label> or <summary>). */
export function buttonClasses({
  variant = "primary",
  size = "md",
  fullWidth = false,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
} = {}): string {
  return cx(base, sizes[size], variants[variant], fullWidth && "w-full");
}

type ButtonProps = Omit<ComponentProps<"button">, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Disables the button and swaps the label for `loadingText`. No spinner (MOTION 1). */
  loading?: boolean;
  /** Label shown while loading, e.g. "Menyimpan…". Name the action in progress. */
  loadingText?: ReactNode;
  /** Name the object: "Simpan nilai", "Catat cek BMI", "Cetak laporan". */
  children: ReactNode;
};

/**
 * Button. Server-component friendly (no hooks). `type` defaults to "button" so a
 * button inside a form never submits by accident; pass type="submit" explicitly.
 */
export function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  loading = false,
  loadingText,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      className={cx(buttonClasses({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

/** A next/link styled as a button, for actions that navigate. Defaults to secondary. */
export function ButtonLink({ variant = "secondary", size = "md", fullWidth, className, ...rest }: ButtonLinkProps) {
  return <Link data-variant={variant} className={cx(buttonClasses({ variant, size, fullWidth }), className)} {...rest} />;
}
