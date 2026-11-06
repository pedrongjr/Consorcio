import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useDb } from '../db/DbProvider';
import { getHolder, saveHolder } from '../db/repo';
import { showAlert } from '../lib/dialog';
import { useAsyncData } from '../lib/useAsyncData';
import { Button, Card, Field, styles } from '../components/ui';

/**
 * Titular das contas: com o nome e/ou CPF, PIX e TED para você mesmo (de uma
 * conta sua para outra) viram transferência e não contam como gasto/receita.
 */
export default function HolderScreen() {
  const db = useDb();
  const [names, setNames] = useState<string | null>(null);
  const [cpf, setCpf] = useState('');
  const [saving, setSaving] = useState(false);
  const { data, reload } = useAsyncData(() => getHolder(db), [db]);
  const shownNames = names ?? (data?.names ?? []).join('\n');

  async function save() {
    setSaving(true);
    try {
      const r = await saveHolder(db, { names: shownNames.split('\n'), ...(cpf.trim() ? { cpf } : {}) });
      setNames(null);
      setCpf('');
      reload();
      const parts = [
        r.classified
          ? `${r.classified} lançamento(s) já importados para/de você mesmo foram marcados como transferência.`
          : 'Nenhum lançamento já importado precisou mudar.',
      ];
      if (r.linked) parts.push(`${r.linked} par(es) saída/entrada entre suas contas foram ligados.`);
      if (r.classified) parts.push('Para desfazer: Mais › Histórico de classificações.');
      showAlert('Titular salvo', parts.join('\n\n'));
    } catch (e) {
      showAlert('Não foi possível salvar', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeCpf() {
    try {
      await saveHolder(db, { names: shownNames.split('\n'), cpf: '' });
      reload();
    } catch (e) {
      showAlert('Não foi possível remover', (e as Error).message);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={{ color: '#1F2933', marginBottom: 12 }}>
          PIX, TED e DOC para ou de alguém com o seu nome ou CPF são dinheiro passando de uma conta sua para outra. O app marca esses
          lançamentos como <Text style={{ fontWeight: '700' }}>transferência</Text> (não contam como gasto nem receita) e liga a saída de
          uma conta à entrada na outra. Salário, benefícios e rendimentos em seu nome continuam como receita.
        </Text>
        <Field
          label="Seu nome (um por linha, como aparece nos extratos)"
          value={shownNames}
          onChangeText={setNames}
          multiline
          autoCapitalize="characters"
          placeholder="Ex.: FULANO DE TAL DA SILVA"
          style={{ minHeight: 80 }}
        />
        <Text style={[styles.muted, { marginBottom: 12 }]}>
          O nome é preenchido sozinho quando o extrato em PDF traz “Cliente” ou “Titular”. Basta o primeiro nome e um sobrenome; abreviações do
          banco (“DA GLO”) são reconhecidas.
        </Text>
        <Field
          label={data?.cpfMasked ? `CPF (salvo: ${data.cpfMasked})` : 'CPF (opcional)'}
          value={cpf}
          onChangeText={setCpf}
          keyboardType="number-pad"
          placeholder={data?.cpfMasked ? 'Deixe em branco para manter' : '000.000.000-00'}
        />
        <Text style={styles.muted}>
          Só os 6 dígitos do meio são guardados — os mesmos que os bancos mostram no CPF mascarado. O CPF completo não fica salvo.
        </Text>
      </Card>
      <Button title="Salvar e reclassificar" icon="checkmark" onPress={save} loading={saving} />
      {data?.cpfMasked ? <Button title="Remover CPF" variant="ghost" onPress={removeCpf} /> : null}
    </ScrollView>
  );
}
