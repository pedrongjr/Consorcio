import { SQLiteProvider, useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import type { ReactNode } from 'react';
import { DB_NAME, migrate } from './database';

/**
 * iOS/Android: os dados ficam num banco SQLite local no aparelho.
 * Na web, `DbProvider.web.tsx` substitui este arquivo e os dados vêm da API.
 */
export function DbProvider({ children }: { children: ReactNode }) {
  return (
    <SQLiteProvider databaseName={DB_NAME} onInit={migrate}>
      {children}
    </SQLiteProvider>
  );
}

export function useDb(): SQLiteDatabase {
  return useSQLiteContext();
}
