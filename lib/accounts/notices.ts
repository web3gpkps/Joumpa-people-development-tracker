/** Reasons the login page prints, from `?notice=` or from a refused sign-in. */
export const LOGIN_NOTICES = {
  pending: "Akun Anda belum disetujui pengelola. Tunggu persetujuan, lalu masuk lagi.",
  inactive: "Akun Anda dinonaktifkan. Hubungi pengelola aplikasi.",
  "no-account": "Akun ini belum terdaftar sebagai akun cabang. Daftar dulu, atau hubungi pengelola aplikasi.",
  "password-updated": "Kata sandi sudah diganti. Masuk dengan kata sandi baru.",
  "link-invalid": "Tautan sudah tidak berlaku atau sudah pernah dipakai. Minta tautan baru.",
  "email-confirmed": "Email terkonfirmasi. Pengelola perlu menyetujui akun Anda sebelum Anda bisa masuk.",
} as const;

export type LoginNotice = keyof typeof LOGIN_NOTICES;

/** The text for a `?notice=` value, or undefined when it is not one of ours (never echo arbitrary text). */
export function loginNotice(value: unknown): string | undefined {
  return typeof value === "string" && Object.hasOwn(LOGIN_NOTICES, value)
    ? LOGIN_NOTICES[value as LoginNotice]
    : undefined;
}
