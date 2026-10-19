import { describe, expect, test } from "bun:test";
import { eqCanon, isoToSerial, normalize, parseDateText, roundTo, serialToIso } from "../normalize";
import type { ColumnType } from "../types";

const int15: ColumnType = { kind: "int", min: 1, max: 5 };
const height: ColumnType = { kind: "numeric", scale: 1, min: 120, max: 210 };
const date: ColumnType = { kind: "date" };
const text: ColumnType = { kind: "text" };
const status: ColumnType = { kind: "enum", values: ["Belum Mulai", "Proses", "Selesai", "Batal / N.A."] };

const val = (raw: unknown, t: ColumnType) => {
  const r = normalize(raw, t);
  if (!r.ok) throw new Error(`expected ok for ${JSON.stringify(raw)}: ${r.message}`);
  return r.value;
};
const err = (raw: unknown, t: ColumnType) => normalize(raw, t).ok === false;

describe("numbers", () => {
  test('"4", 4, 4.0, "4.0", "4,0", " 4 " are all 4', () => {
    for (const raw of ["4", 4, 4.0, "4.0", "4,0", " 4 "]) expect(val(raw, int15)).toBe(4);
  });
  test("int rejects fractions, text and out-of-range values", () => {
    expect(err(4.5, int15)).toBe(true);
    expect(err("4,5", int15)).toBe(true);
    expect(err("empat", int15)).toBe(true);
    expect(err(7, int15)).toBe(true);
    expect(err(0, int15)).toBe(true);
    expect(err(true, int15)).toBe(true);
  });
  test("numeric rounds to the column scale (matches numeric(5,1))", () => {
    expect(val(170.25, height)).toBe(170.3);
    expect(val("170,5", height)).toBe(170.5);
    expect(val("165", height)).toBe(165);
    expect(err(300, height)).toBe(true);
    expect(err(119.9, height)).toBe(true);
  });
  test("roundTo is half away from zero without float noise", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(3.835, 2)).toBe(3.84);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(0.1 + 0.2, 6)).toBe(0.3);
  });
});

describe("dates", () => {
  test("serial <-> ISO round trip", () => {
    expect(serialToIso(46307)).toBe("2026-10-12");
    expect(isoToSerial("2026-10-12")).toBe(46307);
    expect(serialToIso(46307.75)).toBe("2026-10-12");
  });
  test("serial, ISO, D/M/YYYY, D-M-YYYY, Indonesian month names all agree", () => {
    for (const raw of [46307, "2026-10-12", "12/10/2026", "12-10-2026", "12.10.2026", "12 Okt 2026", "12 Oktober 2026", "12 Oct 2026", "2026-10-12T00:00:00Z"]) {
      expect(val(raw, date)).toBe("2026-10-12");
    }
    expect(parseDateText("1 Agustus 2026")).toBe("2026-08-01");
    expect(parseDateText("5 Mei 2026")).toBe("2026-05-05");
    expect(parseDateText("5 Des 2026")).toBe("2026-12-05");
  });
  test("impossible or garbled dates are errors", () => {
    expect(err("31/02/2026", date)).toBe(true);
    expect(err("12 Foo 2026", date)).toBe(true);
    expect(err("besok", date)).toBe(true);
    expect(err(-5, date)).toBe(true);
  });
});

describe("text and enums", () => {
  test("trims, normalizes line endings, empty -> null", () => {
    expect(val("  halo \r\n dunia  ", text)).toBe("halo \n dunia");
    expect(val("   ", text)).toBeNull();
    expect(val("", text)).toBeNull();
    expect(val(undefined, text)).toBeNull();
    expect(val(1234, text)).toBe("1234");
  });
  test("enum matches case- and space-insensitively to the canonical label", () => {
    expect(val("selesai", status)).toBe("Selesai");
    expect(val("  batal   / n.a. ", status)).toBe("Batal / N.A.");
    expect(err("Done", status)).toBe(true);
  });
  test("eqCanon treats undefined as null and compares exactly", () => {
    expect(eqCanon(undefined, null)).toBe(true);
    expect(eqCanon(4, 4)).toBe(true);
    expect(eqCanon(4, "4")).toBe(false);
  });
});

describe("a dash marks an empty number or date cell", () => {
  const scaled: ColumnType = { kind: "numeric", scale: 2, min: 1, max: 5 };
  test('"-", "–", "—" (padded or not) read as empty in int, numeric and date cells', () => {
    for (const raw of ["-", "–", "—", " – ", "\t—"]) {
      expect(val(raw, int15)).toBeNull();
      expect(val(raw, scaled)).toBeNull();
      expect(val(raw, date)).toBeNull();
    }
  });
  test("in a text cell a dash is text; in an enum it is not a choice", () => {
    expect(val("–", text)).toBe("–");
    expect(val(" - ", text)).toBe("-");
    expect(err("–", status)).toBe(true);
  });
  test("a dash with something else is not empty", () => {
    expect(err("--", int15)).toBe(true);
    expect(err("– 3", int15)).toBe(true);
    expect(val("-3", { kind: "int" })).toBe(-3);
    expect(err("1 – 2", date)).toBe(true);
  });
});

describe("stations, report groups and areas", () => {
  const station: ColumnType = { kind: "station" };
  const group: ColumnType = { kind: "report-group" };
  const area: ColumnType = { kind: "area" };
  test("station codes are upper-cased and shape-checked; KPS only where allowed", () => {
    expect(val(" sub ", station)).toBe("SUB");
    expect(err("S", station)).toBe(true);
    expect(err("SURABAYA", station)).toBe(true);
    expect(err("KPS", station)).toBe(true);
    expect(val("kps", { kind: "station", kps: true })).toBe("KPS");
  });
  test("report groups are upper-cased with spaces collapsed", () => {
    expect(val("cgk  &   hlp", group)).toBe("CGK & HLP");
    expect(val("dps", group)).toBe("DPS");
  });
  test("areas keep their case (matched against pd_areas by the merge) with spaces collapsed", () => {
    expect(val("  komunikasi   touch point ", area)).toBe("komunikasi touch point");
    expect(val("   ", area)).toBeNull();
  });
});
