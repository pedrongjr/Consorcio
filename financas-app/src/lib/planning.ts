import { averageSurplus, planGoal, type GoalPlan } from '../core/goals';
import { formatBRL, monthLabel, monthlySummary, shiftMonth } from '../core/reports';
import { categoryMap, listCategories, reportTransactions, type Goal } from '../db/repo';
import { colors, currentMonth } from '../components/ui';

/** Meses usados para medir o ritmo de depósitos de um objetivo (o atual e os 2 anteriores). */
export const PACE_MONTHS = 3;

export interface PlanningContext {
  month: string;
  /** Data a partir da qual os depósitos contam para o ritmo. */
  since: string;
  /** Sobra média mensal dos últimos 6 meses fechados (null sem histórico). */
  avgSurplus: number | null;
}

export async function planningContext(db: unknown): Promise<PlanningContext> {
  const month = currentMonth();
  const [cats, txs] = await Promise.all([
    listCategories(db as never),
    reportTransactions(db as never, shiftMonth(month, -6), shiftMonth(month, -1)),
  ]);
  const summary = monthlySummary(txs, categoryMap(cats));
  return { month, since: `${shiftMonth(month, -(PACE_MONTHS - 1))}-01`, avgSurplus: averageSurplus(summary, month) };
}

export function paceOf(g: Goal): number | null {
  return g.recent_cents > 0 ? Math.round(g.recent_cents / PACE_MONTHS) : null;
}

export function planFor(g: Goal, ctx: PlanningContext): GoalPlan {
  return planGoal({
    targetCents: g.target_cents, savedCents: g.saved_cents, deadline: g.deadline, month: ctx.month,
    paceCents: paceOf(g), avgSurplusCents: ctx.avgSurplus,
  });
}

/** Frase de orientação para o objetivo, com a cor do status. */
export function describePlan(g: Goal, plan: GoalPlan, ctx: PlanningContext): { text: string; color: string } {
  const pace = paceOf(g);
  const needed = plan.monthlyNeededCents ?? 0;
  const until = g.deadline ? monthLabel(g.deadline, true) : '';
  const surplus = ctx.avgSurplus;
  switch (plan.status) {
    case 'done':
      return { text: 'Objetivo alcançado! Parabéns.', color: colors.income };
    case 'no_deadline':
      return plan.etaMonth && pace
        ? { text: `No ritmo atual (${formatBRL(pace)}/mês), você chega lá em ${monthLabel(plan.etaMonth, true)}.`, color: colors.text }
        : { text: 'Defina um prazo ou faça depósitos para ver a previsão.', color: colors.muted };
    case 'overdue':
      return { text: `O prazo (${until}) passou e faltam ${formatBRL(plan.remainingCents)}. Que tal definir um novo prazo?`, color: colors.expense };
    case 'ok':
      return { text: `Guarde ${formatBRL(needed)} por mês até ${until}. Cabe com folga na sua sobra média de ${formatBRL(surplus ?? 0)}/mês.`, color: colors.income };
    case 'tight':
      return { text: `Guarde ${formatBRL(needed)} por mês até ${until}. Isso usa mais da metade da sua sobra média (${formatBRL(surplus ?? 0)}/mês).`, color: colors.warning };
    case 'unrealistic': {
      if (!surplus || surplus <= 0) {
        return { text: `Seriam ${formatBRL(needed)} por mês até ${until}, mas nos últimos meses as despesas superaram as receitas. Reveja gastos, valor ou prazo.`, color: colors.expense };
      }
      const suggested = shiftMonth(ctx.month, Math.ceil(plan.remainingCents / surplus) - 1);
      return {
        text: `Seriam ${formatBRL(needed)} por mês até ${until}, mais que sua sobra média (${formatBRL(surplus)}/mês). ` +
          `Guardando toda a sobra, você chega lá em ${monthLabel(suggested, true)}.`,
        color: colors.expense,
      };
    }
    default:
      return { text: `Guarde ${formatBRL(needed)} por mês até ${until}. Importe extratos para comparar com o quanto sobra por mês.`, color: colors.text };
  }
}
