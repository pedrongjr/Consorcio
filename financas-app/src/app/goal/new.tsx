import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { GOAL_TEMPLATES, planGoal, type GoalTemplate } from '../../core/goals';
import { formatBRL, monthLabel, shiftMonth } from '../../core/reports';
import { parseAmount } from '../../core/text';
import { useDb } from '../../db/DbProvider';
import { addGoalEntry, getGoal, listAccounts, saveGoal, type AccountWithBalance } from '../../db/repo';
import { showAlert } from '../../lib/dialog';
import { planningContext, type PlanningContext } from '../../lib/planning';
import { MonthPicker } from '../../components/MonthPicker';
import { HowToReachCard } from '../../components/HowToReach';
import { Button, Card, Chip, colors, currentMonth, Field, Icon, styles, todayIso } from '../../components/ui';

/** Cria (escolhendo um modelo) ou edita (`?id=`) um objetivo. */
export default function GoalForm() {
  const db = useDb();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = id ? Number(id) : undefined;
  const [template, setTemplate] = useState<GoalTemplate | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [initial, setInitial] = useState('');
  const [deadline, setDeadline] = useState<string | null>(shiftMonth(currentMonth(), 11));
  const [picking, setPicking] = useState(false);
  const [ctx, setCtx] = useState<PlanningContext | null>(null);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    listAccounts(db).then((a) => { if (alive) setAccounts(a); }).catch(() => undefined);
    planningContext(db).then(async (c) => {
      if (!alive) return;
      setCtx(c);
      if (editingId) {
        const g = await getGoal(db, editingId, c.since);
        if (!g || !alive) return;
        setTemplate(GOAL_TEMPLATES.find((t) => t.key === g.template) ?? { ...GOAL_TEMPLATES[GOAL_TEMPLATES.length - 1], icon: g.icon, color: g.color });
        setName(g.name);
        setTarget(formatBRL(g.target_cents).replace('R$ ', ''));
        setDeadline(g.deadline);
        setAccountId(g.account_id ?? null);
      }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [db, editingId]);

  function choose(t: GoalTemplate) {
    setTemplate(t);
    setName(t.key === 'outro' ? '' : t.name);
  }

  const targetCents = target.trim() ? Math.abs(parseAmount(target) ?? 0) : 0;
  const initialCents = initial.trim() ? Math.abs(parseAmount(initial) ?? 0) : 0;
  const preview = targetCents && ctx
    ? planGoal({ targetCents, savedCents: initialCents, deadline, month: ctx.month, avgSurplusCents: ctx.avgSurplus })
    : null;

  async function save() {
    if (!template || saving) return;
    if (!name.trim()) return showAlert('Dê um nome ao sonho');
    if (!targetCents) return showAlert('Informe quanto você precisa juntar');
    setSaving(true);
    try {
      const goalId = await saveGoal(db, {
        id: editingId, name: name.trim(), template: template.key, icon: template.icon, color: template.color,
        target_cents: targetCents, deadline, account_id: accountId,
      });
      if (!editingId && initialCents) await addGoalEntry(db, goalId, { date: todayIso(), amountCents: initialCents, note: 'Valor que já tinha guardado', initial: true });
      if (editingId) router.back();
      else router.replace({ pathname: '/goal/[id]', params: { id: String(goalId) } });
    } catch (e) {
      showAlert('Não foi possível salvar', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!template) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: 'Novo sonho' }} />
        <Card>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>Quer realizar seus sonhos?</Text>
          <Text style={[styles.muted, { marginTop: 4 }]}>Veja como chegar lá. Comece escolhendo uma das opções abaixo.</Text>
        </Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {GOAL_TEMPLATES.map((t) => (
            <Pressable
              key={t.key}
              accessibilityRole="button"
              onPress={() => choose(t)}
              style={({ pressed }) => ({
                flexGrow: 1, flexBasis: '45%', backgroundColor: colors.card, borderRadius: 14, overflow: 'hidden',
                borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1,
              })}
            >
              <View style={{ backgroundColor: t.color, height: 84, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF33', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={t.icon} size={30} color="#fff" />
                </View>
              </View>
              <Text style={{ textAlign: 'center', fontWeight: '700', color: colors.text, padding: 10 }}>{t.name}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: editingId ? 'Editar sonho' : template.name }} />
      <Card>
        <View style={[styles.row, { marginBottom: 12 }]}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: template.color, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={template.icon} size={22} color="#fff" />
          </View>
          <Text style={[styles.muted, { flex: 1 }]}>{template.hint}</Text>
          {!editingId ? (
            <Pressable onPress={() => setTemplate(null)} hitSlop={8}>
              <Text style={{ color: colors.primary }}>Trocar</Text>
            </Pressable>
          ) : null}
        </View>
        <Field label="Nome do sonho" value={name} onChangeText={setName} placeholder="Ex.: Viagem para o Nordeste" />
        <Field label="Quanto precisa juntar (R$)" value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="0,00" />
        {!editingId ? (
          <Field label="Quanto já tem guardado (R$)" value={initial} onChangeText={setInitial} keyboardType="decimal-pad" placeholder="0,00 (opcional)" />
        ) : null}
        <Text style={styles.label}>Até quando</Text>
        <Pressable onPress={() => setPicking(true)} style={[styles.input, styles.row, { justifyContent: 'space-between', marginBottom: 4 }]}>
          <Text style={{ color: colors.text }}>{deadline ? monthLabel(deadline, true) : 'Sem prazo'}</Text>
          <Icon name="calendar-outline" size={18} color={colors.primary} />
        </Pressable>
        {accounts.length ? (
          <>
            <Text style={[styles.label, { marginTop: 12 }]}>Conta onde vai guardar (opcional)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {accounts.map((a) => (
                <Chip key={a.id} label={a.name} active={accountId === a.id} color={a.color} onPress={() => setAccountId(accountId === a.id ? null : a.id)} />
              ))}
            </View>
            <Text style={[styles.muted, { marginTop: 6 }]}>
              {accountId
                ? 'Tudo que entrar ou sair desta conta a partir de hoje conta automaticamente como depósito ou retirada do sonho. Ideal para uma poupança ou investimento separado.'
                : 'Vinculando uma conta (poupança, investimento), os depósitos são registrados sozinhos a cada extrato importado.'}
            </Text>
          </>
        ) : null}
      </Card>

      {preview && preview.status !== 'done' ? (
        <Card>
          {preview.monthlyNeededCents ? (
            <>
              <Text style={styles.muted}>Você precisa guardar por mês</Text>
              <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text }}>{formatBRL(preview.monthlyNeededCents)}</Text>
              <Text style={styles.muted}>durante {preview.monthsLeft} {preview.monthsLeft === 1 ? 'mês' : 'meses'}</Text>
            </>
          ) : <Text style={styles.muted}>Sem prazo: o app mostrará a previsão conforme você guardar.</Text>}
          {ctx?.avgSurplus !== null && ctx?.avgSurplus !== undefined && preview.monthlyNeededCents ? (
            <Text style={{
              marginTop: 8,
              color: preview.status === 'ok' ? colors.income : preview.status === 'tight' ? colors.warning : colors.expense,
            }}
            >
              {ctx.avgSurplus <= 0
                ? 'Nos últimos meses as despesas superaram as receitas.'
                : `Sua sobra média é de ${formatBRL(ctx.avgSurplus)}/mês` +
                  (preview.status === 'ok' ? ' — cabe com folga.' : preview.status === 'tight' ? ' — fica apertado.' : ' — não cabe; aumente o prazo.')}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {preview && preview.status !== 'done' && preview.monthlyNeededCents && ctx ? (
        <HowToReachCard monthlyCents={preview.monthlyNeededCents} ctx={ctx} accountName={accounts.find((a) => a.id === accountId)?.name} />
      ) : null}

      <Button title={editingId ? 'Salvar' : 'Criar sonho'} icon="checkmark" onPress={save} loading={saving} />

      <MonthPicker
        visible={picking}
        title="Prazo do sonho"
        value={deadline ?? shiftMonth(currentMonth(), 11)}
        onClose={() => setPicking(false)}
        onSelect={(m) => { setDeadline(m); setPicking(false); }}
        onClear={() => { setDeadline(null); setPicking(false); }}
        clearLabel="Sem prazo"
      />
    </ScrollView>
  );
}
