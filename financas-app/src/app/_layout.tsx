import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DB_NAME, migrate } from '../db/database';
import { colors } from '../components/ui';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName={DB_NAME} onInit={migrate}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerTintColor: colors.primary,
            headerTitleStyle: { color: colors.text },
            contentStyle: { backgroundColor: colors.bg },
            headerBackTitle: 'Voltar',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="import-review" options={{ title: 'Revisar importação' }} />
          <Stack.Screen name="transaction/[id]" options={{ title: 'Lançamento' }} />
          <Stack.Screen name="transaction/new" options={{ title: 'Novo lançamento', presentation: 'modal' }} />
          <Stack.Screen name="accounts" options={{ title: 'Contas e cartões' }} />
          <Stack.Screen name="categories" options={{ title: 'Categorias' }} />
          <Stack.Screen name="rules" options={{ title: 'Regras de classificação' }} />
          <Stack.Screen name="imports" options={{ title: 'Histórico de importações' }} />
        </Stack>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
