import type { ParsedStatement, ParsedTransaction, StatementFormat } from '../types';
import { normalizeText, parseAmount, parseDate } from '../text';

export type Cell = string | number | null | undefined;

/** Mapeamento das colunas da tabela. Índices começam em 0. */
export interface ColumnMap {
  headerRow: number;
  date: number;
  description: number;
  /** Coluna única de valor (com sinal ou com D/C). */
  amount?: number;
  /** Colunas separadas de crédito (entrada) e débito (saída). */
  credit?: number;
  debit?: number;
  /** Coluna com "D"/"C", "Débito"/"Crédito", "Saída"/"Entrada". */
  type?: number;
  /** Colunas extras concatenadas na descrição (ex.: "Detalhes"). */
  extra?: number[];
  /** Identificador do lançamento (ex.: "Identificador" do Nubank). */
  id?: number;
}

const H = {
  date: ['DATA', 'DATA LANCAMENTO', 'DATA DO LANCAMENTO', 'DT LANCAMENTO', 'DATA MOVIMENTO', 'DT', 'DATE', 'DIA', 'DATA OPERACAO', 'DATA TRANSACAO', 'DATA COMPRA'],
  description: ['DESCRICAO', 'HISTORICO', 'LANCAMENTO', 'LANCAMENTOS', 'DESCRIPTION', 'TITLE', 'TITULO', 'ESTABELECIMENTO', 'MEMO', 'DETALHE', 'NOME', 'MOVIMENTACAO', 'TRANSACAO'],
  amount: ['VALOR', 'VALOR R$', 'VALOR (R$)', 'AMOUNT', 'VALOR LANCAMENTO', 'MONTANTE', 'VALOR EM R$', 'QUANTIA'],
  credit: ['CREDITO', 'CREDITOS', 'ENTRADA', 'ENTRADAS', 'CREDITO (R$)', 'RECEITA'],
  debit: ['DEBITO', 'DEBITOS', 'SAIDA', 'SAIDAS', 'DEBITO (R$)', 'DESPESA'],
  type: ['TIPO', 'D/C', 'C/D', 'NATUREZA', 'TIPO LANCAMENTO', 'TIPO DE TRANSACAO'],
  extra: ['DETALHES', 'COMPLEMENTO', 'DOCUMENTO', 'OBSERVACAO'],
  id: ['IDENTIFICADOR', 'ID', 'NSU', 'CODIGO'],
  ignore: ['SALDO', 'SALDO (R$)', 'SALDO DO DIA', 'BALANCE'],
};

function headerMatch(cell: Cell, names: string[]): boolean {
  if (cell === null || cell === undefined) return false;
  const n = normalizeText(String(cell)).replace(/[:.]$/, '');
  return names.includes(n);
}

function findIndex(row: Cell[], names: string[], used: Set<number>): number | undefined {
  // Primeiro a correspondência exata, depois "começa com" (ex.: "Valor (R$)").
  for (let i = 0; i < row.length; i++) if (!used.has(i) && headerMatch(row[i], names)) return i;
  for (let i = 0; i < row.length; i++) {
    if (used.has(i) || row[i] === null || row[i] === undefined) continue;
    const n = normalizeText(String(row[i]));
    if (names.some((name) => name.length > 3 && n.startsWith(name + ' '))) return i;
  }
  return undefined;
}

/** Procura a linha de cabeçalho nas primeiras linhas e monta o mapa de colunas. */
export function detectColumns(rows: Cell[][]): ColumnMap | null {
  const limit = Math.min(rows.length, 40);
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    const used = new Set<number>();
    const take = (names: string[]) => {
      const i = findIndex(row, names, used);
      if (i !== undefined) used.add(i);
      return i;
    };
    const date = take(H.date);
    if (date === undefined) continue;
    const description = take(H.description);
    const amount = take(H.amount);
    const credit = take(H.credit);
    const debit = take(H.debit);
    if (description === undefined || (amount === undefined && credit === undefined && debit === undefined)) continue;
    const type = take(H.type);
    const id = take(H.id);
    const extra: number[] = [];
    for (let i = 0; i < row.length; i++) if (!used.has(i) && headerMatch(row[i], H.extra)) extra.push(i);
    return { headerRow: r, date, description, amount, credit, debit, type, id, extra };
  }
  return detectHeaderless(rows);
}

/** Sem cabeçalho: tenta inferir data / descrição / valor pelo conteúdo. */
function detectHeaderless(rows: Cell[][]): ColumnMap | null {
  const sample = rows.filter((r) => r.some((c) => c !== null && c !== '' && c !== undefined)).slice(0, 30);
  if (sample.length === 0) return null;
  const width = Math.max(...sample.map((r) => r.length));
  const score = (fn: (c: Cell) => boolean) =>
    Array.from({ length: width }, (_, i) => sample.filter((r) => fn(r[i])).length);
  const dateScore = score((c) => parseDate(c as string) !== null);
  const amountScore = score((c) => typeof c === 'number' || (typeof c === 'string' && /\d[.,]\d{2}\b/.test(c) && parseAmount(c) !== null));
  const textScore = score((c) => typeof c === 'string' && /[A-Za-zÀ-ú]{3,}/.test(c) && parseDate(c) === null);
  const best = (arr: number[], exclude: number[]) =>
    arr.reduce((b, v, i) => (exclude.includes(i) || v <= (arr[b] ?? -1) ? b : i), -1);
  const date = best(dateScore, []);
  if (date < 0 || dateScore[date] < sample.length / 2) return null;
  const description = best(textScore, [date]);
  const amount = best(amountScore, [date, description]);
  if (description < 0 || amount < 0 || amountScore[amount] < sample.length / 2) return null;
  return { headerRow: -1, date, description, amount, extra: [] };
}

function isDebitMarker(cell: Cell): boolean | null {
  if (cell === null || cell === undefined) return null;
  const n = normalizeText(String(cell));
  if (!n) return null;
  if (/^(D|DEB|DEBITO|SAIDA|DESPESA|-)$/.test(n) || n.startsWith('DEBITO') || n.startsWith('SAIDA')) return true;
  if (/^(C|CRED|CREDITO|ENTRADA|RECEITA|\+)$/.test(n) || n.startsWith('CREDITO') || n.startsWith('ENTRADA')) return false;
  return null;
}

const SKIP_DESCRIPTIONS = /^(SALDO( ANTERIOR| DO DIA| FINAL| ATUAL| EM C\/C| DISPONIVEL)?|S A L D O|TOTAL|SDO CTA|SALDO TOTAL.*)\b/;

export interface TableParseOptions {
  /** Inverte o sinal (útil para faturas de cartão que trazem compras positivas). */
  invertSign?: boolean;
  columns?: ColumnMap;
}

export function parseTable(rows: Cell[][], format: StatementFormat, opts: TableParseOptions = {}): ParsedStatement {
  const warnings: string[] = [];
  const cols = opts.columns ?? detectColumns(rows);
  if (!cols) {
    return {
      format,
      transactions: [],
      warnings: ['Não foi possível identificar as colunas de data, descrição e valor.'],
    };
  }
  const transactions: ParsedTransaction[] = [];
  let lastYear: number | undefined;
  for (let r = cols.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;
    const date = parseDate(row[cols.date] as string, lastYear);
    if (!date) continue; // linhas de rodapé, subtotais, etc.
    lastYear = Number(date.slice(0, 4));
    let description = String(row[cols.description] ?? '').trim();
    for (const e of cols.extra ?? []) {
      const v = String(row[e] ?? '').trim();
      if (v && v !== '-' && !description.includes(v)) description = `${description} ${v}`.trim();
    }
    if (SKIP_DESCRIPTIONS.test(normalizeText(description))) continue;

    let amount: number | null = null;
    if (cols.amount !== undefined) amount = parseAmount(row[cols.amount]);
    if ((amount === null || amount === 0) && (cols.credit !== undefined || cols.debit !== undefined)) {
      const credit = cols.credit !== undefined ? parseAmount(row[cols.credit]) : null;
      const debit = cols.debit !== undefined ? parseAmount(row[cols.debit]) : null;
      if (credit) amount = Math.abs(credit);
      else if (debit) amount = -Math.abs(debit);
    }
    if (amount === null) {
      warnings.push(`Linha ${r + 1} ignorada: valor não reconhecido.`);
      continue;
    }
    if (cols.type !== undefined) {
      const debit = isDebitMarker(row[cols.type]);
      if (debit === true) amount = -Math.abs(amount);
      else if (debit === false) amount = Math.abs(amount);
    }
    if (opts.invertSign) amount = -amount;
    if (amount === 0) continue;
    transactions.push({
      date,
      description: description || 'Sem descrição',
      amountCents: amount,
      externalId: cols.id !== undefined && row[cols.id] ? String(row[cols.id]) : undefined,
    });
  }
  if (transactions.length === 0) warnings.push('Nenhum lançamento encontrado.');
  return { format, transactions, warnings };
}
