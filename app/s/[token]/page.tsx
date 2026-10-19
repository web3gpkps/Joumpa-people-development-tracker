import { Suspense } from "react";
import type { Metadata } from "next";
import { APP_NAME } from "@/lib/app-info";
import { LinkScreenRoute } from "@/components/shell/ScreenRoute";
import { DashboardLoading, DashboardScreen } from "@/components/dashboard/DashboardScreen";

// The layout's title template only reaches child segments, not this index page.
export const metadata: Metadata = { title: { absolute: `Beranda | ${APP_NAME}` } };

// Sits in the same segment as the token gate, which must reach the database on every request.
export const instant = false;

/**
 * Beranda, link. A single-station link is sent to Rencana Aksi (its home); KPS links get the
 * dashboard. The screen is shared with /admin and /cabang.
 */
export default function Page({ params, searchParams }: PageProps<"/s/[token]">) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <LinkScreenRoute params={params} searchParams={searchParams} sheet="dashboard" screen={DashboardScreen} />
    </Suspense>
  );
}
