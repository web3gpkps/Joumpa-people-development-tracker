"use client";

import { UrlSelect } from "./UrlSelect";
import type { UrlOption } from "./url-options";

type StationSelectProps = {
  /** One option per station plus { value: ALL_STATIONS, label: "Semua stasiun" } first. */
  options: UrlOption[];
  /** Station code shown now, or ALL_STATIONS. */
  current: string;
  /** Default "Stasiun". */
  label?: string;
  className?: string;
};

/**
 * THE station filter for KPS links and the owner (a station link sees one station, so it
 * never renders this). One native select, the same control as every other filter. The choice is
 * remembered per browser by RememberView (data-remember-stasiun-select).
 */
export function StationSelect({ options, current, label = "Stasiun", className }: StationSelectProps) {
  return (
    <UrlSelect
      label={label}
      options={options}
      current={current}
      className={className}
      selectProps={{ "data-remember-stasiun-select": "" }}
    />
  );
}

