import { Suspense } from "react";
import type { Metadata } from "next";
import { OwnerScreenRoute } from "@/components/shell/ScreenRoute";
import { PenggantianLoading, PenggantianScreen } from "@/components/penggantian/PenggantianScreen";

export const metadata: Metadata = { title: "Penggantian SDM" };

/** Penggantian SDM, owner (all stations). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ searchParams }: PageProps<"/admin/penggantian">) {
  return (
    <Suspense fallback={<PenggantianLoading />}>
      <OwnerScreenRoute searchParams={searchParams} screen={PenggantianScreen} />
    </Suspense>
  );
}
