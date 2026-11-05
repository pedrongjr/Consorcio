import { router } from 'expo-router';
import { useDb } from '../db/DbProvider';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { showAlert } from '../lib/dialog';
import { parseAmount } from '../core/text';
import { ACCOUNT_TYPES, deleteAccount, detectTransfers, listAccounts, saveAccount, type AccountType, type AccountWithBalance } from '../db/repo';
import { useAsyncData } from '../lib/useAsyncData';
import { Button, Card, Chip, colors, EmptyState, Field, Icon, Money, SectionTitle, styles } from '../components/ui';

const COLORS = ['#2A9D8F', '#E76F51', '#264653', '#8338EC', '#FB8500', '#3A86FF', '#C62828', '#6D597A'];

interface Draft { id?: number; name: string; type: AccountType; initial: string; color: string }

export default function Accounts() {
  const db = useDb();
  const { data, reload } = useAsyncData(() => listAccounts(db), [db]);
  const [draft, setDraft] = useState<Draft | null>(null);

  async function save() {
    if (!draft?.name.trim()) return showAlert('Informe o nome');
    await saveAccount(db, {
      id: draft.id, name: draft.name.trim(), type: draft.type, color: draft.color,
      initial_balance_cents: parseAmount(draft.initial || '0') ?? 0,
    });
    setDraft(null);
    reload();
  }

  function remove(a: AccountWithBalance) {
    showAlert(`Excluir “${a.name}”?`, `Os ${a.tx_count} lançamento(s) desta conta também serão excluídos.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => { await deleteAccount(db, a.id); setDraft(null); reload(); } },
    ]);
  }

  async function findTransfers() {
    try {
      const n = await detectTransfers(db);
      showAlert(
        n ? `${n} transferência(s) encontrada(s)` : 'Nenhuma transferência nova',
        n
          ? 'Saídas e entradas de mesmo valor entre suas contas foram ligadas e marcadas como transferência (não contam como gasto nem receita).'
          : 'Para indicar uma transferência à mão, abra o lançamento, escolha a categoria “Transferências entre contas” e a outra conta.',
      );
      reload();
    } catch (e) {
      showAlert('Não foi possível procurar', (e as Error).message);
    }
  }

  const edit = (a: AccountWithBalance) =>
    setDraft({ id: a.id, name: a.name, type: a.type, color: a.color, initial: (a.initial_balance_cents / 100).toFixed(2).replace('.', ',') });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {data?.length ? (
        <Card>
          {data.map((a) => (
            <Pressable key={a.id} onPress={() => edit(a)} style={[styles.row, { paddingVertical: 10 }]}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: a.color }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{a.name}</Text>
                <Text style={styles.muted}>{ACCOUNT_TYPES.find((t) => t.value === a.type)?.label} · {a.tx_count} lançamentos</Text>
              </View>
              <Money cents={a.balance_cents} />
              <Pressable accessibilityLabel={`Ver lançamentos de ${a.name}`} hitSlop={10}
                onPress={() => router.push({ pathname: '/transactions', params: { account: String(a.id) } })}>
                <Icon name="list" size={20} color={colors.primary} />
              </Pressable>
            </Pressable>
          ))}
          {data.length > 1 ? (
            <View style={[styles.row, { paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }]}>
              <Text style={{ flex: 1, color: colors.text, fontWeight: '700' }}>Todas as contas</Text>
              <Money cents={data.reduce((s, a) => s + a.balance_cents, 0)} />
              <Pressable accessibilityLabel="Ver lançamentos de todas as contas" hitSlop={10}
                onPress={() => router.push({ pathname: '/transactions', params: { account: '' } })}>
                <Icon name="list" size={20} color={colors.primary} />
              </Pressable>
            </View>
          ) : null}
        </Card>
      ) : (
        <EmptyState icon="card-outline" title="Nenhuma conta" text="As contas também são criadas ao importar um extrato." />
      )}
      <Button title="Nova conta" icon="add" onPress={() => setDraft({ name: '', type: 'checking', initial: '', color: COLORS[(data?.length ?? 0) % COLORS.length] })} />
      {(data?.length ?? 0) > 1 ? (
        <Button title="Procurar transferências entre contas" icon="swap-horizontal" variant="secondary" onPress={findTransfers} />
      ) : null}
      <Text style={[styles.muted, { textAlign: 'center' }]}>
        Saldo = saldo inicial + soma dos lançamentos. Ajuste o saldo inicial para bater com o extrato do banco.
      </Text>

      <Modal visible={!!draft} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDraft(null)}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionTitle right={<Pressable onPress={() => setDraft(null)} hitSlop={12}><Icon name="close" size={24} /></Pressable>}>
            {draft?.id ? 'Editar conta' : 'Nova conta'}
          </SectionTitle>
          {draft ? (
            <>
              <Field label="Nome" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
              <Text style={styles.label}>Tipo</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {ACCOUNT_TYPES.map((t) => <Chip key={t.value} label={t.label} active={draft.type === t.value} onPress={() => setDraft({ ...draft, type: t.value })} />)}
              </View>
              <Field
                label={draft.type === 'credit_card' ? 'Saldo inicial (use negativo para fatura em aberto)' : 'Saldo inicial (R$)'}
                value={draft.initial}
                onChangeText={(initial) => setDraft({ ...draft, initial })}
                keyboardType="numbers-and-punctuation"
                placeholder="0,00"
              />
              <Text style={styles.label}>Cor</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                {COLORS.map((c) => (
                  <Pressable key={c} onPress={() => setDraft({ ...draft, color: c })}
                    style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: draft.color === c ? 3 : 0, borderColor: colors.text }} />
                ))}
              </View>
              <Button title="Salvar" onPress={save} />
              {draft.id ? <Button title="Excluir conta" variant="danger" onPress={() => remove(data!.find((a) => a.id === draft.id)!)} /> : null}
            </>
          ) : null}
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}
