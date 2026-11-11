import { describe, expect, it } from "vitest";
import { parseProductCsv, productCsv } from "./ProductCatalog";

describe("ProductCatalog CSV", () => {
  it("imports quoted pt-BR semicolon CSV and maps headers by name", () => {
    const csv = "\uFEFFnome;código;preço;estoque;categoria;descrição\r\n\"Feijão\";\"A;1\";\"R$ 12,50\";4;Mercado;\"Feijão; preto\"";
    expect(parseProductCsv(csv)).toEqual([
      {
        name: "Feijão",
        code: "A;1",
        price: "R$ 12,50",
        stock: "4",
        category: "Mercado",
        description: "Feijão; preto",
      },
    ]);
  });

  it("recognizes comma CSV with reordered English/Portuguese aliases", () => {
    const csv = "categoria,nome,sku,valor,quantidade,detalhes\nMercado,Arroz,SKU-2,8.50,12,Tipo longo";
    expect(parseProductCsv(csv)[0]).toMatchObject({
      name: "Arroz",
      code: "SKU-2",
      price: "8.50",
      stock: "12",
      category: "Mercado",
      description: "Tipo longo",
    });
  });

  it("rejects missing headers and all rows if any row is malformed", () => {
    expect(() => parseProductCsv("item;valor\nArroz;10")).toThrow("Cabeçalho CSV inválido");
    const invalidRows = [
      "nome,codigo,preco,estoque,categoria,descricao",
      "Arroz,A1,10,2,Alimentos,",
      ",A2,12,3,Alimentos,sem nome",
      "Feijão,A3,9,2,Alimentos",
    ].join("\n");
    expect(() => parseProductCsv(invalidRows)).toThrow("2 linha(s) inválida(s)");
    expect(() => parseProductCsv(invalidRows)).toThrow("nenhuma alteração foi feita");
  });

  it("neutralizes imported fields during CSV export and doubles embedded quotes", () => {
    const output = productCsv([{
      id: "fixture",
      name: " \t=1+1",
      code: "A\"B",
      price: "-10",
      stock: "1",
      category: "Mercado",
      description: "@SUM(A1)",
      createdAt: "synthetic",
    }]);
    expect(output).toContain('"\' \t=1+1"');
    expect(output).toContain('"A""B"');
    expect(output).toContain('"\'-10"');
    expect(output).toContain('"\'@SUM(A1)"');
    expect(output).toContain("\r\n");
  });
});
