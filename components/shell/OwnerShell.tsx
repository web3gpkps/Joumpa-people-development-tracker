import { Suspense, cache, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { OWNER_ACCESS, navSections } from "@/lib/workspace/access";
import { ShellFrame, ShellIdentity, ShellLoading, WeekLine } from "./ShellFrame";
import { ShellSignOut } from "./SignOutButton";
import { bmiScheduleLine, todayInJakarta } from "./programme-calendar";

const OWNER_SCOPE = "Pemilik · semua stasiun";

/**
 * "Cek BMI ke-N: <date>" for the owner, from public.pd_settings (id = 1). Renders nothing when
 * the schedule cannot be read or is incomplete: the line is context, never a blocker.
 * Render inside <Suspense>; it reads cookies and the clock at request time.
 */
const readSchedule = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pd_settings")
    .select("bmi_first_check, bmi_interval_days, bmi_periods")
    .eq("id", 1)
    .maybeSingle();
  return data;
});

async function OwnerWeekLine() {
  // Rendered twice (sidebar and phone sheet); cache() makes it one query per request.
  const data = await readSchedule();
  if (!data?.bmi_first_check || !data.bmi_interval_days || !data.bmi_periods) return null;
  return <WeekLine>{bmiScheduleLine(data, todayInJakarta())}</WeekLine>;
}

/**
 * Owner area chrome (/admin): every station, plus Pengelolaan (Tautan Akses, Parameter,
 * Sinkronisasi). Signed-in admin only. Footer: the account email and "Keluar".
 */
export function OwnerShell({ email, children }: { email: string; children: ReactNode }) {
  return (
    <ShellFrame
      sections={navSections(OWNER_ACCESS)}
      homeHref={OWNER_ACCESS.basePath}
      scopeLabel={OWNER_SCOPE}
      scopeShort="Pemilik"
      weekLine={
        <Suspense fallback={null}>
          <OwnerWeekLine />
        </Suspense>
      }
      footer={<ShellIdentity icon="user" text={email} action={<ShellSignOut />} />}
    >
      {children}
    </ShellFrame>
  );
}

export function OwnerShellLoading() {
  return <ShellLoading scopeLabel={OWNER_SCOPE} />;
}
