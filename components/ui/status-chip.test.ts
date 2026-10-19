import { describe, expect, test } from "bun:test";
import { toneForStatus } from "./StatusChip";

describe("toneForStatus", () => {
  test("passing, on-schedule and finished labels are good", () => {
    for (const label of [
      "Sesuai",
      "Sesuai dengan Catatan",
      "OK",
      "Normal",
      "Memenuhi",
      "Selesai",
      "On Track",
      "Lulus – boleh bertugas",
      "Tepat waktu",
      "▲ Naik",
    ]) {
      expect(toneForStatus(label)).toBe("good");
    }
  });

  test("failing, late and obese labels are critical, including the dated replacement label", () => {
    for (const label of ["Tidak Sesuai", "Obesitas", "Tidak Memenuhi", "OVERDUE", "Belum lulus", "Ditarik", "Lewat 31 Okt"]) {
      expect(toneForStatus(label)).toBe("critical");
    }
  });

  test("labels that ask for attention soon are warning", () => {
    for (const label of ["Perlu Perbaikan", "Overweight", "Kurus", "Jatuh tempo ≤ 7 hari", "Menunggu", "Beda – verifikasi", "▼ Turun"]) {
      expect(toneForStatus(label)).toBe("warning");
    }
  });

  test("work under way is progress, never the brand tone", () => {
    expect(toneForStatus("On Progress")).toBe("progress");
    expect(toneForStatus("Rutin – pantau")).toBe("progress");
    expect(toneForStatus("Coaching 30 Hari")).toBe("progress");
  });

  test("not started, postponed, quiet and unknown labels stay neutral", () => {
    for (const label of ["Belum Mulai", "Tertunda", "Belum training/dinilai", "Isi standar di Parameter", "Aktif", "Diganti", "= Tetap", "label baru"]) {
      expect(toneForStatus(label)).toBe("neutral");
    }
    expect(toneForStatus(null)).toBe("neutral");
  });

  test("matching ignores case and extra spaces", () => {
    expect(toneForStatus("  tidak   sesuai ")).toBe("critical");
  });
});

describe("People Development labels", () => {
  test("flags, statuses and decisions get their tone", () => {
    expect(toneForStatus("Terlambat")).toBe("critical");
    expect(toneForStatus("On track")).toBe("good");
    expect(toneForStatus("Jatuh tempo ≤ 7 hari")).toBe("warning");
    expect(toneForStatus("Proses")).toBe("progress");
    expect(toneForStatus("Batal / N.A.")).toBe("neutral");
    expect(toneForStatus("Tidak Sesuai → usulan ganti")).toBe("critical");
    expect(toneForStatus("Lulus")).toBe("good");
    expect(toneForStatus("Ditarik dari JOUMPA")).toBe("critical");
    expect(toneForStatus("Siap bertugas")).toBe("good");
    expect(toneForStatus("Siap Bertugas*")).toBe("good");
    expect(toneForStatus("Tidak ikut")).toBe("warning");
  });
});
