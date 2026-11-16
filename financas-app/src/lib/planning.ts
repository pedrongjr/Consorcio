import { averageSurplus, payday, planGoal, suggestCuts, type CategoryAverage, type GoalPlan } from '../core/goals';
import { formatBRL, monthLabel, monthlySummary, shiftMonth, totalsByCategory } from '../core/reports';
import { categoryMap, listBudgets, listCategories, reportTransactions, type Goal } from '../db/repo';
import { colors, currentMonth } from '../components/ui';

/** Meses usados para medir o ritmo de depósitos de um objetivo (o atual e os 2 anteriores). */
export const PACE_MONTHS = 3;

export interface PlanningContext {
  month: string;
  /** Data a partir da qual os depósitos contam para o ritmo. */
  since: string;
  /** Sobra média mensal dos últimos 6 meses fechados (null sem histórico). */
  avgSurplus: number | null;
  /** Receita média mensal dos últimos 6 meses fechados (null sem histórico). */
  avgIncome: number | null;
  /** Gasto médio por categoria nos últimos 3 meses fechados (maiores primeiro). */
  categories: CategoryAverage[];
  /** Dia do mês em que costuma entrar a maior receita. */
  payday: number | null;
}

export async function planningContext(db: unknown): Promise<PlanningContext> {
  const month = currentMonth();
  const [cats, txs, budgets] = await Promise.all([
    listCategories(db as never),
    reportTransactions(db as never, shiftMonth(month, -6), shiftMonth(month, -1)),
    listBudgets(db as never),
  ]);
  const map = categoryMap(cats);
  const summary = monthlySummary(txs, map);
  const closed = summary.filter((m) => m.month >= shiftMonth(month, -6));
  const recent = txs.filter((t) => t.date >= `${shiftMonth(month, -3)}-01`);
  // Divide pelos meses que têm lançamentos (quem importou só um mês não fica com média subestimada).
  const recentMonths = Math.max(1, new Set(recent.map((t) => t.date.slice(0, 7))).size);
  const budgetOf = new Map(budgets.map((b) => [b.categoryKey, b.limitCents]));
  const categories = totalsByCategory(recent, map, 'expense').map((t) => ({
    key: t.key, name: t.name, avgCents: Math.round(t.totalCents / recentMonths), budgetCents: budgetOf.get(t.key) ?? null,
    topChild: t.children.length ? [...t.children].sort((a, b) => b.totalCents - a.totalCents)[0].name : null,
  }));
  const incomes = txs.filter((t) => t.amountCents > 0 && (t.categoryKey ? map.get(t.categoryKey)?.kind === 'income' : true));
  return {
    month,
    since: `${shiftMonth(month, -(PACE_MONTHS - 1))}-01`,
    avgSurplus: averageSurplus(summary, month),
    avgIncome: closed.length ? Math.round(closed.reduce((s, m) => s + m.incomeCents, 0) / closed.length) : null,
    categories,
    payday: payday(incomes),
  };
}

export interface HowToReach {
  /** Quanto falta liberar por mês além da sobra média. */
  gapCents: number;
  cuts: ReturnType<typeof suggestCuts>;
  /** Fração da receita média que o depósito mensal representa. */
  incomeShare: number | null;
  /** Dia sugerido para a transferência automática (logo após a receita). */
  transferDay: number | null;
}

/** Plano de ação para guardar `monthlyCents` por mês com base nas receitas e despesas. */
export function howToReach(monthlyCents: number, ctx: PlanningContext): HowToReach {
  const available = Math.max(0, ctx.avgSurplus ?? 0);
  const gap = ctx.avgSurplus === null ? 0 : Math.max(0, monthlyCents - available);
  return {
    gapCents: gap,
    cuts: suggestCuts(ctx.categories, gap),
    incomeShare: ctx.avgIncome && ctx.avgIncome > 0 ? monthlyCents / ctx.avgIncome : null,
    transferDay: ctx.payday ? Math.min(28, ctx.payday + 1) : null,
  };
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
      return { text: 'Sonho realizado! Parabéns.', color: colors.income };
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
