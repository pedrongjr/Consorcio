import { router } from 'expo-router';
import { useDb } from '../../db/DbProvider';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  budgetProgress, monthLabel, monthlySummary, shiftMonth, totalsByCategory, formatBRL,
} from '../../core/reports';
import { categoryMap, latestMonth, listAccounts, listBudgets, listCategories, reportTransactions } from '../../db/repo';
import { useAsyncData } from '../../lib/useAsyncData';
import {
  Button, Card, colors, currentMonth, EmptyState, Icon, Money, MonthSwitcher, ProgressBar, SectionTitle, styles,
} from '../../components/ui';

export default function Dashboard() {
  const db = useDb();
  const [month, setMonthState] = useState(currentMonth());
  // Enquanto o usuário não escolher um mês, o Resumo segue o mês mais recente
  // com lançamentos (ex.: logo depois de importar um extrato antigo).
  const userPicked = useRef(false);
  const setMonth = (m: string) => { userPicked.current = true; setMonthState(m); };

  const { data } = useAsyncData(async () => {
    if (!userPicked.current) {
      const latest = await latestMonth(db);
      if (latest && latest < currentMonth() && latest !== month) {
        const hasCurrent = (await reportTransactions(db, month, month)).length > 0;
        if (!hasCurrent) { setMonthState(latest); return undefined; }
      }
    }
    const [accounts, cats, budgets, txs] = await Promise.all([
      listAccounts(db), listCategories(db), listBudgets(db), reportTransactions(db, shiftMonth(month, -5), month),
    ]);
    const map = categoryMap(cats);
    const monthTxs = txs.filter((t) => t.date.startsWith(month));
    const months = monthlySummary(txs, map);
    const evolution = Array.from({ length: 6 }, (_, i) => {
      const m = shiftMonth(month, i - 5);
      return months.find((x) => x.month === m) ?? { month: m, incomeCents: 0, expenseCents: 0, balanceCents: 0 };
    });
    return {
      accounts,
      summary: evolution[5],
      evolution,
      byCategory: totalsByCategory(monthTxs, map, 'expense'),
      budgets: budgetProgress(budgets, monthTxs, map)
        .filter((b) => b.status !== 'ok')
        .map((b) => ({ ...b, name: map.get(b.categoryKey)?.name ?? b.categoryKey })),
      hasData: txs.length > 0 || accounts.some((a) => a.tx_count > 0),
    };
  }, [db, month]);

  if (data && !data.hasData && data.accounts.length === 0) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <EmptyState
          icon="wallet-outline"
          title="Bem-vindo ao controle financeiro"
          text="Importe o extrato do seu banco (OFX, CSV, PDF, XLSX ou QIF) e os lançamentos serão classificados automaticamente por categoria."
          action={<Button title="Importar extrato" icon="cloud-upload" onPress={() => router.navigate('/import')} />}
        />
      </ScrollView>
    );
  }

  const total = data?.accounts.reduce((s, a) => s + a.balance_cents, 0) ?? 0;
  const maxEvo = Math.max(1, ...(data?.evolution ?? []).flatMap((e) => [e.incomeCents, e.expenseCents]));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <MonthSwitcher month={month} onChange={setMonth} />

      <Card>
        <Text style={styles.muted}>Saldo em contas</Text>
        <Money cents={total} size={26} />
        <View style={[styles.row, { marginTop: 12, justifyContent: 'space-between' }]}>
          <View>
            <Text style={styles.muted}>Receitas do mês</Text>
            <Money cents={data?.summary.incomeCents ?? 0} />
          </View>
          <View>
            <Text style={styles.muted}>Despesas do mês</Text>
            <Money cents={-(data?.summary.expenseCents ?? 0)} />
          </View>
          <View>
            <Text style={styles.muted}>Resultado</Text>
            <Money cents={data?.summary.balanceCents ?? 0} />
          </View>
        </View>
      </Card>

      {data?.budgets.length ? (
        <Card style={{ borderLeftWidth: 4, borderLeftColor: colors.warning }}>
          <SectionTitle>Alertas de orçamento</SectionTitle>
          {data.budgets.map((b) => (
            <Text key={b.categoryKey} style={{ color: b.status === 'over' ? colors.expense : colors.text, marginBottom: 4 }}>
              {b.name}: {formatBRL(b.spentCents)} de {formatBRL(b.limitCents)} ({Math.round(b.ratio * 100)}%)
            </Text>
          ))}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Gastos por categoria</SectionTitle>
        {data?.byCategory.length ? data.byCategory.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => router.navigate({ pathname: '/transactions', params: { category: c.key, month } })}
            style={{ marginBottom: 12 }}
          >
            <View style={[styles.row, { marginBottom: 4 }]}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: `${c.color}22`, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={c.icon} size={14} color={c.color} />
              </View>
              <Text style={{ flex: 1, color: colors.text, fontWeight: '600' }} numberOfLines={1}>{c.name}</Text>
              <Text style={styles.muted}>{Math.round(c.share * 100)}%</Text>
              <Money cents={c.totalCents} colored={false} />
            </View>
            <ProgressBar ratio={c.share} color={c.color} />
            {c.children.slice(0, 3).map((s) => (
              <View key={s.key} style={[styles.row, { marginTop: 4, paddingLeft: 40 }]}>
                <Text style={[styles.muted, { flex: 1 }]} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.muted}>{formatBRL(s.totalCents)}</Text>
              </View>
            ))}
          </Pressable>
        )) : <Text style={styles.muted}>Nenhuma despesa neste mês.</Text>}
      </Card>

      <Card>
        <SectionTitle>Evolução (6 meses)</SectionTitle>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 140 }}>
          {data?.evolution.map((e) => (
            <Pressable key={e.month} onPress={() => setMonth(e.month)} style={{ alignItems: 'center', flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 110 }}>
                <View style={{ width: 10, height: Math.max(2, (e.incomeCents / maxEvo) * 110), backgroundColor: colors.income, borderRadius: 3 }} />
                <View style={{ width: 10, height: Math.max(2, (e.expenseCents / maxEvo) * 110), backgroundColor: colors.expense, borderRadius: 3 }} />
              </View>
              <Text style={[styles.muted, { fontSize: 11, marginTop: 4, fontWeight: e.month === month ? '700' : '400' }]}>{monthLabel(e.month)}</Text>
            </Pressable>
          ))}
        </View>
        <View style={[styles.row, { marginTop: 8, justifyContent: 'center' }]}>
          <View style={{ width: 10, height: 10, backgroundColor: colors.income, borderRadius: 2 }} /><Text style={styles.muted}>Receitas</Text>
          <View style={{ width: 10, height: 10, backgroundColor: colors.expense, borderRadius: 2 }} /><Text style={styles.muted}>Despesas</Text>
        </View>
      </Card>

      <Card>
        <SectionTitle right={<Button title="Gerenciar" variant="ghost" onPress={() => router.push('/accounts')} />}>Contas</SectionTitle>
        {data?.accounts.map((a) => (
          <Pressable key={a.id} onPress={() => router.navigate({ pathname: '/transactions', params: { account: String(a.id), month } })}>
            <View style={[styles.row, { paddingVertical: 8 }]}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: a.color }} />
              <Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>{a.name}</Text>
              <Money cents={a.balance_cents} />
            </View>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}
