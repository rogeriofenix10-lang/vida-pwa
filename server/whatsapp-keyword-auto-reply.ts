const WHATSAPP_KEYWORDS = [
  "nota",
  "notas",
  "nota fiscal",
  "notas fiscais",
  "copias de pedidos",
  "duplicata",
  "duplicatas",
  "boleto",
  "boletos",
] as const;

export const WHATSAPP_AUTO_REPLY =
  "Olá,\n" +
  "(Tudo bem?\n" +
  "Gostaria de pedir, por favor, que você entre em contato com a Aline pelo WhatsApp no número (43) 3039-3112. Ela é a responsável por essa parte.)";

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function whatsappKeywordMatched(text: string): boolean {
  const normalized = normalizeText(text);

  return WHATSAPP_KEYWORDS.some((keyword) =>
    normalized.includes(normalizeText(keyword))
  );
}

export function getWhatsappAutoReply(text: string): string | null {
  return whatsappKeywordMatched(text) ? WHATSAPP_AUTO_REPLY : null;
}
