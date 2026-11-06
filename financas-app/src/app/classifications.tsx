import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useDb } from '../db/DbProvider';
import { showAlert } from '../lib/dialog';
import {
  ACTION_LABEL, listCategories, listClassificationLog, undoClassification, type ClassificationLogEntry,
} from '../db/repo';
import { useAsyncData } from '../lib/useAsyncData';
import { Button, Card, CategoryBadge, colors, EmptyState, styles } from '../components/ui';

/** Data/hora local a partir do registro (gravado em UTC). */
function when(iso: string): string {
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function Classifications() {
  const db = useDb();
  const { data, reload } = useAsyncData(async () => {
    const [log, cats] = await Promise.all([listClassificationLog(db), listCategories(db)]);
    return { log, cats };
  }, [db]);
  const catMap = useMemo(() => new Map((data?.cats ?? []).map((c) => [c.key, c])), [data?.cats]);

  function undo(e: ClassificationLogEntry) {
    const parts = [`${e.tx_count} lançamento(s) voltam para a categoria anterior.`];
    if (e.rule_pattern) parts.push(`A regra “${e.rule_pattern}” também será desfeita.`);
    parts.push('Lançamentos que você alterou depois disso não são mexidos.');
    showAlert('Desfazer?', parts.join(' '), [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desfazer',
        style: 'destructive',
        onPress: async () => {
          try {
            const n = await undoClassification(db, e.id);
            reload();
            showAlert('Desfeito', `${n} lançamento(s) voltaram para a categoria anterior.`);
          } catch (err) {
            showAlert('Não foi possível desfazer', (err as Error).message);
          }
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.muted}>
        Cada mudança de categoria (na lista, no lançamento, por semelhança ou por regra) fica registrada aqui e pode ser desfeita.
      </Text>
      {data?.log.length ? data.log.map((e) => {
        const c = e.category_key ? catMap.get(e.category_key) : undefined;
        return (
          <Card key={e.id} style={e.undone ? { opacity: 0.55 } : undefined}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{ACTION_LABEL[e.action] ?? e.action}</Text>
            <Text style={{ color: colors.text }} numberOfLines={2}>{e.label}</Text>
            <View style={[styles.row, { gap: 6, flexWrap: 'wrap', marginTop: 4 }]}>
              {c ? <CategoryBadge name={c.name} icon={c.icon} color={c.color} /> : null}
              {e.rule_pattern ? <Text style={styles.muted}>regra “{e.rule_pattern}”</Text> : null}
            </View>
            <View style={[styles.row, { justifyContent: 'space-between', marginTop: 8 }]}>
              <Text style={styles.muted}>
                {when(e.created_at)} · {e.tx_count} lançamento(s){e.undone ? ' · desfeito' : ''}
              </Text>
              {!e.undone ? <Button title="Desfazer" variant="danger" onPress={() => undo(e)} /> : null}
            </View>
          </Card>
        );
      }) : <EmptyState icon="arrow-undo-outline" title="Nenhuma alteração ainda" text="Mudanças de categoria aparecerão aqui." />}
    </ScrollView>
  );
}
