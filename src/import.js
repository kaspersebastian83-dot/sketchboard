// Spreadsheet file import: convert the worksheets of a dropped .xlsx/.xls
// workbook into the same { headers, categories, series } shape that
// parseTableText produces, so paste and file-drop share one chart builder.
// Every sheet with chartable data is returned so the user can pick one when
// a workbook holds several.
import * as XLSX from 'xlsx';
import { parseTableText } from './charts.js';

function tableFromSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  // Drop fully-empty rows/cells and serialize as TSV for the shared parser.
  const grid = rows
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => row.map((cell) => String(cell ?? '')));
  if (grid.length < 2) return null;
  return parseTableText(grid.map((row) => row.join('\t')).join('\n'));
}

// All sheets that parse into a usable table: [{ name, table }].
export function tablesFromSpreadsheet(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheets = [];
  for (const name of workbook.SheetNames) {
    const table = tableFromSheet(workbook.Sheets[name]);
    if (table) sheets.push({ name, table });
  }
  return sheets;
}
