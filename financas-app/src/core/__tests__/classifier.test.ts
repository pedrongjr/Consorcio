import { describe, expect, it } from 'vitest';
import { Classifier, isGenericText, similarityKey, suggestRulePattern } from '../classifier';
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
      { key: 'PIX ENVIADO JOAO DIARISTA', categoryKey: 'moradia.manutencao', direction: 'out' },
    ]);
    const r = k.classify({ description: 'PIX ENVIADO JOAO DIARISTA 12/03', amountCents: -15000 });
    expect(r).toMatchObject({ categoryKey: 'moradia.manutencao', confidence: 'history' });
  });
  it('não aprende com descrições genéricas (só "PIX ENVIADO")', () => {
    const k = new Classifier(DEFAULT_RULES, [
      { key: similarityKey('PIX ENVIADO', null), categoryKey: 'saude.fono', direction: 'out' },
      { key: similarityKey('PIX ENVIADO', 'NUCLEO CAMALEAO LTDA'), categoryKey: 'saude.fono', direction: 'out' },
    ]);
    expect(k.classify({ description: 'PIX ENVIADO', amountCents: -100 }).confidence).not.toBe('history');
    expect(k.classify({ description: 'PIX ENVIADO', memo: 'JOAO DA SILVA', amountCents: -100 }).confidence).not.toBe('history');
    expect(k.classify({ description: 'PIX ENVIADO', memo: 'NUCLEO CAMALEAO LTDA', amountCents: -100 }))
      .toMatchObject({ categoryKey: 'saude.fono', confidence: 'history' });
  });
});

describe('descrições genéricas', () => {
  it('reconhece textos que só dizem o meio de pagamento', () => {
    for (const t of ['PIX ENVIADO', 'Pix enviado 01/10 17:39', 'PIX RECEBIDO', 'TED', 'COMPRA CARTAO DEBITO', 'Transferência enviada pelo Pix', 'PAGAMENTO DE BOLETO', '']) {
      expect(isGenericText(t)).toBe(true);
    }
    for (const t of ['PIX ENVIADO NUCLEO CAMALEAO', 'NUCLEO', 'TARIFA', 'IFOOD']) expect(isGenericText(t)).toBe(false);
  });
  it('similarityKey usa o complemento quando a descrição é genérica', () => {
    expect(similarityKey('PIX ENVIADO 01/10 17:39', null)).toBe('');
    expect(similarityKey('PIX ENVIADO', 'NUCLEO CAMALEAO')).toBe('PIX ENVIADO NUCLEO CAMALEAO');
    expect(similarityKey('PIX ENVIADO NUCLEO CAMALEAO 01/10', 'qualquer')).toBe('PIX ENVIADO NUCLEO CAMALEAO');
  });
});

describe('suggestRulePattern', () => {
  it('remove prefixos genéricos', () => {
    expect(suggestRulePattern('COMPRA CARTAO DEB PADARIA BELA VISTA SAO PAULO BR')).toBe('PADARIA BELA VISTA');
    expect(suggestRulePattern('PIX ENVIADO Maria Silva')).toBe('MARIA SILVA');
    expect(suggestRulePattern('PIX ENVIADO 01/10 17:39 NUCLEO CAMALEAO FONOAUDIOLOGIA LTDA')).toBe('NUCLEO CAMALEAO FONOAUDIOLOGIA');
    expect(suggestRulePattern('Transferência enviada pelo Pix - Núcleo Camaleão')).toBe('NUCLEO CAMALEAO');
  });
  it('usa o complemento ou não sugere nada quando a descrição é genérica', () => {
    expect(suggestRulePattern('PIX ENVIADO', 'NUCLEO CAMALEAO')).toBe('NUCLEO CAMALEAO');
    expect(suggestRulePattern('PIX ENVIADO')).toBe('');
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

describe('extrato da Caixa: apostas e prestação habitacional', () => {
  it('classifica aposta como jogos e prestação como moradia', async () => {
    const { Classifier } = await import('../classifier');
    const { DEFAULT_RULES } = await import('../categories');
    const c = new Classifier(DEFAULT_RULES);
    expect(c.classify({ description: 'APOSTA LOTERIA INTERNET', amountCents: -1200 }).categoryKey).toBe('lazer.jogos');
    expect(c.classify({ description: 'DEBITO PRESTACAO HAB', amountCents: -401584 }).categoryKey).toBe('moradia');
    expect(c.classify({ description: 'VIVO FIBRA INTERNET', amountCents: -9990 }).categoryKey).toBe('moradia.internet');
  });
});
