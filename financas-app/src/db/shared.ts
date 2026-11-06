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
  /** Transferência: a outra conta (destino se saiu, origem se entrou). */
  transfer_account_id: number | null;
  transfer_account_name: string | null;
  /** Lançamento correspondente na outra conta. */
  transfer_peer_id: number | null;
  /** 1 = criado automaticamente como contrapartida de uma transferência. */
  mirror: number;
}

export interface TransferInput {
  /** Outra conta da transferência; `null` desfaz a ligação. */
  accountId: number | null;
  /** Categoria de transferência (padrão: conforme o tipo das contas). */
  categoryKey?: string | null;
  /** Sem lançamento correspondente na outra conta: cria um (como no Minhas Finanças). */
  createMirror?: boolean;
}

export interface TransferResult {
  /** Lançamento ligado na outra conta (encontrado ou criado). */
  peerId: number | null;
  /** Encontrou um lançamento já importado na outra conta. */
  matched: boolean;
  /** Criou um lançamento na outra conta. */
  created: boolean;
}

export interface HolderInfo {
  /** Nomes do titular (como aparecem nos extratos). */
  names: string[];
  /** CPF mascarado ("***.616.981-**") ou null — o CPF completo não é guardado. */
  cpfMasked: string | null;
}

export interface SelfTransferResult {
  /** Registro no histórico de classificações (para desfazer). */
  logId: number | null;
  /** Lançamentos marcados como transferência para você mesmo. */
  classified: number;
  /** Pares ligados entre contas (saída numa, entrada noutra). */
  linked: number;
}

export interface Rule {
  id: number;
  pattern: string;
  category_key: string;
  direction: 'in' | 'out' | null;
}

/** Objetivo financeiro ("sonho"), com o total já guardado. */
export interface Goal {
  id: number;
  name: string;
  template: string;
  icon: string;
  color: string;
  target_cents: number;
  /** Mês-limite YYYY-MM (inclusive) ou null. */
  deadline: string | null;
  created_at: string;
  /** Conta vinculada: as movimentações dela (desde a criação) contam como depósitos. */
  account_id: number | null;
  account_name: string | null;
  saved_cents: number;
  /** Guardado desde a data pedida em `listGoals` (para calcular o ritmo). */
  recent_cents: number;
}

/** Depósito (valor positivo) ou retirada (negativo) de um objetivo. */
export interface GoalEntry {
  id: number;
  goal_id: number;
  date: string;
  amount_cents: number;
  note: string | null;
  /** 1 = movimentação da conta vinculada (não pode ser excluída aqui). */
  auto: number;
}

export interface GoalInput {
  id?: number;
  name: string;
  template: string;
  icon: string;
  color: string;
  target_cents: number;
  deadline: string | null;
  account_id?: number | null;
}

export type ClassificationAction = 'manual' | 'similar' | 'rule' | 'reset' | 'self';

/** Uma alteração de categoria (de um ou vários lançamentos), que pode ser desfeita. */
export interface ClassificationLogEntry {
  id: number;
  created_at: string;
  action: ClassificationAction;
  category_key: string | null;
  label: string;
  rule_pattern: string | null;
  tx_count: number;
  undone: number;
}

export interface ClassifyResult {
  /** Registro no histórico (para desfazer); `null` se nada mudou. */
  logId: number | null;
  /** Total de lançamentos alterados, incluindo o próprio. */
  changed: number;
  /** Quantos mudaram por terem a mesma descrição. */
  similar: number;
  /** Quantos já importados mudaram pela regra nova. */
  byRule: number;
}

export interface SimilarPreview {
  /** Outros lançamentos com a mesma descrição (mesmo sentido: entrada/saída). */
  count: number;
  /** A descrição só tem palavras genéricas ("PIX ENVIADO") — nada é aplicado aos semelhantes. */
  generic: boolean;
}

export interface RulePreview {
  /** Lançamentos já importados que o padrão alcança. */
  count: number;
  generic: boolean;
  examples: string[];
}

export const RULE_TOO_GENERIC =
  'Esse texto é genérico demais (ex.: “PIX ENVIADO”, “COMPRA CARTAO”) e valeria para quase todos os lançamentos. ' +
  'Use o nome de quem recebeu ou da loja, como “NUCLEO CAMALEAO”.';

export const ACTION_LABEL: Record<ClassificationAction, string> = {
  manual: 'Categoria alterada',
  similar: 'Categoria aplicada aos semelhantes',
  rule: 'Regra criada',
  reset: 'Classificação automática refeita',
  self: 'Transferências para você mesmo',
};

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
  /** Várias contas (vazio ou ausente = todas). */
  accountIds?: number[];
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
