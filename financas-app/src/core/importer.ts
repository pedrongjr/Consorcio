import type { ParsedStatement, ParsedTransaction, StatementFormat } from './types';
import { decodeText, descriptionKey } from './text';
import { looksLikeOfx, parseOfx } from './parsers/ofx';
import { looksLikeQif, parseQif } from './parsers/qif';
import { parseCsv } from './parsers/csv';
import { parseSpreadsheet } from './parsers/spreadsheet';
import { parsePdfText } from './parsers/pdfText';

export class UnsupportedFormatError extends Error {}

/** Tipo MIME da imagem (JPG, PNG ou WEBP) pelo conteúdo do arquivo, ou `null`. */
export function imageMimeType(fileName: string, bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  const riff = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return riff ? 'image/webp' : null;
}

/** Descobre o formato pela extensão e, em caso de dúvida, pelo conteúdo. */
export function detectFormat(fileName: string, bytes: Uint8Array): StatementFormat {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  if (isPdf || ext === 'pdf') return 'pdf';
  if (imageMimeType(fileName, bytes)) return 'image';
  if (['heic', 'heif'].includes(ext)) {
    throw new UnsupportedFormatError('Fotos HEIC não são suportadas. Tire um print da tela ou salve a foto como JPG.');
  }
  if (isZip) {
    if (ext === 'ods') return 'ods';
    if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
    // Procura o mimetype do OpenDocument no início do zip.
    const head = decodeText(bytes.slice(0, 200));
    return head.includes('opendocument.spreadsheet') ? 'ods' : 'xlsx';
  }
  if (ext === 'xls' && bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    throw new UnsupportedFormatError(
      'Arquivos .xls (Excel 97-2003) não são suportados. Abra no Excel/Planilhas e salve como .xlsx ou .csv, ou exporte o extrato em OFX.',
    );
  }
  const text = decodeText(bytes.slice(0, 4000));
  if (['ofx', 'qfx', 'ofc'].includes(ext) || looksLikeOfx(text)) return 'ofx';
  if (ext === 'qif' || looksLikeQif(text)) return 'qif';
  // Texto delimitado — inclui tabelas HTML salvas como ".xls" por alguns bancos.
  if (['csv', 'txt', 'tsv', 'xls'].includes(ext) || /[;,\t]/.test(text) || /<table/i.test(text)) return 'csv';
  throw new UnsupportedFormatError('Formato de arquivo não reconhecido. Use OFX, CSV, QIF, XLSX, ODS, PDF ou imagem (JPG/PNG).');
}

/** Converte tabela HTML (exportações "xls" de alguns bancos) para CSV com `;`. */
function htmlTableToCsv(html: string): string {
  const rows = [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((tr) =>
    [...tr[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((td) => td[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim())
      .map((c) => `"${c.replace(/"/g, '""')}"`)
      .join(';'),
  );
  return rows.join('\n');
}

export interface ParseFileInput {
  fileName: string;
  bytes: Uint8Array;
  /** Para PDFs e imagens: linhas de texto já extraídas (pdf.js ou OCR). */
  pdfLines?: string[];
  /** As linhas vieram de OCR. */
  ocr?: boolean;
  creditCard?: boolean;
}

export function parseStatementFile(input: ParseFileInput): ParsedStatement {
  const format = detectFormat(input.fileName, input.bytes);
  let result: ParsedStatement;
  switch (format) {
    case 'pdf':
    case 'image':
      if (!input.pdfLines) throw new Error('O texto do PDF/imagem precisa ser extraído antes.');
      return parsePdfText(input.pdfLines, { creditCard: input.creditCard, ocr: input.ocr || format === 'image', format });
    case 'ofx':
      return parseOfx(decodeText(input.bytes));
    case 'qif':
      result = parseQif(decodeText(input.bytes));
      break;
    case 'xlsx':
    case 'ods':
      result = parseSpreadsheet(input.bytes, format);
      break;
    default: {
      let text = decodeText(input.bytes);
      if (/<table/i.test(text.slice(0, 5000))) text = htmlTableToCsv(text);
      result = parseCsv(text);
    }
  }
  if (input.creditCard) result = adjustCardSigns(result);
  return result;
}

/**
 * Faturas em CSV/planilha (ex.: Nubank) trazem compras como valores positivos.
 * Se a maioria dos valores for positiva numa conta de cartão, invertemos.
 */
export function adjustCardSigns(st: ParsedStatement): ParsedStatement {
  const positives = st.transactions.filter((t) => t.amountCents > 0).length;
  if (st.transactions.length === 0 || positives / st.transactions.length < 0.6) return st;
  return {
    ...st,
    transactions: st.transactions.map((t) => ({ ...t, amountCents: -t.amountCents })),
    warnings: [...st.warnings, 'Sinais invertidos: compras do cartão registradas como saídas.'],
  };
}

/**
 * Chave de deduplicação. Usa o FITID do banco quando existe; senão,
 * data + valor + descrição normalizada + ordem da ocorrência (para não
 * perder duas compras iguais no mesmo dia).
 */
export function dedupeKeys(txs: ParsedTransaction[]): string[] {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    if (t.externalId) return `id:${t.externalId}`;
    const base = `${t.date}|${t.amountCents}|${descriptionKey(t.description)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `h:${base}|${n}`;
  });
}
