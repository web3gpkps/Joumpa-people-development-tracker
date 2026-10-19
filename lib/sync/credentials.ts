/**
 * Google service-account credentials, read from env at call time (the key gets rotated,
 * so nothing is cached at module load).
 *
 * Error messages name variables and lengths only. Never put a credential value in one.
 */

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export class CredentialsError extends Error {
  readonly code = "credentials_invalid";
}

type Env = Record<string, string | undefined>;

/** Literal newlines inside a JSON string are invalid; a double-quoted dotenv value expands `\n` into them. */
function repairJson(text: string): string {
  return text.replace(/("private_key"\s*:\s*")([\s\S]*?)(")/, (_m, a: string, body: string, c: string) => {
    return a + body.replace(/\r?\n/g, "\\n") + c;
  });
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(repairJson(text));
  }
}

function decodeMaybeBase64(text: string): string | null {
  if (!/^[A-Za-z0-9+/=_-\s]+$/.test(text)) return null;
  try {
    const decoded = Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8");
    return decoded.trim().startsWith("{") ? decoded : null;
  } catch {
    return null;
  }
}

function fromJsonText(text: string, varName: string): ServiceAccount {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{") ? trimmed : decodeMaybeBase64(trimmed);
  if (!jsonText) {
    throw new CredentialsError(
      `${varName} is set (${trimmed.length} chars) but is neither JSON nor base64-encoded JSON.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = parseJsonLoose(jsonText);
  } catch {
    throw new CredentialsError(
      `${varName} is set (${trimmed.length} chars) but is not valid JSON. A multi-line JSON value in .env ` +
        `is usually truncated by dotenv; put the JSON on one line in GOOGLE_SERVICE_ACCOUNT_JSON ` +
        `(or base64-encode it).`,
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj?.client_email !== "string" || typeof obj?.private_key !== "string") {
    throw new CredentialsError(`${varName} JSON is missing client_email or private_key.`);
  }
  return { client_email: obj.client_email, private_key: normalizeKey(obj.private_key) };
}

function normalizeKey(key: string): string {
  const k = key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
  if (!k.includes("BEGIN PRIVATE KEY")) {
    throw new CredentialsError("Service account private_key is not a PEM private key.");
  }
  return k;
}

/**
 * Order: GOOGLE_SERVICE_ACCOUNT_JSON (JSON or base64 JSON), then GOOGLE_PRIVATE_KEY holding the
 * JSON (legacy), then GOOGLE_PRIVATE_KEY as a bare PEM key + GOOGLE_CLIENT_EMAIL.
 */
export function loadServiceAccount(env: Env = process.env): ServiceAccount {
  const json = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json && json.trim()) return fromJsonText(json, "GOOGLE_SERVICE_ACCOUNT_JSON");

  const legacy = env.GOOGLE_PRIVATE_KEY;
  if (legacy && legacy.trim()) {
    const t = legacy.trim();
    if (t.includes("BEGIN PRIVATE KEY") && !t.startsWith("{")) {
      const email = env.GOOGLE_CLIENT_EMAIL ?? env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      if (!email) {
        throw new CredentialsError("GOOGLE_PRIVATE_KEY is a bare PEM key but GOOGLE_CLIENT_EMAIL is not set.");
      }
      return { client_email: email, private_key: normalizeKey(t) };
    }
    return fromJsonText(t, "GOOGLE_PRIVATE_KEY");
  }
  throw new CredentialsError("No Google credentials: set GOOGLE_SERVICE_ACCOUNT_JSON.");
}
