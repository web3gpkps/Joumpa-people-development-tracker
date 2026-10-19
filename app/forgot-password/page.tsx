import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/shell/AuthFrame";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Lupa kata sandi" };

export default function ForgotPasswordPage() {
  return (
    <AuthFrame
      title="Lupa kata sandi"
      intro="Isi email akun Anda. Kami kirim tautan untuk mengganti kata sandi."
      footnote={
        <Link href="/login" className="font-semibold text-accent underline underline-offset-2">
          Kembali ke halaman masuk
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
