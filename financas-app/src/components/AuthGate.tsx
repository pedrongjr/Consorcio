import type { ReactNode } from 'react';

/**
 * iOS/Android: os dados ficam só no aparelho, então não há login.
 * Na web, `AuthGate.web.tsx` exige cadastro/login.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Seção "Minha conta" da tela Mais (só existe na web). */
export function AccountSection() {
  return null;
}
