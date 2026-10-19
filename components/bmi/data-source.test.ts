/*
 * Guard for the Cek BMI screen's data rules (see the header of BmiScreen.tsx):
 *
 * 1. Data source. The screen mirrors the Google Sheet tab "Cek BMI 2 Mingguan", so nothing under
 *    components/bmi may read the weekly scores, replacements, action items, weekly reports or the
 *    baseline scores from the workspace. The source files are parsed, so a comment
 *    that explains the rule does not trip it; a name used in code or in a string does.
 * 2. One interval for everyone. No "monthly" rhythm for staff without a BMI note, in code or comments.
 * 3. The number of checks comes from Parameter (1 to 52). Nothing here may hard-code the five of the workbook.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const DIR = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(): string[] {
  return readdirSync(DIR)
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(DIR, name));
}

/** The workspace fields (and their database names) this screen must not read. */
const FORBIDDEN_FIELDS =
  /^(weeklyScores|weekly_scores|replacements|actionItems|action_items|weeklyReports|weekly_reports|preTest|pre_test|postTest|post_test|scoreA|score_a|reportConclusion|report_conclusion)$/;

function parse(path: string): ts.SourceFile {
  const text = readFileSync(path, "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

describe("Cek BMI data source", () => {
  test("there are source files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(15);
  });

  test("no file under components/bmi names a workspace field outside the BMI tab", () => {
    const found: string[] = [];
    for (const path of sourceFiles()) {
      const file = parse(path);
      walk(file, (node) => {
        const name =
          ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isPrivateIdentifier(node) ? node.text : null;
        if (name && FORBIDDEN_FIELDS.test(name)) {
          const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
          found.push(`${path.slice(DIR.length)}:${line} ${name}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  test("BmiScreen states the rule in its header", () => {
    const text = readFileSync(join(DIR, "BmiScreen.tsx"), "utf8");
    expect(text.trimStart().startsWith("/*")).toBe(true);
    expect(text.slice(0, 1200)).toContain("DATA RULE");
    expect(text.slice(0, 1200)).toContain("Cek BMI 2 Mingguan");
  });
});

describe("Cek BMI interval and number of checks", () => {
  test("no trace of a monthly rhythm", () => {
    const found: string[] = [];
    for (const path of sourceFiles()) {
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (/bulanan|monthly|tanpa catatan|sebulan|per bulan/i.test(line)) found.push(`${path.slice(DIR.length)}:${index + 1}`);
        });
    }
    expect(found).toEqual([]);
  });

  // Five is also the number of columns of a check and of identity columns, so only words are checked here;
  // the tests of tracker-model, xlsx-export and labels run 1, 8, 26 and 52 checks.
  test("the number of checks is never written as a word", () => {
    const found: string[] = [];
    for (const path of sourceFiles()) {
      const file = parse(path);
      walk(file, (node) => {
        if (ts.isStringLiteralLike(node) && /\b(lima|five)\b/i.test(node.text)) {
          found.push(`${path.slice(DIR.length)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1} "${node.text}"`);
        }
      });
    }
    expect(found).toEqual([]);
  });
});
