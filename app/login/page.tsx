import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginNotice } from "@/lib/accounts/notices";
import { getAccountSession, loginNoticeFor } from "@/lib/supabase/account";
import { getAdminSession } from "@/lib/supabase/auth";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { AuthFrame } from "@/components/shell/AuthFrame";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Masuk" };

const LINK = "font-semibold text-accent underline underline-offset-2";

function LoginFootnote() {
  return (
    <>
      <span className="block">
        Belum punya akun cabang?{" "}
        <Link href="/register" className={LINK}>
          Daftar
        </Link>
      </span>
      <span className="mt-1 block">
        <Link href="/forgot-password" className={LINK}>
          Lupa kata sandi?
        </Link>{" "}
        Stasiun yang memakai tautan tidak perlu masuk.
      </span>
    </>
  );
}

/**
 * The form is rendered once, outside any Suspense boundary: what someone has already typed must
 * survive while the session check below streams in. The check only forwards a visitor who is
 * already signed in, or adds a notice above the form.
 */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthFrame title="Masuk" footnote={<LoginFootnote />}>
      <Suspense fallback={null}>
        <LoginSession searchParams={searchParams} />
      </Suspense>
      <LoginForm />
    </AuthFrame>
  );
}

/**
 * Forwards someone who is already signed in (the owner to /admin, an approved branch account to
 * /cabang) and prints why a signed-in account that is not approved yet cannot continue, or the
 * reason another page sent them back here (`?notice=`).
 */
async function LoginSession({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const [params, admin] = await Promise.all([searchParams, getAdminSession()]);
  if (admin.status === "admin") redirect("/admin");

  const account = await getAccountSession();
  if (account.status === "active") redirect("/cabang");

  const fromUrl = loginNotice(Array.isArray(params.notice) ? params.notice[0] : params.notice);
  const fromSession =
    account.status === "pending" || account.status === "inactive" ? loginNotice(loginNoticeFor(account)) : undefined;

  return <AuthMessage tone="info">{fromUrl ?? fromSession}</AuthMessage>;
}
