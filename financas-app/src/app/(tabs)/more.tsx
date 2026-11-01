import { File, Paths } from 'expo-file-system';
import { router, type Href } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { exportCsv, reclassifyAll } from '../../db/repo';
import { Card, colors, Icon, styles, todayIso, type IconName } from '../../components/ui';

function Item({ icon, title, subtitle, onPress }: { icon: IconName; title: string; subtitle?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, { paddingVertical: 12, opacity: pressed ? 0.6 : 1 }]}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
        {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
      </View>
      <Icon name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

export default function More() {
  const db = useSQLiteContext();
  const go = (href: Href) => () => router.push(href);

  async function doExport() {
    try {
      const csv = await exportCsv(db);
      const file = new File(Paths.cache, `lancamentos-${todayIso()}.csv`);
      if (file.exists) file.delete();
      file.create();
      await file.write(`﻿${csv}`); // BOM para o Excel reconhecer acentos
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Exportar lançamentos' });
      } else {
        Alert.alert('Arquivo gerado', file.uri);
      }
    } catch (e) {
      Alert.alert('Erro ao exportar', (e as Error).message);
    }
  }

  async function doReclassify() {
    const n = await reclassifyAll(db);
    Alert.alert('Reclassificação concluída', n ? `${n} lançamento(s) receberam nova categoria.` : 'Nenhum lançamento mudou de categoria.');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Item icon="card" title="Contas e cartões" subtitle="Saldos, saldo inicial e tipos de conta" onPress={go('/accounts')} />
        <Item icon="pricetags" title="Categorias" subtitle="Crie, edite e organize subcategorias" onPress={go('/categories')} />
        <Item icon="git-branch" title="Regras de classificação" subtitle="Palavras-chave que definem a categoria" onPress={go('/rules')} />
        <Item icon="time" title="Histórico de importações" subtitle="Veja ou desfaça importações" onPress={go('/imports')} />
      </Card>
      <Card>
        <Item icon="refresh" title="Reclassificar lançamentos" subtitle="Aplica as regras atuais aos lançamentos não ajustados à mão" onPress={doReclassify} />
        <Item icon="share" title="Exportar CSV" subtitle="Todos os lançamentos com categoria, para Excel/Planilhas" onPress={doExport} />
      </Card>
      <Text style={[styles.muted, { textAlign: 'center' }]}>
        Seus dados ficam apenas neste aparelho. Nenhum extrato é enviado para servidores.
      </Text>
    </ScrollView>
  );
}
