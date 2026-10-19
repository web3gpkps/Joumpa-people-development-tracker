import { Suspense } from "react";
import type { Metadata } from "next";
import { LinkScreenRoute } from "@/components/shell/ScreenRoute";
import { TrackerStafLoading, TrackerStafScreen } from "@/components/tracker-staf/TrackerStafScreen";

export const metadata: Metadata = { title: "Tracker Staf" };

/** Tracker Staf, station link (scope from the token). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ params, searchParams }: PageProps<"/s/[token]/tracker-staf">) {
  return (
    <Suspense fallback={<TrackerStafLoading />}>
      <LinkScreenRoute params={params} searchParams={searchParams} sheet="trackerStaf" screen={TrackerStafScreen} />
    </Suspense>
  );
}
