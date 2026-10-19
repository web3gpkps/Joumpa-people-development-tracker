import { Suspense } from "react";
import type { Metadata } from "next";
import { OwnerScreenRoute } from "@/components/shell/ScreenRoute";
import { RencanaAksiLoading, RencanaAksiScreen } from "@/components/rencana-aksi/RencanaAksiScreen";

export const metadata: Metadata = { title: "Rencana Aksi" };

/** Rencana Aksi, owner (all stations). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ searchParams }: PageProps<"/admin/rencana-aksi">) {
  return (
    <Suspense fallback={<RencanaAksiLoading />}>
      <OwnerScreenRoute searchParams={searchParams} screen={RencanaAksiScreen} />
    </Suspense>
  );
}
