import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/app-info";
import { Logo } from "./Logo";

type AuthFrameProps = {
  /** Page heading (h1). */
  title: ReactNode;
  /** One short sentence under the heading, when the screen needs it. */
  intro?: ReactNode;
  children?: ReactNode;
  /** One muted line under the panel. */
  footnote?: ReactNode;
};

/**
 * Frame for screens outside the shells (login, access problems): logo, app name, title,
 * then the content, on one white panel. No gradient, no decoration.
 */
export function AuthFrame({ title, intro, children, footnote }: AuthFrameProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-[25rem]">
        <section aria-labelledby="auth-frame-title" className="rounded-panel border border-line bg-surface px-6 py-8 sm:px-8">
          <Logo height={40} />
          <p className="mt-6 text-xs text-ink-muted">{APP_NAME}</p>
          <h1 id="auth-frame-title" className="mt-1 text-xl font-semibold text-ink">
            {title}
          </h1>
          {intro ? <div className="mt-2 text-sm wrap-break-word text-ink-muted">{intro}</div> : null}
          {children ? <div className="mt-6">{children}</div> : null}
        </section>
        {footnote ? <p className="mt-4 px-1 text-xs text-ink-muted">{footnote}</p> : null}
      </div>
    </main>
  );
}
