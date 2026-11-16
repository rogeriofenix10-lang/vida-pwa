import { BUSINESS_CLIENT_FIELDS, BUSINESS_CLIENT_FIELD_LABELS, businessClientDisplayName, type BusinessRecord } from "./businessRecords";

/** Generates locally. Every wrapped line is placed inside page bounds, including long fields. */
export async function createBusinessClientPdf(clients: readonly BusinessRecord[]) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  const width = pdf.internal.pageSize.getWidth() - 2 * margin;
  const bottom = pdf.internal.pageSize.getHeight() - margin;
  let y = margin;
  const line = (text: string, bold = false, size = 8, indent = 0) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const spacing = size * 0.45 + 1;
    const wrapped = pdf.splitTextToSize(text, width - indent) as string[];
    for (const part of wrapped) {
      if (y + spacing > bottom) { pdf.addPage(); y = margin; }
      pdf.text(part, margin + indent, y);
      y += spacing;
    }
  };
  line("Carteira de clientes", true, 15);
  line(`${clients.length} registro(s) - gerado localmente - ${new Date().toLocaleString("pt-BR")}`);
  y += 4;
  clients.forEach((client, index) => {
    line(`${index + 1}. ${businessClientDisplayName(client)}`, true, 10);
    for (const field of BUSINESS_CLIENT_FIELDS) {
      const raw = client[field];
      const value = typeof raw === "string" && raw.trim() ? raw.trim() : "Não informado";
      line(`${BUSINESS_CLIENT_FIELD_LABELS[field]}: ${value}`, false, 8, 2);
    }
    for (const [key, value] of Object.entries(client.extraFields ?? {})) {
      line(`${key}: ${value || "Não informado"}`, false, 8, 2);
    }
    y += 4;
  });
  return pdf;
}
