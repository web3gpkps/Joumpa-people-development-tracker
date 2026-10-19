import { describe, expect, test } from "bun:test";
import { authorize, safeEqual } from "../auth";

const env = { SYNC_SECRET: "f".repeat(64), SYNC_PING_SECRET: "p".repeat(64) };

describe("authorize", () => {
  test("full secret, ping secret, wrong secret", () => {
    expect(authorize(`Bearer ${env.SYNC_SECRET}`, env)).toBe("full");
    expect(authorize(`bearer ${env.SYNC_PING_SECRET}`, env)).toBe("ping");
    expect(authorize(`Bearer ${"x".repeat(64)}`, env)).toBe("denied");
    expect(authorize(`Bearer ${env.SYNC_SECRET}x`, env)).toBe("denied");
  });
  test("missing or malformed header", () => {
    expect(authorize(null, env)).toBe("denied");
    expect(authorize(env.SYNC_SECRET, env)).toBe("denied");
    expect(authorize("Basic abc", env)).toBe("denied");
    expect(authorize("Bearer ", env)).toBe("denied");
  });
  test("unconfigured when no usable secret; short secrets are ignored", () => {
    expect(authorize("Bearer anything", {})).toBe("unconfigured");
    expect(authorize("Bearer short", { SYNC_SECRET: "short" })).toBe("unconfigured");
    expect(authorize(`Bearer ${env.SYNC_PING_SECRET}`, { SYNC_PING_SECRET: env.SYNC_PING_SECRET })).toBe("ping");
  });
  test("safeEqual handles different lengths", () => {
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "ab")).toBe(false);
  });
});
