import { describe, expect, it } from 'vitest';
import { groupTextItems } from '../pdfLayout';
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
