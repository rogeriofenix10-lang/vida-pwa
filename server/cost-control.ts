/**
 * IRIS COST CONTROL & FINANCIAL SAFETY
 * 
 * Mantém a IRIS orientada a custo zero ou baixo.
 * Garante que nenhuma operação ative faturamento ou cobrança automática.
 * Monitora limites diários e mensais configurados (Padrão: R$ 100,00).
 */

export interface CostStatus {
  todayBrl: number;
  monthBrl: number;
  limitBrl: number;
  status: "Dentro do limite" | "Limite atingido (Bloqueado)";
  billingMode: "gratuito_ou_chave_propria";
  automaticBillingEnabled: false;
  lastUpdated: string;
}

// Limite configurado seguro padrão de R$ 100,00
const DEFAULT_LIMIT_BRL = 100.0;

let currentMonthUsageBrl = 0.0;
let currentDayUsageBrl = 0.0;
let lastResetDate = new Date().toISOString().slice(0, 10);

function checkDateRollover() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastResetDate) {
    currentDayUsageBrl = 0.0;
    if (today.slice(0, 7) !== lastResetDate.slice(0, 7)) {
      currentMonthUsageBrl = 0.0;
    }
    lastResetDate = today;
  }
}

export function getCostStatus(_userId?: number): CostStatus {
  checkDateRollover();
  const isWithinLimit = currentMonthUsageBrl < DEFAULT_LIMIT_BRL;

  return {
    todayBrl: Number(currentDayUsageBrl.toFixed(2)),
    monthBrl: Number(currentMonthUsageBrl.toFixed(2)),
    limitBrl: DEFAULT_LIMIT_BRL,
    status: isWithinLimit ? "Dentro do limite" : "Limite atingido (Bloqueado)",
    billingMode: "gratuito_ou_chave_propria",
    automaticBillingEnabled: false,
    lastUpdated: new Date().toISOString(),
  };
}

export function recordAiUsage(estimatedCostBrl: number) {
  checkDateRollover();
  if (estimatedCostBrl <= 0) return;
  currentDayUsageBrl += estimatedCostBrl;
  currentMonthUsageBrl += estimatedCostBrl;
}

/**
 * REGRA PERMANENTE: Se uma operação potencialmente paga ultrapassar o limite, BLOQUEAR.
 * Nunca habilitar billing automaticamente.
 */
export function assertWithinCostLimit(estimatedOperationCostBrl = 0) {
  checkDateRollover();
  if (currentMonthUsageBrl + estimatedOperationCostBrl > DEFAULT_LIMIT_BRL) {
    throw new Error(
      `Operação bloqueada por governança de custos: o limite mensal de R$ ${DEFAULT_LIMIT_BRL.toFixed(
        2
      )} foi atingido. A IRIS não realiza cobrança automática.`
    );
  }
}
