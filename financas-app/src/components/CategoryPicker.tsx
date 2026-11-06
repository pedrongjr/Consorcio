import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CategoryKind } from '../core/types';
import type { Category } from '../db/repo';
import { normalizeText } from '../core/text';
import { Chip, colors, Icon, styles } from './ui';

const KINDS: { kind: CategoryKind; label: string }[] = [
  { kind: 'expense', label: 'Despesas' },
  { kind: 'income', label: 'Receitas' },
  { kind: 'transfer', label: 'Transferências' },
];

/** Modal para escolher categoria/subcategoria, com busca. */
export function CategoryPicker({
  visible, categories, selected, initialKind = 'expense', onSelect, onClose,
}: {
  visible: boolean;
  categories: Category[];
  selected?: string | null;
  initialKind?: CategoryKind;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<CategoryKind>(initialKind);
  const [query, setQuery] = useState('');
  // Ao abrir, volta para o tipo sugerido (despesa/receita) e limpa a busca.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) { setKind(initialKind); setQuery(''); }
  }

  const items = useMemo(() => {
    const q = normalizeText(query);
    const byParent = new Map<string, Category[]>();
    for (const c of categories) if (c.parent) byParent.set(c.parent, [...(byParent.get(c.parent) ?? []), c]);
    const roots = categories.filter((c) => !c.parent && (q || c.kind === kind));
    const out: { cat: Category; child: boolean }[] = [];
    for (const r of roots) {
      const children = byParent.get(r.key) ?? [];
      const rootMatch = !q || normalizeText(r.name).includes(q);
      const kids = children.filter((c) => !q || rootMatch || normalizeText(c.name).includes(q));
      if (!rootMatch && kids.length === 0) continue;
      out.push({ cat: r, child: false });
      for (const k of kids) out.push({ cat: k, child: true });
    }
    return out;
  }, [categories, kind, query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={{ padding: 16, gap: 12 }}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Escolha a categoria</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Fechar">
              <Icon name="close" size={24} />
            </Pressable>
          </View>
          <TextInput
            placeholder="Buscar categoria"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            style={styles.input}
          />
          {!query ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {KINDS.map((k) => <Chip key={k.kind} label={k.label} active={kind === k.kind} onPress={() => setKind(k.kind)} />)}
            </View>
          ) : null}
        </View>
        <FlatList
          data={items}
          keyExtractor={(i) => i.cat.key}
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => { onSelect(item.cat.key); setQuery(''); }}
              style={({ pressed }) => [
                { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, paddingLeft: item.child ? 48 : 16 },
                { backgroundColor: selected === item.cat.key ? colors.primaryLight : pressed ? '#EEF1F4' : 'transparent' },
              ]}
            >
              <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: `${item.cat.color}22` }}>
                <Icon name={item.cat.icon} size={16} color={item.cat.color} />
              </View>
              <Text style={{ fontSize: 15, color: colors.text, fontWeight: item.child ? '400' : '600', flex: 1 }}>{item.cat.name}</Text>
              {selected === item.cat.key ? <Icon name="checkmark" color={colors.primary} /> : null}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}
