import { describe, expect, it } from 'vitest';
import { cleanOcrLine, cleanOcrLines, groupTextItems } from '../pdfLayout';
import { parsePdfText } from '../parsers/pdfText';

describe('groupTextItems', () => {
  it('monta linhas por altura e ordena da esquerda para a direita', () => {
    const items = [
      { str: '150,00', x: 400, y: 700.4, width: 30, height: 9 },
      { str: '03/01', x: 40, y: 700, width: 25, height: 9 },
      { str: 'PIX ENVIADO', x: 80, y: 700.2, width: 60, height: 9 },
      { str: 'Extrato', x: 40, y: 760, width: 40, height: 12 },
      { str: '', x: 0, y: 0, width: 0, height: 0 },
    ];
    expect(groupTextItems(items)).toEqual(['Extrato', '03/01 PIX ENVIADO 150,00']);
  });

  it('não insere espaço entre trechos colados', () => {
    expect(groupTextItems([
      { str: 'SUPER', x: 10, y: 10, width: 25, height: 9 },
      { str: 'MERCADO', x: 35, y: 10, width: 40, height: 9 },
    ])).toEqual(['SUPERMERCADO']);
  });

  it('funciona de ponta a ponta com o leitor de PDF', () => {
    const lines = groupTextItems([
      { str: 'Janeiro de 2025', x: 10, y: 800, width: 80, height: 10 },
      { str: '07/01', x: 10, y: 700, width: 25, height: 9 },
      { str: 'DROGASIL 1234', x: 50, y: 700, width: 70, height: 9 },
      { str: '-45,90', x: 300, y: 700, width: 30, height: 9 },
    ]);
    expect(parsePdfText(lines).transactions).toEqual([{ date: '2025-01-07', description: 'DROGASIL 1234', amountCents: -4590 }]);
  });
});

describe('cleanOcrLine', () => {
  it.each([
    ['O5/O1 SUPERMERCADO EXTRA 1.234,5O', '05/01 SUPERMERCADO EXTRA 1.234,50'],
    ['10/01 PADARIA SOL RS 12,9O', '10/01 PADARIA SOL R$ 12,90'],
    ['12/01 ALUGUEL 1 500,00', '12/01 ALUGUEL 1500,00'],
    ['15/01 FARMACIA 45, 90-', '15/01 FARMACIA 45,90-'],
    ['20/01 SOLAR ILUMINACAO 30,00', '20/01 SOLAR ILUMINACAO 30,00'],
    ['TOTAL DO DIA 2O24', 'TOTAL DO DIA 2O24'],
  ])('%s → %s', (raw, expected) => {
    expect(cleanOcrLine(raw)).toBe(expected);
  });

  it('linhas corrigidas viram lançamentos', () => {
    const st = parsePdfText(cleanOcrLines(['Extrato Janeiro de 2025', 'O7/O1 DROGASIL -45,9O']));
    expect(st.transactions).toEqual([{ date: '2025-01-07', description: 'DROGASIL', amountCents: -4590 }]);
  });
});

describe('OCR real (Tesseract) de um extrato escaneado', () => {
  // Linhas exatamente como o Tesseract leu um extrato renderizado como imagem
  // (ver README: teste de ponta a ponta no Chromium).
  const ocrLines = [
    'Banco Exemplo S.A. - Extrato de Conta Corrente',
    'Período: Janeiro de 2025 Agência 1234 Conta 56789-0',
    'Data Histórico Valor (R$) Saldo (R$)',
    '02/01 SALDO ANTERIOR 2.000,00',
    '03/01 COMPRA CARTAO SUPERMERCADO EXTRA -245,37 1.754,63',
    '05/01 PIX RECEBIDO JOAO SILVA 1.500,00 — 3.254,63',
    '08/01 PAG BOLETO ENEL SP -189,90 — 3.064,73',
    '10/01 TARIFA PACOTE SERVICOS -35,00 3.029,73',
    '15/01 UBER *TRIP -27,80 — 3.001,93',
  ];

  it('vira lançamentos com datas, valores e sinais corretos', () => {
    const st = parsePdfText(cleanOcrLines(ocrLines), { ocr: true });
    expect(st.transactions.map((t) => [t.date, t.description, t.amountCents])).toEqual([
      ['2025-01-03', 'COMPRA CARTAO SUPERMERCADO EXTRA', -24537],
      ['2025-01-05', 'PIX RECEBIDO JOAO SILVA', 150000],
      ['2025-01-08', 'PAG BOLETO ENEL SP', -18990],
      ['2025-01-10', 'TARIFA PACOTE SERVICOS', -3500],
      ['2025-01-15', 'UBER *TRIP', -2780],
    ]);
    expect(st.warnings.join(' ')).toContain('OCR');
  });

  it('remove bordas de tabela', () => {
    expect(cleanOcrLine('08/01 PAG BOLETO -189,90 — 3.064,73 |')).toBe('08/01 PAG BOLETO -189,90 3.064,73');
  });
});

describe('OCR de foto torta e desfocada', () => {
  it('corrige menos lido como aspas e vírgula perdida', () => {
    expect(cleanOcrLine('10/01 TARIFA PACOTE SERVICOS “35,00 3.029,73')).toBe('10/01 TARIFA PACOTE SERVICOS -35,00 3.029,73');
    expect(cleanOcrLine('15/01 UBER *TRIP -2780 3.001,93')).toBe('15/01 UBER *TRIP -27,80 3.001,93');
    expect(cleanOcrLine('07/01 DROGASIL 1234 -45,90')).toBe('07/01 DROGASIL 1234 -45,90');
  });

  it('calcula o valor pelo saldo quando o OCR perdeu o valor', () => {
    const lines = [
      'Extrato Janeiro de 2025',
      '02/01 SALDO ANTERIOR 2.000,00',
      '03/01 SUPERMERCADO -245,37 1.754,63',
      '05/01 PIX RECEBIDO JOAO 1.500,00 3.254,63',
      '10/01 TARIFA PACOTE SERVICOS 3.219,63',
      '15/01 UBER -27,80 3.191,83',
    ];
    const st = parsePdfText(lines, { ocr: true });
    expect(st.transactions.map((t) => t.amountCents)).toEqual([-24537, 150000, -3500, -2780]);
    expect(st.warnings.join(' ')).toMatch(/diferença de saldo/);
    // Sem OCR (PDF com texto), uma linha com um valor só continua sendo o valor.
    expect(parsePdfText(lines).transactions[2].amountCents).toBe(-321963);
  });
});

it('foto torta e desfocada (linhas reais do Tesseract após endireitar) vira lançamentos corretos', () => {
  const lines = [
    'Banco Exemplo S.A. - Extrato de Conta Corrente',
    'Período: Janeiro de 2025 Agência 1234 Conta 56789-0',
    'Data Histórico Valor (RS) Saldo (RS)',
    '02/01 SALDO ANTERIOR 2.000,00',
    '03/01 COMPRA CARTAO SUPERMERCADO EXTRA -245,37 1.754,63',
    '05/01 PIX RECEBIDO JOAO SILVA 1.500,00 3.254,63',
    '08/01 PAG BOLETO ENEL SP -189,90 3.064,73',
    '10/01 TARIFA PACOTE SERVICOS 35,00 3.029,73',
    '15/01 UBER *TRIP -2780 3.001,93',
  ];
  const st = parsePdfText(cleanOcrLines(lines), { ocr: true });
  expect(st.transactions.map((t) => t.amountCents)).toEqual([-24537, 150000, -18990, -3500, -2780]);
});
