import { formatPeriodLabel } from "@/lib/financePeriods";
import "./FinanceMonthlyChart.css";

export type FinanceMonthlyPoint = {
  month: string;
  label: string;
  income: number;
  expense: number;
  balance: number;
  count: number;
};

type Props = {
  year: number;
  series: FinanceMonthlyPoint[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
};

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function interactiveKey(event: React.KeyboardEvent, month: string, onSelectMonth: Props["onSelectMonth"]) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onSelectMonth(month);
  }
}

export default function FinanceMonthlyChart({ year, series, selectedMonth, onSelectMonth }: Props) {
  const width = 1000;
  const height = 360;
  const left = 112;
  const right = 60;
  const top = 36;
  const bottom = 280;
  const plotWidth = width - left - right;
  const plotHeight = bottom - top;
  const slot = plotWidth / 12;
  const hasData = series.some((point) => point.count > 0);
  const maxValue = hasData ? Math.max(1, ...series.flatMap((point) => [point.income, point.expense, point.balance])) : 1;
  const minValue = hasData ? Math.min(0, ...series.map((point) => point.balance)) : 0;
  const valueY = (value: number) => bottom - (value - minValue) / (maxValue - minValue) * plotHeight;
  const baseline = valueY(0);
  const ticks = hasData ? [...new Set([minValue, 0, minValue + (maxValue - minValue) / 2, maxValue])].sort((a, b) => a - b) : [0];
  const yearTotal = (key: "income" | "expense" | "balance") => series.reduce((sum, point) => sum + Math.round(point[key] * 100), 0) / 100;
  const linePoints = series.map((point, index) => ({
    x: left + slot * (index + 0.5),
    y: valueY(point.balance),
  }));
  const line = linePoints.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <section className="finance-chart" aria-labelledby="finance-chart-title">
      <div className="finance-chart-heading">
        <div>
          <span className="finance-chart-kicker">COMPARATIVO MÊS A MÊS</span>
          <h2 id="finance-chart-title">Receitas, despesas e saldo por mês</h2>
          <p>Compare os 12 meses de {year}. Selecione qualquer mês para abrir seus lançamentos; o comparativo permanece visível.</p>
        </div>
        <strong className="finance-chart-year">{year}</strong>
      </div>
      {!hasData && <p className="finance-chart-empty">Ainda não há lançamentos com data neste ano. A comparação mensal será preenchida com seus registros reais.</p>}
      <div className="finance-chart-scroll">
        <svg className="finance-chart-svg" viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby="finance-chart-title finance-chart-description">
          <desc id="finance-chart-description">Comparativo mensal de janeiro a dezembro de {year}, em reais e na mesma escala: barras turquesa para receitas, barras coral para despesas e uma linha âmbar para o saldo dos lançamentos, que pode ser negativo. Os meses podem ser selecionados por teclado ou clique.</desc>
          {ticks.map((value) => {
            const y = valueY(value);
            return <g key={value} className="finance-chart-grid">
              <line x1={left} x2={width - right} y1={y} y2={y} />
              <text x={left - 12} y={y + 4} textAnchor="end">{brl(value)}</text>
            </g>;
          })}
          <line className="finance-chart-balance-zero" x1={left} x2={width - right} y1={baseline} y2={baseline} />
          <text className="finance-chart-zero-label" x={width - right + 7} y={baseline + 4}>Zero</text>
          {series.map((point, index) => {
            const center = left + slot * (index + 0.5);
            const barWidth = Math.min(18, slot * 0.27);
            const incomeHeight = point.income ? Math.max(1, baseline - valueY(point.income)) : 0;
            const expenseHeight = point.expense ? Math.max(1, baseline - valueY(point.expense)) : 0;
            const isSelected = selectedMonth === point.month;
            return <g
              key={point.month}
              className={`finance-chart-month${isSelected ? " is-selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${formatPeriodLabel(point.month)}: receitas ${brl(point.income)}, despesas ${brl(point.expense)}, saldo ${brl(point.balance)}, ${point.count} lançamento(s). Abrir mês.`}
              aria-pressed={isSelected}
              onClick={() => onSelectMonth(point.month)}
              onKeyDown={(event) => interactiveKey(event, point.month, onSelectMonth)}
            >
              {isSelected && <rect className="finance-chart-highlight" x={center - slot * 0.45} y={top - 15} width={slot * 0.9} height={bottom - top + 60} rx="10" />}
              <rect className="finance-chart-hitarea" x={center - slot * 0.45} y={top - 15} width={slot * 0.9} height={bottom - top + 60} rx="10" />
              {point.income > 0 && <rect className="finance-chart-income" x={center - barWidth - 2} y={baseline - incomeHeight} width={barWidth} height={incomeHeight} rx="4"><title>{formatPeriodLabel(point.month)} · Receitas: {brl(point.income)}</title></rect>}
              {point.expense > 0 && <rect className="finance-chart-expense" x={center + 2} y={baseline - expenseHeight} width={barWidth} height={expenseHeight} rx="4"><title>{formatPeriodLabel(point.month)} · Despesas: {brl(point.expense)}</title></rect>}
              <text className="finance-chart-month-label" x={center} y={bottom + 25} textAnchor="middle">{point.label.slice(0, 3)}</text>
              {point.count > 0 && <circle className="finance-chart-dot" cx={center} cy={bottom + 39} r="2.5"><title>{point.count} lançamento(s)</title></circle>}
            </g>;
          })}
          {hasData && series.length > 1 && <polyline className="finance-chart-balance-line" points={line} />}
          {hasData && series.map((point, index) => {
            const { x, y } = linePoints[index];
            return <g key={`${point.month}-balance`}>
              <circle className="finance-chart-balance-point" cx={x} cy={y} r="4"><title>{formatPeriodLabel(point.month)} · Saldo: {brl(point.balance)}</title></circle>
            </g>;
          })}
        </svg>
      </div>
      <div className="finance-chart-legend" aria-label="Legenda do gráfico">
        <span><i className="finance-legend-income" /> Receitas</span>
        <span><i className="finance-legend-expense" /> Despesas</span>
        <span><i className="finance-legend-balance" /> Saldo mensal</span>
        <small>Meses sem registros não possuem barras.</small>
      </div>
      <details className="finance-chart-table-details" open>
        <summary>Valores exatos e totalizações de cada mês</summary>
        <div className="finance-chart-table-wrap">
          <table className="finance-chart-table">
            <caption>Totais mensais reais de {year}; selecione uma linha para abrir o período.</caption>
            <thead><tr><th scope="col">Mês</th><th scope="col">Receitas</th><th scope="col">Despesas</th><th scope="col">Saldo</th><th scope="col">Lançamentos</th></tr></thead>
            <tbody>{series.map((point) => <tr
              key={point.month}
              className={selectedMonth === point.month ? "is-selected" : ""}
              tabIndex={0}
              aria-label={`Abrir ${formatPeriodLabel(point.month)}`}
              onClick={() => onSelectMonth(point.month)}
              onKeyDown={(event) => interactiveKey(event, point.month, onSelectMonth)}
            ><th scope="row">{formatPeriodLabel(point.month)}</th><td>{brl(point.income)}</td><td>{brl(point.expense)}</td><td className={point.balance < 0 ? "is-negative" : "is-positive"}>{brl(point.balance)}</td><td>{point.count}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row">Total do ano</th><td>{brl(yearTotal("income"))}</td><td>{brl(yearTotal("expense"))}</td><td>{brl(yearTotal("balance"))}</td><td>{series.reduce((sum, point) => sum + point.count, 0)}</td></tr></tfoot>
          </table>
        </div>
      </details>
    </section>
  );
}
