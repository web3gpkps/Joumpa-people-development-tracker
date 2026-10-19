/**
 * Local scripts only (never imported by the app): the repo's .env holds the service-account JSON as a
 * multi-line quoted value that dotenv/Bun truncate. Read that block straight from the file.
 */
import { existsSync, readFileSync } from "node:fs";
import { loadServiceAccount, type ServiceAccount } from "../credentials";

export function readMultilineFromDotenv(name: string, path = ".env"): string | undefined {
  if (!existsSync(path)) return undefined;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (start < 0) return undefined;
  const block = [lines[start].slice(name.length + 1)];
  for (let i = start + 1; i < lines.length && !/^[A-Z_][A-Z0-9_]*=/.test(lines[i]); i++) block.push(lines[i]);
  let v = block.join("\n").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

/** Credentials from env if they parse, else from the raw .env block. */
export function localServiceAccount(): ServiceAccount {
  try {
    return loadServiceAccount();
  } catch {
    return loadServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: readMultilineFromDotenv("GOOGLE_PRIVATE_KEY") });
  }
}
