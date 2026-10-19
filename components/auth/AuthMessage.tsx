import type { ReactNode } from "react";

/**
 * A message at the top of an auth form. Always mounted, so a screen reader announces the text when
 * it appears: errors with role="alert", information with role="status".
 */
export function AuthMessage({ tone, children }: { tone: "error" | "info"; children?: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"} className="not-empty:mb-5">
      {children ? (
        <p
          className={
            tone === "error"
              ? "rounded-control bg-critical-tint px-3 py-2.5 text-sm font-semibold text-critical"
              : "rounded-control bg-good-tint px-3 py-2.5 text-sm font-semibold text-good"
          }
        >
          {children}
        </p>
      ) : null}
    </div>
  );
}
