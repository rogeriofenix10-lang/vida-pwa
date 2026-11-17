export type FinanceAnalysisSummary = {
  income: number;
  expense: number;
  balance: number;
  openIncome: number;
  openExpense: number;
};

export type FinanceAnalysisMonth = {
  month: string;
  income: number;
  expense: number;
  balance: number;
  count: number;
};

export type FinanceAnalysisCategory = {
  category: string;
  total: number;
  count: number;
};

/** A deliberately narrow aggregate: no transaction descriptions, holders, document names or account identifiers. */
export function buildFinanceAnalysisAggregate(input: {
  period: string;
  summary: FinanceAnalysisSummary;
  recordCount: number;
  comparisonYear: number;
  months: FinanceAnalysisMonth[];
  periodCategories: FinanceAnalysisCategory[];
  yearCategories: FinanceAnalysisCategory[];
}) {
  const toCents = (value: number) => Math.round((value + Number.EPSILON) * 100);
  return {
    period: input.period,
    totalsCentsBRL: {
      income: toCents(input.summary.income),
      expenses: toCents(input.summary.expense),
      balanceOfEntries: toCents(input.summary.balance),
      openIncome: toCents(input.summary.openIncome),
      openExpenses: toCents(input.summary.openExpense),
    },
    recordCount: input.recordCount,
    monthlyComparisonYear: input.comparisonYear,
    months: input.months.map((point) => ({
      month: point.month,
      incomeCentsBRL: toCents(point.income),
      expenseCentsBRL: toCents(point.expense),
      balanceCentsBRL: toCents(point.balance),
      recordCount: point.count,
    })),
    categories: input.periodCategories.map((group) => ({
      category: group.category,
      totalCentsBRL: toCents(group.total),
      recordCount: group.count,
    })),
    chartYearCategoryTotals: input.yearCategories.map((group) => ({
      category: group.category,
      totalCentsBRL: toCents(group.total),
      recordCount: group.count,
    })),
  };
}
