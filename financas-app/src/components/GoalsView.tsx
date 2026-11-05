import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { formatBRL, monthLabel } from '../core/reports';
import { useDb } from '../db/DbProvider';
import { listGoals } from '../db/repo';
import { describePlan, planFor, planningContext } from '../lib/planning';
import { useAsyncData } from '../lib/useAsyncData';
import { HowToReachCard } from './HowToReach';
import { Button, Card, colors, EmptyState, Icon, Money, ProgressBar, styles } from './ui';

/** Lista de sonhos com o plano de cada um e o total necessário por mês. */
export function GoalsView() {
  const db = useDb();
  const { data, reload } = useAsyncData(async () => {
    const ctx = await planningContext(db);
    const goals = await listGoals(db, ctx.since);
    return { ctx, items: goals.map((g) => ({ g, plan: planFor(g, ctx) })) };
  }, [db]);

  const items = data?.items ?? [];
  const active = items.filter((i) => i.plan.status !== 'done');
  const totalNeeded = active.reduce((s, i) => s + (i.plan.monthlyNeededCents ?? 0), 0);
  const surplus = data?.ctx.avgSurplus ?? null;

  return (
    <View style={{ gap: 12 }}>
      {items.length ? (
        <Card>
          <Text style={styles.muted}>Para cumprir os prazos, guarde por mês</Text>
          <Money cents={totalNeeded} size={24} colored={false} />
          <Text style={[styles.muted, { marginTop: 6 }]}>
            {surplus === null
              ? 'Importe extratos dos últimos meses para comparar com o quanto sobra.'
              : `Sua sobra média nos últimos meses: ${formatBRL(surplus)}/mês`}
          </Text>
          {surplus !== null && totalNeeded > 0 ? (
            <View style={{ marginTop: 8 }}>
              <ProgressBar
                ratio={surplus > 0 ? Math.min(1, totalNeeded / surplus) : 1}
                color={surplus > 0 && totalNeeded <= surplus ? colors.primary : colors.expense}
              />
              <Text style={{ marginTop: 4, color: surplus > 0 && totalNeeded <= surplus ? colors.text : colors.expense }}>
                {surplus > 0 && totalNeeded <= surplus
                  ? `Usa ${Math.round((totalNeeded / surplus) * 100)}% da sua sobra.`
                  : 'Os sonhos pedem mais do que sobra por mês. Veja abaixo onde economizar, ou reveja prazos e valores.'}
              </Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {data && surplus !== null && totalNeeded > Math.max(0, surplus) ? (
        <HowToReachCard monthlyCents={totalNeeded} ctx={data.ctx} onBudgets={reload} />
      ) : null}

      {items.map(({ g, plan }) => {
        const d = data ? describePlan(g, plan, data.ctx) : null;
        return (
          <Pressable key={g.id} onPress={() => router.push({ pathname: '/goal/[id]', params: { id: String(g.id) } })}>
            <Card>
              <View style={[styles.row, { marginBottom: 8 }]}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${g.color}22`, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={g.icon} size={20} color={g.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }} numberOfLines={1}>{g.name}</Text>
                  <Text style={styles.muted}>{g.deadline ? `até ${monthLabel(g.deadline, true)}` : 'sem prazo'}</Text>
                </View>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{Math.round(plan.progress * 100)}%</Text>
              </View>
              <ProgressBar ratio={plan.progress} color={g.color} />
              <View style={[styles.row, { justifyContent: 'space-between', marginTop: 6 }]}>
                <Text style={styles.muted}>{formatBRL(g.saved_cents)} de {formatBRL(g.target_cents)}</Text>
                {plan.monthlyNeededCents && plan.status !== 'done' ? (
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{formatBRL(plan.monthlyNeededCents)}/mês</Text>
                ) : null}
              </View>
              {d ? <Text style={{ color: d.color, marginTop: 6 }}>{d.text}</Text> : null}
            </Card>
          </Pressable>
        );
      })}

      {data && !items.length ? (
        <EmptyState
          icon="star-outline"
          title="Quer realizar seus sonhos?"
          text="Escolha um sonho (viagem, carro, casa, reserva...) e o app mostra quanto guardar por mês, onde economizar e como automatizar."
        />
      ) : null}
      <Button title="Novo sonho" icon="add" onPress={() => router.push('/goal/new')} />
    </View>
  );
}
