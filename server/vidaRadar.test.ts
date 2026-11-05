import { describe, expect, it } from "vitest";
import { completeRadarItem, editRadarItem, snoozeRadarItem } from "../shared/vidaRadar";

const items = [
  { id: 1, label: "Seguro", detail: "vence em 12 dias", date: "12 dias", priority: "importante" as const, action: "Revisar" },
  { id: 2, label: "Conta", detail: "vence amanhã", date: "amanhã", priority: "urgente" as const, action: "Pagar" },
];

describe("ações do Radar da Vida", () => {
  it("concluir remove apenas o item selecionado", () => {
    expect(completeRadarItem(items, 1)).toHaveLength(1);
    expect(completeRadarItem(items, 1)[0]?.id).toBe(2);
  });

  it("adiar atualiza prazo e registra o adiamento", () => {
    const result = snoozeRadarItem(items, 2);
    expect(result[1]).toMatchObject({ date: "amanhã", detail: "vence amanhã · adiado" });
  });

  it("editar salva o novo texto do item", () => {
    const result = editRadarItem(items, 1, "Seguro do carro — renovar");
    expect(result[0]).toMatchObject({ label: "Seguro do carro — renovar", detail: "ajustado por você" });
  });
});
