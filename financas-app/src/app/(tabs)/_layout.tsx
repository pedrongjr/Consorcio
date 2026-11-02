import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';
import { colors } from '../../components/ui';

type IoniconName = keyof typeof Ionicons.glyphMap;

function icon(name: IoniconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerTitleStyle: { color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Resumo', tabBarIcon: icon('pie-chart') }} />
      <Tabs.Screen name="transactions" options={{ title: 'Lançamentos', tabBarIcon: icon('list') }} />
      <Tabs.Screen name="import" options={{ title: 'Importar', tabBarIcon: icon('cloud-upload') }} />
      <Tabs.Screen name="budgets" options={{ title: 'Planejar', tabBarIcon: icon('flag') }} />
      <Tabs.Screen name="more" options={{ title: 'Mais', tabBarIcon: icon('menu') }} />
    </Tabs>
  );
}
