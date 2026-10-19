"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";

const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

type DialogProps = {
  /** Controlled open state. */
  open: boolean;
  /** Called on Escape, backdrop click (if dismissible) and the close button. Set open=false here. */
  onClose: () => void;
  /** Dialog heading; also its accessible name. Name the decision: "Cabut tautan SUB?" */
  title: ReactNode;
  /** One or two sentences under the title; linked as the accessible description. */
  description?: ReactNode;
  children?: ReactNode;
  /** Action buttons, right-aligned (stacked full width on phones), always visible under the scrolling body. Put the safe choice first. */
  footer?: ReactNode;
  /** Close when the backdrop is clicked. Default true; turn off while a save is running. */
  dismissible?: boolean;
  /** Width from 640px: "sm" 28rem (confirmations) or "md" 35rem / 560px (forms). Phones always get a full-screen sheet. */
  size?: "sm" | "md";
};

/**
 * Modal dialog on the native <dialog> element: showModal() makes the rest of the page
 * inert (focus stays inside), Escape closes, and focus returns to whatever opened it.
 * Client component.
 *
 *   const [open, setOpen] = useState(false);
 *   <Button onClick={() => setOpen(true)}>Cabut tautan</Button>
 *   <Dialog open={open} onClose={() => setOpen(false)} title="Cabut tautan SUB?"
 *     footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Batal</Button>
 *              <Button variant="danger" onClick={revoke}>Cabut tautan</Button></>}>
 *     Pemegang tautan tidak bisa lagi mengisi cek BMI.
 *   </Dialog>
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  size = "sm",
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Escape fires "cancel": keep the dialog controlled by the parent.
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    const handleClose = () => {
      const target = returnFocusTo.current;
      returnFocusTo.current = null;
      if (target && target.isConnected) target.focus();
    };
    // showModal() makes the page inert, but Tab can still leave for the browser UI.
    // Wrap it so focus cycles inside the dialog (WAI-ARIA modal dialog pattern).
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={(event) => {
        // A click whose target is the <dialog> itself landed on the backdrop.
        if (dismissible && event.target === event.currentTarget) onCloseRef.current();
      }}
      className={cx(
        // Phones: a full-screen sheet. From 640px: a centred 8px-radius panel, at most 560px wide.
        "fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-surface p-0 text-ink",
        "sm:m-auto sm:h-fit sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:rounded-panel sm:border sm:border-line sm:shadow-float",
        "open:flex open:flex-col",
        "backdrop:bg-ink/40",
        size === "sm" ? "sm:max-w-md" : "sm:max-w-[35rem]",
      )}
    >
      <div className="flex shrink-0 flex-col gap-1 border-b border-line px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="-mr-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control text-sm font-semibold text-ink-muted transition-colors duration-120 hover:bg-bg hover:text-ink lg:min-h-9"
          >
            Tutup
          </button>
        </div>
        {description ? (
          <p id={descriptionId} className="text-sm text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
      {children ? (
        // The body scrolls on its own, so the header and the footer stay on screen on phones.
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="px-4 py-4 text-sm sm:px-6">{children}</div>
        </div>
      ) : null}
      {footer ? (
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6 sm:pb-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * Action row for a form that lives inside the dialog body (its buttons belong to that
 * form, e.g. one per tab). Sticks to the bottom of the scrolling body, so the save
 * button stays visible on a phone while the fields scroll under it.
 */
export function DialogActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-[1] -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-surface px-4 py-3 sm:-mx-6 sm:flex-row sm:items-center sm:justify-end sm:px-6">
      {children}
    </div>
  );
}
