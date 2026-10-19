"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUp, type RegisterState } from "@/app/auth/actions";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { PasswordField } from "@/components/auth/PasswordField";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { PASSWORD_MIN, branchLabel } from "@/lib/accounts/rules";

const initialState: RegisterState = { status: "idle" };

/**
 * Self-registration for a branch account. Nothing here grants access: the owner approves the
 * account (Akun Cabang) before it can sign in. The server action validates everything again,
 * including the branch, so this form is only a convenience.
 */
export function RegisterForm({ branches }: { branches: string[] }) {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  if (state.status === "done") {
    return (
      <div className="flex flex-col gap-5">
        <AuthMessage tone="info">
          Pendaftaran untuk {state.email} diterima. Jika diminta, konfirmasi email lewat tautan yang dikirim ke kotak masuk
          Anda. Setelah itu pengelola akan menyetujui akun Anda; Anda bisa masuk begitu akun disetujui.
        </AuthMessage>
        <ButtonLink href="/login" variant="primary" fullWidth>
          Ke halaman masuk
        </ButtonLink>
      </div>
    );
  }

  const error = state.status === "error" ? state : null;
  const fields = error?.fields;

  return (
    <form action={formAction} noValidate className="flex flex-col">
      <AuthMessage tone="error">{error?.message}</AuthMessage>

      <div className="flex flex-col gap-5">
        <Field label="Nama lengkap" error={fields?.fullName}>
          <Input name="fullName" autoComplete="name" defaultValue={error?.values?.fullName ?? ""} maxLength={120} />
        </Field>

        <Field label="Email" error={fields?.email}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={error?.values?.email ?? ""}
            maxLength={254}
          />
        </Field>

        <Field label="Cabang" help="Anda hanya bisa membuka data cabang ini setelah disetujui." error={fields?.branch}>
          <Select name="branch" defaultValue={error?.values?.branch ?? ""}>
            <option value="" disabled>
              Pilih cabang
            </option>
            {branches.map((code) => (
              <option key={code} value={code}>
                {branchLabel(code)}
              </option>
            ))}
          </Select>
        </Field>

        <PasswordField
          name="password"
          label="Kata sandi"
          autoComplete="new-password"
          help={`Minimal ${PASSWORD_MIN} karakter.`}
          error={fields?.password}
        />
        <PasswordField name="confirm" label="Ulangi kata sandi" autoComplete="new-password" error={fields?.confirm} />

        <Button type="submit" fullWidth loading={pending} loadingText="Mendaftarkan…">
          Daftar akun cabang
        </Button>
        <p className="text-center text-sm text-ink-muted">
          Sudah punya akun?{" "}
          <Link href="/login" className="font-semibold text-accent underline underline-offset-2">
            Masuk
          </Link>
        </p>
      </div>
    </form>
  );
}
