import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseAmount, parseDate, decodeText, descriptionKey } from '../text';
import { parseOfx } from '../parsers/ofx';
import { parseCsv } from '../parsers/csv';
import { parseQif } from '../parsers/qif';
import { parseSpreadsheet } from '../parsers/spreadsheet';
import { parsePdfText } from '../parsers/pdfText';
import { detectFormat, parseStatementFile, dedupeKeys, UnsupportedFormatError } from '../importer';

describe('parseAmount', () => {
  it.each([
    ['1.234,56', 123456],
    ['-1.234,56', -123456],
    ['1,234.56', 123456],
    ['R$ 10,00', 1000],
    ['(10,00)', -1000],
    ['10,00-', -1000],
    ['10,00 D', -1000],
    ['10,00 C', 1000],
    ['-50.00', -5000],
    ['1.500', 150000],
    ['0,5', 50],
    ['abc', null],
    ['', null],
  ])('%s → %s', (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });
  it('aceita números', () => expect(parseAmount(-12.345)).toBe(-1235));
});

describe('parseDate', () => {
  it.each([
    ['25/12/2024', '2024-12-25'],
    ['25/12/24', '2024-12-25'],
    ['2024-12-25', '2024-12-25'],
    ['20241225120000[-3:BRT]', '2024-12-25'],
    ['05 JAN', '2025-01-05'],
    ['05/03', '2025-03-05'],
    ['31/02/2024', null],
  ])('%s → %s', (raw, expected) => {
    expect(parseDate(raw, 2025)).toBe(expected);
  });
  it('converte serial do Excel', () => expect(parseDate(45651)).toBe('2024-12-25'));
});

describe('decodeText', () => {
  it('detecta Windows-1252', () => {
    expect(decodeText(new Uint8Array([0x50, 0x41, 0x47, 0x54, 0xba, 0x20, 0xc7, 0xc3, 0x4f]))).toBe('PAGTº ÇÃO');
  });
  it('mantém UTF-8', () => {
    expect(decodeText(strToU8('Padaria São João'))).toBe('Padaria São João');
  });
});

describe('descriptionKey', () => {
  it('remove datas, parcelas e códigos', () => {
    expect(descriptionKey('COMPRA CARTAO 12/03 NETFLIX.COM 123456789')).toBe('COMPRA CARTAO NETFLIX COM');
    expect(descriptionKey('Loja X - Parcela 2/10')).toBe('LOJA X');
  });
});

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20250131</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0341<BRANCHID>1234<ACCTID>56789-0<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20250101<DTEND>20250131
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250105100000[-03:EST]<TRNAMT>-152.37<FITID>2025010501<MEMO>SUPERMERCADO EXTRA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20250106<TRNAMT>5000.00<FITID>2025010601<NAME>SALARIO ACME<MEMO>SALARIO ACME</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250110<TRNAMT>-39,90<FITID>2025011001<NAME>NETFLIX &amp; CIA</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>4807.73<DTASOF>20250131</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('OFX', () => {
  it('lê OFX SGML de conta corrente', () => {
    const st = parseOfx(OFX_SGML);
    expect(st.transactions).toEqual([
      { date: '2025-01-05', description: 'SUPERMERCADO EXTRA', amountCents: -15237, externalId: '2025010501', memo: undefined },
      { date: '2025-01-06', description: 'SALARIO ACME', amountCents: 500000, externalId: '2025010601', memo: undefined },
      { date: '2025-01-10', description: 'NETFLIX & CIA', amountCents: -3990, externalId: '2025011001', memo: undefined },
    ]);
    expect(st.account).toMatchObject({ bankId: '0341', branchId: '1234', accountId: '56789-0', type: 'checking' });
    expect(st.balanceCents).toBe(480773);
  });

  it('lê OFX XML de cartão de crédito', () => {
    const xml = `<?xml version="1.0"?><?OFX OFXHEADER="200" VERSION="220"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>BRL</CURDEF><CCACCTFROM><ACCTID>1234</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20250203</DTPOSTED><TRNAMT>-25.00</TRNAMT><FITID>a1</FITID><MEMO>UBER *TRIP</MEMO></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    const st = parseOfx(xml);
    expect(st.account?.type).toBe('credit_card');
    expect(st.transactions[0]).toMatchObject({ date: '2025-02-03', amountCents: -2500, description: 'UBER *TRIP' });
  });
});

describe('CSV', () => {
  it('lê CSV do Nubank (conta)', () => {
    const csv = `Data,Valor,Identificador,Descrição
01/02/2025,-45.90,abc-1,Compra no débito - IFOOD
02/02/2025,1200.00,abc-2,Transferência recebida pelo Pix - FULANO
`;
    const st = parseCsv(csv);
    expect(st.transactions).toEqual([
      { date: '2025-02-01', description: 'Compra no débito - IFOOD', amountCents: -4590, externalId: 'abc-1' },
      { date: '2025-02-02', description: 'Transferência recebida pelo Pix - FULANO', amountCents: 120000, externalId: 'abc-2' },
    ]);
  });

  it('lê CSV com ; crédito/débito separados e ignora saldo', () => {
    const csv = `Extrato de conta corrente
Agência: 1234;Conta: 99999-9
Data;Histórico;Documento;Crédito (R$);Débito (R$);Saldo (R$)
02/01/2025;Saldo Anterior;;;;1.000,00
03/01/2025;PIX ENVIADO MARIA;123;;150,00;850,00
04/01/2025;"DEPOSITO; ONLINE";;2.500,00;;3.350,00
`;
    const st = parseCsv(csv);
    expect(st.transactions.map((t) => [t.date, t.description, t.amountCents])).toEqual([
      ['2025-01-03', 'PIX ENVIADO MARIA 123', -15000],
      ['2025-01-04', 'DEPOSITO; ONLINE', 250000],
    ]);
  });

  it('usa coluna de tipo D/C', () => {
    const csv = `Data;Lançamento;Valor;Tipo\n10/01/2025;TARIFA;12,50;D\n11/01/2025;ESTORNO;12,50;C\n`;
    expect(parseCsv(csv).transactions.map((t) => t.amountCents)).toEqual([-1250, 1250]);
  });

  it('infere colunas sem cabeçalho', () => {
    const csv = `05/01/2025;PADARIA PAO QUENTE;-12,00\n06/01/2025;POSTO SHELL;-200,00\n`;
    expect(parseCsv(csv).transactions.map((t) => t.description)).toEqual(['PADARIA PAO QUENTE', 'POSTO SHELL']);
  });
});

describe('QIF', () => {
  it('lê lançamentos', () => {
    const qif = `!Type:Bank\nD25/12/2024\nT-1,234.56\nPLOJA X\nMparcela 1\n^\nD26/12/2024\nT100.00\nPSALARIO\n^\n`;
    const st = parseQif(qif);
    expect(st.transactions).toEqual([
      { date: '2024-12-25', description: 'LOJA X', amountCents: -123456, memo: 'parcela 1' },
      { date: '2024-12-26', description: 'SALARIO', amountCents: 10000, memo: undefined },
    ]);
  });
});

function makeXlsx(): Uint8Array {
  const shared = ['Data', 'Descrição', 'Valor', 'MERCADO LIVRE', 'SALÁRIO'];
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/sharedStrings.xml': strToU8(
      `<sst>${shared.map((s) => `<si><t>${s.replace('&', '&amp;')}</t></si>`).join('')}</sst>`,
    ),
    'xl/styles.xml': strToU8('<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
<row r="2"><c r="A2" s="1"><v>45658</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>-89.9</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>05/01/2025</t></is></c><c r="B3" t="s"><v>4</v></c><c r="C3"><v>3500</v></c></row>
</sheetData></worksheet>`),
  });
}

function makeOds(): Uint8Array {
  return zipSync({
    // Como num ODS real, o mimetype vai primeiro e sem compressão.
    mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet'), { level: 0 }],
    'content.xml': strToU8(`<office:document-content><office:body><office:spreadsheet><table:table table:name="Extrato">
<table:table-row><table:table-cell office:value-type="string"><text:p>Data</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Histórico</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Valor</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell office:value-type="date" office:date-value="2025-03-10"><text:p>10/03/25</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>DROGASIL</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="-32.5"><text:p>-32,50</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1000"/></table:table-row>
</table:table></office:spreadsheet></office:body></office:document-content>`),
  });
}

describe('Planilhas', () => {
  it('lê XLSX com data serial e inline string', () => {
    const st = parseSpreadsheet(makeXlsx(), 'xlsx');
    expect(st.transactions).toEqual([
      { date: '2025-01-01', description: 'MERCADO LIVRE', amountCents: -8990, externalId: undefined },
      { date: '2025-01-05', description: 'SALÁRIO', amountCents: 350000, externalId: undefined },
    ]);
  });
  it('lê ODS', () => {
    const st = parseSpreadsheet(makeOds(), 'ods');
    expect(st.transactions).toEqual([{ date: '2025-03-10', description: 'DROGASIL', amountCents: -3250, externalId: undefined }]);
  });
  it('detecta ODS e XLSX pelo conteúdo', () => {
    expect(detectFormat('extrato', makeOds())).toBe('ods');
    expect(detectFormat('extrato.xlsx', makeXlsx())).toBe('xlsx');
  });
});

describe('PDF (texto extraído)', () => {
  it('lê extrato de conta e usa o saldo para o sinal', () => {
    const lines = [
      'Extrato de Conta Corrente - Janeiro de 2025',
      'Data Lançamento Valor Saldo',
      '02/01 SALDO ANTERIOR 1.000,00',
      '03/01 PIX TRANSF MARIA 03/01 150,00 850,00',
      '05/01 PIX RECEBIDO JOAO 300,00 1.150,00',
      'PAG BOLETO ENEL 120,00 1.030,00',
      '10/01 TARIFA PACOTE SERVICOS 35,00- 995,00',
      'Total de saídas 305,00',
    ];
    const st = parsePdfText(lines);
    expect(st.transactions.map((t) => [t.date, t.description, t.amountCents])).toEqual([
      ['2025-01-03', 'PIX TRANSF MARIA', -15000],
      ['2025-01-05', 'PIX RECEBIDO JOAO', 30000],
      ['2025-01-05', 'PAG BOLETO ENEL', -12000],
      ['2025-01-10', 'TARIFA PACOTE SERVICOS', -3500],
    ]);
  });

  it('lê fatura de cartão', () => {
    const lines = [
      'Fatura do Cartão de Crédito - Vencimento 10/02/2025',
      '15 JAN IFOOD *RESTAURANTE R$ 54,90',
      '16 JAN AMAZON PARCELA 2/5 R$ 120,00',
      '20 JAN PAGAMENTO RECEBIDO -R$ 1.500,00',
    ];
    const st = parsePdfText(lines);
    expect(st.account?.type).toBe('credit_card');
    expect(st.transactions.map((t) => [t.date, t.amountCents])).toEqual([
      ['2025-01-15', -5490],
      ['2025-01-16', -12000],
      ['2025-01-20', 150000],
    ]);
  });
});

describe('importer', () => {
  it('rejeita .xls binário com mensagem clara', () => {
    expect(() => detectFormat('a.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(UnsupportedFormatError);
  });

  it('inverte sinais de fatura em CSV', () => {
    const csv = 'date,title,amount\n2025-01-03,Uber *Trip,23.50\n2025-01-04,Netflix,39.90\n2025-01-10,Pagamento recebido,-500.00\n';
    const st = parseStatementFile({ fileName: 'nubank.csv', bytes: strToU8(csv), creditCard: true });
    expect(st.transactions.map((t) => t.amountCents)).toEqual([-2350, -3990, 50000]);
  });

  it('converte tabela HTML salva como .xls', () => {
    const html = '<html><table><tr><td>Data</td><td>Histórico</td><td>Valor</td></tr><tr><td>01/02/2025</td><td>PADARIA</td><td>-8,00</td></tr></table></html>';
    expect(parseStatementFile({ fileName: 'extrato.xls', bytes: strToU8(html) }).transactions).toHaveLength(1);
  });

  it('gera chaves de deduplicação estáveis e distintas para compras iguais', () => {
    const tx = { date: '2025-01-01', description: 'CAFE', amountCents: -500 };
    const keys = dedupeKeys([tx, tx, { ...tx, externalId: 'X' }]);
    expect(new Set(keys).size).toBe(3);
    expect(dedupeKeys([tx, tx])).toEqual(keys.slice(0, 2));
  });
});
