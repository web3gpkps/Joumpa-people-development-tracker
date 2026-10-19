"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cx } from "@/components/ui/cx";
import { isNavActive, type NavLink, type NavSection } from "@/lib/workspace/access";
import { Icon, navIconName } from "./NavIcon";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

function navLinkClasses(active: boolean): string {
  return cx(
    "group flex min-h-11 items-center gap-3 rounded-control px-3 text-sm transition-colors duration-120 lg:min-h-9",
    active ? "bg-brand-tint font-semibold text-navy" : "text-[#d3e6dd] hover:bg-white/8 hover:text-white",
  );
}

/**
 * The grouped nav list, shared by the sidebar (≥1024px) and the phone menu sheet. A group is an
 * uppercase caption over its items; the items are indented under it on a vertical guide line
 * that runs from the caption to the last item, and groups are split by a hairline. Every item carries its icon,
 * and the current page is a light pill (navy on brand-tint, 12.5:1; the pill on the sidebar green 12.5:1).
 */
function NavList({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const idPrefix = useId();
  return (
    <div className="flex flex-col">
      {sections.map((section, index) => {
        const headingId = `${idPrefix}-${section.key}`;
        return (
          <div key={section.key} className={cx(index > 0 && "mt-3 border-t border-white/15 pt-3")}>
            <p id={headingId} className="nav-label mb-1 px-3 py-1">
              {section.label}
            </p>
            <ul aria-labelledby={headingId} className="ml-3 flex flex-col gap-0.5 border-l border-white/20 pl-2">
              {section.items.map((item) => {
                const active = isNavActive(pathname, item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={onNavigate}
                      className={navLinkClasses(active)}
                    >
                      <Icon
                        name={navIconName(item.key)}
                        className={cx(
                          "shrink-0 transition-colors duration-120",
                          active ? "text-brand" : "text-[#8db3a3] group-hover:text-white",
                        )}
                      />
                      <span className="min-w-0 py-2">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** "Keluar" as a row of the sidebar or sheet footer. Render inside the sign-out <form>. */
export function SignOutRowButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={cx(navLinkClasses(false), "w-full disabled:cursor-not-allowed")}>
      <Icon name="signOut" className="shrink-0 text-[#8db3a3] transition-colors duration-120 group-hover:text-white" />
      {pending ? "Keluar…" : "Keluar"}
    </button>
  );
}

/** Sidebar navigation (≥1024px). Client only for the active item. */
export function SidebarNav({ sections, label }: { sections: NavSection[]; label: string }) {
  return (
    <nav aria-label={label}>
      <NavList sections={sections} />
    </nav>
  );
}

type MobileChromeProps = {
  /** Same groups as the sidebar. */
  sections: NavSection[];
  /** Phone bottom bar links (<640px), three at most; "Menu" is added after them and the cells share the width. */
  bottomItems: NavLink[];
  /** Accessible name of the nav landmarks, e.g. "Menu Stasiun SUB". */
  label: string;
  /** Logo at 24px, rendered on the server. */
  brand: ReactNode;
  /** Where the logo leads (Beranda). */
  homeHref: string;
  /** Short scope next to the logo: a station code ("SUB", "KPS") or "Pemilik". */
  scopeShort: string;
  /** Scope card under the logo row of the sheet: scope line and programme week. Names the dialog. */
  sheetHeader: ReactNode;
  /** Bottom of the sheet: link label, or the owner's email and "Keluar". */
  sheetFooter?: ReactNode;
};

/**
 * Chrome under 1024px: a 56px top bar (logo, scope code, "Menu") and, under 640px, a bottom
 * bar of icons over labels (Beranda, Penilaian, Cek BMI, Menu). Both "Menu" buttons open the
 * same left sheet on a native modal <dialog>: the page behind is inert, Tab cycles inside,
 * Escape and the backdrop close it, and focus returns to the button that opened it.
 */
export function MobileChrome({
  sections,
  bottomItems,
  label,
  brand,
  homeHref,
  scopeShort,
  sheetHeader,
  sheetFooter,
}: MobileChromeProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const sheetId = useId();
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      setOpen(false);
    };
    const onClose = () => {
      const target = returnFocusTo.current;
      returnFocusTo.current = null;
      if (target?.isConnected) target.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
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
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      dialog.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const close = () => setOpen(false);
  const inMenu = !bottomItems.some((item) => isNavActive(pathname, item));
  const menuButton = (extra: string, icon: ReactNode) => (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={sheetId}
      onClick={() => setOpen(true)}
      className={extra}
    >
      {icon}
      <span>Menu</span>
    </button>
  );

  return (
    <>
      <header
        data-print="hide"
        className="sticky top-0 z-30 flex h-(--topbar-height) items-center gap-3 border-b border-line bg-surface px-4 shadow-card sm:px-6 lg:hidden"
      >
        <Link href={homeHref} aria-label="Beranda" className="flex shrink-0 items-center rounded-control">
          {brand}
        </Link>
        <span className="station-code min-w-0 truncate border-l border-line pl-3 text-sm text-ink">{scopeShort}</span>
        {/* Under 640px the bottom bar carries "Menu"; the top bar keeps only the logo and scope. */}
        {menuButton(
          "ml-auto inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-sm font-semibold text-ink transition-colors duration-120 hover:bg-bg max-sm:hidden",
          <Icon name="menu" />,
        )}
      </header>

      <nav
        aria-label={`${label}, pintasan`}
        data-print="hide"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <ul
          className="grid h-(--bottombar-height)"
          style={{ gridTemplateColumns: `repeat(${bottomItems.length + 1}, minmax(0, 1fr))` }}
        >
          {bottomItems.map((item) => {
            const active = isNavActive(pathname, item);
            return (
              <li key={item.href} className="flex min-w-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(bottomItemClasses, active ? "font-semibold text-brand" : "text-ink-muted hover:text-ink")}
                >
                  <span className={cx(bottomIconClasses, active && "bg-brand-tint")}>
                    <Icon name={navIconName(item.key)} />
                  </span>
                  <span className="max-w-full truncate px-1">{item.shortLabel}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0">
            {/* A page that is not in the bar lives under "Menu": mark it as where you are. */}
            {menuButton(
              cx(bottomItemClasses, inMenu ? "font-semibold text-brand" : "text-ink-muted hover:text-ink"),
              <span className={cx(bottomIconClasses, inMenu && "bg-brand-tint")}>
                <Icon name="menu" />
              </span>,
            )}
          </li>
        </ul>
      </nav>

      <dialog
        ref={dialogRef}
        id={sheetId}
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className={cx(
          "on-navy fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(20rem,85vw)] max-w-none border-0 bg-navy p-0 text-white shadow-float",
          "open:flex open:flex-col backdrop:bg-ink/40",
        )}
      >
        <div className="flex flex-col gap-3 border-b border-white/15 px-3 pt-3 pb-4">
          <div className="flex items-center justify-between gap-2">
            <Link
              href={homeHref}
              aria-label="Beranda"
              onClick={close}
              className="flex min-w-0 items-center rounded-control bg-white px-3 py-2"
            >
              {brand}
            </Link>
            <button
              type="button"
              onClick={close}
              className="-mr-1 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control px-3 text-sm font-semibold text-[#d3e6dd] transition-colors duration-120 hover:bg-white/8 hover:text-white"
            >
              <Icon name="close" />
              Tutup
            </button>
          </div>
          <div id={titleId}>{sheetHeader}</div>
        </div>
        <nav aria-label={label} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          <NavList sections={sections} onNavigate={close} />
        </nav>
        {sheetFooter ? <div className="border-t border-white/15 p-3">{sheetFooter}</div> : null}
      </dialog>
    </>
  );
}

/** Bottom bar cell: icon over a 13px label; the current page gets a tinted pill behind its icon. */
const bottomItemClasses =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors duration-120";
const bottomIconClasses = "flex h-7 w-12 items-center justify-center rounded-control transition-colors duration-120";
