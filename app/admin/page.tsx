import { Suspense } from "react";
import type { Metadata } from "next";
import { OwnerScreenRoute } from "@/components/shell/ScreenRoute";
import { DashboardLoading, DashboardScreen } from "@/components/dashboard/DashboardScreen";

export const metadata: Metadata = { title: "Beranda" };

// Sits in the same segment as the owner gate, which must check the session on every request.
export const instant = false;

/** Dashboard, owner (all stations). The screen is shared with /s/[token] and /cabang. */
export default function Page({ searchParams }: PageProps<"/admin">) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <OwnerScreenRoute searchParams={searchParams} screen={DashboardScreen} />
    </Suspense>
  );
}
