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

describe('OCR de extrato da Caixa (mais novo primeiro, valores com C/D)', () => {
  it('mantém valor e saldo na mesma linha mesmo com a vírgula descendo', () => {
    // O Tesseract devolve "6,00" com a caixa mais baixa que a do "D" ao lado.
    expect(groupTextItems([
      { str: 'APOSTA', x: 200, y: 1000, width: 80, height: 22 },
      { str: '6,00', x: 700, y: 994, width: 50, height: 28 },
      { str: 'D', x: 755, y: 1000, width: 12, height: 22 },
      { str: '21,59', x: 830, y: 994, width: 60, height: 28 },
      { str: 'C', x: 895, y: 1000, width: 12, height: 22 },
      { str: 'SALDO', x: 200, y: 950, width: 80, height: 22 },
    ])).toEqual(['APOSTA 6,00 D 21,59 C', 'SALDO']);
  });

  // Linhas como o Tesseract leu o extrato (nomes trocados).
  const lines = [
    'CAIXA FO',
    'Extrato por período',
    'Cliente FULANO DE TAL',
    'Data 02/11/2026- 23:00',
    'Período dos lançamentos 01/10/2026 até 31/10/2026',
    'SALDO ANTERIOR R$19,68 C',
    'Lançamentos Nr. Doc Histórico/Complemento Favorecido CPF/CNPJ Valor Saldo',
    '22/10/2026 - 00:00:00 000000 SALDO DIA 0,00 C 9,59 C',
    '22/10/2026 - 11:11:50 221117 APOSTA LOTERIA INTERNET 1200 D 9,59C',
    '22/10/2026 - 07:37:31 220737 APOSTA LOTERIA INTERNET 6,00 D 21,59 C',
    '22/10/2026 - 07:83:18 220733 APOSTA LOTERIA INTERNET 12,00 D 27,59 C',
    '20/10/2026 - 00:00:00 000000 SALDO DIA 0,00 C 39,59 C',
    '20/10/2026 - 09:12:27 200912 DEB PIX CHAVE Fulano De Tal 616.9B1+* 4.600,00 D 39,59 C',
    '20/10/2026 - 06:59:40 000033 RECEBIMENTO TED SALARIO Fulano De Tal 616.9B1*+ 4.565,80 C 4.639,59 C',
    '08/10/2026 - 00:00:00 000000 SALDO DIA 0,00 C 74,29C',
    '08/10/2026 - 03:57:11 000000 DEBITO PRESTACAO HAB 4.015,84 D 7429C',
    '06/10/2026- 00:00:00 000000 SALDO DIA 0,00 C 4090,/13C',
    '06/10/2026- 07:55:10 060755 DEB PIX CHAVE Fulano De Tal **r 616.981 3.000,00 D 4.090,13',
    '06/10/2026 - 07:25:49 000033 RECEBIMENTO TED SALARIO Fulano De Tal +14 616.981 7.07045C 7.090,13C',
    'Alô CAIXA: 4004 0104 (Capitais e Regiões Metropolitanas)',
  ];

  it('lê o valor (não o saldo), com sinal certo e erros corrigidos pelo saldo', () => {
    const st = parsePdfText(cleanOcrLines(lines), { ocr: true });
    expect(st.transactions.map((t) => [t.date, t.description, t.amountCents])).toEqual([
      ['2026-10-22', 'APOSTA LOTERIA INTERNET', -1200],
      ['2026-10-22', 'APOSTA LOTERIA INTERNET', -600],
      ['2026-10-22', 'APOSTA LOTERIA INTERNET', -1200],
      ['2026-10-20', 'DEB PIX CHAVE Fulano De Tal', -460000],
      // OCR leu 4.565,80; a variação do saldo mostra 4.565,30.
      ['2026-10-20', 'RECEBIMENTO TED SALARIO Fulano De Tal', 456530],
      ['2026-10-08', 'DEBITO PRESTACAO HAB', -401584],
      ['2026-10-06', 'DEB PIX CHAVE Fulano De Tal', -300000],
      ['2026-10-06', 'RECEBIMENTO TED SALARIO Fulano De Tal', 707045],
    ]);
    expect(st.warnings.join(' ')).toContain('corrigidos pela diferença de saldo');
  });
});
