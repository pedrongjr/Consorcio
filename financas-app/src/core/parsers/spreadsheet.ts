import { unzipSync, strFromU8 } from 'fflate';
import type { ParsedStatement } from '../types';
import { parseTable, type Cell, type TableParseOptions } from './table';

/**
 * Leitura mínima de planilhas XLSX (Excel) e ODS (LibreOffice/OpenDocument),
 * suficiente para extratos: lê a primeira aba com dados como uma tabela.
 * O formato binário antigo .xls não é suportado — exporte em .xlsx, .csv ou .ofx.
 */

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function innerText(xml: string): string {
  return decodeXml(xml.replace(/<[^>]+>/g, ''));
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : undefined;
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsxSheet(xml: string, shared: string[], dateStyles: Set<number>): Cell[][] {
  const rows: Cell[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const row: Cell[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let next = 0;
    while ((cm = cellRe.exec(rm[1]))) {
      const tag = cm[1];
      const body = cm[2] ?? '';
      const ref = attr(tag, 'r');
      const idx = ref ? columnIndex(ref) : next;
      next = idx + 1;
      const type = attr(tag, 't');
      const style = Number(attr(tag, 's') ?? -1);
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value: Cell = null;
      if (type === 's' && v !== undefined) value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = innerText(body);
      else if (type === 'str' || type === 'b' || type === 'e') value = v !== undefined ? decodeXml(v) : null;
      else if (v !== undefined) {
        const num = Number(v);
        value = Number.isFinite(num) ? num : decodeXml(v);
        // Datas no Excel são números com estilo de data: convertemos para dd/mm/aaaa.
        if (typeof value === 'number' && dateStyles.has(style)) value = excelSerialToBr(value);
      }
      row[idx] = value;
    }
    rows.push(Array.from(row, (c) => c ?? null));
  }
  return rows;
}

function excelSerialToBr(serial: number): string {
  const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`;
}

function xlsxDateStyles(stylesXml: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const builtinDate = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
  const custom = new Set<number>();
  const fmtRe = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = fmtRe.exec(stylesXml))) {
    const code = decodeXml(m[2]).replace(/"[^"]*"|\[[^\]]*\]/g, '').toLowerCase();
    if (/[dy]/.test(code) || /m{1,2}\/|\/m{1,2}/.test(code)) custom.add(Number(m[1]));
  }
  const xfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  const xfRe = /<xf\b([^>]*)/g;
  let i = 0;
  while ((m = xfRe.exec(xfs))) {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    if (builtinDate.has(id) || custom.has(id)) out.add(i);
    i++;
  }
  return out;
}

export function xlsxToRows(bytes: Uint8Array): Cell[][] {
  const files = unzipSync(bytes, {
    filter: (f) => f.name.startsWith('xl/worksheets/sheet') || f.name === 'xl/sharedStrings.xml' || f.name === 'xl/styles.xml',
  });
  const sharedXml = files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : '';
  const shared: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(sharedXml))) {
    // Ignora o texto fonético (<rPh>) e junta os trechos formatados (<r><t>).
    shared.push(innerText(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')));
  }
  const dateStyles = xlsxDateStyles(files['xl/styles.xml'] ? strFromU8(files['xl/styles.xml']) : undefined);
  const sheets = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  // Usa a primeira aba que tenha mais de uma linha com conteúdo.
  for (const name of sheets) {
    const rows = readXlsxSheet(strFromU8(files[name]), shared, dateStyles);
    if (rows.filter((r) => r.some((c) => c !== null && c !== '')).length > 1) return rows;
  }
  return [];
}

export function odsToRows(bytes: Uint8Array): Cell[][] {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'content.xml' });
  if (!files['content.xml']) return [];
  const xml = strFromU8(files['content.xml']);
  const table = xml.match(/<table:table\b[\s\S]*?<\/table:table>/)?.[0] ?? '';
  const rows: Cell[][] = [];
  const rowRe = /<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(table))) {
    const repeatRows = Math.min(Number(attr(rm[1], 'table:number-rows-repeated') ?? 1), 1);
    const row: Cell[] = [];
    const cellRe = /<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[2] ?? ''))) {
      const tag = cm[1];
      // Limita repetições para não expandir colunas vazias até a coluna 1024.
      const repeat = Math.min(Number(attr(tag, 'table:number-columns-repeated') ?? 1), 50);
      const type = attr(tag, 'office:value-type');
      let value: Cell;
      if (type === 'float' || type === 'currency' || type === 'percentage') value = Number(attr(tag, 'office:value'));
      else if (type === 'date') {
        const iso = attr(tag, 'office:date-value') ?? '';
        const [y, mo, d] = iso.slice(0, 10).split('-');
        value = d ? `${d}/${mo}/${y}` : iso;
      } else {
        const paragraphs = [...(cm[2] ?? '').matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)].map((p) => innerText(p[1]));
        value = paragraphs.length ? paragraphs.join(' ') : null;
      }
      for (let k = 0; k < repeat; k++) row.push(value);
    }
    while (row.length && (row[row.length - 1] === null || row[row.length - 1] === '')) row.pop();
    for (let k = 0; k < repeatRows; k++) rows.push(row);
  }
  return rows;
}

export function parseSpreadsheet(bytes: Uint8Array, kind: 'xlsx' | 'ods', opts?: TableParseOptions): ParsedStatement {
  const rows = kind === 'xlsx' ? xlsxToRows(bytes) : odsToRows(bytes);
  return parseTable(rows, kind, opts);
}
