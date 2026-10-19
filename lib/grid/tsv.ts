/*
 * Clipboard text as Excel and Google Sheets write it: rows separated by newlines, cells by
 * tabs. A cell that holds a tab, a newline or a double quote is wrapped in double quotes,
 * with inner quotes doubled. Pure, unit-tested.
 */

/** Parses copied spreadsheet text into rows of cells. A single trailing newline is ignored. */
export function parseTsv(text: string): string[][] {
  const input = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let atCellStart = true;

  while (i < input.length) {
    const ch = input[i];
    if (atCellStart && ch === '"') {
      // Quoted cell: read to the closing quote; "" is a literal quote.
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < input.length) {
        if (input[j] === '"') {
          if (input[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        value += input[j];
        j += 1;
      }
      // Only a real quoted cell if the quote closes right before a separator or the end.
      if (closed && (j === input.length || input[j] === "\t" || input[j] === "\n")) {
        cell = value;
        i = j;
        atCellStart = false;
        continue;
      }
      // Otherwise the quote is plain text (e.g. 5" screen).
    }
    if (ch === "\t") {
      row.push(cell);
      cell = "";
      atCellStart = true;
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atCellStart = true;
    } else {
      cell += ch;
      atCellStart = false;
    }
    i += 1;
  }
  if (!atCellStart || cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function quote(cell: string): string {
  return /[\t\n\r"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Serialises rows of cells for the clipboard (pastes back into Excel / Sheets cell by cell). */
export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.map(quote).join("\t")).join("\n");
}
