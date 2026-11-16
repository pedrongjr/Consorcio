import { describe, expect, it } from 'vitest';
import { groupTextItems } from '../pdfLayout';
import { parsePdfText } from '../parsers/pdfText';

/**
 * Layouts de extrato e fatura em PDF dos principais bancos brasileiros, como o
 * texto chega depois de agrupado em linhas (nomes e números fictícios). Cada
 * caso confere data, descrição e valor com sinal.
 */
const rowsOf = (lines: string[], card?: boolean) =>
  parsePdfText(lines, card === undefined ? {} : { creditCard: card }).transactions.map((t) => [t.date, t.description, t.amountCents]);

describe('extratos de conta', () => {
  it('Nubank: data como cabeçalho, seções Entradas/Saídas, descrição em várias linhas', () => {
    const lines = [
      'Extrato de conta',
      'FULANO DE TAL',
      'CPF •••.123.456-••',
      '01 de outubro de 2024 a 31 de outubro de 2024',
      'Saldo inicial R$ 1.000,00',
      'Rendimento líquido + R$ 0,35',
      'Saldo final do período R$ 1.240,10',
      'Movimentações',
      '01 OUT 2024 Total de entradas + 2.000,00',
      'Transferência recebida pelo Pix 2.000,00',
      'FULANO DE TAL - •••.123.456-•• - BCO DO BRASIL S.A. (0001)',
      'Agência: 1234 Conta: 56789-0',
      'Total de saídas - 759,90',
      'Compra no débito SUPERMERCADO BOM PRECO 159,90',
      'Transferência enviada pelo Pix 600,00',
      'MARIA SOUZA - •••.987.654-•• - ITAÚ UNIBANCO S.A. (0341)',
      '02 OUT 2024 Total de saídas - 1.000,00',
      'Pagamento de fatura 1.000,00',
    ];
    const st = parsePdfText(lines);
    expect(st.transactions.map((t) => [t.date, t.description, t.amountCents])).toEqual([
      ['2024-10-01', 'Transferência recebida pelo Pix', 200000],
      ['2024-10-01', 'Compra no débito SUPERMERCADO BOM PRECO', -15990],
      ['2024-10-01', 'Transferência enviada pelo Pix', -60000],
      ['2024-10-02', 'Pagamento de fatura', -100000],
    ]);
    // O nome de quem enviou/recebeu e o CPF mascarado vão para o complemento.
    expect(st.transactions[0].memo).toContain('FULANO DE TAL');
    expect(st.transactions[0].memo).toContain('***123456**');
    expect(st.transactions[2].memo).toContain('MARIA SOUZA');
    expect(st.account?.type).toBeUndefined(); // "Pagamento de fatura" não faz do extrato uma fatura
    // Saldo inicial + lançamentos = saldo final (1.000 + 2.000 − 759,90 − 1.000 = 1.240,10): sem aviso.
    expect(st.warnings.join(' ')).not.toMatch(/diferença/);
  });

  it('Itaú: data em toda linha, sinal negativo, saldo do dia', () => {
    expect(rowsOf([
      'extrato conta corrente',
      'data lançamentos valor (R$) saldo (R$)',
      '30/09/2024 SALDO ANTERIOR 1.000,00',
      '01/10/2024 PIX TRANSF FULANO01/10 -150,00',
      '01/10/2024 SALDO DO DIA 850,00',
      '02/10/2024 PAG BOLETO ENEL -200,00',
      '02/10/2024 TED 341.1234.MARIA S 2.000,00',
      '02/10/2024 SALDO DO DIA 2.650,00',
    ])).toEqual([
      ['2024-10-01', 'PIX TRANSF FULANO01/10', -15000],
      ['2024-10-02', 'PAG BOLETO ENEL', -20000],
      ['2024-10-02', 'TED 341.1234.MARIA S', 200000],
    ]);
  });

  it('Bradesco: data só no 1º lançamento do dia, histórico acima de "REM:", sinal pelo saldo', () => {
    const st = parsePdfText([
      'Extrato Mensal / Por Período',
      'Data Histórico Docto. Crédito (R$) Débito (R$) Saldo (R$)',
      '30/09/2024 SALDO ANTERIOR 1.000,00',
      '01/10/2024 TRANSFERENCIA PIX',
      'REM: FULANO DE TAL 01/10 1234567 150,00 850,00',
      'PAGTO ELETRON COBRANCA 7654321 200,00 650,00',
      'ENEL DISTRIBUICAO',
      '02/10/2024 PIX RECEBIDO 112233 2.000,00 2.650,00',
      'DES: MARIA SOUZA',
    ]);
    expect(st.transactions.map((t) => [t.date, t.description, t.amountCents])).toEqual([
      ['2024-10-01', 'TRANSFERENCIA PIX', -15000],
      ['2024-10-01', 'PAGTO ELETRON COBRANCA', -20000],
      ['2024-10-02', 'PIX RECEBIDO', 200000],
    ]);
    expect(st.transactions[0].memo).toContain('FULANO DE TAL');
    expect(st.transactions[1].memo).toContain('ENEL');
    expect(st.transactions[2].memo).toContain('MARIA SOUZA');
  });

  it('Bradesco/Itaú sem coluna de saldo: sinal pela coluna Crédito/Débito (posição na página)', () => {
    const it = (str: string, x: number, y: number, width = 40) => ({ str, x, y, width, height: 9 });
    const lines = groupTextItems([
      it('Data', 30, 700), it('Histórico', 90, 700), it('Crédito (R$)', 380, 700, 60), it('Débito (R$)', 460, 700, 60),
      it('01/10/2024', 30, 680), it('PIX RECEBIDO FULANO', 90, 680, 120), it('2.000,00', 400, 680),
      it('02/10/2024', 30, 660), it('CONTA DE LUZ ENEL', 90, 660, 120), it('200,00', 480, 660),
    ]);
    expect(rowsOf(lines)).toEqual([
      ['2024-10-01', 'PIX RECEBIDO FULANO', 200000],
      ['2024-10-02', 'CONTA DE LUZ ENEL', -20000],
    ]);
  });

  it('Banco do Brasil: lote/documento antes do histórico, (-)/(+) e detalhe na linha de baixo', () => {
    const st = parsePdfText([
      'Extrato de conta corrente',
      'Dia Lote Documento Histórico Valor',
      '30/09/2024 Saldo Anterior 1.000,00 (+)',
      '01/10/2024 13105 99015 Pix - Enviado 150,00 (-)',
      '01/10 10:30 Fulano de Tal',
      '01/10/2024 14175 2001 Pagamento de Boleto 200,00 (-)',
      'ENEL DISTRIBUICAO SAO PAULO',
      '02/10/2024 13105 99016 Pix - Recebido 2.000,00 (+)',
      '02/10 09:12 00012345678 Maria Souza',
      'S A L D O 2.650,00 (+)',
    ]);
    expect(st.transactions.map((t) => [t.date, t.description, t.amountCents])).toEqual([
      ['2024-10-01', 'Pix - Enviado', -15000],
      ['2024-10-01', 'Pagamento de Boleto', -20000],
      ['2024-10-02', 'Pix - Recebido', 200000],
    ]);
    expect(st.transactions[0].memo).toContain('Fulano de Tal');
    expect(st.transactions[2].memo).toContain('Maria Souza');
  });

  it('Santander: sinal depois do valor', () => {
    expect(rowsOf([
      'Data Descrição Nº Documento Movimentos (R$) Saldo (R$)',
      '01/10/2024 PIX ENVIADO FULANO 000000 150,00- 850,00',
      '02/10/2024 PIX RECEBIDO MARIA 000000 2.000,00 2.850,00',
      '03/10/2024 TARIFA MENSALIDADE PACOTE 000000 35,00- 2.815,00',
    ])).toEqual([
      ['2024-10-01', 'PIX ENVIADO FULANO', -15000],
      ['2024-10-02', 'PIX RECEBIDO MARIA', 200000],
      ['2024-10-03', 'TARIFA MENSALIDADE PACOTE', -3500],
    ]);
  });

  it('Inter: data por extenso como cabeçalho, "-R$"', () => {
    expect(rowsOf([
      'Extrato',
      'Período: 01/10/2024 a 31/10/2024',
      'Saldo total R$ 2.650,00',
      '1 de Outubro de 2024 Saldo do dia: R$ 850,00',
      'Pix enviado: "Cp :18236120-FULANO DE TAL" -R$ 150,00 R$ 850,00',
      '2 de Outubro de 2024 Saldo do dia: R$ 2.650,00',
      'Pix recebido: "Cp :00000000-MARIA" R$ 2.000,00 R$ 2.850,00',
      'Pagamento efetuado: "Pagamento de titulo ENEL" -R$ 200,00 R$ 2.650,00',
    ])).toEqual([
      ['2024-10-01', 'Pix enviado: "Cp :18236120-FULANO DE TAL"', -15000],
      ['2024-10-02', 'Pix recebido: "Cp :00000000-MARIA"', 200000],
      ['2024-10-02', 'Pagamento efetuado: "Pagamento de titulo ENEL"', -20000],
    ]);
  });

  it('C6 Bank: data do lançamento e contábil, ano no período', () => {
    expect(rowsOf([
      'Extrato C6 Bank — Período 01/10/2024 a 31/10/2024',
      'Data lançamento Data contábil Título Descrição Entradas/Saídas (R$)',
      '01/10 01/10 Pix enviado para FULANO DE TAL -150,00',
      '01/10 01/10 Compra no débito SUPERMERCADO -59,90',
      '02/10 02/10 Pix recebido de MARIA 2.000,00',
    ])).toEqual([
      ['2024-10-01', 'Pix enviado para FULANO DE TAL', -15000],
      ['2024-10-01', 'Compra no débito SUPERMERCADO', -5990],
      ['2024-10-02', 'Pix recebido de MARIA', 200000],
    ]);
  });

  it('Mercado Pago: data com hífen e "R$ -150,00"', () => {
    expect(rowsOf([
      'EXTRATO DE CONTA',
      'Período: 01-10-2024 a 31-10-2024',
      'Data Descrição ID da operação Valor Saldo',
      '01-10-2024 Transferência Pix enviada FULANO DE TAL 89123456789 R$ -150,00 R$ 850,00',
      '02-10-2024 Rendimentos 89123456790 R$ 0,35 R$ 850,35',
      '02-10-2024 Transferência Pix recebida MARIA 89123456791 R$ 2.000,00 R$ 2.850,35',
    ])).toEqual([
      ['2024-10-01', 'Transferência Pix enviada FULANO DE TAL', -15000],
      ['2024-10-02', 'Rendimentos', 35],
      ['2024-10-02', 'Transferência Pix recebida MARIA', 200000],
    ]);
  });

  it('PicPay / PagBank: hora depois da data, "- R$" com espaço', () => {
    expect(rowsOf([
      'Data/Hora Descrição Valor Saldo',
      '01/10/2024 10:30 Pix enviado para FULANO - R$ 150,00 R$ 850,00',
      '02/10/2024 09:00 Pix recebido de MARIA + R$ 2.000,00 R$ 2.850,00',
      '03/10/2024 PIX ENVIADO JOAO -R$ 50,00',
    ])).toEqual([
      ['2024-10-01', 'Pix enviado para FULANO', -15000],
      ['2024-10-02', 'Pix recebido de MARIA', 200000],
      ['2024-10-03', 'PIX ENVIADO JOAO', -5000],
    ]);
  });

  it('Sicoob: D/C colado e detalhe em linhas de baixo', () => {
    const st = parsePdfText([
      'SICOOB - Extrato Conta Corrente - Outubro/2024',
      'DATA HISTÓRICO VALOR',
      '01/10 PIX EMIT.OUTRA IF 150,00D',
      'Pagamento Pix',
      'FULANO DE TAL',
      '02/10 CRÉD.TED-STR 2.000,00C',
      'SALDO DO DIA 2.850,00C',
    ]);
    expect(st.transactions.map((t) => [t.date, t.description, t.amountCents])).toEqual([
      ['2024-10-01', 'PIX EMIT.OUTRA IF', -15000],
      ['2024-10-02', 'CRÉD.TED-STR', 200000],
    ]);
    expect(st.transactions[0].memo).toContain('FULANO DE TAL');
  });

  it('Sicredi: código do lançamento e documento', () => {
    expect(rowsOf([
      'Data Descrição Documento Valor (R$) Saldo (R$)',
      '01/10/2024 PIX_DEB 12345678900 FULANO -150,00 850,00',
      '02/10/2024 PIX_CRED 98765432100 MARIA 2.000,00 2.850,00',
    ])).toEqual([
      ['2024-10-01', 'PIX_DEB 12345678900 FULANO', -15000],
      ['2024-10-02', 'PIX_CRED 98765432100 MARIA', 200000],
    ]);
  });
});

describe('faturas de cartão', () => {
  it('Nubank: mês abreviado, pagamento e estorno com "−R$"', () => {
    expect(rowsOf([
      'FATURA DE OUTUBRO 2024',
      'Data de vencimento 10 NOV 2024 Total da fatura R$ 173,90',
      'TRANSAÇÕES DE 03 OUT A 02 NOV',
      '03 OUT Mercadolivre*Loja 2/3 R$ 150,00',
      '05 OUT Uber *Trip R$ 23,90',
      '10 OUT Pagamento em 10 OUT −R$ 1.200,00',
      '12 OUT Estorno de "Netflix" −R$ 39,90',
    ])).toEqual([
      ['2024-10-03', 'Mercadolivre*Loja 2/3', -15000],
      ['2024-10-05', 'Uber *Trip', -2390],
      ['2024-10-10', 'Pagamento em 10 OUT', 120000],
      ['2024-10-12', 'Estorno de "Netflix"', 3990],
    ]);
  });

  it('Itaú: seções de compras e pagamentos, virada de ano', () => {
    expect(rowsOf([
      'Resumo da fatura - Vencimento 10/01/2025',
      'Lançamentos: compras e saques',
      'DATA ESTABELECIMENTO VALOR EM R$',
      '20/12 MERCADOLIVRE*LOJA 150,00',
      '05/01 UBER* TRIP 23,90',
      'Pagamentos efetuados',
      '02/01 PAGAMENTO EFETUADO -1.200,00',
    ])).toEqual([
      ['2024-12-20', 'MERCADOLIVRE*LOJA', -15000],
      ['2025-01-05', 'UBER* TRIP', -2390],
      ['2025-01-02', 'PAGAMENTO EFETUADO', 120000],
    ]);
  });
});

describe('PDF real gerado e lido pelo pdf.js (posições de verdade)', () => {
  it('Bradesco com colunas Crédito/Débito/Saldo encostadas', async () => {
    const { readFileSync } = await import('node:fs');
    const pages = JSON.parse(readFileSync(new URL('./fixtures/bradesco-pdfjs.json', import.meta.url), 'utf8'));
    const st = parsePdfText(pages.flatMap(groupTextItems));
    expect(st.transactions.map((t) => [t.date, t.description, t.amountCents])).toEqual([
      ['2024-10-01', 'TRANSFERENCIA PIX', -15000],
      ['2024-10-01', 'PAGTO ELETRON COBRANCA', -20000],
      ['2024-10-02', 'PIX RECEBIDO', 200000],
      ['2024-10-02', 'TARIFA BANCARIA', -3500],
    ]);
    expect(st.transactions[0].memo).toContain('FULANO DE TAL');
  });

  it('layout desconhecido com a data no meio da linha', () => {
    expect(rowsOf([
      'Movimentação',
      'PIX ENVIADO FULANO 01/10/2024 -150,00',
      'PIX RECEBIDO MARIA 02/10/2024 2.000,00',
    ])).toEqual([
      ['2024-10-01', 'PIX ENVIADO FULANO', -15000],
      ['2024-10-02', 'PIX RECEBIDO MARIA', 200000],
    ]);
  });
});
