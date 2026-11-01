import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { formatDateBR } from '../../core/reports';
import { listAccounts, listCategories, listTransactions, type Category, type Transaction } from '../../db/repo';
import { useAsyncData } from '../../lib/useAsyncData';
import { CategoryPicker } from '../../components/CategoryPicker';
import {
  CategoryBadge, Chip, colors, currentMonth, EmptyState, Icon, Money, MonthSwitcher, styles,
} from '../../components/ui';

export default function Transactions() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ category?: string; month?: string; account?: string }>();
  const [month, setMonth] = useState<string | null>(params.month ?? currentMonth());
  const [accountId, setAccountId] = useState<number | undefined>(params.account ? Number(params.account) : undefined);
  const [categoryKey, setCategoryKey] = useState<string | undefined>(params.category);
  const [search, setSearch] = useState('');
  const [uncategorized, setUncategorized] = useState(false);
  const [picker, setPicker] = useState(false);

  // Filtros vindos do Resumo (toque numa categoria ou conta): ajusta o estado
  // durante a renderização quando os parâmetros mudam.
  const paramsKey = `${params.category ?? ''}|${params.month ?? ''}|${params.account ?? ''}`;
  const [lastParams, setLastParams] = useState(paramsKey);
  if (paramsKey !== lastParams) {
    setLastParams(paramsKey);
    if (params.month) setMonth(params.month);
    setCategoryKey(params.category);
    setAccountId(params.account ? Number(params.account) : undefined);
  }

  const { data } = useAsyncData(async () => {
    const [txs, accounts, cats] = await Promise.all([
      listTransactions(db, { month: month ?? undefined, accountId, categoryKey, search, uncategorizedOnly: uncategorized }),
      listAccounts(db),
      listCategories(db),
    ]);
    return { txs, accounts, cats };
  }, [db, month, accountId, categoryKey, search, uncategorized]);

  const catMap = useMemo(() => new Map<string, Category>((data?.cats ?? []).map((c) => [c.key, c])), [data?.cats]);
  const totals = useMemo(() => {
    let inc = 0; let out = 0;
    for (const t of data?.txs ?? []) {
      if (catMap.get(t.category_key ?? '')?.kind === 'transfer') continue;
      if (t.amount_cents >= 0) inc += t.amount_cents; else out += t.amount_cents;
    }
    return { inc, out };
  }, [data?.txs, catMap]);

  const selectedCat = categoryKey ? catMap.get(categoryKey) : undefined;

  const renderItem = ({ item }: { item: Transaction }) => {
    const c = item.category_key ? catMap.get(item.category_key) : undefined;
    return (
      <Pressable
        onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: String(item.id) } })}
        style={({ pressed }) => [{ backgroundColor: pressed ? '#EEF1F4' : colors.card, paddingHorizontal: 16, paddingVertical: 12 }]}
      >
        <View style={styles.row}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: `${c?.color ?? '#999'}22`, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={c?.icon ?? 'help'} size={18} color={c?.color ?? colors.muted} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: colors.text, fontSize: 15 }} numberOfLines={1}>{item.description}</Text>
            <View style={[styles.row, { gap: 6 }]}>
              {c ? <CategoryBadge name={c.name} icon={c.icon} color={c.color} /> : <CategoryBadge name="Sem categoria" icon="help" color={colors.warning} />}
              <Text style={[styles.muted, { fontSize: 12, flexShrink: 1 }]} numberOfLines={1}>{item.account_name}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Money cents={item.amount_cents} />
            <Text style={[styles.muted, { fontSize: 12 }]}>{formatDateBR(item.date)}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={{ padding: 16, paddingBottom: 8, gap: 10, backgroundColor: colors.bg }}>
        {month ? <MonthSwitcher month={month} onChange={setMonth} /> : null}
        <TextInput
          placeholder="Buscar por descrição"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          style={styles.input}
          clearButtonMode="while-editing"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <Chip label={month ? 'Todo o período' : 'Por mês'} onPress={() => setMonth(month ? null : currentMonth())} active={!month} />
          <Chip label="Sem categoria" active={uncategorized} onPress={() => setUncategorized((v) => !v)} color={colors.warning} />
          <Chip
            label={selectedCat ? `${selectedCat.name} ✕` : 'Categoria'}
            active={!!selectedCat}
            onPress={() => (selectedCat ? setCategoryKey(undefined) : setPicker(true))}
          />
          {data?.accounts.map((a) => (
            <Chip key={a.id} label={a.name} active={accountId === a.id} color={a.color} onPress={() => setAccountId(accountId === a.id ? undefined : a.id)} />
          ))}
        </ScrollView>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.muted}>{data?.txs.length ?? 0} lançamentos</Text>
          <View style={[styles.row, { gap: 10 }]}>
            <Money cents={totals.inc} size={13} />
            <Money cents={totals.out} size={13} />
          </View>
        </View>
      </View>
      <FlatList
        data={data?.txs ?? []}
        keyExtractor={(t) => String(t.id)}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
        ListEmptyComponent={<EmptyState icon="document-text-outline" title="Nenhum lançamento" text="Importe um extrato ou mude os filtros." />}
        contentContainerStyle={{ paddingBottom: 96 }}
      />
      <Pressable
        accessibilityLabel="Novo lançamento"
        onPress={() => router.push('/transaction/new')}
        style={{
          position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary,
          alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
        }}
      >
        <Icon name="add" size={30} color="#fff" />
      </Pressable>
      <CategoryPicker
        visible={picker}
        categories={data?.cats ?? []}
        selected={categoryKey}
        onClose={() => setPicker(false)}
        onSelect={(k) => { setCategoryKey(k); setPicker(false); }}
      />
    </View>
  );
}
