import { Suspense } from "react";
import type { Metadata } from "next";
import { OwnerScreenRoute } from "@/components/shell/ScreenRoute";
import { LaporanBulananLoading, LaporanBulananScreen } from "@/components/laporan-bulanan/LaporanBulananScreen";

export const metadata: Metadata = { title: "Laporan Bulanan" };

/** Laporan Bulanan, owner (all stations). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ searchParams }: PageProps<"/admin/laporan-bulanan">) {
  return (
    <Suspense fallback={<LaporanBulananLoading />}>
      <OwnerScreenRoute searchParams={searchParams} screen={LaporanBulananScreen} />
    </Suspense>
  );
}
