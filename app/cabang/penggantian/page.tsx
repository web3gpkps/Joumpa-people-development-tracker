import { Suspense } from "react";
import type { Metadata } from "next";
import { AccountScreenRoute } from "@/components/shell/ScreenRoute";
import { PenggantianLoading, PenggantianScreen } from "@/components/penggantian/PenggantianScreen";

export const metadata: Metadata = { title: "Penggantian SDM" };

/** Penggantian SDM, signed-in branch account (scope from the account's branch). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ searchParams }: PageProps<"/cabang/penggantian">) {
  return (
    <Suspense fallback={<PenggantianLoading />}>
      <AccountScreenRoute searchParams={searchParams} sheet="penggantian" screen={PenggantianScreen} />
    </Suspense>
  );
}
