import { signOut } from "@/app/auth/actions";
import type { ButtonSize, ButtonVariant } from "@/components/ui/Button";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { SignOutRowButton } from "./ShellNav";

type SignOutButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children?: React.ReactNode;
};

/** A one-button form posting to the signOut server action. Works before hydration. */
export function SignOutButton({ variant = "ghost", size, fullWidth, children = "Keluar" }: SignOutButtonProps) {
  return (
    <form action={signOut} className={fullWidth ? "w-full" : undefined}>
      <SubmitButton variant={variant} size={size} fullWidth={fullWidth} pendingText="Keluar…">
        {children}
      </SubmitButton>
    </form>
  );
}

/** "Keluar" as a footer row of the sidebar and the phone menu sheet (on the deep green). */
export function ShellSignOut() {
  return (
    <form action={signOut}>
      <SignOutRowButton />
    </form>
  );
}
