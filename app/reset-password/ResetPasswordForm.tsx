"use client";

import { useActionState } from "react";
import { updatePassword, type RecoveryState } from "@/app/auth/actions";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { PasswordField } from "@/components/auth/PasswordField";
import { Button } from "@/components/ui/Button";
import { PASSWORD_MIN } from "@/lib/accounts/rules";

const initialState: RecoveryState = { status: "idle" };

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);
  const error = state.status === "error" ? state : null;
  const mismatch = error?.field?.startsWith("Konfirmasi") ? error.field : undefined;
  const passwordError = mismatch ? undefined : error?.field;

  return (
    <form action={formAction} noValidate className="flex flex-col">
      <AuthMessage tone="error">{error?.message}</AuthMessage>
      <div className="flex flex-col gap-5">
        <PasswordField
          name="password"
          label="Kata sandi baru"
          autoComplete="new-password"
          help={`Minimal ${PASSWORD_MIN} karakter.`}
          error={passwordError}
        />
        <PasswordField name="confirm" label="Ulangi kata sandi baru" autoComplete="new-password" error={mismatch} />
        <Button type="submit" fullWidth loading={pending} loadingText="Menyimpan…">
          Simpan kata sandi
        </Button>
      </div>
    </form>
  );
}
