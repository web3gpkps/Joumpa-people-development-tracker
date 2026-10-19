import { Suspense } from "react";
import type { Metadata } from "next";
import { LinkScreenRoute } from "@/components/shell/ScreenRoute";
import { LaporanBulananLoading, LaporanBulananScreen } from "@/components/laporan-bulanan/LaporanBulananScreen";

export const metadata: Metadata = { title: "Laporan Bulanan" };

/** Laporan Bulanan, station link (scope from the token). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ params, searchParams }: PageProps<"/s/[token]/laporan-bulanan">) {
  return (
    <Suspense fallback={<LaporanBulananLoading />}>
      <LinkScreenRoute params={params} searchParams={searchParams} sheet="laporanBulanan" screen={LaporanBulananScreen} />
    </Suspense>
  );
}
