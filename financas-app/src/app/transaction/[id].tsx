import { router, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../db/DbProvider';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { showAlert } from '../../lib/dialog';
import { suggestRulePattern } from '../../core/classifier';
import { formatDateBR } from '../../core/reports';
import {
  applyCategoryToSimilar, deleteTransaction, getTransaction, listCategories, saveRule, updateTransaction,
  type Category, type Transaction,
} from '../../db/repo';
import { CategoryPicker } from '../../components/CategoryPicker';
import { Button, Card, CategoryBadge, colors, Field, Money, styles } from '../../components/ui';

const SOURCE_LABEL: Record<string, string> = {
  user: 'definida por você', rule: 'classificação automática', history: 'aprendida de lançamentos anteriores', none: 'não identificada',
};

export default function TransactionDetail() {
  const db = useDb();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tx, setTx] = useState<Transaction | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [description, setDescription] = useState('');
  const [picker, setPicker] = useState(false);
  const [applySimilar, setApplySimilar] = useState(true);
  const [createRule, setCreateRule] = useState(false);
  const [pattern, setPattern] = useState('');

  useEffect(() => {
    (async () => {
      const [t, c] = await Promise.all([getTransaction(db, Number(id)), listCategories(db)]);
      setTx(t); setCats(c);
      if (t) {
        setCategoryKey(t.category_key);
        setNotes(t.notes ?? '');
        setDescription(t.description);
        setPattern(suggestRulePattern(t.description));
      }
    })();
  }, [db, id]);

  if (!tx) return <View style={styles.screen} />;
  const cat = cats.find((c) => c.key === categoryKey);
  const categoryChanged = categoryKey !== tx.category_key;

  async function save() {
    if (!tx) return;
    await updateTransaction(db, tx.id, {
      category_key: categoryChanged || tx.category_source !== 'user' ? categoryKey : undefined,
      notes: notes.trim() || null,
      description: description.trim() && description.trim() !== tx.description ? description.trim() : undefined,
    });
    const msgs: string[] = [];
    if (categoryKey && categoryChanged && applySimilar) {
      const n = await applyCategoryToSimilar(db, tx.id, categoryKey);
      if (n) msgs.push(`${n} lançamento(s) semelhante(s) também foram atualizados.`);
    }
    if (categoryKey && createRule && pattern.trim()) {
      await saveRule(db, pattern, categoryKey, tx.amount_cents >= 0 ? 'in' : 'out');
      msgs.push(`Regra criada: “${pattern.trim().toUpperCase()}” → ${cat?.name}. Será usada nas próximas importações.`);
    }
    if (msgs.length) showAlert('Salvo', msgs.join('\n\n'));
    router.back();
  }

  function remove() {
    showAlert('Excluir lançamento?', 'Esta ação não pode ser desfeita.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => { await deleteTransaction(db, tx!.id); router.back(); } },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Money cents={tx.amount_cents} size={28} />
        <Text style={[styles.muted, { marginTop: 4 }]}>{formatDateBR(tx.date)} · {tx.account_name}</Text>
        {tx.memo ? <Text style={[styles.muted, { marginTop: 4 }]}>{tx.memo}</Text> : null}
      </Card>

      <Card>
        <Text style={styles.label}>Categoria</Text>
        <Pressable onPress={() => setPicker(true)} style={[styles.input, styles.row, { justifyContent: 'space-between' }]}>
          {cat ? <CategoryBadge name={cat.name} icon={cat.icon} color={cat.color} /> : <Text style={styles.muted}>Escolher categoria</Text>}
          <Text style={{ color: colors.primary }}>Alterar</Text>
        </Pressable>
        <Text style={[styles.muted, { marginTop: 4 }]}>Origem: {categoryChanged ? SOURCE_LABEL.user : SOURCE_LABEL[tx.category_source] ?? '-'}</Text>

        {categoryChanged ? (
          <View style={{ marginTop: 12, gap: 10 }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={{ color: colors.text, flex: 1 }}>Aplicar aos lançamentos com a mesma descrição</Text>
              <Switch value={applySimilar} onValueChange={setApplySimilar} />
            </View>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={{ color: colors.text, flex: 1 }}>Criar regra para próximas importações</Text>
              <Switch value={createRule} onValueChange={setCreateRule} />
            </View>
            {createRule ? (
              <Field
                label="Quando a descrição contiver"
                value={pattern}
                onChangeText={setPattern}
                autoCapitalize="characters"
              />
            ) : null}
          </View>
        ) : null}
      </Card>

      <Card>
        <Field label="Descrição" value={description} onChangeText={setDescription} />
        <Field label="Observações" value={notes} onChangeText={setNotes} multiline placeholder="Opcional" style={{ minHeight: 70 }} />
      </Card>

      <Button title="Salvar" icon="checkmark" onPress={save} />
      <Button title="Excluir lançamento" variant="danger" icon="trash" onPress={remove} />

      <CategoryPicker
        visible={picker}
        categories={cats}
        selected={categoryKey}
        initialKind={cat?.kind ?? (tx.amount_cents >= 0 ? 'income' : 'expense')}
        onClose={() => setPicker(false)}
        onSelect={(k) => { setCategoryKey(k); setPicker(false); }}
      />
    </ScrollView>
  );
}
