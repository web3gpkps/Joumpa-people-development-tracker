import { Suspense } from "react";
import type { Metadata } from "next";
import { AccountScreenRoute } from "@/components/shell/ScreenRoute";
import { TrackerStafLoading, TrackerStafScreen } from "@/components/tracker-staf/TrackerStafScreen";

export const metadata: Metadata = { title: "Tracker Staf" };

/** Tracker Staf, signed-in branch account (scope from the account's branch). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ searchParams }: PageProps<"/cabang/tracker-staf">) {
  return (
    <Suspense fallback={<TrackerStafLoading />}>
      <AccountScreenRoute searchParams={searchParams} sheet="trackerStaf" screen={TrackerStafScreen} />
    </Suspense>
  );
}
