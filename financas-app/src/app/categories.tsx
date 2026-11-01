import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { CategoryKind } from '../core/types';
import { deleteCategory, listCategories, saveCategory, type Category } from '../db/repo';
import { useAsyncData } from '../lib/useAsyncData';
import { Button, Card, Chip, colors, Field, Icon, SectionTitle, styles } from '../components/ui';

const KINDS: { kind: CategoryKind; label: string }[] = [
  { kind: 'expense', label: 'Despesas' },
  { kind: 'income', label: 'Receitas' },
  { kind: 'transfer', label: 'Transferências' },
];
const ICONS = ['pricetag', 'cart', 'restaurant', 'home', 'car', 'medkit', 'school', 'happy', 'bag-handle', 'paw', 'gift', 'airplane', 'barbell', 'book', 'briefcase', 'cash', 'heart', 'construct', 'game-controller', 'wallet'];
const COLORS = ['#E4572E', '#29335C', '#F3A712', '#2E86AB', '#6A4C93', '#1B998B', '#C5283D', '#D88C9A', '#7D7D7D', '#2A9D8F', '#457B9D', '#90BE6D'];

interface Draft { key?: string; name: string; kind: CategoryKind; parent: string | null; icon: string; color: string }

export default function Categories() {
  const db = useSQLiteContext();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [draft, setDraft] = useState<Draft | null>(null);
  const { data: cats, reload } = useAsyncData(() => listCategories(db), [db]);

  const roots = (cats ?? []).filter((c) => c.kind === kind && !c.parent);
  const childrenOf = (k: string) => (cats ?? []).filter((c) => c.parent === k);

  async function save() {
    if (!draft?.name.trim()) return Alert.alert('Informe o nome');
    await saveCategory(db, { ...draft, name: draft.name.trim() });
    setDraft(null);
    reload();
  }

  function remove(c: Draft) {
    Alert.alert(`Excluir “${c.name}”?`, 'Subcategorias também serão excluídas. Os lançamentos ficarão sem categoria.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => { await deleteCategory(db, c.key!); setDraft(null); reload(); } },
    ]);
  }

  const edit = (c: Category) => setDraft({ key: c.key, name: c.name, kind: c.kind, parent: c.parent, icon: c.icon, color: c.color });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {KINDS.map((k) => <Chip key={k.kind} label={k.label} active={kind === k.kind} onPress={() => setKind(k.kind)} />)}
      </View>
      {roots.map((r) => (
        <Card key={r.key}>
          <Pressable onPress={() => edit(r)} style={[styles.row, { marginBottom: 6 }]}>
            <Icon name={r.icon} color={r.color} />
            <Text style={{ flex: 1, fontWeight: '700', color: colors.text }}>{r.name}</Text>
            <Icon name="create-outline" size={16} color={colors.muted} />
          </Pressable>
          {childrenOf(r.key).map((c) => (
            <Pressable key={c.key} onPress={() => edit(c)} style={[styles.row, { paddingVertical: 6, paddingLeft: 32 }]}>
              <Text style={{ flex: 1, color: colors.text }}>{c.name}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setDraft({ name: '', kind: r.kind, parent: r.key, icon: r.icon, color: r.color })} style={{ paddingLeft: 32, paddingVertical: 6 }}>
            <Text style={{ color: colors.primary }}>+ Subcategoria</Text>
          </Pressable>
        </Card>
      ))}
      <Button title="Nova categoria" icon="add" onPress={() => setDraft({ name: '', kind, parent: null, icon: 'pricetag', color: COLORS[0] })} />

      <Modal visible={!!draft} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDraft(null)}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionTitle right={<Pressable onPress={() => setDraft(null)} hitSlop={12}><Icon name="close" size={24} /></Pressable>}>
            {draft?.key ? 'Editar categoria' : draft?.parent ? 'Nova subcategoria' : 'Nova categoria'}
          </SectionTitle>
          {draft ? (
            <>
              <Field label="Nome" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
              {!draft.parent ? (
                <>
                  <Text style={styles.label}>Ícone</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                    {ICONS.map((i) => (
                      <Pressable key={i} onPress={() => setDraft({ ...draft, icon: i })}
                        style={{ padding: 8, borderRadius: 8, backgroundColor: draft.icon === i ? colors.primaryLight : '#fff' }}>
                        <Icon name={i} color={draft.color} />
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.label}>Cor</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                    {COLORS.map((c) => (
                      <Pressable key={c} onPress={() => setDraft({ ...draft, color: c })}
                        style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: draft.color === c ? 3 : 0, borderColor: colors.text }} />
                    ))}
                  </View>
                </>
              ) : null}
              <Button title="Salvar" onPress={save} />
              {draft.key ? <Button title="Excluir" variant="danger" onPress={() => remove(draft)} /> : null}
            </>
          ) : null}
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}
