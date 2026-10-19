import { Suspense } from "react";
import type { Metadata } from "next";
import { AccountScreenRoute } from "@/components/shell/ScreenRoute";
import { DashboardLoading, DashboardScreen } from "@/components/dashboard/DashboardScreen";

export const metadata: Metadata = { title: "Beranda" };

// Sits in the same segment as the account gate, which must reach the database on every request.
export const instant = false;

/**
 * Beranda, signed-in branch account. A single-station account is sent to Rencana Aksi (its home);
 * KPS accounts get the dashboard. The screen is shared with /admin and /s/[token].
 */
export default function Page({ searchParams }: PageProps<"/cabang">) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <AccountScreenRoute searchParams={searchParams} sheet="dashboard" screen={DashboardScreen} />
    </Suspense>
  );
}
