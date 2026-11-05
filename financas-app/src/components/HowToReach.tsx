import { useState } from 'react';
import { Text, View } from 'react-native';
import { formatBRL } from '../core/reports';
import { useDb } from '../db/DbProvider';
import { setBudget } from '../db/repo';
import { showAlert } from '../lib/dialog';
import { howToReach, type PlanningContext } from '../lib/planning';
import { Button, Card, colors, Icon, SectionTitle, styles } from './ui';

/**
 * "Como chegar lá": transforma o valor mensal de um sonho em ações concretas
 * com base nas receitas e despesas — quanto da renda representa, quando
 * programar a transferência automática e onde cortar se a sobra não basta
 * (com um toque para criar os orçamentos sugeridos).
 */
export function HowToReachCard({ monthlyCents, ctx, accountName, onBudgets }: {
  monthlyCents: number;
  ctx: PlanningContext;
  /** Conta vinculada ao sonho, se houver. */
  accountName?: string | null;
  onBudgets?: () => void;
}) {
  const db = useDb();
  const [saving, setSaving] = useState(false);
  if (monthlyCents <= 0) return null;
  const h = howToReach(monthlyCents, ctx);
  // Orçamentos que de fato mudam algo (não afrouxa um limite já menor).
  const toCreate = h.cuts.cuts.filter((c) => !c.budgetCents || c.budgetCents > c.limitCents);
  const unknown = ctx.categories.find((c) => c.key === 'outros_gastos')?.avgCents ?? 0;

  async function createBudgets() {
    setSaving(true);
    try {
      for (const c of toCreate) await setBudget(db, c.key, c.limitCents);
      showAlert('Orçamentos criados', `${toCreate.length} limite(s) mensal(is) definidos. Acompanhe em Sonhos › Orçamentos.`);
      onBudgets?.();
    } catch (e) {
      showAlert('Não foi possível criar', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const steps: { icon: string; text: string }[] = [];
  if (h.incomeShare !== null) {
    steps.push({ icon: 'pie-chart-outline', text: `${formatBRL(monthlyCents)} por mês é ${Math.max(1, Math.round(h.incomeShare * 100))}% da sua receita média (${formatBRL(ctx.avgIncome ?? 0)}).` });
  }
  steps.push({
    icon: 'repeat-outline',
    text: (h.transferDay
      ? `Programe no app do banco uma transferência automática de ${formatBRL(monthlyCents)} todo dia ${h.transferDay}, logo depois que sua receita principal costuma entrar`
      : `Programe no app do banco uma transferência automática mensal de ${formatBRL(monthlyCents)} logo depois de receber`) +
      (accountName
        ? ` para ${accountName}. Ao importar o extrato, ela conta sozinha neste sonho.`
        : '. Vincule a conta de destino ao sonho (editar) para os depósitos contarem sozinhos.'),
  });

  return (
    <Card>
      <SectionTitle>Como chegar lá</SectionTitle>
      {steps.map((s, i) => (
        <View key={i} style={[styles.row, { alignItems: 'flex-start', marginBottom: 10 }]}>
          <Icon name={s.icon} size={18} color={colors.primary} />
          <Text style={{ flex: 1, color: colors.text }}>{s.text}</Text>
        </View>
      ))}
      {ctx.avgSurplus === null ? (
        <Text style={styles.muted}>Importe extratos de alguns meses para o app sugerir onde economizar.</Text>
      ) : h.gapCents <= 0 ? (
        <View style={[styles.row, { alignItems: 'flex-start' }]}>
          <Icon name="checkmark-circle-outline" size={18} color={colors.income} />
          <Text style={{ flex: 1, color: colors.text }}>Sua sobra média ({formatBRL(ctx.avgSurplus)}/mês) já cobre esse valor. O segredo é separar o dinheiro assim que ele entra.</Text>
        </View>
      ) : (
        <>
          <View style={[styles.row, { alignItems: 'flex-start', marginBottom: 8 }]}>
            <Icon name="cut-outline" size={18} color={colors.warning} />
            <Text style={{ flex: 1, color: colors.text }}>
              Faltam {formatBRL(h.gapCents)}/mês além da sua sobra média. {h.cuts.cuts.length ? 'Onde dá para economizar, pelos seus gastos dos últimos meses:' : 'Não há gastos suficientes que possam ser reduzidos; reveja o prazo ou o valor.'}
            </Text>
          </View>
          {h.cuts.cuts.map((c) => (
            <View key={c.key} style={[styles.row, { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{c.name}{c.topChild ? <Text style={styles.muted}> · sobretudo {c.topChild}</Text> : null}</Text>
                <Text style={styles.muted}>média {formatBRL(c.avgCents)} → limite {formatBRL(c.limitCents)}</Text>
              </View>
              <Text style={{ color: colors.income, fontWeight: '700' }}>−{formatBRL(c.cutCents)}</Text>
            </View>
          ))}
          {!h.cuts.covers && h.cuts.cuts.length ? (
            <Text style={[styles.muted, { marginTop: 8 }]}>Mesmo com esses cortes ainda faltariam {formatBRL(h.gapCents - h.cuts.totalCents)}/mês: considere aumentar o prazo.</Text>
          ) : null}
          {unknown >= 10000 ? (
            <Text style={[styles.muted, { marginTop: 8 }]}>
              {formatBRL(unknown)}/mês estão em “Outros gastos”. Classifique esses lançamentos para o app sugerir cortes mais precisos.
            </Text>
          ) : null}
          {toCreate.length ? (
            <Button style={{ marginTop: 12 }} title={`Criar ${toCreate.length} orçamento(s) com esses limites`} icon="wallet" variant="secondary" onPress={createBudgets} loading={saving} />
          ) : null}
        </>
      )}
    </Card>
  );
}
