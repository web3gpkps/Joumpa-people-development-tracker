import type { ReactNode } from "react";

/**
 * The page banner of Cek BMI (the shared .hero gradient), laid out like PageHeader: the title, one
 * meta line, and the actions. A branch account keeps v1's name ("BMI Monitoring Tracker").
 * The buttons inside `.hero-actions` are restyled for the dark banner by app/globals.css.
 * Server-component friendly.
 */
export function BmiHero({
  title = "Cek BMI",
  meta,
  children,
}: {
  title?: string;
  /** Counts and nouns, e.g. "Stasiun DPS · Cek ke-1 · 1 dari 27 sudah dicek". */
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="hero bmi-hero">
      <div className="bmi-hero-copy">
        <h1>{title}</h1>
        {meta ? <p className="bmi-hero-meta">{meta}</p> : null}
      </div>
      {children ? (
        <div className="hero-actions bmi-hero-actions" data-print="hide">
          {children}
        </div>
      ) : null}
    </header>
  );
}
