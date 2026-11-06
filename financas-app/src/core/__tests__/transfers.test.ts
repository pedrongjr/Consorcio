import { describe, expect, it } from 'vitest';
import { findTransferPairs, transferCategoryFor, transferLabel, type TransferCandidate } from '../transfers';

let n = 0;
const tx = (p: Partial<TransferCandidate>): TransferCandidate => ({
  id: ++n, account_id: 1, account_type: 'checking', date: '2026-10-20', amount_cents: -1000, description: 'PIX ENVIADO',
  memo: null, category_key: null, category_kind: null, category_source: 'none', ...p,
});

describe('findTransferPairs', () => {
  it('liga saída e entrada de mesmo valor entre contas diferentes', () => {
    const a = tx({ account_id: 1, amount_cents: -460000, description: 'DEB PIX CHAVE FULANO' });
    const b = tx({ account_id: 2, amount_cents: 460000, date: '2026-10-21', description: 'TRANSFERENCIA RECEBIDA' });
    expect(findTransferPairs([a, b])).toEqual([{ outId: a.id, inId: b.id, categoryKey: 'transferencias' }]);
  });

  it('não liga na mesma conta, longe no tempo, sem cara de transferência ou com ambiguidade', () => {
    const out = tx({ account_id: 1, amount_cents: -5000, description: 'PIX ENVIADO' });
    expect(findTransferPairs([out, tx({ account_id: 1, amount_cents: 5000 })])).toEqual([]);
    expect(findTransferPairs([out, tx({ account_id: 2, amount_cents: 5000, date: '2026-11-20' })])).toEqual([]);
    expect(findTransferPairs([
      tx({ account_id: 1, amount_cents: -5000, description: 'MERCADO' }), tx({ account_id: 2, amount_cents: 5000, description: 'VENDA OLX' }),
    ])).toEqual([]);
    expect(findTransferPairs([out, tx({ account_id: 2, amount_cents: 5000 }), tx({ account_id: 3, amount_cents: 5000 })])).toEqual([]);
  });

  it('respeita categoria de gasto escolhida à mão e usa pagamento de fatura com cartão', () => {
    const manual = tx({ account_id: 1, amount_cents: -7000, category_key: 'lazer', category_kind: 'expense', category_source: 'user' });
    expect(findTransferPairs([manual, tx({ account_id: 2, amount_cents: 7000 })])).toEqual([]);
    const pay = tx({ account_id: 1, amount_cents: -90000, description: 'PAGTO FATURA' });
    const card = tx({ account_id: 3, account_type: 'credit_card', amount_cents: 90000, description: 'PAGAMENTO RECEBIDO' });
    expect(findTransferPairs([pay, card])[0].categoryKey).toBe('pagamento_fatura');
  });

  it('categorias e rótulos', () => {
    expect(transferCategoryFor('checking', 'investment')).toBe('investimentos');
    expect(transferCategoryFor('checking', 'checking', ['investimentos'])).toBe('investimentos');
    expect(transferLabel(-100, 'Caixa', 'Nubank')).toBe('Caixa → Nubank');
    expect(transferLabel(100, 'Caixa', 'Nubank')).toBe('Nubank → Caixa');
  });
});
