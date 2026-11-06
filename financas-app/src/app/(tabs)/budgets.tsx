import { useDb } from '../../db/DbProvider';
import { useState, type ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { GoalsView } from '../../components/GoalsView';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { showAlert } from '../../lib/dialog';
import { budgetProgress, formatBRL, monthlySummary, shiftMonth, totalsByCategory } from '../../core/reports';
import { parseAmount } from '../../core/text';
import { categoryMap, listBudgets, listCategories, reportTransactions, setBudget, type Category } from '../../db/repo';
import { useAsyncData } from '../../lib/useAsyncData';
import { Button, Card, Chip, colors, currentMonth, Icon, Money, MonthSwitcher, ProgressBar, SectionTitle, styles } from '../../components/ui';

/**
 * Orçamento mensal por categoria, como no Minhas Economias: define-se um teto
 * por categoria e acompanha-se o quanto já foi gasto no mês.
 */
export default function Planning() {
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<'budgets' | 'goals'>(params.view === 'budgets' ? 'budgets' : 'goals');
  // Vindo do Resumo com ?view=goals: ajusta durante a renderização.
  const [lastParam, setLastParam] = useState(params.view);
  if (params.view !== lastParam) {
    setLastParam(params.view);
    if (params.view === 'goals' || params.view === 'budgets') setView(params.view);
  }
  const tabs = (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Chip label="Sonhos" active={view === 'goals'} onPress={() => setView('goals')} />
      <Chip label="Orçamentos" active={view === 'budgets'} onPress={() => setView('budgets')} />
    </View>
  );
  if (view === 'goals') {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {tabs}
        <GoalsView />
      </ScrollView>
    );
  }
  return <Budgets header={tabs} />;
}

function Budgets({ header }: { header: ReactNode }) {
  const db = useDb();
  const [month, setMonth] = useState(currentMonth());
  const [editing, setEditing] = useState<{ cat: Category; value: string; avg: number } | null>(null);

  const { data, reload } = useAsyncData(async () => {
    const [cats, budgets, txs] = await Promise.all([
      listCategories(db), listBudgets(db), reportTransactions(db, shiftMonth(month, -3), month),
    ]);
    const map = categoryMap(cats);
    const monthTxs = txs.filter((t) => t.date.startsWith(month));
    const progress = new Map(budgetProgress(budgets, monthTxs, map).map((p) => [p.categoryKey, p]));
    // Média dos 3 meses anteriores, para sugerir um valor de orçamento.
    const prev = txs.filter((t) => !t.date.startsWith(month));
    const avg = new Map<string, number>();
    for (const t of totalsByCategory(prev, map, 'expense')) avg.set(t.key, Math.round(t.totalCents / 3));
    const spent = new Map(totalsByCategory(monthTxs, map, 'expense').map((t) => [t.key, t.totalCents]));
    const roots = cats.filter((c) => c.kind === 'expense' && !c.parent);
    const summary = monthlySummary(monthTxs, map)[0];
    const totalBudget = budgets.filter((b) => roots.some((r) => r.key === b.categoryKey)).reduce((s, b) => s + b.limitCents, 0);
    return { roots, progress, avg, spent, summary, totalBudget };
  }, [db, month]);

  async function saveBudget() {
    if (!editing) return;
    const cents = editing.value.trim() ? parseAmount(editing.value) : 0;
    if (cents === null) return showAlert('Valor inválido');
    await setBudget(db, editing.cat.key, Math.abs(cents));
    setEditing(null);
    reload();
  }

  const totalSpent = data?.summary?.expenseCents ?? 0;
  const withBudget = data?.roots.filter((r) => data.progress.has(r.key)) ?? [];
  const withoutBudget = data?.roots.filter((r) => !data.progress.has(r.key)) ?? [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {header}
      <MonthSwitcher month={month} onChange={setMonth} />
      <Card>
        <Text style={styles.muted}>Gasto no mês</Text>
        <Money cents={-totalSpent} size={24} />
        {data?.totalBudget ? (
          <>
            <Text style={[styles.muted, { marginTop: 8 }]}>de {formatBRL(data.totalBudget)} orçados</Text>
            <View style={{ marginTop: 6 }}>
              <ProgressBar ratio={totalSpent / data.totalBudget} color={totalSpent > data.totalBudget ? colors.expense : colors.primary} />
            </View>
          </>
        ) : <Text style={[styles.muted, { marginTop: 8 }]}>Toque numa categoria para definir um limite mensal.</Text>}
      </Card>

      {withBudget.length ? (
        <Card>
          <SectionTitle>Com orçamento</SectionTitle>
          {withBudget.map((c) => {
            const p = data!.progress.get(c.key)!;
            const color = p.status === 'over' ? colors.expense : p.status === 'warning' ? colors.warning : colors.primary;
            return (
              <Pressable key={c.key} onPress={() => setEditing({ cat: c, value: (p.limitCents / 100).toFixed(2).replace('.', ','), avg: data!.avg.get(c.key) ?? 0 })} style={{ marginBottom: 14 }}>
                <View style={[styles.row, { marginBottom: 6 }]}>
                  <Icon name={c.icon} size={18} color={c.color} />
                  <Text style={{ flex: 1, color: colors.text, fontWeight: '600' }}>{c.name}</Text>
                  <Text style={{ color, fontWeight: '600' }}>{Math.round(p.ratio * 100)}%</Text>
                </View>
                <ProgressBar ratio={p.ratio} color={color} />
                <Text style={[styles.muted, { marginTop: 4 }]}>
                  {formatBRL(p.spentCents)} de {formatBRL(p.limitCents)} ·{' '}
                  {p.limitCents >= p.spentCents ? `restam ${formatBRL(p.limitCents - p.spentCents)}` : `excedeu ${formatBRL(p.spentCents - p.limitCents)}`}
                </Text>
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Sem orçamento</SectionTitle>
        {withoutBudget.map((c) => (
          <Pressable key={c.key} onPress={() => setEditing({ cat: c, value: '', avg: data!.avg.get(c.key) ?? 0 })} style={[styles.row, { paddingVertical: 10 }]}>
            <Icon name={c.icon} size={18} color={c.color} />
            <Text style={{ flex: 1, color: colors.text }}>{c.name}</Text>
            <Text style={styles.muted}>{formatBRL(data!.spent.get(c.key) ?? 0)}</Text>
            <Icon name="add-circle-outline" size={20} color={colors.primary} />
          </Pressable>
        ))}
      </Card>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={{ flex: 1, backgroundColor: '#0006', justifyContent: 'center', padding: 24 }}>
          <Card>
            <SectionTitle>Orçamento: {editing?.cat.name}</SectionTitle>
            {editing?.avg ? <Text style={[styles.muted, { marginBottom: 8 }]}>Média dos últimos 3 meses: {formatBRL(editing.avg)}</Text> : null}
            <TextInput
              value={editing?.value ?? ''}
              onChangeText={(v) => editing && setEditing({ ...editing, value: v })}
              keyboardType="decimal-pad"
              placeholder="Limite mensal (R$) — vazio remove"
              placeholderTextColor={colors.muted}
              autoFocus
              style={[styles.input, { marginBottom: 12 }]}
            />
            <Button title="Salvar" onPress={saveBudget} />
            <Button title="Cancelar" variant="ghost" onPress={() => setEditing(null)} />
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}
