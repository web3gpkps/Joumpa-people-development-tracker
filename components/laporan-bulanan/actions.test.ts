import { describe, expect, mock, test } from "bun:test";

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let nextError: { message: string; code?: string; details?: string } | null = null;
let refreshed = 0;

mock.module("next/cache", () => ({ refresh: () => void refreshed++ }));
mock.module("@/lib/workspace", async () => {
  const { toLinkError } = await import("@/lib/workspace/errors");
  return {
    resolveAccess: async () => ({
      ok: true,
      access: { kind: "owner", key: "owner" },
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        const error = nextError;
        nextError = null;
        return { data: error ? null : {}, error };
      },
    }),
    toLinkError,
  };
});

const { deleteMonthlyReport, saveMonthlyReport } = await import("./actions");

describe("saveMonthlyReport", () => {
  test("sends only the changed columns", async () => {
    calls.length = 0;
    const result = await saveMonthlyReport("owner", {
      reportGroup: "DPS",
      period: "2026-10-01",
      patch: { receivedOn: "2026-11-04", complaints: 0 },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        name: "pd_share_save_monthly_report",
        args: { p_report_group: "DPS", p_period: "2026-10-01", p_patch: { received_on: "2026-11-04", complaints: 0 } },
      },
    ]);
  });

  test("an invalid value never reaches the database", async () => {
    calls.length = 0;
    const result = await saveMonthlyReport("owner", { reportGroup: "DPS", period: "2026-10-01", patch: { satisfaction: 6 } });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("a database field error is told in the screen's words", async () => {
    nextError = { message: "invalid_input", code: "22023", details: "active_staff" };
    const result = await saveMonthlyReport("owner", { reportGroup: "DPS", period: "2026-10-01", patch: { activeStaff: 5 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("active_staff");
      expect(result.error.message).toContain("Total staf aktif");
    }
  });

  test("a station link is refused by the database: KPS only", async () => {
    nextError = { message: "forbidden_field" };
    const result = await saveMonthlyReport("owner", { reportGroup: "DPS", period: "2026-10-01", patch: {} });
    expect(!result.ok && result.error.message).toBe("Laporan bulanan hanya bisa diisi oleh KPS.");
  });
});

describe("deleteMonthlyReport", () => {
  test("deletes by Cabang and period, then refreshes", async () => {
    calls.length = 0;
    const before = refreshed;
    const result = await deleteMonthlyReport("owner", "CGK & HLP", "2026-10-01");
    expect(result.ok).toBe(true);
    expect(calls[0]).toEqual({
      name: "pd_share_delete_monthly_report",
      args: { p_report_group: "CGK & HLP", p_period: "2026-10-01" },
    });
    expect(refreshed).toBe(before + 1);
  });

  test("a row someone else already deleted says so", async () => {
    nextError = { message: "out_of_scope" };
    const result = await deleteMonthlyReport("owner", "DPS", "2026-10-01");
    expect(!result.ok && result.error.message).toContain("sudah tidak ada");
  });

  test("a malformed period is refused before the database", async () => {
    calls.length = 0;
    expect((await deleteMonthlyReport("owner", "DPS", "2026-10")).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
