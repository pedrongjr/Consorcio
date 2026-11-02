import { useDb } from '../db/DbProvider';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { showAlert } from '../lib/dialog';
import { deleteRule, listCategories, listRules, reclassifyAll, saveRule } from '../db/repo';
import { useAsyncData } from '../lib/useAsyncData';
import { CategoryPicker } from '../components/CategoryPicker';
import { Button, Card, CategoryBadge, Chip, colors, EmptyState, Field, Icon, SectionTitle, styles } from '../components/ui';

export default function Rules() {
  const db = useDb();
  const { data, reload } = useAsyncData(async () => ({ rules: await listRules(db), cats: await listCategories(db) }), [db]);
  const [pattern, setPattern] = useState('');
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<'in' | 'out' | null>('out');
  const [picker, setPicker] = useState(false);
  const catMap = useMemo(() => new Map((data?.cats ?? []).map((c) => [c.key, c])), [data?.cats]);

  async function add() {
    if (!pattern.trim() || !categoryKey) return showAlert('Preencha o texto e a categoria');
    await saveRule(db, pattern, categoryKey, direction);
    setPattern(''); setCategoryKey(null);
    const n = await reclassifyAll(db);
    reload();
    if (n) showAlert('Regra criada', `${n} lançamento(s) foram reclassificados.`);
  }

  const cat = categoryKey ? catMap.get(categoryKey) : undefined;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <SectionTitle>Nova regra</SectionTitle>
        <Field label="Quando a descrição contiver" value={pattern} onChangeText={setPattern} autoCapitalize="characters" placeholder="Ex.: PADARIA BELA VISTA" />
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <Chip label="Saídas" active={direction === 'out'} onPress={() => setDirection('out')} />
          <Chip label="Entradas" active={direction === 'in'} onPress={() => setDirection('in')} />
          <Chip label="Ambos" active={direction === null} onPress={() => setDirection(null)} />
        </View>
        <Text style={styles.label}>Classificar como</Text>
        <Pressable onPress={() => setPicker(true)} style={[styles.input, { marginBottom: 12 }]}>
          {cat ? <CategoryBadge name={cat.name} icon={cat.icon} color={cat.color} /> : <Text style={styles.muted}>Escolher categoria</Text>}
        </Pressable>
        <Button title="Adicionar regra" icon="add" onPress={add} />
      </Card>

      <Text style={styles.muted}>
        Suas regras têm prioridade sobre a classificação automática. O app também aprende sozinho quando você altera a categoria de um lançamento.
      </Text>

      {data?.rules.length ? (
        <Card>
          {data.rules.map((r) => {
            const c = catMap.get(r.category_key);
            return (
              <View key={r.id} style={[styles.row, { paddingVertical: 8 }]}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{r.pattern}</Text>
                  <View style={[styles.row, { gap: 6 }]}>
                    {c ? <CategoryBadge name={c.name} icon={c.icon} color={c.color} /> : null}
                    <Text style={styles.muted}>{r.direction === 'in' ? 'entradas' : r.direction === 'out' ? 'saídas' : 'entradas e saídas'}</Text>
                  </View>
                </View>
                <Pressable hitSlop={10} accessibilityLabel="Excluir regra" onPress={async () => { await deleteRule(db, r.id); reload(); }}>
                  <Icon name="trash-outline" color={colors.expense} />
                </Pressable>
              </View>
            );
          })}
        </Card>
      ) : <EmptyState icon="git-branch-outline" title="Nenhuma regra criada" />}

      <CategoryPicker
        visible={picker}
        categories={data?.cats ?? []}
        selected={categoryKey}
        initialKind={direction === 'in' ? 'income' : 'expense'}
        onClose={() => setPicker(false)}
        onSelect={(k) => { setCategoryKey(k); setPicker(false); }}
      />
    </ScrollView>
  );
}
