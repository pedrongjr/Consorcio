import { describe, expect, it } from 'vitest';
import { Classifier, suggestRulePattern } from '../classifier';
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from '../categories';
import { budgetProgress, formatBRL, monthlySummary, totalsByCategory, type ReportCategory } from '../reports';

const c = new Classifier(DEFAULT_RULES);
const cat = (description: string, amountCents = -1000) => c.classify({ description, amountCents }).categoryKey;

describe('Classifier com regras padrão', () => {
  it.each([
    ['COMPRA CARTAO SUPERMERCADO EXTRA', 'alimentacao.supermercado'],
    ['IFOOD *RESTAURANTE DO ZE', 'alimentacao.delivery'],
    ['MERCADOLIVRE*VENDEDOR', 'compras.online'],
    ['MERCADO LIVRE', 'compras.online'],
    ['Mercadinho da Esquina', 'alimentacao.supermercado'],
    ['UBER *TRIP', 'transporte.app'],
    ['UBER EATS', 'alimentacao.delivery'],
    ['AUTO POSTO IPIRANGA', 'transporte.combustivel'],
    ['NETFLIX.COM', 'lazer.streaming'],
    ['Drogaria São Paulo', 'saude.farmacia'],
    ['PAG BOLETO ENEL SP', 'moradia.energia'],
    ['TARIFA PACOTE SERVICOS', 'taxas.bancarias'],
    ['IOF COMPRA INTERNACIONAL', 'taxas.juros'],
    ['SMART FIT', 'saude.academia'],
    ['PAGAMENTO DE FATURA', 'pagamento_fatura'],
    ['SAQUE BANCO24HORAS', 'saques'],
    ['PIX ENVIADO FULANO DE TAL', 'outros_gastos'],
  ])('%s → %s', (desc, expected) => {
    expect(cat(desc)).toBe(expected);
  });

  it('respeita a direção da regra', () => {
    expect(cat('CRED SALARIO EMPRESA X', 500000)).toBe('salario');
    expect(cat('TED RECEBIDA FULANO', 1000)).toBe('outras_receitas');
    expect(cat('ESTORNO IFOOD', 2000)).toBe('reembolsos');
  });

  it('não casa palavras curtas no meio de outras', () => {
    expect(cat('BETONEIRA LOCACAO')).toBe('outros_gastos');
  });
});

describe('Classifier com regras do usuário e histórico', () => {
  it('regra do usuário vence a padrão', () => {
    const k = new Classifier([...DEFAULT_RULES, { pattern: 'POSTO SHELL', categoryKey: 'transporte.veiculo', source: 'user' }]);
    expect(k.classify({ description: 'AUTO POSTO SHELL', amountCents: -100 }).categoryKey).toBe('transporte.veiculo');
  });
  it('aprende com lançamentos já categorizados', () => {
    const k = new Classifier(DEFAULT_RULES, [
      { descriptionKey: 'PIX ENVIADO JOAO DIARISTA', categoryKey: 'moradia.manutencao', direction: 'out' },
    ]);
    const r = k.classify({ description: 'PIX ENVIADO JOAO DIARISTA 12/03', amountCents: -15000 });
    expect(r).toMatchObject({ categoryKey: 'moradia.manutencao', confidence: 'history' });
  });
});

describe('suggestRulePattern', () => {
  it('remove prefixos genéricos', () => {
    expect(suggestRulePattern('COMPRA CARTAO DEB PADARIA BELA VISTA SAO PAULO BR')).toBe('PADARIA BELA VISTA');
    expect(suggestRulePattern('PIX ENVIADO Maria Silva')).toBe('MARIA SILVA');
  });
});

describe('Relatórios', () => {
  const cats = new Map<string, ReportCategory>(DEFAULT_CATEGORIES.map((d) => [d.key, { ...d, parent: d.parent ?? null }]));
  const txs = [
    { date: '2025-01-03', amountCents: -10000, categoryKey: 'alimentacao.supermercado' },
    { date: '2025-01-04', amountCents: -5000, categoryKey: 'alimentacao.delivery' },
    { date: '2025-01-05', amountCents: 1000, categoryKey: 'alimentacao.delivery' }, // estorno
    { date: '2025-01-06', amountCents: -20000, categoryKey: 'moradia.energia' },
    { date: '2025-01-07', amountCents: 500000, categoryKey: 'salario' },
    { date: '2025-01-08', amountCents: -100000, categoryKey: 'pagamento_fatura' },
    { date: '2025-02-01', amountCents: -3000, categoryKey: null },
  ];

  it('resume por mês sem contar transferências', () => {
    expect(monthlySummary(txs, cats)).toEqual([
      { month: '2025-01', incomeCents: 500000, expenseCents: 34000, balanceCents: 466000 },
      { month: '2025-02', incomeCents: 0, expenseCents: 3000, balanceCents: -3000 },
    ]);
  });

  it('agrupa por categoria e subcategoria', () => {
    const t = totalsByCategory(txs.filter((x) => x.date < '2025-02'), cats);
    expect(t.map((x) => [x.key, x.totalCents])).toEqual([['moradia', 20000], ['alimentacao', 14000]]);
    expect(t[1].children.map((x) => [x.key, x.totalCents])).toEqual([
      ['alimentacao.supermercado', 10000],
      ['alimentacao.delivery', 4000],
    ]);
  });

  it('calcula orçamento', () => {
    const p = budgetProgress([{ categoryKey: 'alimentacao', limitCents: 15000 }, { categoryKey: 'moradia', limitCents: 10000 }], txs, cats);
    expect(p.map((x) => x.status)).toEqual(['warning', 'over']);
  });

  it('formata reais', () => {
    expect(formatBRL(123456789)).toBe('R$ 1.234.567,89');
    expect(formatBRL(-5)).toBe('-R$ 0,05');
  });
});
