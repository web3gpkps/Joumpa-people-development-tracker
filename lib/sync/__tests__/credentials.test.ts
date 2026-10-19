import { describe, expect, test } from "bun:test";
import { CredentialsError, loadServiceAccount } from "../credentials";

// Not a real key: shape only.
const PEM = "-----BEGIN PRIVATE KEY-----\nMIIBfake\n-----END PRIVATE KEY-----\n";
const SA = { type: "service_account", client_email: "sync@example.iam.gserviceaccount.com", private_key: PEM };

describe("loadServiceAccount", () => {
  test("single-line JSON in GOOGLE_SERVICE_ACCOUNT_JSON", () => {
    const sa = loadServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(SA) });
    expect(sa.client_email).toBe(SA.client_email);
    expect(sa.private_key).toBe(PEM);
  });

  test("base64 JSON", () => {
    const b64 = Buffer.from(JSON.stringify(SA)).toString("base64");
    expect(loadServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: b64 }).private_key).toBe(PEM);
  });

  test("preferred over GOOGLE_PRIVATE_KEY", () => {
    const other = { ...SA, client_email: "other@example.com" };
    const sa = loadServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(SA), GOOGLE_PRIVATE_KEY: JSON.stringify(other) });
    expect(sa.client_email).toBe(SA.client_email);
  });

  test("falls back to GOOGLE_PRIVATE_KEY holding pretty-printed JSON", () => {
    const sa = loadServiceAccount({ GOOGLE_PRIVATE_KEY: JSON.stringify(SA, null, 2) });
    expect(sa.client_email).toBe(SA.client_email);
  });

  test("repairs real newlines inside private_key (dotenv expanded \\n)", () => {
    const broken = JSON.stringify(SA, null, 2).replace(/\\n/g, "\n");
    expect(loadServiceAccount({ GOOGLE_PRIVATE_KEY: broken }).private_key).toBe(PEM);
  });

  test("bare PEM in GOOGLE_PRIVATE_KEY needs GOOGLE_CLIENT_EMAIL", () => {
    expect(() => loadServiceAccount({ GOOGLE_PRIVATE_KEY: PEM })).toThrow(CredentialsError);
    const sa = loadServiceAccount({ GOOGLE_PRIVATE_KEY: PEM.replace(/\n/g, "\\n"), GOOGLE_CLIENT_EMAIL: "x@y.z" });
    expect(sa.private_key).toBe(PEM);
  });

  test("errors name the variable and length, never the value", () => {
    const secretish = '{\n  "type": "service_account", "private_key": "-----BEGIN PRIVATE KEY-----abc';
    try {
      loadServiceAccount({ GOOGLE_PRIVATE_KEY: secretish });
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(e).toBeInstanceOf(CredentialsError);
      expect(msg).toContain("GOOGLE_PRIVATE_KEY");
      expect(msg).not.toContain("BEGIN PRIVATE KEY");
      expect(msg).not.toContain("service_account");
    }
  });

  test("a truncated multi-line value (what dotenv leaves) is reported clearly", () => {
    expect(() => loadServiceAccount({ GOOGLE_PRIVATE_KEY: "{\n  " })).toThrow(/not valid JSON/);
  });

  test("nothing set", () => {
    expect(() => loadServiceAccount({})).toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON/);
  });
});
