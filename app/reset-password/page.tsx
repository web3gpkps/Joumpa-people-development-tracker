import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAccountSession } from "@/lib/supabase/account";
import { getAdminSession } from "@/lib/supabase/auth";
import { AuthFrame } from "@/components/shell/AuthFrame";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Ganti kata sandi" };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthFrame title="Ganti kata sandi" />}>
      <ResetGate />
    </Suspense>
  );
}

/** The recovery link signs the visitor in (see /auth/callback); without that session there is nothing to change. */
async function ResetGate() {
  const [admin, account] = await Promise.all([getAdminSession(), getAccountSession()]);
  const signedIn = admin.status === "admin" || admin.status === "not-admin" || account.status !== "signed-out";

  if (!signedIn) {
    return (
      <AuthFrame
        title="Tautan tidak berlaku"
        intro={<p>Tautan penggantian kata sandi sudah dipakai atau kedaluwarsa. Minta tautan baru.</p>}
        footnote={
          <Link href="/forgot-password" className="font-semibold text-accent underline underline-offset-2">
            Minta tautan baru
          </Link>
        }
      />
    );
  }

  return (
    <AuthFrame title="Ganti kata sandi" intro="Pilih kata sandi baru untuk akun Anda.">
      <ResetPasswordForm />
    </AuthFrame>
  );
}
