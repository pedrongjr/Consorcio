import type { ParsedStatement } from '../core/types';
import type { ImportCandidate } from '../db/repo';

/**
 * Guarda a importação em andamento entre a tela "Importar" e a tela de revisão.
 * Fica só em memória: se o app for fechado, o usuário importa o arquivo de novo.
 */
export interface ImportSession {
  fileName: string;
  accountId: number;
  statement: ParsedStatement;
  candidates: ImportCandidate[];
}

let session: ImportSession | null = null;

export const importSession = {
  get: () => session,
  set: (s: ImportSession) => { session = s; },
  clear: () => { session = null; },
};
