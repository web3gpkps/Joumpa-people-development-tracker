"use client";

import { useActionState } from "react";
import { requestPasswordReset, type RecoveryState } from "@/app/auth/actions";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

const initialState: RecoveryState = { status: "idle" };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);
  const error = state.status === "error" ? state : null;

  return (
    <form action={formAction} noValidate className="flex flex-col">
      <AuthMessage tone="error">{error?.message}</AuthMessage>
      <AuthMessage tone="info">{state.status === "done" ? state.message : undefined}</AuthMessage>

      <div className="flex flex-col gap-5">
        <Field label="Email" error={error?.field}>
          <Input
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={error?.email ?? ""}
          />
        </Field>
        <Button type="submit" fullWidth loading={pending} loadingText="Mengirim tautan…">
          Kirim tautan penggantian
        </Button>
      </div>
    </form>
  );
}
