import { describe, expect, test } from "bun:test";
import { PASSWORD_MIN } from "./rules";
import { temporaryPassword } from "./temp-password";

describe("temporaryPassword", () => {
  test("is long enough and mixes upper, lower and digits", () => {
    for (let i = 0; i < 200; i++) {
      const p = temporaryPassword();
      expect(p.length).toBeGreaterThanOrEqual(Math.max(12, PASSWORD_MIN));
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[2-9]/);
    }
  });

  test("leaves out characters that are easy to misread", () => {
    const all = Array.from({ length: 200 }, () => temporaryPassword()).join("");
    expect(all).not.toMatch(/[0O1lI]/);
  });

  test("differs every time", () => {
    expect(new Set(Array.from({ length: 50 }, () => temporaryPassword())).size).toBe(50);
  });
});
