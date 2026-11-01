import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { parseAmount, parseDate } from '../../core/text';
import { formatDateBR } from '../../core/reports';
import { addManualTransaction, listAccounts, listCategories, type AccountWithBalance, type Category } from '../../db/repo';
import { CategoryPicker } from '../../components/CategoryPicker';
import { Button, Card, CategoryBadge, Chip, colors, Field, styles, todayIso } from '../../components/ui';

export default function NewTransaction() {
  const db = useSQLiteContext();
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [type, setType] = useState<'out' | 'in'>('out');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(formatDateBR(todayIso()));
  const [description, setDescription] = useState('');
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    Promise.all([listAccounts(db), listCategories(db)]).then(([a, c]) => {
      setAccounts(a); setCats(c);
      if (a.length) setAccountId(a[0].id);
    });
  }, [db]);

  async function save() {
    const cents = parseAmount(amount);
    const iso = parseDate(date);
    if (!accountId) return Alert.alert('Cadastre uma conta antes', 'Vá em Mais → Contas e cartões.');
    if (!cents) return Alert.alert('Informe o valor');
    if (!iso) return Alert.alert('Data inválida', 'Use o formato dd/mm/aaaa.');
    if (!description.trim()) return Alert.alert('Informe a descrição');
    await addManualTransaction(db, {
      accountId, date: iso, description: description.trim(),
      amountCents: type === 'out' ? -Math.abs(cents) : Math.abs(cents), categoryKey,
    });
    router.back();
  }

  const cat = cats.find((c) => c.key === categoryKey);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <Chip label="Despesa" active={type === 'out'} color={colors.expense} onPress={() => setType('out')} />
          <Chip label="Receita" active={type === 'in'} color={colors.income} onPress={() => setType('in')} />
        </View>
        <Field label="Valor (R$)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
        <Field label="Data" value={date} onChangeText={setDate} placeholder="dd/mm/aaaa" keyboardType="numbers-and-punctuation" />
        <Field label="Descrição" value={description} onChangeText={setDescription} placeholder="Ex.: Feira, dentista" />
        <Text style={styles.label}>Categoria</Text>
        <Pressable onPress={() => setPicker(true)} style={[styles.input, { marginBottom: 12 }]}>
          {cat ? <CategoryBadge name={cat.name} icon={cat.icon} color={cat.color} /> : <Text style={styles.muted}>Escolher categoria</Text>}
        </Pressable>
        <Text style={styles.label}>Conta</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {accounts.map((a) => <Chip key={a.id} label={a.name} active={accountId === a.id} color={a.color} onPress={() => setAccountId(a.id)} />)}
        </View>
      </Card>
      <Button title="Salvar" icon="checkmark" onPress={save} />
      <CategoryPicker
        visible={picker}
        categories={cats}
        selected={categoryKey}
        initialKind={type === 'in' ? 'income' : 'expense'}
        onClose={() => setPicker(false)}
        onSelect={(k) => { setCategoryKey(k); setPicker(false); }}
      />
    </ScrollView>
  );
}
