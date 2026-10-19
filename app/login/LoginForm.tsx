"use client";

import { useActionState, useSyncExternalStore } from "react";
import { catchError, type ErrorInfo } from "next/error";
import { signIn, type SignInState } from "@/app/auth/actions";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { PasswordField } from "@/components/auth/PasswordField";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

const initialState: SignInState = { status: "idle" };

const subscribeToNothing = () => () => {};
const readNextParam = () => new URLSearchParams(window.location.search).get("next") ?? "";

/**
 * An action that never reaches the server rejects, and useActionState rethrows it during
 * render; this boundary shows it. The success redirect passes through catchError untouched.
 */
const NetworkErrorBoundary = catchError(function LoginNetworkError(
  _props: object,
  { reset }: ErrorInfo,
) {
  return (
    <div className="flex flex-col gap-4">
      <p
        role="alert"
        className="rounded-control bg-critical-tint px-3 py-2.5 text-sm font-semibold text-critical"
      >
        Tidak bisa terhubung ke server. Periksa koneksi, lalu coba lagi.
      </p>
      <Button fullWidth onClick={() => reset()}>
        Coba lagi
      </Button>
    </div>
  );
});

export function LoginForm() {
  return (
    <NetworkErrorBoundary>
      <LoginFormFields />
    </NetworkErrorBoundary>
  );
}

/**
 * Email + password sign-in for the owner and for branch accounts. The server action is passed
 * straight to useActionState, so the form also works before JavaScript has loaded.
 */
function LoginFormFields() {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  // ?next= from the proxy redirect, read without useSearchParams (no Suspense needed). The server
  // action keeps only a path inside the signed-in role's own area.
  const next = useSyncExternalStore(subscribeToNothing, readNextParam, () => "");

  const error = state.status === "error" ? state : null;
  const fieldErrors = error?.fields;

  return (
    <form action={formAction} noValidate className="flex flex-col">
      <input type="hidden" name="next" value={next} />

      <AuthMessage tone="error">{error?.message}</AuthMessage>

      <div className="flex flex-col gap-5">
        <Field label="Email" error={fieldErrors?.email}>
          <Input
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={error?.email ?? ""}
          />
        </Field>

        <PasswordField name="password" label="Kata sandi" autoComplete="current-password" error={fieldErrors?.password} />

        <Button type="submit" fullWidth loading={pending} loadingText="Memeriksa akun…">
          Masuk
        </Button>
      </div>
    </form>
  );
}
