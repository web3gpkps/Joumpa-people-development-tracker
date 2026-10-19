import { describe, expect, mock, test } from "bun:test";

const rpcCalls: string[] = [];
let lastArgs: Record<string, unknown> = {};
mock.module("next/cache", () => ({ refresh: () => {} }));
mock.module("@/lib/workspace", () => ({
  resolveAccess: async () => ({
    ok: true,
    access: { kind: "owner", key: "owner" },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push(name);
      lastArgs = args;
      return { data: {}, error: null };
    },
  }),
  toLinkError: (error: unknown) => error,
}));

const { saveBmiCheck } = await import("./actions");

const check = { staffCode: "TMB-01", checkDate: "2026-10-26", heightCm: 170, weightKg: 62 };

describe("saveBmiCheck", () => {
  test("every check can be saved, the first one too", async () => {
    rpcCalls.length = 0;
    for (const period of [1, 2]) {
      const result = await saveBmiCheck("owner", { ...check, period });
      expect(result.ok).toBe(true);
    }
    expect(rpcCalls).toEqual(["pd_share_save_check", "pd_share_save_check"]);
    expect(lastArgs).toEqual({ p_staff_code: "TMB-01", p_period: 2, p_check_date: "2026-10-26", p_height_cm: 170, p_weight_kg: 62 });
  });

  test("an invalid date or a non-number is refused before the database", async () => {
    rpcCalls.length = 0;
    expect(await saveBmiCheck("owner", { ...check, period: 2, checkDate: "0002-10-25" })).toMatchObject({ ok: false, error: { field: "check_date" } });
    expect(await saveBmiCheck("owner", { ...check, period: 2, heightCm: Number.NaN })).toMatchObject({ ok: false, error: { field: "height_cm" } });
    expect(rpcCalls).toEqual([]);
  });
});
