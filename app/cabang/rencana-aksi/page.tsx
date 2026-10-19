import { Suspense } from "react";
import type { Metadata } from "next";
import { AccountScreenRoute } from "@/components/shell/ScreenRoute";
import { RencanaAksiLoading, RencanaAksiScreen } from "@/components/rencana-aksi/RencanaAksiScreen";

export const metadata: Metadata = { title: "Rencana Aksi" };

/** Rencana Aksi, signed-in branch account (scope from the account's branch). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ searchParams }: PageProps<"/cabang/rencana-aksi">) {
  return (
    <Suspense fallback={<RencanaAksiLoading />}>
      <AccountScreenRoute searchParams={searchParams} sheet="rencanaAksi" screen={RencanaAksiScreen} />
    </Suspense>
  );
}
