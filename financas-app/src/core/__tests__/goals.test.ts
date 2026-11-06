import { describe, expect, it } from 'vitest';
import { averageSurplus, goalPace, monthsBetween, planGoal } from '../goals';

const base = { targetCents: 1_200_000, savedCents: 200_000, month: '2026-11' };

describe('planGoal', () => {
  it('calcula quanto guardar por mês até o prazo (contando o mês atual)', () => {
    const p = planGoal({ ...base, deadline: '2027-10', avgSurplusCents: 300_000 });
    expect(p.monthsLeft).toBe(12);
    expect(p.remainingCents).toBe(1_000_000);
    expect(p.monthlyNeededCents).toBe(83_334); // arredonda para cima
    expect(p.progress).toBeCloseTo(1 / 6);
    expect(p.status).toBe('ok');
  });
  it('classifica pelo tamanho da sobra média', () => {
    expect(planGoal({ ...base, deadline: '2027-10', avgSurplusCents: 100_000 }).status).toBe('tight');
    expect(planGoal({ ...base, deadline: '2027-10', avgSurplusCents: 50_000 }).status).toBe('unrealistic');
    expect(planGoal({ ...base, deadline: '2027-10', avgSurplusCents: -10_000 }).status).toBe('unrealistic');
    expect(planGoal({ ...base, deadline: '2027-10', avgSurplusCents: null }).status).toBe('unknown');
  });
  it('prazo no mês atual, prazo vencido, sem prazo e alcançado', () => {
    expect(planGoal({ ...base, deadline: '2026-11' })).toMatchObject({ monthsLeft: 1, monthlyNeededCents: 1_000_000 });
    expect(planGoal({ ...base, deadline: '2026-10' }).status).toBe('overdue');
    const free = planGoal({ ...base, deadline: null, paceCents: 100_000 });
    expect(free).toMatchObject({ status: 'no_deadline', monthlyNeededCents: null, etaMonth: '2027-08' });
    expect(planGoal({ ...base, savedCents: 1_300_000, deadline: '2027-01' })).toMatchObject({ status: 'done', progress: 1, remainingCents: 0 });
  });
});

describe('auxiliares', () => {
  it('monthsBetween atravessa anos', () => {
    expect(monthsBetween('2026-11', '2027-02')).toBe(3);
    expect(monthsBetween('2026-11', '2026-11')).toBe(0);
  });
  it('averageSurplus usa só meses fechados recentes', () => {
    const months = [
      { month: '2026-01', balanceCents: 999_999 }, // antigo demais
      { month: '2026-09', balanceCents: 100_000 },
      { month: '2026-10', balanceCents: 300_000 },
      { month: '2026-11', balanceCents: -50_000 }, // mês atual, em andamento
    ];
    expect(averageSurplus(months, '2026-11')).toBe(200_000);
    expect(averageSurplus([], '2026-11')).toBeNull();
  });
  it('goalPace divide pelos meses da janela', () => {
    expect(goalPace([{ date: '2026-10-05', amountCents: 30_000 }, { date: '2026-05-01', amountCents: 999 }], '2026-11')).toBe(10_000);
    expect(goalPace([], '2026-11')).toBeNull();
  });
});

describe('suggestCuts e payday', () => {
  const cats = [
    { key: 'moradia', name: 'Moradia', avgCents: 300000 },
    { key: 'lazer', name: 'Lazer', avgCents: 100000, topChild: 'Viagens' },
    { key: 'alimentacao', name: 'Alimentação', avgCents: 200000 },
    { key: 'minha', name: 'Minha categoria', avgCents: 20000 },
  ];
  it('corta primeiro onde dá para economizar mais, sem tocar em essenciais', async () => {
    const { suggestCuts } = await import('../goals');
    const r = suggestCuts(cats, 40000);
    expect(r.cuts.map((c) => [c.key, c.cutCents, c.limitCents])).toEqual([
      ['lazer', 30000, 70000],
      ['alimentacao', 10000, 190000],
    ]);
    expect(r.covers).toBe(true);
    expect(r.cuts[0].topChild).toBe('Viagens');
    expect(suggestCuts(cats, 1_000_000).covers).toBe(false);
    expect(suggestCuts(cats, 1_000_000).cuts.some((c) => c.key === 'moradia')).toBe(false);
    expect(suggestCuts(cats, 0).cuts).toEqual([]);
  });
  it('dia do salário: maior receita de cada mês', async () => {
    const { payday } = await import('../goals');
    expect(payday([
      { date: '2026-08-05', amountCents: 700000 }, { date: '2026-08-20', amountCents: 5000 },
      { date: '2026-09-05', amountCents: 700000 }, { date: '2026-10-06', amountCents: 707045 }, { date: '2026-10-20', amountCents: 456530 },
    ])).toBe(5);
    expect(payday([])).toBeNull();
  });
});
