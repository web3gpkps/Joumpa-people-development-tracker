import { createHash, timingSafeEqual } from "node:crypto";

/**
 * "full": SYNC_SECRET (cron, operators): may pass run options (dryRun, conflictPolicy, allowMassDelete).
 * "ping": SYNC_PING_SECRET (Apps Script, DB trigger): can only trigger a normal run.
 */
export type SyncCaller = "full" | "ping";
export type AuthResult = SyncCaller | "denied" | "unconfigured";

const MIN_SECRET_LENGTH = 16;

function digest(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** Constant-time comparison (hashing first makes lengths equal and hides the secret's length). */
export function safeEqual(given: string, secret: string): boolean {
  return timingSafeEqual(digest(given), digest(secret));
}

export function authorize(header: string | null, env: Record<string, string | undefined> = process.env): AuthResult {
  const usable = (s: string | undefined) => (s && s.length >= MIN_SECRET_LENGTH ? s : undefined);
  const full = usable(env.SYNC_SECRET);
  const ping = usable(env.SYNC_PING_SECRET);
  if (!full && !ping) return "unconfigured";
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  const given = m?.[1] ?? "";
  // Compare against both, always, so timing does not reveal which secret matched.
  const isFull = full ? safeEqual(given, full) : false;
  const isPing = ping ? safeEqual(given, ping) : false;
  if (!m) return "denied";
  return isFull ? "full" : isPing ? "ping" : "denied";
}
