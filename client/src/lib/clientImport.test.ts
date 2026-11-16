import { describe, expect, it } from "vitest";
import { businessClientMissingFields } from "./businessRecords";
import {
  createTextImportResult,
  parseBusinessJson,
  parseBusinessRows,
  parseBusinessText,
  parseDelimitedRows,
} from "./clientImport";

describe("importação local da carteira de clientes", () => {
  it("lê CSV separado por ponto e vírgula, com aspas, acentos e campos extras", () => {
    const source = [
      'Nome;Razão Social;CNPJ/CPF;Grupo Econômico;Cidade;UF;Email;Ramo de atividade',
      'Ana Lima;"Lima, Comércio Ltda.";12.345.678/0001-90;Grupo Aurora;Recife;PE;ana@example.test;Varejo',
    ].join("\r\n");
    const rows = parseDelimitedRows(source, ";");
    const [client] = parseBusinessRows(rows);
    expect(client.values).toMatchObject({
      name: "Ana Lima",
      legalName: "Lima, Comércio Ltda.",
      document: "12.345.678/0001-90",
      economicGroup: "Grupo Aurora",
      city: "Recife",
      state: "PE",
      email: "ana@example.test",
    });
    expect(client.extraFields).toEqual({ "Ramo de atividade": "Varejo" });
  });

  it("lê JSON com coleção aninhada e preserva campos desconhecidos", () => {
    const json = JSON.stringify({ version: 1, customers: [
      { "nome fantasia": "Mercado Azul", cnpj: "12345678000190", city: "Olinda", segmento: "Alimentos" },
      { name: "Oficina Norte", email: "norte@example.test", state: "PE" },
    ] });
    const clients = parseBusinessJson(json);
    expect(clients).toHaveLength(2);
    expect(clients[0].values).toMatchObject({ tradeName: "Mercado Azul", document: "12345678000190", city: "Olinda" });
    expect(clients[0].extraFields).toEqual({ segmento: "Alimentos" });
    expect(clients[1].values).toMatchObject({ name: "Oficina Norte", email: "norte@example.test", state: "PE" });
    expect(clients[1].values.legalName).toBeUndefined();
    expect(clients[1].values.document).toBeUndefined();
  });

  it("mapeia linhas de planilha XLSX sintética e converte números sem adivinhar outros campos", () => {
    const syntheticSheet = [
      ["Nome do cliente", "Telefone", "Cidade", "Código interno"],
      ["Oficina Central", "81999990000", "Recife", 321],
    ];
    const [client] = parseBusinessRows(syntheticSheet);
    expect(client.values).toMatchObject({ name: "Oficina Central", phone: "81999990000", city: "Recife" });
    expect(client.extraFields).toEqual({ "Código interno": "321" });
    expect(client.values.document).toBeUndefined();
  });

  it("interpreta texto em blocos com rótulos como saída de camada de texto PDF sem inventar ausências", () => {
    const text = [
      "Nome: Clínica São Bento",
      "Razão social: São Bento Saúde Ltda.",
      "CNPJ: 12.345.678/0001-90",
      "Endereço: Rua das Flores",
      "Bairro: Centro",
      "Cidade: Recife",
      "UF: PE",
      "Contato: Marta",
      "Email: marta@example.test",
      "Segmento: Saúde",
    ].join("\n");
    const [client] = parseBusinessText(text);
    expect(client.values).toMatchObject({
      name: "Clínica São Bento",
      legalName: "São Bento Saúde Ltda.",
      document: "12.345.678/0001-90",
      address: "Rua das Flores",
      neighborhood: "Centro",
      city: "Recife",
      state: "PE",
      contact: "Marta",
      email: "marta@example.test",
    });
    expect(client.extraFields).toEqual({ Segmento: "Saúde" });
    expect(client.values.phone).toBeUndefined();
    expect(businessClientMissingFields(client.values)).toContain("phone");
  });

  it("sinaliza revisão quando o texto de um PDF/OCR tiver confiança ou caracteres ambíguos", () => {
    const result = createTextImportResult(
      "PDF",
      "Nome: Cl¡nica S Bento\nCNPJ: 12.345.678/0001-90",
      "ocr",
      ["Confiança de OCR baixa; confira a leitura."],
    );
    expect(result.method).toBe("ocr");
    expect(result.warnings.some((warning) => warning.includes("OCR"))).toBe(true);
    expect(result.candidates[0].warnings.some((warning) => warning.includes("OCR"))).toBe(true);
    expect(result.candidates[0].values.document).toBe("12.345.678/0001-90");
  });

  it("preserva campos adicionais e clientFields no JSON de backup próprio", () => {
    const clients = parseBusinessJson(JSON.stringify({ format: "iris-business-clients", clients: [{
      name: "Loja Sintética", city: "Recife", extraFields: { segmento: "varejo", código: "A9" },
      clientFields: { phone: "81999990000", economicGroup: "Grupo Sintético" },
      condições: { prazo: 30, moeda: "BRL" },
    }] }));
    expect(clients[0].values).toMatchObject({ name: "Loja Sintética", phone: "81999990000", economicGroup: "Grupo Sintético" });
    expect(clients[0].extraFields).toMatchObject({ segmento: "varejo", código: "A9", condições: '{"prazo":30,"moeda":"BRL"}' });
  });

  it("recusa CSV malformado e nunca descarta colunas excedentes", () => {
    expect(() => parseDelimitedRows('Nome;Cidade\n"Cliente;Recife', ";")).toThrow("sem fechamento");
    expect(() => parseDelimitedRows('Nome;Cidade\n"Cliente"ruim;Recife', ";")).toThrow("após aspas");
    expect(() => parseBusinessRows([["Nome", "Cidade"], ["Cliente", "Recife", "dado não pode sumir"]])).toThrow("mais colunas");
    expect(() => parseBusinessRows([["Nome", "Nome"], ["Cliente", "Outro"]])).toThrow("repetidas");
    expect(parseDelimitedRows('\uFEFF"Nome";Cidade\nCliente;Recife', ";")[0][0]).toBe("Nome");
  });

  it("interpreta rótulos sem dois pontos e separa clientes consecutivos", () => {
    const clients = parseBusinessText("Nome Loja A\n\nRazão social São Bento Saúde Ltda.\n\nCidade Recife\n\nUF PE\n\nNome Loja B\n\nCidade Olinda\n\nUF PE");
    expect(clients).toHaveLength(2);
    expect(clients[0].values.name).toBe("Loja A");
    expect(clients[0].values.legalName).toBe("São Bento Saúde Ltda.");
    expect(clients[1].values.city).toBe("Olinda");
    const [labelled] = parseBusinessText("Razão social: Loja, Comércio Ltda.\nNome: Cliente, teste\nCidade: Recife");
    expect(labelled.values.legalName).toBe("Loja, Comércio Ltda.");
  });
});
