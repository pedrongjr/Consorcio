import type { ReactNode } from 'react';

/**
 * Web: não há banco local. As funções de `repo.web.ts` chamam a API do
 * servidor, que identifica o usuário pela sessão (cookie). O valor devolvido
 * por `useDb` só existe para manter a mesma assinatura das telas.
 */
const WEB_DB = Object.freeze({ kind: 'web-api' });

export function DbProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useDb(): typeof WEB_DB {
  return WEB_DB;
}
