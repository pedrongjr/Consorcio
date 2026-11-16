import { shiftMonth } from './reports';

/**
 * Planejamento de objetivos ("sonhos"): quanto falta, quanto guardar por mês
 * para chegar no prazo e se isso cabe na sobra média do orçamento.
 */

export interface GoalTemplate {
  key: string;
  name: string;
  icon: string;
  color: string;
  hint: string;
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  { key: 'viagem', name: 'Fazer uma viagem', icon: 'airplane', color: '#E5484D', hint: 'Passagens, hospedagem e passeios' },
  { key: 'carro', name: 'Comprar o carro', icon: 'car-sport', color: '#F08C00', hint: 'Entrada ou valor total do carro' },
  { key: 'eletronico', name: 'Comprar um eletrônico', icon: 'phone-portrait', color: '#2F9E44', hint: 'Celular, notebook, TV...' },
  { key: 'casa', name: 'Comprar uma casa', icon: 'home', color: '#12B886', hint: 'Entrada do imóvel e custos de cartório' },
  { key: 'filhos', name: 'Ter filhos', icon: 'happy', color: '#F59F00', hint: 'Enxoval, parto e primeiros meses' },
  { key: 'aposentadoria', name: 'Aposentar-se bem', icon: 'umbrella', color: '#1C7ED6', hint: 'Reserva para o futuro' },
  { key: 'dividas', name: 'Sair das dívidas', icon: 'trending-down', color: '#E8A400', hint: 'Valor total das dívidas a quitar' },
  { key: 'reserva', name: 'Reserva de emergência', icon: 'shield-checkmark', color: '#6741D9', hint: 'O ideal é de 6 a 12 meses de gastos' },
  { key: 'outro', name: 'Outro sonho', icon: 'star', color: '#74B816', hint: 'Qualquer outro objetivo' },
];

export type GoalStatus =
  | 'done'        // já alcançado
  | 'no_deadline' // sem prazo: mostra só a previsão pelo ritmo atual
  | 'overdue'     // prazo passou sem alcançar
  | 'ok'          // cabe com folga na sobra média
  | 'tight'       // cabe, mas usa mais da metade da sobra
  | 'unrealistic' // maior que a sobra média
  | 'unknown';    // sem histórico para comparar

export interface GoalPlanInput {
  targetCents: number;
  savedCents: number;
  /** Mês-limite (YYYY-MM), inclusive. */
  deadline: string | null;
  /** Mês atual (YYYY-MM). */
  month: string;
  /** Média mensal guardada neste objetivo nos últimos meses (ritmo). */
  paceCents?: number | null;
  /** Sobra média mensal (receitas − despesas) do usuário. */
  avgSurplusCents?: number | null;
}

export interface GoalPlan {
  remainingCents: number;
  progress: number; // 0..1
  /** Meses até o prazo, contando o atual. */
  monthsLeft: number | null;
  /** Quanto guardar por mês para chegar no prazo. */
  monthlyNeededCents: number | null;
  status: GoalStatus;
  /** Mês previsto para alcançar no ritmo atual. */
  etaMonth: string | null;
}

/** Diferença em meses entre dois YYYY-MM (b − a). */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

export function planGoal(i: GoalPlanInput): GoalPlan {
  const target = Math.max(0, i.targetCents);
  const remaining = Math.max(0, target - i.savedCents);
  const progress = target ? Math.min(1, Math.max(0, i.savedCents / target)) : 1;
  const pace = i.paceCents && i.paceCents > 0 ? i.paceCents : null;
  const etaMonth = remaining === 0 ? i.month : pace ? shiftMonth(i.month, Math.ceil(remaining / pace) - 1) : null;

  if (remaining === 0) return { remainingCents: 0, progress: 1, monthsLeft: null, monthlyNeededCents: 0, status: 'done', etaMonth };
  if (!i.deadline) return { remainingCents: remaining, progress, monthsLeft: null, monthlyNeededCents: null, status: 'no_deadline', etaMonth };

  const monthsLeft = monthsBetween(i.month, i.deadline) + 1;
  if (monthsLeft < 1) return { remainingCents: remaining, progress, monthsLeft: 0, monthlyNeededCents: remaining, status: 'overdue', etaMonth };

  const needed = Math.ceil(remaining / monthsLeft);
  const surplus = i.avgSurplusCents;
  let status: GoalStatus;
  if (surplus === null || surplus === undefined) status = 'unknown';
  else if (surplus <= 0 || needed > surplus) status = 'unrealistic';
  else if (needed > surplus / 2) status = 'tight';
  else status = 'ok';
  return { remainingCents: remaining, progress, monthsLeft, monthlyNeededCents: needed, status, etaMonth };
}

/**
 * Sobra média por mês (receitas − despesas) nos meses fechados que têm
 * lançamentos. `null` quando não há histórico.
 */
export function averageSurplus(months: { month: string; balanceCents: number }[], currentMonth: string, lookback = 6): number | null {
  const from = shiftMonth(currentMonth, -lookback);
  const closed = months.filter((m) => m.month >= from && m.month < currentMonth);
  if (!closed.length) return null;
  return Math.round(closed.reduce((s, m) => s + m.balanceCents, 0) / closed.length);
}

/** Ritmo: média mensal guardada no objetivo nos últimos `lookback` meses fechados + o atual. */
export function goalPace(entries: { date: string; amountCents: number }[], currentMonth: string, lookback = 3): number | null {
  const from = shiftMonth(currentMonth, -lookback);
  const recent = entries.filter((e) => e.date.slice(0, 7) >= from);
  if (!recent.length) return null;
  const total = recent.reduce((s, e) => s + e.amountCents, 0);
  return total > 0 ? Math.round(total / lookback) : null;
}

// ---------------- Como chegar lá: sugestões com base em receitas e despesas ----------------

/**
 * Quanto dá para reduzir, no máximo, em cada categoria de despesa (fração do
 * gasto médio). Gastos essenciais (moradia, saúde, educação, impostos) ficam
 * de fora; categorias criadas pelo usuário usam o padrão. "Outros gastos"
 * também fica de fora: sem saber o que é (pode ser uma prestação), não dá
 * para sugerir corte.
 */
export const CUT_RATES: Record<string, number> = {
  lazer: 0.3, compras: 0.3, pessoal: 0.2, saques: 0.2, outros_gastos: 0,
  alimentacao: 0.15, transporte: 0.1, servicos: 0.1, familia: 0.1,
  moradia: 0, saude: 0, educacao: 0, taxas: 0,
};
const DEFAULT_CUT_RATE = 0.15;

export interface CategoryAverage {
  key: string;
  name: string;
  /** Gasto médio mensal (positivo). */
  avgCents: number;
  /** Orçamento atual da categoria, se houver. */
  budgetCents?: number | null;
  /** Subcategoria com mais gasto (para dar uma dica concreta). */
  topChild?: string | null;
}

export interface CutSuggestion {
  key: string;
  name: string;
  avgCents: number;
  cutCents: number;
  /** Novo limite mensal sugerido para o orçamento. */
  limitCents: number;
  /** Orçamento atual (não sugerimos afrouxar um limite menor). */
  budgetCents?: number | null;
  topChild?: string | null;
}

/** Arredonda para baixo em múltiplos de R$ 10. */
const floor10 = (cents: number) => Math.floor(cents / 1000) * 1000;

/**
 * Cortes sugeridos para liberar `gapCents` por mês: começa pelas categorias
 * com maior potencial de economia, sem passar do limite de cada uma.
 */
export function suggestCuts(categories: CategoryAverage[], gapCents: number): { cuts: CutSuggestion[]; totalCents: number; covers: boolean } {
  if (gapCents <= 0) return { cuts: [], totalCents: 0, covers: true };
  const options = categories
    .map((c) => {
      const rate = CUT_RATES[c.key] ?? DEFAULT_CUT_RATE;
      const max = floor10(c.avgCents * rate);
      return { c, max };
    })
    .filter((o) => o.max >= 1000)
    .sort((a, b) => b.max - a.max);
  const cuts: CutSuggestion[] = [];
  let left = gapCents;
  for (const { c, max } of options) {
    if (left <= 0) break;
    const cut = Math.min(max, Math.ceil(left / 1000) * 1000);
    cuts.push({ key: c.key, name: c.name, avgCents: c.avgCents, cutCents: cut, limitCents: Math.max(0, c.avgCents - cut), budgetCents: c.budgetCents ?? null, topChild: c.topChild });
    left -= cut;
  }
  const total = cuts.reduce((s, c) => s + c.cutCents, 0);
  return { cuts, totalCents: total, covers: total >= gapCents };
}

/**
 * Dia do mês em que costuma cair a maior receita (salário), para sugerir a
 * transferência automática logo depois de receber. `null` sem histórico.
 */
export function payday(incomes: { date: string; amountCents: number }[]): number | null {
  const biggest = new Map<string, { day: number; amount: number }>();
  for (const i of incomes) {
    if (i.amountCents <= 0) continue;
    const m = i.date.slice(0, 7);
    const cur = biggest.get(m);
    if (!cur || i.amountCents > cur.amount) biggest.set(m, { day: Number(i.date.slice(8, 10)), amount: i.amountCents });
  }
  if (!biggest.size) return null;
  const days = [...biggest.values()].map((b) => b.day).sort((a, b) => a - b);
  return days[Math.floor((days.length - 1) / 2)];
}
