import type { CategoryKind, ParsedStatement, ParsedTransaction } from '../core/types';
import type { ReportCategory } from '../core/reports';

/**
 * Tipos e funções auxiliares sem acesso a banco, usados pelo app (SQLite),
 * pela versão web (API) e pelo servidor.
 */

export type AccountType = 'checking' | 'savings' | 'credit_card' | 'cash' | 'investment';

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  bank: string | null;
  external_key: string | null;
  initial_balance_cents: number;
  color: string;
  archived: number;
}

export interface AccountWithBalance extends Account {
  balance_cents: number;
  tx_count: number;
}

export interface Category {
  key: string;
  name: string;
  kind: CategoryKind;
  parent: string | null;
  icon: string;
  color: string;
  sort: number;
}

export interface Transaction {
  id: number;
  account_id: number;
  account_name: string;
  date: string;
  description: string;
  memo: string | null;
  notes: string | null;
  amount_cents: number;
  category_key: string | null;
  category_source: string;
}

export interface Rule {
  id: number;
  pattern: string;
  category_key: string;
  direction: 'in' | 'out' | null;
}

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking', label: 'Conta corrente' },
  { value: 'savings', label: 'Poupança' },
  { value: 'credit_card', label: 'Cartão de crédito' },
  { value: 'investment', label: 'Investimentos' },
  { value: 'cash', label: 'Carteira / dinheiro' },
];

/** Códigos COMPE dos bancos mais comuns, para nomear contas vindas do OFX. */
const BANKS: Record<string, string> = {
  '001': 'Banco do Brasil', '033': 'Santander', '104': 'Caixa', '237': 'Bradesco', '341': 'Itaú',
  '260': 'Nubank', '077': 'Inter', '336': 'C6 Bank', '212': 'Banco Original', '756': 'Sicoob',
  '748': 'Sicredi', '041': 'Banrisul', '422': 'Safra', '208': 'BTG Pactual', '655': 'Votorantim',
  '380': 'PicPay', '323': 'Mercado Pago', '290': 'PagBank', '403': 'Cora', '197': 'Stone', '070': 'BRB',
  '004': 'Banco do Nordeste', '021': 'Banestes', '637': 'Sofisa', '623': 'Pan', '746': 'Modal', '102': 'XP',
};

export function bankName(bankId?: string): string | undefined {
  if (!bankId) return undefined;
  const code = bankId.replace(/\D/g, '').slice(-3).padStart(3, '0');
  return BANKS[code];
}

export function accountExternalKey(acc: ParsedStatement['account']): string | null {
  if (!acc?.accountId) return null;
  return [acc.bankId ?? '', acc.branchId ?? '', acc.accountId].join('|');
}

export function categoryMap(cats: Category[]): Map<string, ReportCategory> {
  return new Map(cats.map((c) => [c.key, c]));
}

export interface TxFilter {
  month?: string; // YYYY-MM
  accountId?: number;
  categoryKey?: string; // inclui subcategorias
  search?: string;
  uncategorizedOnly?: boolean;
}

export interface ImportCandidate extends ParsedTransaction {
  dedupeKey: string;
  categoryKey: string;
  categorySource: string;
  duplicate: boolean;
  selected: boolean;
}

export interface ImportRecord {
  id: number;
  file_name: string;
  format: string;
  account_name: string;
  imported_count: number;
  skipped_count: number;
  created_at: string;
}
