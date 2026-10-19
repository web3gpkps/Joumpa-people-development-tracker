import { Suspense } from "react";
import type { Metadata } from "next";
import { LinkScreenRoute } from "@/components/shell/ScreenRoute";
import { RencanaAksiLoading, RencanaAksiScreen } from "@/components/rencana-aksi/RencanaAksiScreen";

export const metadata: Metadata = { title: "Rencana Aksi" };

/** Rencana Aksi, station link (scope from the token). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ params, searchParams }: PageProps<"/s/[token]/rencana-aksi">) {
  return (
    <Suspense fallback={<RencanaAksiLoading />}>
      <LinkScreenRoute params={params} searchParams={searchParams} sheet="rencanaAksi" screen={RencanaAksiScreen} />
    </Suspense>
  );
}
