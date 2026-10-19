import { Suspense } from "react";
import type { Metadata } from "next";
import { OwnerScreenRoute } from "@/components/shell/ScreenRoute";
import { BmiLoading, BmiScreen } from "@/components/bmi/BmiScreen";

// Health data: the title never carries a name or a measurement.
export const metadata: Metadata = { title: "Cek BMI" };

/** Cek BMI, owner (all stations). The screen is shared by /s/[token], /cabang and /admin. */
export default function Page({ searchParams }: PageProps<"/admin/bmi">) {
  return (
    <Suspense fallback={<BmiLoading />}>
      <OwnerScreenRoute searchParams={searchParams} screen={BmiScreen} />
    </Suspense>
  );
}
