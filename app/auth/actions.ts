"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  branchOptions,
  cleanRegistration,
  safeNextPath,
  validateRegistration,
  type RegistrationErrors,
} from "@/lib/accounts/rules";
import { LOGIN_NOTICES } from "@/lib/accounts/notices";
import { requestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

type SupabaseAuthError = { code?: string; status?: number; name?: string };

/** One message per failure kind, shared by every auth form. The raw Supabase text never reaches the screen. */
function authFailure(error: SupabaseAuthError): { code: AuthErrorCode; message: string } {
  if (error.code === "invalid_credentials" || (error.status === 400 && !error.code)) {
    return { code: "invalid-credentials", message: "Email atau kata sandi salah." };
  }
  if (error.code === "email_not_confirmed") {
    return {
      code: "email-not-confirmed",
      message: "Email belum dikonfirmasi. Buka tautan konfirmasi yang dikirim ke email Anda.",
    };
  }
  if (error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit" || error.status === 429) {
    return { code: "rate-limited", message: "Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi." };
  }
  if (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500) {
    return { code: "auth-unreachable", message: "Layanan login tidak bisa dihubungi. Coba lagi." };
  }
  return { code: "unknown", message: "Permintaan belum bisa diproses. Coba lagi." };
}

type AuthErrorCode =
  | "missing-fields"
  | "invalid-credentials"
  | "email-not-confirmed"
  | "rate-limited"
  | "auth-unreachable"
  | "not-configured"
  | "not-approved"
  | "unknown";

const NOT_CONFIGURED = "Aplikasi belum terhubung ke layanan login. Hubungi pengelola aplikasi.";

// ------------------------------------------------------------------------------------------ sign in

export type SignInState =
  | { status: "idle" }
  | {
      status: "error";
      code: AuthErrorCode;
      message: string;
      /** Field-level errors, keyed by input name. */
      fields?: { email?: string; password?: string };
      /** Echo the email back so the form keeps it after a failed attempt. */
      email?: string;
    };

/**
 * Email + password for everyone. The owner (public.admins) goes to /admin; an account the owner has
 * approved goes to /cabang; any other account is signed straight back out with the reason, so a
 * pending or deactivated account never holds a usable session.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const fields: { email?: string; password?: string } = {};
  if (!email) fields.email = "Isi email akun Anda.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = "Format email belum benar.";
  if (!password) fields.password = "Isi kata sandi.";
  if (fields.email || fields.password) {
    return { status: "error", code: "missing-fields", message: "Lengkapi isian yang ditandai.", fields, email };
  }

  if (!getSupabasePublicEnv()) {
    return { status: "error", code: "not-configured", message: NOT_CONFIGURED, email };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { status: "error", ...authFailure(error), email };

  const userId = data.user.id;
  const { data: adminRow, error: adminError } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!adminError && adminRow) {
    revalidatePath("/", "layout");
    redirect(safeNextPath(formData.get("next"), "/admin"));
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", userId)
    .maybeSingle();
  if (adminError || profileError) {
    await supabase.auth.signOut({ scope: "local" });
    return {
      status: "error",
      code: "auth-unreachable",
      message: "Akun belum bisa diperiksa. Coba lagi sebentar lagi.",
      email,
    };
  }

  if (profile?.status === "active") {
    revalidatePath("/", "layout");
    redirect(safeNextPath(formData.get("next"), "/cabang"));
  }

  await supabase.auth.signOut({ scope: "local" });
  return {
    status: "error",
    code: "not-approved",
    message: LOGIN_NOTICES[profile?.status === "inactive" ? "inactive" : profile ? "pending" : "no-account"],
    email,
  };
}

// ------------------------------------------------------------------------------------------ register

export type RegisterState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      fields?: RegistrationErrors;
      /** Echoed back; passwords never are. */
      values?: { fullName: string; email: string; branch: string };
    }
  | { status: "done"; email: string };

/**
 * Self-registration. The account is always created pending (the database trigger ignores any role
 * or status in the metadata); only the owner's approval turns it on. The branch is checked here
 * against the stations in the database, because a form post can carry anything.
 */
export async function signUp(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const input = cleanRegistration({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    branch: formData.get("branch"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  const values = { fullName: input.fullName, email: input.email, branch: input.branch };

  if (!getSupabasePublicEnv()) return { status: "error", message: NOT_CONFIGURED, values };

  const supabase = await createClient();
  const { data: stations, error: stationsError } = await supabase.rpc("registration_branches");
  if (stationsError || !stations) {
    return { status: "error", message: "Daftar cabang belum bisa dimuat. Coba lagi sebentar lagi.", values };
  }

  const fields = validateRegistration(input, branchOptions(stations));
  if (Object.keys(fields).length > 0) {
    return { status: "error", message: "Lengkapi isian yang ditandai.", fields, values };
  }

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${await requestOrigin()}/auth/callback`,
      data: { full_name: input.fullName, branch_code: input.branch },
    },
  });

  if (error) {
    if (error.code === "weak_password") {
      return {
        status: "error",
        message: "Kata sandi terlalu mudah ditebak.",
        fields: { password: "Pakai kata sandi yang lebih panjang atau campur huruf dan angka." },
        values,
      };
    }
    const failure = authFailure(error);
    if (failure.code === "rate-limited" || failure.code === "auth-unreachable") {
      return { status: "error", message: failure.message, values };
    }
    // Same answer whether or not the address is taken: the form must not tell who has an account.
    return {
      status: "error",
      message: "Pendaftaran belum bisa diproses. Jika email ini sudah terdaftar, masuk atau pakai Lupa kata sandi.",
      values,
    };
  }

  // With e-mail confirmation switched off, sign-up opens a session at once. A pending account must not hold one.
  if (data.session) await supabase.auth.signOut({ scope: "local" });
  return { status: "done", email: input.email };
}

// ------------------------------------------------------------------------------------------ password recovery

export type RecoveryState =
  | { status: "idle" }
  | { status: "error"; message: string; field?: string; email?: string }
  | { status: "done"; message: string };

/** Always answers the same way, so the form cannot be used to find out who has an account. */
export async function requestPasswordReset(_prev: RecoveryState, formData: FormData): Promise<RecoveryState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { status: "error", message: "Isi email akun Anda.", field: "Isi email akun Anda.", email };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: "error", message: "Format email belum benar.", field: "Format email belum benar.", email };
  }
  if (!getSupabasePublicEnv()) return { status: "error", message: NOT_CONFIGURED, email };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await requestOrigin()}/auth/callback?next=/reset-password`,
  });
  if (error) {
    const failure = authFailure(error);
    if (failure.code === "rate-limited" || failure.code === "auth-unreachable") {
      return { status: "error", message: failure.message, email };
    }
  }
  return { status: "done", message: "Jika email itu terdaftar, tautan untuk mengganti kata sandi sudah dikirim. Periksa kotak masuk Anda." };
}

export async function updatePassword(_prev: RecoveryState, formData: FormData): Promise<RecoveryState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < PASSWORD_MIN) {
    const message = `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
    return { status: "error", message, field: message };
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) {
    const message = `Kata sandi maksimal ${PASSWORD_MAX} karakter.`;
    return { status: "error", message, field: message };
  }
  if (password !== confirm) {
    return { status: "error", message: "Konfirmasi kata sandi belum sama.", field: "Konfirmasi kata sandi belum sama." };
  }
  if (!getSupabasePublicEnv()) return { status: "error", message: NOT_CONFIGURED };

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { status: "error", message: "Tautan sudah tidak berlaku. Minta tautan baru dari halaman Lupa kata sandi." };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") {
      return { status: "error", message: "Pakai kata sandi yang berbeda dari yang lama.", field: "Pakai kata sandi yang berbeda dari yang lama." };
    }
    if (error.code === "weak_password") {
      return { status: "error", message: "Kata sandi terlalu mudah ditebak.", field: "Pakai kata sandi yang lebih panjang atau campur huruf dan angka." };
    }
    return { status: "error", message: authFailure(error).message };
  }

  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?notice=password-updated");
}

// ------------------------------------------------------------------------------------------ sign out

export async function signOut(): Promise<void> {
  if (getSupabasePublicEnv()) {
    const supabase = await createClient();
    // scope "local": end this browser's session only, not the account's other devices.
    await supabase.auth.signOut({ scope: "local" });
  }
  revalidatePath("/", "layout");
  redirect("/login");
}
