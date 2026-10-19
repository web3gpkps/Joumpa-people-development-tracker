import { Suspense } from "react";
import type { Metadata } from "next";
import { OwnerScreenRoute } from "@/components/shell/ScreenRoute";
import { TrackerStafLoading, TrackerStafScreen } from "@/components/tracker-staf/TrackerStafScreen";

export const metadata: Metadata = { title: "Tracker Staf" };

/** Tracker Staf, owner (all stations). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ searchParams }: PageProps<"/admin/tracker-staf">) {
  return (
    <Suspense fallback={<TrackerStafLoading />}>
      <OwnerScreenRoute searchParams={searchParams} screen={TrackerStafScreen} />
    </Suspense>
  );
}
