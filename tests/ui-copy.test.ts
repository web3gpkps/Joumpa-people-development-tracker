/*
 * Copy guard (DESIGN.md Principle 4: product vocabulary, not spreadsheet vocabulary).
 * Scans every string literal, template text and JSX text in app/** and components/**
 * (tests and comments excluded) and fails on words that must never reach the screen.
 *
 * PENDING_SCREENS lists screen files that phase 2 is rewriting. Each entry is allowed to
 * fail for now; remove it as soon as its screen is redone. The test also fails when an
 * allowlisted file is already clean, so the list can only shrink.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const FORBIDDEN: Array<[RegExp, string]> = [
  [/[Ww]orkbook/, "workbook"],
  [/sel kuning/i, "sel kuning"],
  [/PDF/, "PDF"],
  [/dummy/i, "dummy"],
  [/Cara mengisi/i, "Cara mengisi"],
  [/\u2014/, "em dash"],
  [/\b[Ss]heet\b/, "sheet"],
  [/\b(tabel|kriteria|butir) \d+\.\d+/i, "report table reference"],
];

/**
 * Screen files phase 2 is still rewriting (they still say "sheet", "workbook" or cite report
 * tables). Remove each entry as soon as its screen is redone; the second test fails on an
 * entry whose file is already clean, so this list can only shrink.
 */
const PENDING_SCREENS = new Set<string>([
]);

/**
 * The owner-only sync screens name the replica by its product name, "Google Sheet", and so does
 * the Rencana Aksi archive confirmation (an archived plan also leaves the Google Sheet). There,
 * and only there, that exact proper noun is allowed; any other "sheet" still fails.
 */
function allowsGoogleSheet(rel: string): boolean {
  return (
    rel.startsWith("app/admin/sinkronisasi/") ||
    rel === "components/admin/ConflictTable.tsx" ||
    rel === "components/admin/SyncActions.tsx" ||
    rel === "components/admin/sync-labels.ts" ||
    rel === "components/rencana-aksi/ArchivePlanDialog.tsx"
  );
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

type Hit = { line: number; word: string; text: string };

/** Visible text in one file: string literals (not module paths), template pieces and JSX text. */
function hits(path: string): Hit[] {
  const text = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Hit[] = [];
  const googleSheet = allowsGoogleSheet(relative(ROOT, path).split("\\").join("/"));
  const check = (node: ts.Node, value: string) => {
    for (const [pattern, word] of FORBIDDEN) {
      const seen = word === "sheet" && googleSheet ? value.replace(/Google Sheet/g, "") : value;
      if (pattern.test(seen)) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        found.push({ line, word, text: value.trim().slice(0, 80) });
      }
    }
  };
  // Object keys and operands of an equality test are machine codes ("sheet-wins"), never copy.
  const isCode = (node: ts.Node) => {
    const parent = node.parent;
    if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
    if (!ts.isBinaryExpression(parent)) return false;
    const op = parent.operatorToken.kind;
    return op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isCode(node)) check(node, node.text);
    }
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) check(node, node.text);
    else if (ts.isJsxText(node)) check(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const files = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))].map((p) => ({
  path: p,
  rel: relative(ROOT, p).split("\\").join("/"),
}));

describe("UI copy uses product vocabulary", () => {
  test("no spreadsheet, PDF or placeholder wording outside the pending screens", () => {
    const failures = files
      .filter((f) => !PENDING_SCREENS.has(f.rel))
      .flatMap((f) => hits(f.path).map((h) => `${f.rel}:${h.line} [${h.word}] ${h.text}`));
    expect(failures).toEqual([]);
  });

  test("every pending screen still exists and still needs its allowlist entry", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.path]));
    const stale = [...PENDING_SCREENS].filter((rel) => !byRel.has(rel) || hits(byRel.get(rel)!).length === 0);
    expect(stale).toEqual([]);
  });
});
