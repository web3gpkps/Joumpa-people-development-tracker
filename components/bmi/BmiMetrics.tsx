import type { ReactNode } from "react";
import { bmiCheckName } from "@/lib/bmi-periods";
import type { TrackerMetrics } from "./tracker-model";

type MetricProps = {
  label: string;
  value: ReactNode;
  foot: string;
  tone?: "good" | "late" | "above";
  /** 0..100: a thin bar under the foot. */
  progress?: number;
  icon?: ReactNode;
};

function Metric({ label, value, foot, tone, progress, icon }: MetricProps) {
  return (
    <div className="bmi-metric" data-tone={tone}>
      <p className="bmi-metric-label">{label}</p>
      <p className="bmi-metric-value" data-numeric>
        {value}
      </p>
      <p className="bmi-metric-foot">{foot}</p>
      {progress !== undefined ? (
        <div className="bmi-metric-bar" aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      ) : null}
      {icon ? (
        <span className="bmi-metric-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
    </div>
  );
}

const svg = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", focusable: false } as const;

/** People, a clock and a weighing scale: what each of the three counts is about. */
const PeopleIcon = (
  <svg {...svg}>
    <circle cx="8" cy="5" r="2.6" />
    <path d="M2.5 14c.4-3 2.8-4.6 5.5-4.6s5.1 1.6 5.5 4.6" />
  </svg>
);
const ClockIcon = (
  <svg {...svg}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M8 4.8V8l2.2 1.4" />
  </svg>
);
const ScaleIcon = (
  <svg {...svg}>
    <rect x="2.2" y="2.4" width="11.6" height="11.2" rx="2.4" />
    <path d="M5.2 6.2a3.6 3.6 0 0 1 5.6 0M8 8.2 9.6 6.6" />
  </svg>
);

/**
 * Four counts above the sheet. Tone is fixed per card (green checked, red late, amber above
 * normal), as in the CGK prototype; the foot names what is counted.
 */
export function BmiMetrics({
  metrics,
  period,
  scopeFoot,
}: {
  metrics: TrackerMetrics;
  period: number;
  scopeFoot: string;
}) {
  return (
    <section className="bmi-metrics" aria-label="Ringkasan cek BMI" data-print="hide">
      <Metric label="Total SDM" value={metrics.total} foot={scopeFoot} icon={PeopleIcon} />
      <Metric
        label="Sudah diperiksa"
        value={metrics.checked}
        foot={`${bmiCheckName(period)} · ${metrics.checkedPct}% selesai`}
        tone="good"
        progress={metrics.checkedPct}
      />
      <Metric label="Terlambat cek" value={metrics.late} foot="Memerlukan tindak lanjut" tone="late" icon={ClockIcon} />
      <Metric
        label="BMI di atas normal"
        value={metrics.aboveNormal}
        foot="Overweight + Obesitas, nilai terakhir"
        tone="above"
        icon={ScaleIcon}
      />
    </section>
  );
}

/** Static stand-ins while the page loads (no numbers, no motion). */
export function BmiMetricsSkeleton() {
  return (
    <div className="bmi-metrics" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bmi-metric">
          <span className="bmi-skeleton" style={{ width: "40%", height: 12 }} />
          <span className="bmi-skeleton" style={{ width: "28%", height: 28, marginTop: 14 }} />
          <span className="bmi-skeleton" style={{ width: "62%", height: 12, marginTop: 14 }} />
        </div>
      ))}
    </div>
  );
}
