/*
 * Branch accounts: pure rules shared by the sign-up form, the Server Actions and the owner's
 * approval page. No server or React imports, so they are unit tested (rules.test.ts).
 */

export type AccountStatus = "pending" | "active" | "inactive";

export const ACCOUNT_STATUSES: readonly AccountStatus[] = ["pending", "active", "inactive"];

export const STATUS_LABEL: Record<AccountStatus, string> = {
  pending: "Menunggu persetujuan",
  active: "Aktif",
  inactive: "Dinonaktifkan",
};

/** Head office (KPS) is a branch an account can belong to: it sees every station. */
export const KPS_BRANCH = "KPS";
/** What the database stores when a sign-up named no valid branch. It can never be activated. */
export const UNASSIGNED_BRANCH = "UNASSIGNED";

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === "string" && (ACCOUNT_STATUSES as readonly string[]).includes(value);
}

/** Branch codes the sign-up form offers: KPS first, then the stations as listed in public.stations. */
export function branchOptions(stations: readonly string[]): string[] {
  return [KPS_BRANCH, ...stations.filter((code) => code !== KPS_BRANCH)];
}

export function branchLabel(code: string): string {
  if (code === KPS_BRANCH) return "KPS (kantor pusat, semua stasiun)";
  if (code === UNASSIGNED_BRANCH) return "Belum ditentukan";
  return `Stasiun ${code}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN = 8;
/** bcrypt, which Supabase Auth uses, ignores everything past 72 bytes: refuse instead of truncating silently. */
export const PASSWORD_MAX = 72;
export const NAME_MIN = 3;
export const NAME_MAX = 120;
export const EMAIL_MAX = 254;

export type RegistrationInput = {
  fullName: string;
  email: string;
  branch: string;
  password: string;
  confirm: string;
};

export type RegistrationErrors = Partial<Record<keyof RegistrationInput, string>>;

/** Trim and collapse the text fields; the password is never touched. */
export function cleanRegistration(raw: Partial<Record<keyof RegistrationInput, unknown>>): RegistrationInput {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    fullName: text(raw.fullName).trim().replace(/\s+/g, " "),
    email: text(raw.email).trim(),
    branch: text(raw.branch).trim().toUpperCase(),
    password: text(raw.password),
    confirm: text(raw.confirm),
  };
}

/**
 * Field errors for a sign-up, empty when it is fine. `allowedBranches` is the list the server read
 * from the database: a form post can carry any branch, so this is the check the restriction rests on.
 */
export function validateRegistration(input: RegistrationInput, allowedBranches: readonly string[]): RegistrationErrors {
  const errors: RegistrationErrors = {};
  if (input.fullName.length < NAME_MIN) errors.fullName = `Isi nama lengkap, minimal ${NAME_MIN} huruf.`;
  else if (input.fullName.length > NAME_MAX) errors.fullName = `Nama lengkap maksimal ${NAME_MAX} karakter.`;

  if (!input.email) errors.email = "Isi email aktif Anda.";
  else if (input.email.length > EMAIL_MAX || !EMAIL.test(input.email)) errors.email = "Format email belum benar.";

  if (!input.branch) errors.branch = "Pilih cabang Anda.";
  else if (!allowedBranches.includes(input.branch)) errors.branch = "Cabang ini tidak ada di daftar. Pilih dari daftar.";

  if (input.password.length < PASSWORD_MIN) errors.password = `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
  else if (new TextEncoder().encode(input.password).length > PASSWORD_MAX) {
    errors.password = `Kata sandi maksimal ${PASSWORD_MAX} karakter.`;
  }

  if (!errors.password && input.confirm !== input.password) errors.confirm = "Konfirmasi kata sandi belum sama.";
  return errors;
}

/**
 * Where to go after sign-in: only a path inside `area` ("/admin" or "/cabang"), never another site,
 * /login, or the other area. Anything else lands on the area's home.
 */
export function safeNextPath(raw: unknown, area: "/admin" | "/cabang"): string {
  const next = typeof raw === "string" ? raw : "";
  if (next === area || next.startsWith(`${area}/`) || next.startsWith(`${area}?`)) {
    // A backslash, a control character or a double slash after the area is never a real path of this app.
    if (!/[\\\r\n]/.test(next) && !next.includes("//")) return next;
  }
  return area;
}

/** Path after the password-recovery callback: only the reset page makes sense there. */
export function safeCallbackPath(raw: unknown): string {
  const next = typeof raw === "string" ? raw : "";
  return next === "/reset-password" ? next : "/login";
}
