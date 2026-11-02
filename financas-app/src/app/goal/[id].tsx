import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { formatBRL, formatDateBR, monthLabel } from '../../core/reports';
import { parseAmount } from '../../core/text';
import { useDb } from '../../db/DbProvider';
import { addGoalEntry, deleteGoal, deleteGoalEntry, getGoal, listGoalEntries } from '../../db/repo';
import { showAlert } from '../../lib/dialog';
import { describePlan, paceOf, planFor, planningContext } from '../../lib/planning';
import { useAsyncData } from '../../lib/useAsyncData';
import { Button, Card, Chip, colors, Field, Icon, Money, ProgressBar, SectionTitle, styles, todayIso } from '../../components/ui';

export default function GoalDetail() {
  const db = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const goalId = Number(id);
  const [kind, setKind] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, reload } = useAsyncData(async () => {
    const ctx = await planningContext(db);
    const [goal, entries] = await Promise.all([getGoal(db, goalId, ctx.since), listGoalEntries(db, goalId)]);
    return { ctx, goal, entries };
  }, [db, goalId]);

  const g = data?.goal;
  if (!data) return <View style={styles.screen} />;
  if (!g) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.muted}>Objetivo não encontrado.</Text>
      </View>
    );
  }
  const plan = planFor(g, data.ctx);
  const d = describePlan(g, plan, data.ctx);
  const pace = paceOf(g);

  async function add() {
    const cents = amount.trim() ? Math.abs(parseAmount(amount) ?? 0) : 0;
    if (!cents) return showAlert('Informe o valor');
    setBusy(true);
    try {
      await addGoalEntry(db, goalId, { date: todayIso(), amountCents: kind === 'in' ? cents : -cents, note: note.trim() || null });
      setAmount(''); setNote('');
      reload();
    } catch (e) {
      showAlert('Não foi possível registrar', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function removeEntry(entryId: number) {
    showAlert('Excluir este registro?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => { await deleteGoalEntry(db, entryId); reload(); } },
    ]);
  }

  function remove() {
    showAlert(`Excluir “${g!.name}”?`, 'O objetivo e o histórico de depósitos serão apagados. Seus lançamentos não mudam.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => { await deleteGoal(db, goalId); router.back(); } },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: g.name,
          headerRight: () => (
            <Pressable accessibilityLabel="Editar objetivo" hitSlop={10} onPress={() => router.push({ pathname: '/goal/new', params: { id: String(g.id) } })}>
              <Icon name="create-outline" color={colors.primary} />
            </Pressable>
          ),
        }}
      />
      <Card>
        <View style={[styles.row, { marginBottom: 10 }]}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: g.color, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={g.icon} size={24} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.muted}>Guardado</Text>
            <Money cents={g.saved_cents} size={24} colored={false} />
          </View>
          <Text style={{ fontSize: 22, fontWeight: '700', color: g.color }}>{Math.round(plan.progress * 100)}%</Text>
        </View>
        <ProgressBar ratio={plan.progress} color={g.color} />
        <View style={[styles.row, { justifyContent: 'space-between', marginTop: 8 }]}>
          <Text style={styles.muted}>Meta: {formatBRL(g.target_cents)}</Text>
          <Text style={styles.muted}>Faltam: {formatBRL(plan.remainingCents)}</Text>
        </View>
        <Text style={[styles.muted, { marginTop: 4 }]}>
          Prazo: {g.deadline ? monthLabel(g.deadline, true) : 'sem prazo'}
          {plan.monthsLeft ? ` (${plan.monthsLeft} ${plan.monthsLeft === 1 ? 'mês' : 'meses'})` : ''}
        </Text>
      </Card>

      <Card>
        <SectionTitle>Plano</SectionTitle>
        {plan.monthlyNeededCents && plan.status !== 'done' ? (
          <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 8 }]}>
            <Text style={{ color: colors.text }}>Guardar por mês</Text>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 17 }}>{formatBRL(plan.monthlyNeededCents)}</Text>
          </View>
        ) : null}
        {pace ? (
          <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 8 }]}>
            <Text style={{ color: colors.text }}>Seu ritmo (últimos 3 meses)</Text>
            <Text style={{ color: colors.text }}>{formatBRL(pace)}/mês</Text>
          </View>
        ) : null}
        {plan.etaMonth && plan.status !== 'done' ? (
          <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 8 }]}>
            <Text style={{ color: colors.text }}>Previsão no ritmo atual</Text>
            <Text style={{ color: colors.text }}>{monthLabel(plan.etaMonth, true)}</Text>
          </View>
        ) : null}
        <Text style={{ color: d.color }}>{d.text}</Text>
      </Card>

      {plan.status !== 'done' || g.saved_cents > 0 ? (
        <Card>
          <SectionTitle>Registrar</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <Chip label="Guardei" active={kind === 'in'} onPress={() => setKind('in')} />
            <Chip label="Retirei" active={kind === 'out'} onPress={() => setKind('out')} color={colors.expense} />
          </View>
          <Field label="Valor (R$)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
          <Field label="Observação" value={note} onChangeText={setNote} placeholder="Opcional" />
          <Button title={kind === 'in' ? 'Adicionar depósito' : 'Registrar retirada'} icon={kind === 'in' ? 'add' : 'remove'} onPress={add} loading={busy} />
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Histórico</SectionTitle>
        {data.entries.length ? data.entries.map((e) => (
          <View key={e.id} style={[styles.row, { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text }}>{formatDateBR(e.date)}</Text>
              {e.note ? <Text style={styles.muted} numberOfLines={2}>{e.note}</Text> : null}
            </View>
            <Money cents={e.amount_cents} />
            <Pressable accessibilityLabel="Excluir registro" hitSlop={10} onPress={() => removeEntry(e.id)}>
              <Icon name="trash-outline" size={18} color={colors.muted} />
            </Pressable>
          </View>
        )) : <Text style={styles.muted}>Nenhum depósito ainda. Registre aqui sempre que guardar dinheiro para este objetivo.</Text>}
      </Card>

      <Button title="Excluir objetivo" variant="danger" icon="trash" onPress={remove} />
    </ScrollView>
  );
}
