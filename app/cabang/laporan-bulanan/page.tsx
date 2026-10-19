import { Suspense } from "react";
import type { Metadata } from "next";
import { AccountScreenRoute } from "@/components/shell/ScreenRoute";
import { LaporanBulananLoading, LaporanBulananScreen } from "@/components/laporan-bulanan/LaporanBulananScreen";

export const metadata: Metadata = { title: "Laporan Bulanan" };

/** Laporan Bulanan, signed-in branch account (scope from the account's branch). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ searchParams }: PageProps<"/cabang/laporan-bulanan">) {
  return (
    <Suspense fallback={<LaporanBulananLoading />}>
      <AccountScreenRoute searchParams={searchParams} sheet="laporanBulanan" screen={LaporanBulananScreen} />
    </Suspense>
  );
}
