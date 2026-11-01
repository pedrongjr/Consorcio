/**
 * Utilitários de texto, números e datas no padrão dos bancos brasileiros.
 */

const CP1252_EXTRA: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function decodeCp1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += String.fromCharCode(CP1252_EXTRA[b] ?? b);
  }
  return out;
}

/** Decodifica UTF-8 de forma estrita; retorna `null` se a sequência for inválida. */
function decodeUtf8Strict(bytes: Uint8Array): string | null {
  let out = '';
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3; // BOM
  while (i < bytes.length) {
    const b = bytes[i];
    let cp: number;
    let extra: number;
    if (b < 0x80) { cp = b; extra = 0; }
    else if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; extra = 1; }
    else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; extra = 2; }
    else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; extra = 3; }
    else return null;
    for (let k = 1; k <= extra; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

/**
 * Converte os bytes de um arquivo de texto em string. Extratos brasileiros
 * costumam vir em Windows-1252/ISO-8859-1; tentamos UTF-8 primeiro.
 */
export function decodeText(bytes: Uint8Array): string {
  return decodeUtf8Strict(bytes) ?? decodeCp1252(bytes);
}

/** Remove acentos, deixa em maiúsculas e colapsa espaços. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Versão da descrição usada para comparar lançamentos semelhantes:
 * sem acentos, sem datas, números longos, códigos de autorização e pontuação.
 */
export function descriptionKey(s: string): string {
  return normalizeText(s)
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, ' ')
    .replace(/\b\d{2}:\d{2}(:\d{2})?\b/g, ' ')
    .replace(/\bPARC(ELA)?\s*\d+\s*(\/|DE)\s*\d+\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, ' ')
    .replace(/[0-9*#]{4,}/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Converte reais em centavos arredondando "para longe do zero" (-12,345 → -1235). */
export function toCents(value: number): number {
  const cents = Math.round(Math.abs(value) * 100 + 1e-7);
  return value < 0 ? -cents : cents;
}

/**
 * Interpreta um valor monetário em formato brasileiro ou internacional e
 * devolve centavos. Aceita "1.234,56", "-1.234,56", "1,234.56", "R$ 10,00",
 * "(10,00)", "10,00-", "10,00 D", "10,00 C". Retorna `null` se não for número.
 */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? toCents(raw) : null;
  let s = raw.trim().toUpperCase();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/\s*D$/.test(s) && /\d/.test(s)) { negative = true; s = s.replace(/\s*D$/, ''); }
  else if (/\s*C$/.test(s) && /\d/.test(s)) { s = s.replace(/\s*C$/, ''); }
  s = s.replace(/R\$|BRL|\s/g, '');
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;
  if (lastComma > -1 && lastDot > -1) {
    // O separador que aparece por último é o decimal.
    normalized = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    const commas = s.split(',').length - 1;
    normalized = commas === 1 && decimals !== 3 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot > -1) {
    const decimals = s.length - lastDot - 1;
    const dots = s.split('.').length - 1;
    // "1.234" (milhar no padrão BR) x "12.34" (decimal no padrão US/OFX)
    normalized = dots === 1 && decimals !== 3 ? s : dots > 1 ? s.replace(/\./g, '') : s.replace('.', '');
  } else {
    normalized = s;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const cents = toCents(value);
  return negative ? -cents : cents;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const MONTHS_PT: Record<string, number> = {
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12,
  FEB: 2, APR: 4, MAY: 5, AUG: 8, SEP: 9, OCT: 10, DEC: 12,
};

/**
 * Converte datas comuns em extratos para ISO. Aceita `dd/mm/aaaa`, `dd/mm/aa`,
 * `dd-mm-aaaa`, `aaaa-mm-dd`, `aaaammdd` (OFX), `dd/mm` (usa `fallbackYear`)
 * e `dd MMM` / `dd/MMM/aaaa` com mês abreviado em português.
 */
export function parseDate(raw: string | number | null | undefined, fallbackYear?: number): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    // Número serial de data do Excel (dias desde 1899-12-30).
    if (raw > 20000 && raw < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
      return validDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
    raw = String(raw);
  }
  const s = raw.trim().toUpperCase();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/)) && s.length >= 8 && !/[\/.-]/.test(s.slice(0, 8))) {
    return validDate(+m[1], +m[2], +m[3]);
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return validDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/))) {
    let y = +m[3];
    if (m[3].length === 2) y += 2000;
    return validDate(y, +m[2], +m[1]);
  }
  if ((m = s.match(/^(\d{1,2})[\/\s.-]+([A-Z]{3})[A-Z]*\.?(?:[\/\s.-]+(\d{2,4}))?\b/)) && MONTHS_PT[m[2]]) {
    let y = m[3] ? +m[3] : fallbackYear;
    if (y === undefined) return null;
    if (m[3] && m[3].length === 2) y += 2000;
    return validDate(y, MONTHS_PT[m[2]], +m[1]);
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/)) && fallbackYear) {
    return validDate(fallbackYear, +m[2], +m[1]);
  }
  return null;
}
