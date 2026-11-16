import { describe, expect, it } from 'vitest';
import { Classifier } from '../classifier';
import { cleanNames, cpfMiddleDigits, isSelfTransfer, mentionsCpf, mentionsName } from '../holder';
import { extractDocument, extractHolderName } from '../parsers/pdfText';

const holder = { names: ['PEDRO NUNES DA GLORIA JUNIOR'], cpfMiddle: '616981' };

describe('titular: nome e CPF', () => {
  it.each([
    ['DEB PIX CHAVE Pedro Nunes Da Gló', true],
    ['PIX ENVIADO PEDRO N DA GLORIA', true], // "N" é curto demais, mas GLORIA confirma
    ['TRANSFERENCIA RECEBIDA PEDRO GLORIA JR', true],
    ['PIX ENVIADO PEDRO ALVES', false],
    ['PIX ENVIADO MARIA NUNES', false],
    ['PADARIA PEDRO', false],
  ])('%s → %s', (text, expected) => {
    expect(mentionsName(text, holder.names[0])).toBe(expected);
  });

  it('CPF mascarado, inteiro ou com erro de OCR', () => {
    expect(mentionsCpf('PIX ***.616.981-**', '616981')).toBe(true);
    expect(mentionsCpf('DEB PIX 616.9B1*+*', '616981')).toBe(true);
    expect(mentionsCpf('CPF/CNPJ ***616981**', '616981')).toBe(true);
    expect(mentionsCpf('TED 123.616.981-00', '616981')).toBe(true);
    expect(mentionsCpf('PIX ***.111.222-**', '616981')).toBe(false);
    expect(extractDocument('Pedro Nunes 616.981')).toBe('***616981**');
    expect(cpfMiddleDigits('123.616.981-00')).toBe('616981');
    expect(cpfMiddleDigits('616981')).toBe('616981');
    expect(cpfMiddleDigits('12345')).toBeNull();
  });

  it('salário e outras receitas em nome do titular continuam receita', () => {
    expect(isSelfTransfer({ description: 'RECEBIMENTO TED SALARIO Pedro Nunes Da Glo', amountCents: 456530 }, holder)).toBe(false);
    expect(isSelfTransfer({ description: 'RECEBIMENTO TED', memo: 'CPF/CNPJ ***616981**', amountCents: 100 }, holder)).toBe(true);
    expect(isSelfTransfer({ description: 'DEB PIX CHAVE Pedro Nunes Da Gló', amountCents: -460000 }, holder)).toBe(true);
    expect(isSelfTransfer({ description: 'DEB PIX CHAVE Pedro Nunes', amountCents: -1 }, null)).toBe(false);
  });

  it('nome do titular no cabeçalho do extrato', () => {
    expect(extractHolderName(['CAIXA', 'Extrato por período', 'Cliente PEDRO NUNES DA GLORIA JUNIOR', 'Conta 3776'])).toBe('PEDRO NUNES DA GLORIA JUNIOR');
    expect(extractHolderName(['Titular: Maria Souza'])).toBe('MARIA SOUZA');
    expect(extractHolderName(['Cliente 12345'])).toBeNull();
    expect(cleanNames(['Pedro Nunes', 'PEDRO NUNES', 'Pedro', ''])).toEqual(['PEDRO NUNES']);
  });

  it('classificador: regra do usuário e aprendizado vêm antes; depois o titular', () => {
    const c = new Classifier([], [], { holder });
    expect(c.classify({ description: 'DEB PIX CHAVE Pedro Nunes Da Gló', amountCents: -460000 })).toMatchObject({ categoryKey: 'transferencias', confidence: 'rule' });
    expect(c.classify({ description: 'RECEBIMENTO TED SALARIO Pedro Nunes Da Glo', amountCents: 456530 }).categoryKey).not.toBe('transferencias');
    const withRule = new Classifier([{ pattern: 'PEDRO NUNES', categoryKey: 'lazer', source: 'user' }], [], { holder });
    expect(withRule.classify({ description: 'DEB PIX CHAVE Pedro Nunes Da Gló', amountCents: -1 }).categoryKey).toBe('lazer');
    const noCat = new Classifier([], [], { holder, selfCategory: null });
    expect(noCat.classify({ description: 'DEB PIX CHAVE Pedro Nunes Da Gló', amountCents: -1 }).categoryKey).not.toBe('transferencias');
  });
});
