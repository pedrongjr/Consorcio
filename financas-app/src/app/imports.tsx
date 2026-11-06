import { useDb } from '../db/DbProvider';
import { ScrollView, Text, View } from 'react-native';
import { showAlert } from '../lib/dialog';
import { listImports, undoImport, type ImportRecord } from '../db/repo';
import { useAsyncData } from '../lib/useAsyncData';
import { Button, Card, colors, EmptyState, styles } from '../components/ui';

export default function Imports() {
  const db = useDb();
  const { data, reload } = useAsyncData(() => listImports(db), [db]);

  function undo(i: ImportRecord) {
    showAlert('Desfazer importação?', `Os ${i.imported_count} lançamento(s) importados de “${i.file_name}” serão excluídos.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Desfazer', style: 'destructive', onPress: async () => { await undoImport(db, i.id); reload(); } },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {data?.length ? data.map((i) => (
        <Card key={i.id}>
          <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={2}>{i.file_name}</Text>
          <Text style={styles.muted}>{i.account_name} · {i.format.toUpperCase()} · {i.created_at.slice(0, 16).replace('T', ' ')} (UTC)</Text>
          <View style={[styles.row, { justifyContent: 'space-between', marginTop: 8 }]}>
            <Text style={{ color: colors.text }}>{i.imported_count} importados{i.skipped_count ? ` · ${i.skipped_count} ignorados` : ''}</Text>
            <Button title="Desfazer" variant="danger" onPress={() => undo(i)} />
          </View>
        </Card>
      )) : <EmptyState icon="time-outline" title="Nenhuma importação ainda" />}
    </ScrollView>
  );
}
