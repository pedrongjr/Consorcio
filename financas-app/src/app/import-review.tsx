import { router, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { descriptionKey } from '../core/text';
import { formatDateBR } from '../core/reports';
import { commitImport, listCategories, type Category, type ImportCandidate } from '../db/repo';
import { importSession } from '../lib/importSession';
import { useAsyncData } from '../lib/useAsyncData';
import { CategoryPicker } from '../components/CategoryPicker';
import { Button, CategoryBadge, colors, EmptyState, Icon, Money, styles } from '../components/ui';

export default function ImportReview() {
  const db = useSQLiteContext();
  const session = importSession.get();
  const [items, setItems] = useState<ImportCandidate[]>(session?.candidates ?? []);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { data: cats } = useAsyncData(() => listCategories(db), [db]);
  const catMap = useMemo(() => new Map<string, Category>((cats ?? []).map((c) => [c.key, c])), [cats]);

  const stats = useMemo(() => {
    const sel = items.filter((i) => i.selected);
    return {
      selected: sel.length,
      duplicates: items.filter((i) => i.duplicate).length,
      uncategorized: sel.filter((i) => i.categorySource === 'none').length,
      income: sel.filter((i) => i.amountCents > 0).reduce((s, i) => s + i.amountCents, 0),
      expense: sel.filter((i) => i.amountCents < 0).reduce((s, i) => s + i.amountCents, 0),
    };
  }, [items]);

  if (!session) {
    return <EmptyState icon="alert-circle-outline" title="Nenhuma importação em andamento" action={<Button title="Voltar" onPress={() => router.back()} />} />;
  }

  function setCategory(index: number, key: string) {
    const target = items[index];
    const k = descriptionKey(target.description);
    const positive = target.amountCents >= 0;
    let others = 0;
    const next = items.map((it, i) => {
      if (i === index) return { ...it, categoryKey: key, categorySource: 'user' };
      // Aplica também aos lançamentos com a mesma descrição que não foram ajustados à mão.
      if (it.categorySource !== 'user' && (it.amountCents >= 0) === positive && descriptionKey(it.description) === k) {
        others++;
        return { ...it, categoryKey: key, categorySource: 'user' };
      }
      return it;
    });
    setItems(next);
    setEditing(null);
    if (others) setNotice(`Categoria aplicada também a ${others} lançamento(s) semelhante(s).`);
  }

  async function confirm() {
    if (!session) return;
    setSaving(true);
    try {
      const r = await commitImport(db, { accountId: session.accountId, fileName: session.fileName, format: session.statement.format, candidates: items });
      importSession.clear();
      Alert.alert('Importação concluída', `${r.imported} lançamento(s) importado(s).${r.skipped ? ` ${r.skipped} ignorado(s).` : ''}`);
      router.dismissTo('/transactions');
    } catch (e) {
      Alert.alert('Erro ao importar', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const allSelected = items.every((i) => i.selected || i.duplicate);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: `Revisar (${items.length})` }} />
      <View style={{ padding: 16, gap: 6, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={styles.muted} numberOfLines={1}>{session.fileName}</Text>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={{ color: colors.text }}>{stats.selected} selecionados</Text>
          <Pressable onPress={() => setItems((p) => p.map((i) => ({ ...i, selected: i.duplicate ? false : !allSelected })))}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>{allSelected ? 'Desmarcar todos' : 'Marcar todos'}</Text>
          </Pressable>
        </View>
        {stats.duplicates ? <Text style={[styles.muted, { color: colors.warning }]}>{stats.duplicates} já importado(s) antes — desmarcado(s).</Text> : null}
        {stats.uncategorized ? <Text style={styles.muted}>{stats.uncategorized} sem categoria identificada — toque para classificar.</Text> : null}
        {notice ? <Text style={{ color: colors.primary, fontSize: 13 }}>{notice}</Text> : null}
      </View>
      <FlatList
        data={items}
        keyExtractor={(_, i) => String(i)}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
        renderItem={({ item, index }) => {
          const c = catMap.get(item.categoryKey);
          return (
            <View style={[styles.row, { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.card, opacity: item.selected ? 1 : 0.5 }]}>
              <Pressable
                hitSlop={8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.selected }}
                onPress={() => setItems((p) => p.map((it, i) => (i === index ? { ...it, selected: !it.selected } : it)))}
              >
                <Icon name={item.selected ? 'checkbox' : 'square-outline'} size={24} color={item.selected ? colors.primary : colors.muted} />
              </Pressable>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: colors.text }} numberOfLines={2}>{item.description}</Text>
                <Pressable onPress={() => setEditing(index)} style={[styles.row, { gap: 6 }]}>
                  {c ? <CategoryBadge name={c.name} icon={c.icon} color={item.categorySource === 'none' ? colors.warning : c.color} /> : null}
                  {item.duplicate ? <Text style={[styles.muted, { fontSize: 12 }]}>já importado</Text> : null}
                  <Icon name="create-outline" size={14} color={colors.muted} />
                </Pressable>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Money cents={item.amountCents} />
                <Text style={[styles.muted, { fontSize: 12 }]}>{formatDateBR(item.date)}</Text>
              </View>
            </View>
          );
        }}
      />
      <View style={{ padding: 16, gap: 8, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.muted}>Entradas <Money cents={stats.income} size={13} /></Text>
          <Text style={styles.muted}>Saídas <Money cents={stats.expense} size={13} /></Text>
        </View>
        <Button title={`Importar ${stats.selected} lançamento(s)`} icon="download" onPress={confirm} loading={saving} disabled={stats.selected === 0} />
      </View>
      <CategoryPicker
        visible={editing !== null}
        categories={cats ?? []}
        selected={editing !== null ? items[editing]?.categoryKey : null}
        initialKind={editing !== null && items[editing]?.amountCents > 0 ? 'income' : 'expense'}
        onClose={() => setEditing(null)}
        onSelect={(k) => editing !== null && setCategory(editing, k)}
      />
    </SafeAreaView>
  );
}
