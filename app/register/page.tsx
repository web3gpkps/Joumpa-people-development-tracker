import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { branchOptions } from "@/lib/accounts/rules";
import { getAccountSession } from "@/lib/supabase/account";
import { getAdminSession } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { AuthFrame } from "@/components/shell/AuthFrame";
import { ReloadButton } from "@/components/ui/ReloadButton";
import { RegisterForm } from "./RegisterForm";

export const metadata: Metadata = { title: "Daftar akun cabang" };

const TITLE = "Daftar akun cabang";
const INTRO = "Akun baru perlu disetujui pengelola sebelum bisa masuk.";

export default function RegisterPage() {
  return (
    <Suspense fallback={<AuthFrame title={TITLE} intro={INTRO} />}>
      <RegisterGate />
    </Suspense>
  );
}

async function RegisterGate() {
  // Someone who is already signed in has no use for this form.
  const [admin, account] = await Promise.all([getAdminSession(), getAccountSession()]);
  if (admin.status === "admin") redirect("/admin");
  if (account.status === "active") redirect("/cabang");

  if (!getSupabasePublicEnv()) {
    return (
      <AuthFrame title="Pendaftaran belum tersedia" intro={<p>Aplikasi belum terhubung ke layanan login. Hubungi pengelola aplikasi.</p>} />
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("registration_branches");
  if (error || !data) {
    return (
      <AuthFrame title="Daftar cabang belum bisa dimuat" intro={<p>Periksa koneksi, lalu muat ulang halaman.</p>}>
        <ReloadButton variant="primary" />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title={TITLE} intro={INTRO}>
      <RegisterForm branches={branchOptions(data)} />
    </AuthFrame>
  );
}
