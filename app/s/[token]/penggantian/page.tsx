import { Suspense } from "react";
import type { Metadata } from "next";
import { LinkScreenRoute } from "@/components/shell/ScreenRoute";
import { PenggantianLoading, PenggantianScreen } from "@/components/penggantian/PenggantianScreen";

export const metadata: Metadata = { title: "Penggantian SDM" };

/** Penggantian SDM, station link (scope from the token). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ params, searchParams }: PageProps<"/s/[token]/penggantian">) {
  return (
    <Suspense fallback={<PenggantianLoading />}>
      <LinkScreenRoute params={params} searchParams={searchParams} sheet="penggantian" screen={PenggantianScreen} />
    </Suspense>
  );
}
