import Link from "next/link";
import type { ReactNode } from "react";
import { TableSkeleton } from "@/components/ui/States";
import { BOTTOM_BAR_KEYS, type NavSection } from "@/lib/workspace/access";
import { Logo } from "./Logo";
import { Icon } from "./NavIcon";
import { MobileChrome, SidebarNav } from "./ShellNav";

/** Page gutter (16 phone, 24 from 640, 32 from 1280) and section rhythm, for content outside the shell. */
export const pageGutter = "px-4 sm:px-6 xl:px-8";

type ShellFrameProps = {
  /** Grouped navigation from navSections(access, isKps). */
  sections: NavSection[];
  /** Where the logo leads (Beranda). */
  homeHref: string;
  /** Scope line under the logo: "Stasiun SUB", "KPS · semua stasiun", "Pemilik · semua stasiun". */
  scopeLabel: string;
  /** Short scope for the phone top bar: a station code ("SUB", "KPS") or "Pemilik". */
  scopeShort: string;
  /** Programme line under the scope ("Minggu ke-2 dari 10"), caption muted. Optional. */
  weekLine?: ReactNode;
  /** Sidebar / sheet footer: the link label, or the owner's email and "Keluar". */
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * The app shell (DESIGN.md Shell and navigation), shared by station links and the owner.
 * ≥1024px: fixed 232px deep green sidebar in three bands split by hairlines: identity (logo on a
 * white chip, scope card with the programme week), grouped nav with an icon per item, footer.
 * <1024px: 56px top bar with a "Menu" sheet; <640px also a bottom bar. Chrome is hidden in print.
 * Server component; only the nav (active state, sheet) runs on the client.
 */
export function ShellFrame({ sections, homeHref, scopeLabel, scopeShort, weekLine, footer, children }: ShellFrameProps) {
  const allLinks = sections.flatMap((s) => s.items);
  const bottomItems = BOTTOM_BAR_KEYS.map((key) => allLinks.find((l) => l.key === key)).filter((l) => l !== undefined);
  const navLabel = `Menu ${scopeLabel}`;
  const scopeBlock = <ScopeCard scopeLabel={scopeLabel} weekLine={weekLine} />;

  return (
    <div className="min-h-dvh">
      <a
        href="#isi"
        className="sr-only z-50 rounded-control border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-float focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Lewati ke isi halaman
      </a>

      <aside
        data-print="hide"
        className="on-navy fixed inset-y-0 left-0 z-20 hidden w-(--sidebar-width) flex-col bg-navy text-white lg:flex"
      >
        <div className="flex flex-col gap-3 border-b border-white/15 px-3 py-4">
          <Link href={homeHref} aria-label="Beranda" className={logoChipClasses}>
            <Logo height={24} />
          </Link>
          {scopeBlock}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          <SidebarNav sections={sections} label={navLabel} />
        </div>
        {footer ? <div className="border-t border-white/15 p-3">{footer}</div> : null}
      </aside>

      <MobileChrome
        sections={sections}
        bottomItems={bottomItems}
        label={navLabel}
        brand={<Logo height={24} />}
        homeHref={homeHref}
        scopeShort={scopeShort}
        sheetHeader={scopeBlock}
        sheetFooter={footer}
      />

      <div data-shell-main="" className="lg:pl-(--sidebar-width)">
        <main
          id="isi"
          data-shell-main=""
          className={`${pageGutter} mx-auto w-full max-w-[1440px] pt-6 pb-[calc(var(--bottombar-height)+env(safe-area-inset-bottom)+24px)] sm:pb-8`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

const logoChipClasses = "flex items-center rounded-control bg-white px-3 py-2.5";

/** Where this view looks: the scope line and, when known, the programme week, on a raised card. */
function ScopeCard({ scopeLabel, weekLine }: { scopeLabel: string; weekLine?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-control bg-white/6 px-3 py-2.5 ring-1 ring-white/12 ring-inset">
      <p className="flex items-center gap-2 text-sm font-semibold text-white">
        <Icon name="station" size={16} className="mx-0.5 shrink-0 text-[#8db3a3]" />
        <span className="min-w-0 truncate" title={scopeLabel}>
          {scopeLabel}
        </span>
      </p>
      {weekLine ? <div className="mt-1 text-xs text-[#b4d2c4] empty:hidden">{weekLine}</div> : null}
    </div>
  );
}

/** "Minggu ke-2 dari 10" with its calendar icon, for the scope card. */
export function WeekLine({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <Icon name="calendar" size={16} className="mx-0.5 shrink-0 text-[#8db3a3]" />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/**
 * Sidebar and sheet footer: who is using this view (an account, or the link label), on the same
 * icon column as the nav rows, with an optional row under it such as "Keluar".
 */
export function ShellIdentity({ icon, text, action }: { icon: "user" | "link"; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="flex min-h-9 items-center gap-3 px-3 text-xs text-[#d3e6dd]">
        <Icon name={icon} className="shrink-0 text-[#8db3a3]" />
        <span className="min-w-0 truncate" title={text}>
          {text}
        </span>
      </p>
      {action}
    </div>
  );
}

/**
 * Static shell shown while a gate runs. Prerendered, so it reads no request data and
 * renders no client nav (usePathname would block prerendering): logo, scope, skeleton.
 */
export function ShellLoading({ scopeLabel }: { scopeLabel: string }) {
  return (
    <div className="min-h-dvh">
      <aside
        data-print="hide"
        className="fixed inset-y-0 left-0 z-20 hidden w-(--sidebar-width) flex-col bg-navy text-white lg:flex"
      >
        <div className="flex flex-col gap-3 border-b border-white/15 px-3 py-4">
          <span className={logoChipClasses}>
            <Logo height={24} />
          </span>
          <ScopeCard scopeLabel={scopeLabel} />
        </div>
      </aside>
      <header
        data-print="hide"
        className="sticky top-0 z-30 flex h-(--topbar-height) items-center border-b border-line bg-surface px-4 sm:px-6 lg:hidden"
      >
        <Logo height={24} />
      </header>
      <div data-shell-main="" className="lg:pl-(--sidebar-width)">
        <main data-shell-main="" className={`${pageGutter} mx-auto flex w-full max-w-[1440px] flex-col gap-6 py-6`}>
          <div aria-hidden="true" className="h-7 w-48 rounded-control bg-neutral-tint" />
          <TableSkeleton rows={6} label="Membuka halaman" />
        </main>
      </div>
    </div>
  );
}
