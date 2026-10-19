import {
  cloneElement,
  isValidElement,
  useId,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { cx } from "./cx";

type ControlA11yProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  required?: boolean;
};

type FieldProps = {
  /** Visible label. Always shown; never replace it with a placeholder. */
  label: ReactNode;
  /** One control: <Input>, <Select>, <Textarea>, <NumberInput> or any element taking id/aria props. */
  children: ReactElement<ControlA11yProps>;
  /** Short help under the label, e.g. "Format 165,5". */
  help?: ReactNode;
  /** Error text. When set, the control gets aria-invalid and the text is linked with aria-describedby. */
  error?: ReactNode;
  /** Marks the label with "(wajib)" and sets `required` on the control. */
  required?: boolean;
  /** Visually hide the label (it stays in the accessibility tree). Use only inside table cells with a column header. */
  hideLabel?: boolean;
  className?: string;
};

/**
 * Label + control + help + error, wired for assistive tech.
 * Server-component friendly (uses only useId). The control's own id wins if it has one.
 */
export function Field({
  label,
  children,
  help,
  error,
  required,
  hideLabel = false,
  className,
}: FieldProps) {
  const autoId = useId();
  const control = isValidElement(children) ? children : null;
  const controlId = control?.props.id ?? `field-${autoId}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [control?.props["aria-describedby"], helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label
        htmlFor={controlId}
        className={cx("text-sm font-semibold text-ink", hideLabel && "sr-only")}
      >
        {label}
        {required ? <span className="font-normal text-ink-muted"> (wajib)</span> : null}
      </label>
      {help ? (
        <p id={helpId} className="text-xs text-ink-muted">
          {help}
        </p>
      ) : null}
      {control
        ? cloneElement(control, {
            id: controlId,
            "aria-describedby": describedBy,
            "aria-invalid": error ? true : control.props["aria-invalid"],
            required: required ?? control.props.required,
          })
        : children}
      {error ? (
        <p id={errorId} className="text-xs font-semibold text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/*
 * Shared control look (DESIGN.md Field): white surface, --line-strong border (3.81:1), 6px
 * radius, 2px emerald focus outline (global :focus-visible). 16px text and 44px height below
 * 1024px (no iOS zoom, thumb-sized), 14px / 40px from 1024px. aria-invalid switches the
 * border to --critical.
 */
const controlBase =
  "block w-full min-w-0 rounded-control border border-line-strong bg-surface text-ink " +
  "text-base lg:text-sm placeholder:text-ink-muted " +
  "transition-colors duration-120 hover:border-ink focus-visible:outline-offset-0 " +
  "aria-invalid:border-critical aria-invalid:ring-1 aria-invalid:ring-inset aria-invalid:ring-critical " +
  "disabled:bg-neutral-tint disabled:text-ink-muted disabled:cursor-not-allowed";

// :read-only also matches <select>, so only text-like controls get the read-only look.
const readOnlyLook = "read-only:bg-surface-sunken read-only:border-line";

const singleLine = "min-h-11 px-3 lg:min-h-10";

export function Input({ className, type = "text", ...rest }: ComponentProps<"input">) {
  return (
    <input type={type} className={cx(controlBase, singleLine, readOnlyLook, className)} {...rest} />
  );
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    // pr-9 keeps the text clear of the chevron (px-3 from singleLine would otherwise win over .select-control).
    <select className={cx(controlBase, singleLine, "select-control truncate pr-9", className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, rows = 3, ...rest }: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={rows}
      className={cx(controlBase, readOnlyLook, "px-3 py-2 leading-normal", className)}
      {...rest}
    />
  );
}

type NumberInputProps = Omit<ComponentProps<"input">, "type" | "inputMode"> & {
  /** Allow a decimal part (height, weight). Scores 1 to 5 leave this off. */
  decimal?: boolean;
  /** Unit shown after the value, e.g. "cm" or "kg". Visual only: put the unit in the label too ("Tinggi (cm)"). */
  unit?: string;
  /** Right-align the digits (entry grids). Default true. */
  alignEnd?: boolean;
};

/**
 * Numeric entry that behaves on phones: a text input with a numeric keypad
 * (no type=number, so the scroll wheel cannot change a score and "165,5" is accepted).
 * Parse the submitted value with parseDecimal().
 */
export function NumberInput({
  decimal = false,
  unit,
  alignEnd = true,
  className,
  ...rest
}: NumberInputProps) {
  const input = (
    <input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      spellCheck={false}
      className={cx(
        controlBase,
        singleLine,
        readOnlyLook,
        "tabular-nums",
        alignEnd && "text-right",
        unit && "pr-10",
        className,
      )}
      {...rest}
    />
  );
  if (!unit) return input;
  return (
    <span className="relative block">
      {input}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-muted"
      >
        {unit}
      </span>
    </span>
  );
}

/**
 * Parses what people type in Indonesia: "165,5", "165.5", " 72 ". Returns null for
 * empty input and NaN for anything that is not a number, so callers can tell
 * "left blank" from "typed something wrong".
 */
export function parseDecimal(raw: FormDataEntryValue | string | null | undefined): number | null {
  if (raw == null) return null;
  const text = String(raw).trim().replace(/\s+/g, "");
  if (text === "") return null;
  const normalised = text.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return Number.NaN;
  return Number(normalised);
}
