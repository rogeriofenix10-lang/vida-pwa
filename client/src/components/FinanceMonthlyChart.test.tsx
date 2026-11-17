import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FinanceMonthlyChart, { type FinanceMonthlyPoint } from "./FinanceMonthlyChart";

const months = (overrides: Partial<FinanceMonthlyPoint>[] = []): FinanceMonthlyPoint[] => Array.from({ length: 12 }, (_, index) => ({ month: `2028-${String(index + 1).padStart(2, "0")}`, label: `Mês ${index + 1}`, income: 0, expense: 0, balance: 0, count: 0, ...overrides[index] }));
const render = (series: FinanceMonthlyPoint[]) => renderToStaticMarkup(<FinanceMonthlyChart year={2028} series={series} selectedMonth="2028-01" onSelectMonth={() => {}} />);
const attributes = (html: string, className: string) => [...html.matchAll(new RegExp(`<[^>]+class="${className}"[^>]*>`, "g"))].map(([tag]) => Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));

describe("annual financial chart", () => {
  it("uses exactly the same money scale for balance and bars including negative balances", () => {
    const html = render(months([{ income: 300, expense: 100, balance: 200, count: 2 }, { income: 0, expense: 200, balance: -200, count: 1 }]));
    const balances = attributes(html, "finance-chart-balance-point");
    const expenses = attributes(html, "finance-chart-expense");
    const zero = Number(attributes(html, "finance-chart-balance-zero")[0].y1);
    expect(Number(balances[0].cy)).toBeCloseTo(Number(expenses[1].y));
    expect(Number(balances[0].cy)).toBeLessThan(zero);
    expect(Number(balances[1].cy)).toBeGreaterThan(zero);
    expect(html).toContain("mesma escala");
  });
  it("keeps twelve selectable months and truthful empty state without fabricated bars", () => {
    const html = render(months());
    expect((html.match(/role="button"/g) ?? [])).toHaveLength(12);
    expect(html).toContain("Ainda não há lançamentos com data neste ano");
    expect(attributes(html, "finance-chart-income")).toHaveLength(0);
    expect(attributes(html, "finance-chart-expense")).toHaveLength(0);
    expect(attributes(html, "finance-chart-balance-point")).toHaveLength(0);
    expect(attributes(html, "finance-chart-balance-line")).toHaveLength(0);
    expect(attributes(html, "finance-chart-grid")).toHaveLength(1);
  });
  it("provides exact values in a real table and indicates the selected month", () => {
    const html = render(months([{ income: 0.1, expense: 0, balance: 0.1, count: 1 }, { income: 0.2, expense: 0.1, balance: 0.1, count: 2 }]));
    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).toContain("Valores exatos e totalizações de cada mês");
    expect(html).toContain("Total do ano");
    expect(html).toContain("0,30");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});
