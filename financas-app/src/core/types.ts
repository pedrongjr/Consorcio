/** Formatos de extrato suportados. */
export type StatementFormat = 'ofx' | 'csv' | 'qif' | 'xlsx' | 'ods' | 'pdf' | 'image';

/** Lançamento extraído de um arquivo de extrato, antes de ser salvo. */
export interface ParsedTransaction {
  /** Data no formato ISO `YYYY-MM-DD`. */
  date: string;
  /** Descrição/histórico como veio do banco. */
  description: string;
  /** Valor em centavos. Negativo = saída (débito), positivo = entrada (crédito). */
  amountCents: number;
  /** Identificador único do banco (FITID do OFX), quando houver. */
  externalId?: string;
  /** Texto complementar (MEMO, documento, etc.). */
  memo?: string;
}

export interface ParsedStatement {
  format: StatementFormat;
  transactions: ParsedTransaction[];
  /** Dados da conta identificados no arquivo (OFX traz banco/agência/conta). */
  account?: {
    bankId?: string;
    branchId?: string;
    accountId?: string;
    type?: 'checking' | 'savings' | 'credit_card';
    currency?: string;
  };
  /** Nome do titular lido no cabeçalho do extrato (PDF). */
  holderName?: string;
  /** Saldo final informado pelo banco, em centavos. */
  balanceCents?: number;
  /** Avisos não fatais (linhas ignoradas etc.). */
  warnings: string[];
}

export type CategoryKind = 'expense' | 'income' | 'transfer';

export interface CategoryDef {
  /** Identificador estável (slug), ex.: `alimentacao.supermercado`. */
  key: string;
  name: string;
  kind: CategoryKind;
  /** Chave da categoria-pai, quando for subcategoria. */
  parent?: string;
  icon: string;
  color: string;
}

/** Regra de classificação: se a descrição normalizada contém `pattern`, aplica `categoryKey`. */
export interface CategoryRule {
  pattern: string;
  categoryKey: string;
  /** Restringe a regra ao sinal do valor. */
  direction?: 'in' | 'out';
  /** Regras do usuário têm prioridade sobre as padrão. */
  source: 'user' | 'default';
  /** Desempate entre regras padrão: maior vence antes do tamanho do padrão. */
  priority?: number;
}
