import { Suspense } from "react";
import type { Metadata } from "next";
import { AccountScreenRoute } from "@/components/shell/ScreenRoute";
import { BmiLoading, BmiScreen } from "@/components/bmi/BmiScreen";

// Health data: the title never carries a name or a measurement.
export const metadata: Metadata = { title: "Cek BMI" };

/** Cek BMI, signed-in branch account (scope from the account's branch). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ searchParams }: PageProps<"/cabang/bmi">) {
  return (
    <Suspense fallback={<BmiLoading />}>
      <AccountScreenRoute searchParams={searchParams} sheet="bmi" screen={BmiScreen} />
    </Suspense>
  );
}
