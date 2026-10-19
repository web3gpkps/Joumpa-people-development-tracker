"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";

type SubmitButtonProps = {
  children: React.ReactNode;
  /** Shown while the parent <form>'s action runs, e.g. "Menyimpan cek BMI…". */
  pendingText: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Submit to a different server action than the form's own. */
  formAction?: (formData: FormData) => void | Promise<void>;
};

/**
 * Submit button that reads its parent form's pending state (useFormStatus), so a
 * server-rendered <form action={serverAction}> still shows progress. Client component;
 * it must be rendered inside the <form>. With useActionState, use <Button loading> instead.
 */
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size,
  fullWidth,
  formAction,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      loading={pending}
      loadingText={pendingText}
      formAction={formAction}
    >
      {children}
    </Button>
  );
}
