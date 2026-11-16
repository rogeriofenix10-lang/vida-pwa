import { describe, expect, it } from "vitest";
import {
  annotateBusinessClientDuplicates,
  businessClientExportCsv,
  businessClientExportJson,
  businessClientMissingFields,
  filterBusinessClients,
  findBusinessClientDuplicate,
  mergeBusinessRecords,
  toBusinessRemoteRow,
  type BusinessClientCandidate,
  type BusinessRecord,
} from "./businessRecords";

const client = (overrides: Partial<BusinessRecord> = {}): BusinessRecord => ({
  id: "client-1",
  kind: "cliente",
  name: "Mercado Aurora",
  company: "Aurora Alimentos Ltda.",
  legalName: "Aurora Alimentos Ltda.",
  tradeName: "Mercado Aurora",
  amount: 0,
  status: "ativo",
  notes: "Carteira regional",
  createdAt: "2026-11-15T12:00:00.000Z",
  document: "12.345.678/0001-90",
  economicGroup: "Grupo Aurora",
  address: "Rua das Flores",
  number: "123",
  city: "Recife",
  state: "PE",
  email: "contato@example.test",
  phone: "81999990000",
  extraFields: { segmento: "varejo" },
  ...overrides,
});

function candidate(values: BusinessClientCandidate["values"], extraFields: Record<string, string> = {}): BusinessClientCandidate {
  return { values, extraFields, warnings: [], selected: true };
}

describe("carteira comercial local", () => {
  it("deduplica por documento ou email e por nome mais endereço e cidade claros", () => {
    expect(findBusinessClientDuplicate({ document: "12345678000190" }, [client()])?.reason).toBe("CNPJ/CPF igual");
    expect(findBusinessClientDuplicate({ email: "CONTATO@example.test" }, [client()])?.reason).toBe("email igual");
    expect(findBusinessClientDuplicate({ name: "Mercado Aurora", address: "Rua das Flores", number: "123", city: "Recife" }, [client({ document: "" })])?.reason).toBe("nome e endereço/cidade iguais");
  });

  it("não considera duplicado só por grupo econômico ou nome", () => {
    expect(findBusinessClientDuplicate({ name: "Mercado Aurora", economicGroup: "Grupo Aurora" }, [client({ document: "", email: "", address: "", city: "" })])).toBeUndefined();
    expect(findBusinessClientDuplicate({ name: "Mercado Aurora", economicGroup: "Outro grupo" }, [client({ document: "", email: "", address: "", city: "" })])).toBeUndefined();
  });

  it("marca duplicatas em uma prévia sem eliminar nem sobrescrever a carteira existente", () => {
    const candidates = [
      candidate({ name: "Mercado Aurora", document: "12.345.678/0001-90" }),
      candidate({ name: "Novo cliente", email: "novo@example.test" }),
      candidate({ name: "Novo cliente", email: "novo@example.test" }),
    ];
    const marked = annotateBusinessClientDuplicates(candidates, [client()]);
    expect(marked[0].duplicateReason).toBe("CNPJ/CPF igual");
    expect(marked[1].duplicateReason).toBeUndefined();
    expect(marked[2].duplicateReason).toBe("email igual");
    expect(marked[0].selected).toBe(true);
  });

  it("não preenche campos ausentes e inclui os campos vazios para revisão", () => {
    const missing = businessClientMissingFields({ name: "Cliente de teste", city: "Recife" });
    expect(missing).toContain("document");
    expect(missing).toContain("email");
    expect(missing).toContain("phone");
    expect(missing).not.toContain("name");
  });

  it("faz merge por ID preservando registros locais, campos adicionais e IDs remotos não duplicados", () => {
    const local = client({ name: "Nome local editado", notes: "alteração local", needsSync: true, extraFields: { segmento: "local", regional: "nordeste" } });
    const remote = client({ name: "Nome remoto antigo", notes: "antiga", remoteSyncedAt: "2026-11-14T00:00:00.000Z", extraFields: { segmento: "remoto", legacy: "mantido" } });
    const localOnly = client({ id: "local-only", name: "Importado offline", remoteSyncedAt: undefined });
    const remoteOnly = client({ id: "remote-only", name: "Outro remoto" });
    const merged = mergeBusinessRecords([local, localOnly], [remote, remoteOnly]);
    expect(merged).toHaveLength(3);
    expect(merged.find((item) => item.id === local.id)).toMatchObject({
      name: "Nome local editado",
      notes: "alteração local",
      needsSync: true,
      extraFields: { segmento: "local", regional: "nordeste", legacy: "mantido" },
    });
    expect(merged.some((item) => item.id === "local-only")).toBe(true);
    expect(merged.some((item) => item.id === "remote-only")).toBe(true);
  });

  it("preserva email, telefone e extras em payload remoto sem anexar o Blob local", () => {
    const record = client({ localFileId: "local-file", extraFields: { segmento: "varejo", codigo: "A-9" } });
    const row = toBusinessRemoteRow(record);
    expect(row.email).toBe("contato@example.test");
    expect(row.phone).toBe("81999990000");
    expect(row.payload).toMatchObject({
      legalName: "Aurora Alimentos Ltda.",
      economicGroup: "Grupo Aurora",
      extraFields: { segmento: "varejo", codigo: "A-9" },
    });
    expect(row.payload).not.toHaveProperty("localFileId");
    expect(row.payload).not.toHaveProperty("localAttachment");
  });

  it("filtra por nome, grupo, cidade e UF e exporta todas as colunas e extras filtrados", () => {
    const first = client();
    const second = client({ id: "client-2", name: "Loja Norte", economicGroup: "Grupo Norte", city: "Olinda", state: "PE", extraFields: { regime: "especial" } });
    expect(filterBusinessClients([first, second], { group: "aurora", city: "recife", state: "pe" })).toEqual([first]);
    const csv = businessClientExportCsv([first]);
    expect(csv).toContain("Grupo econômico");
    expect(csv).toContain("segmento");
    expect(csv).toContain("varejo");
    expect(csv).not.toContain("especial");
    const json = businessClientExportJson([first], { city: "Recife" });
    expect(json.filters.city).toBe("Recife");
    expect(json.clients[0].extraFields).toEqual({ segmento: "varejo" });
    expect(filterBusinessClients([client({ name: "Ana", legalName: "Comércio Sintético Ltda.", tradeName: "Loja Aurora" })], { name: "sintetico" })).toHaveLength(1);
    expect(filterBusinessClients([client({ name: "Ana", legalName: "Comércio Sintético Ltda.", tradeName: "Loja Aurora" })], { name: "loja aurora" })).toHaveLength(1);
  });
});
