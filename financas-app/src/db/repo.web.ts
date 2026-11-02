import type { CategoryKind, ParsedStatement } from '../core/types';
import { rpc } from '../lib/api';
import type {
  Account, AccountType, AccountWithBalance, Category, ClassificationLogEntry, ClassifyResult, ImportCandidate, ImportRecord, Rule,
  RulePreview, SimilarPreview, Transaction, TxFilter,
} from './shared';

/**
 * Web: mesmas funções de `repo.ts`, mas executadas no servidor. O primeiro
 * parâmetro (o "banco") é ignorado: o servidor identifica o usuário pela
 * sessão e só devolve os dados dele.
 */

export * from './shared';

type Db = unknown;

export const listAccounts = (_db: Db) => rpc<AccountWithBalance[]>('listAccounts');
export const saveAccount = (
  _db: Db,
  a: { id?: number; name: string; type: AccountType; bank?: string | null; initial_balance_cents?: number; color?: string; external_key?: string | null },
) => rpc<number>('saveAccount', a);
export const deleteAccount = (_db: Db, id: number) => rpc<void>('deleteAccount', id);
export const findAccountByExternalKey = (_db: Db, key: string | null) => rpc<Account | null>('findAccountByExternalKey', key);

export const listCategories = (_db: Db) => rpc<Category[]>('listCategories');
export const saveCategory = (
  _db: Db,
  c: { key?: string; name: string; kind: CategoryKind; parent: string | null; icon: string; color: string },
) => rpc<string>('saveCategory', c);
export const deleteCategory = (_db: Db, key: string) => rpc<void>('deleteCategory', key);

export const listRules = (_db: Db) => rpc<Rule[]>('listRules');
export const saveRule = (_db: Db, pattern: string, categoryKey: string, direction: 'in' | 'out' | null) =>
  rpc<void>('saveRule', pattern, categoryKey, direction);
export const deleteRule = (_db: Db, id: number) => rpc<void>('deleteRule', id);
export const reclassifyAll = (_db: Db) => rpc<number>('reclassifyAll');

export const listTransactions = (_db: Db, f: TxFilter = {}) => {
  // Remove filtros vazios (o servidor valida tipos estritamente).
  const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '' && v !== false));
  return rpc<Transaction[]>('listTransactions', clean);
};
export const getTransaction = (_db: Db, id: number) => rpc<Transaction | null>('getTransaction', id);
export const updateTransaction = (
  _db: Db,
  id: number,
  patch: { category_key?: string | null; notes?: string | null; description?: string; amount_cents?: number; date?: string },
) => rpc<void>('updateTransaction', id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
export const addManualTransaction = (
  _db: Db,
  t: { accountId: number; date: string; description: string; amountCents: number; categoryKey: string | null; notes?: string },
) => rpc<void>('addManualTransaction', t);
export const deleteTransaction = (_db: Db, id: number) => rpc<void>('deleteTransaction', id);

export const prepareImport = (_db: Db, accountId: number, st: ParsedStatement) => rpc<ImportCandidate[]>('prepareImport', accountId, st);
export const commitImport = (_db: Db, args: { accountId: number; fileName: string; format: string; candidates: ImportCandidate[] }) =>
  rpc<{ imported: number; skipped: number }>('commitImport', args);
export const listImports = (_db: Db) => rpc<ImportRecord[]>('listImports');
export const undoImport = (_db: Db, importId: number) => rpc<void>('undoImport', importId);

export const listBudgets = (_db: Db) => rpc<{ categoryKey: string; limitCents: number }[]>('listBudgets');
export const setBudget = (_db: Db, categoryKey: string, limitCents: number | null) => rpc<void>('setBudget', categoryKey, limitCents);
export const reportTransactions = (_db: Db, fromMonth: string, toMonth: string) =>
  rpc<{ date: string; amountCents: number; categoryKey: string | null }[]>('reportTransactions', fromMonth, toMonth);
export const latestMonth = (_db: Db) => rpc<string | null>('latestMonth');
export const exportCsv = (_db: Db) => rpc<string>('exportCsv');

export const previewSimilar = (_db: Db, txId: number) => rpc<SimilarPreview>('previewSimilar', txId);
export const previewRule = (_db: Db, pattern: string, direction: 'in' | 'out' | null) => rpc<RulePreview>('previewRule', pattern, direction);
export const classifyTransaction = (
  _db: Db,
  args: { txId: number; categoryKey: string; applySimilar: boolean; rule?: { pattern: string; direction: 'in' | 'out' | null } | null },
) => rpc<ClassifyResult>('classifyTransaction', args);
export const createRule = (_db: Db, pattern: string, categoryKey: string, direction: 'in' | 'out' | null) =>
  rpc<ClassifyResult>('createRule', pattern, categoryKey, direction);
export const resetClassification = (_db: Db, ids: number[]) => rpc<ClassifyResult>('resetClassification', ids);
export const listClassificationLog = (_db: Db) => rpc<ClassificationLogEntry[]>('listClassificationLog');
export const undoClassification = (_db: Db, logId: number) => rpc<number>('undoClassification', logId);
