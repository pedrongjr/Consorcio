import { router, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../db/DbProvider';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { showAlert } from '../../lib/dialog';
import { isGenericText, suggestRulePattern } from '../../core/classifier';
import { formatDateBR } from '../../core/reports';
import { RULE_TOO_GENERIC } from '../../db/shared';
import {
  classifyTransaction, deleteTransaction, getTransaction, listCategories, previewRule, previewSimilar, updateTransaction,
  type Category, type RulePreview, type SimilarPreview, type Transaction,
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
  const [similar, setSimilar] = useState<SimilarPreview | null>(null);
  const [rulePreview, setRulePreview] = useState<{ pattern: string; data: RulePreview } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [t, c, sim] = await Promise.all([getTransaction(db, Number(id)), listCategories(db), previewSimilar(db, Number(id)).catch(() => null)]);
      setTx(t); setCats(c); setSimilar(sim);
      if (t) {
        setCategoryKey(t.category_key);
        setNotes(t.notes ?? '');
        setDescription(t.description);
        setPattern(suggestRulePattern(t.description, t.memo));
      }
    })();
  }, [db, id]);

  // Prévia de quantos lançamentos o padrão da regra alcança (com uma pequena espera enquanto digita).
  const direction = tx ? (tx.amount_cents >= 0 ? 'in' : 'out') : null;
  useEffect(() => {
    if (!createRule || !pattern.trim() || !direction) return;
    let alive = true;
    const p = pattern.trim();
    const timer = setTimeout(() => {
      previewRule(db, p, direction).then((data) => { if (alive) setRulePreview({ pattern: p, data }); }).catch(() => undefined);
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [db, createRule, pattern, direction]);

  if (!tx) return <View style={styles.screen} />;
  const cat = cats.find((c) => c.key === categoryKey);
  const categoryChanged = categoryKey !== tx.category_key;

  const ruleGeneric = createRule && isGenericText(pattern);
  const preview = rulePreview && rulePreview.pattern === pattern.trim() ? rulePreview.data : null;

  async function save() {
    if (!tx || saving) return;
    const wantsRule = categoryChanged && createRule && !!pattern.trim();
    if (wantsRule && ruleGeneric) return showAlert('Regra genérica demais', RULE_TOO_GENERIC);
    setSaving(true);
    try {
      await updateTransaction(db, tx.id, {
        notes: notes.trim() || null,
        description: description.trim() && description.trim() !== tx.description ? description.trim() : undefined,
      });
      const msgs: string[] = [];
      if (categoryKey && (categoryChanged || tx.category_source !== 'user')) {
        const r = await classifyTransaction(db, {
          txId: tx.id,
          categoryKey,
          applySimilar: categoryChanged && applySimilar && !!similar?.count,
          rule: wantsRule ? { pattern, direction: tx.amount_cents >= 0 ? 'in' : 'out' } : null,
        });
        if (r.similar) msgs.push(`${r.similar} lançamento(s) com a mesma descrição também foram alterados.`);
        if (wantsRule) {
          msgs.push(`Regra criada: “${pattern.trim().toUpperCase()}” → ${cat?.name}.` +
            (r.byRule ? ` ${r.byRule} lançamento(s) já importados foram reclassificados por ela.` : ' Será usada nas próximas importações.'));
        }
        if (msgs.length) msgs.push('Se algo saiu errado, desfaça em Mais › Histórico de classificações.');
      }
      if (msgs.length) showAlert('Salvo', msgs.join('\n\n'));
      router.back();
    } catch (e) {
      showAlert('Não foi possível salvar', (e as Error).message);
    } finally {
      setSaving(false);
    }
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
            {similar?.count ? (
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={{ color: colors.text, flex: 1 }}>
                  Aplicar também a {similar.count} outro(s) lançamento(s) com a mesma descrição
                </Text>
                <Switch value={applySimilar} onValueChange={setApplySimilar} />
              </View>
            ) : similar?.generic ? (
              <Text style={styles.muted}>
                A descrição é genérica (só diz o meio de pagamento), então só este lançamento será alterado.
              </Text>
            ) : null}
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={{ color: colors.text, flex: 1 }}>Criar regra para próximas importações</Text>
              <Switch value={createRule} onValueChange={setCreateRule} />
            </View>
            {createRule ? (
              <View>
                <Field
                  label="Quando a descrição contiver"
                  value={pattern}
                  onChangeText={setPattern}
                  autoCapitalize="characters"
                  placeholder="Ex.: NUCLEO CAMALEAO"
                />
                {!pattern.trim() ? (
                  <Text style={styles.muted}>Digite um trecho que identifique só este tipo de lançamento (nome de quem recebeu, da loja...).</Text>
                ) : ruleGeneric ? (
                  <Text style={{ color: colors.expense }}>{RULE_TOO_GENERIC}</Text>
                ) : preview ? (
                  <Text style={styles.muted}>
                    {preview.count
                      ? `Esse texto aparece em ${preview.count} lançamento(s) já importado(s)` +
                        (preview.examples.length ? `, como: ${preview.examples.map((e) => `“${e}”`).join(', ')}.` : '.') +
                        ' Os que você não categorizou à mão serão reclassificados.'
                      : 'Nenhum lançamento já importado contém esse texto; a regra vale para as próximas importações.'}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </Card>

      <Card>
        <Field label="Descrição" value={description} onChangeText={setDescription} />
        <Field label="Observações" value={notes} onChangeText={setNotes} multiline placeholder="Opcional" style={{ minHeight: 70 }} />
      </Card>

      <Button title="Salvar" icon="checkmark" onPress={save} loading={saving} />
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
