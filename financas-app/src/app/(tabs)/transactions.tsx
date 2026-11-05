import { router, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../db/DbProvider';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { displayDescription } from '../../core/classifier';
import { formatDateBR } from '../../core/reports';
import { transferLabel } from '../../core/transfers';
import {
  classifyTransaction, listAccounts, listCategories, listTransactions, resetClassification, undoClassification,
  type Category, type Transaction,
} from '../../db/repo';
import { showAlert } from '../../lib/dialog';
import { useAsyncData } from '../../lib/useAsyncData';
import { CategoryPicker } from '../../components/CategoryPicker';
import {
  Button, CategoryBadge, Chip, colors, currentMonth, EmptyState, Icon, Money, MonthSwitcher, styles,
} from '../../components/ui';

export default function Transactions() {
  const db = useDb();
  const params = useLocalSearchParams<{ category?: string; month?: string; account?: string }>();
  const [month, setMonth] = useState<string | null>(params.month ?? currentMonth());
  /** Contas visíveis (vazio = todas as contas juntas). */
  const [accountIds, setAccountIds] = useState<number[]>(params.account ? [Number(params.account)] : []);
  const [categoryKey, setCategoryKey] = useState<string | undefined>(params.category);
  const [search, setSearch] = useState('');
  const [uncategorized, setUncategorized] = useState(false);
  const [picker, setPicker] = useState(false);
  /** Lançamento cuja categoria está sendo trocada direto na lista. */
  const [editing, setEditing] = useState<Transaction | null>(null);
  /** Última alteração feita na lista, com opção de desfazer. */
  const [lastChange, setLastChange] = useState<{ logId: number; text: string } | null>(null);

  // Filtros vindos do Resumo (toque numa categoria ou conta): ajusta o estado
  // durante a renderização quando os parâmetros mudam.
  const paramsKey = `${params.category ?? ''}|${params.month ?? ''}|${params.account ?? ''}`;
  const [lastParams, setLastParams] = useState(paramsKey);
  if (paramsKey !== lastParams) {
    setLastParams(paramsKey);
    if (params.month) setMonth(params.month);
    setCategoryKey(params.category);
    setAccountIds(params.account ? [Number(params.account)] : []);
  }

  const { data, reload } = useAsyncData(async () => {
    const [txs, accounts, cats] = await Promise.all([
      listTransactions(db, { month: month ?? undefined, accountIds, categoryKey, search, uncategorizedOnly: uncategorized }),
      listAccounts(db),
      listCategories(db),
    ]);
    return { txs, accounts, cats };
  }, [db, month, accountIds.join(','), categoryKey, search, uncategorized]);

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
  const visibleAccounts = (data?.accounts ?? []).filter((a) => !accountIds.length || accountIds.includes(a.id));
  const balance = visibleAccounts.reduce((s, a) => s + a.balance_cents, 0);
  const toggleAccount = (id: number) => setAccountIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  async function changeCategory(t: Transaction, key: string) {
    setEditing(null);
    if (key === t.category_key && t.category_source === 'user') return;
    try {
      const r = await classifyTransaction(db, { txId: t.id, categoryKey: key, applySimilar: false });
      if (r.logId) setLastChange({ logId: r.logId, text: `“${displayDescription(t.description, t.memo)}” → ${catMap.get(key)?.name ?? key}` });
      reload();
      // Transferência: abre o lançamento para escolher de/para qual conta.
      if (catMap.get(key)?.kind === 'transfer' && !t.transfer_account_id) {
        router.push({ pathname: '/transaction/[id]', params: { id: String(t.id) } });
      }
    } catch (e) {
      showAlert('Não foi possível alterar', (e as Error).message);
    }
  }

  async function undoLast() {
    if (!lastChange) return;
    try {
      await undoClassification(db, lastChange.logId);
      setLastChange(null);
      reload();
    } catch (e) {
      showAlert('Não foi possível desfazer', (e as Error).message);
    }
  }

  function resetListed() {
    const ids = (data?.txs ?? []).map((t) => t.id);
    if (!ids.length) return;
    showAlert(
      'Refazer a classificação automática?',
      `Os ${ids.length} lançamento(s) desta lista voltam a ser classificados pelas regras e pelo aprendizado do app, ` +
        'descartando a categoria escolhida à mão. Antes, apague em Mais › Regras qualquer regra errada.\n\n' +
        'Dá para desfazer em Mais › Histórico de classificações.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Refazer',
          onPress: async () => {
            try {
              const r = await resetClassification(db, ids);
              if (r.logId) setLastChange({ logId: r.logId, text: `${r.changed} lançamento(s) reclassificados` });
              reload();
            } catch (e) {
              showAlert('Não foi possível reclassificar', (e as Error).message);
            }
          },
        },
      ],
    );
  }

  const renderItem = ({ item }: { item: Transaction }) => {
    const c = item.category_key ? catMap.get(item.category_key) : undefined;
    const isTransfer = c?.kind === 'transfer';
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
            <Text style={{ color: colors.text, fontSize: 15 }} numberOfLines={1}>{displayDescription(item.description, item.memo)}</Text>
            <View style={[styles.row, { gap: 6 }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Alterar categoria"
                hitSlop={6}
                onPress={() => setEditing(item)}
                style={({ pressed }) => [styles.row, { gap: 2, opacity: pressed ? 0.6 : 1 }]}
              >
                {c ? (
                  <CategoryBadge
                    // Transferência: o rótulo mostra de qual conta para qual.
                    name={isTransfer ? transferLabel(item.amount_cents, item.account_name, item.transfer_account_name) : c.name}
                    icon={c.icon}
                    color={c.color}
                  />
                ) : <CategoryBadge name="Sem categoria" icon="help" color={colors.warning} />}
                <Icon name="chevron-down" size={14} color={colors.muted} />
              </Pressable>
              {isTransfer ? null : (
                <Text style={[styles.muted, { fontSize: 12, flexShrink: 1 }]} numberOfLines={1}>{item.account_name}</Text>
              )}
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
        </ScrollView>
        {data && data.accounts.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
            <Icon name="wallet-outline" size={16} color={colors.muted} />
            <Chip label="Todas as contas" active={!accountIds.length} onPress={() => setAccountIds([])} />
            {data.accounts.map((a) => (
              <Chip key={a.id} label={a.name} active={accountIds.includes(a.id)} color={a.color} onPress={() => toggleAccount(a.id)} />
            ))}
          </ScrollView>
        ) : null}
        {data?.accounts.length ? (
          <Text style={styles.muted}>
            Saldo {accountIds.length ? `de ${visibleAccounts.length === 1 ? visibleAccounts[0].name : `${visibleAccounts.length} contas`}` : 'de todas as contas'}:{' '}
            <Money cents={balance} size={13} />
          </Text>
        ) : null}
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.muted}>{data?.txs.length ?? 0} lançamentos · toque na categoria para trocar</Text>
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
        ListFooterComponent={selectedCat && data?.txs.length ? (
          <View style={{ padding: 16 }}>
            <Button
              title={`Refazer classificação automática destes ${data.txs.length}`}
              icon="refresh"
              variant="secondary"
              onPress={resetListed}
            />
          </View>
        ) : undefined}
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
      {lastChange ? (
        <View
          style={{
            position: 'absolute', left: 12, right: 88, bottom: 24, minHeight: 52, borderRadius: 12, backgroundColor: '#1F2933',
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10,
          }}
        >
          <Text style={{ color: '#fff', flex: 1 }} numberOfLines={2}>{lastChange.text}</Text>
          <Pressable accessibilityRole="button" onPress={undoLast} hitSlop={8}>
            <Text style={{ color: '#7FD1C7', fontWeight: '700' }}>DESFAZER</Text>
          </Pressable>
          <Pressable accessibilityLabel="Fechar aviso" onPress={() => setLastChange(null)} hitSlop={8}>
            <Icon name="close" size={18} color="#fff" />
          </Pressable>
        </View>
      ) : null}
      <CategoryPicker
        visible={picker}
        categories={data?.cats ?? []}
        selected={categoryKey}
        onClose={() => setPicker(false)}
        onSelect={(k) => { setCategoryKey(k); setPicker(false); }}
      />
      <CategoryPicker
        visible={!!editing}
        categories={data?.cats ?? []}
        selected={editing?.category_key ?? undefined}
        initialKind={editing ? catMap.get(editing.category_key ?? '')?.kind ?? (editing.amount_cents >= 0 ? 'income' : 'expense') : undefined}
        onClose={() => setEditing(null)}
        onSelect={(k) => { if (editing) changeCategory(editing, k); }}
      />
    </View>
  );
}
