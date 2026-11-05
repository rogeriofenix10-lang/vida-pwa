import { invokeLLM } from "./_core/llm";

type Provider = "manus" | "chatgpt" | "gemini" | "kimi";
type Message = { role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> };

type AdapterInput = { provider: Provider; apiKey?: string; model?: string; messages: Message[]; responseFormat?: Record<string, unknown> };
export type AttachmentInput = { type: "image_url" | "file_url"; url: string; mimeType?: string };

export function validateAttachments(provider: Provider, attachments: AttachmentInput[] = []) {
  if (!attachments.length) return;
  const supportsFiles = provider === "manus" || provider === "chatgpt" || provider === "gemini";
  const supportsImages = provider !== "kimi";
  if (attachments.some((attachment) => attachment.type === "image_url") && !supportsImages) throw new Error("O Kimi não está configurado para analisar imagens neste aplicativo.");
  if (attachments.some((attachment) => attachment.type === "file_url") && !supportsFiles) throw new Error(`O provedor ${provider} não aceita arquivos neste aplicativo.`);
  if (provider === "gemini" && attachments.some((attachment) => (attachment.type === "file_url" || attachment.type === "image_url") && !attachment.url.startsWith("data:"))) throw new Error("O Gemini precisa receber imagens e arquivos como conteúdo inline; reenvie o anexo para conversão.");
}

function textFromContent(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : "").join("\n");
  return "";
}

async function openAiCompatible(baseUrl: string, apiKey: string, model: string, input: AdapterInput) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: input.messages, response_format: input.responseFormat }),
  });
  if (!response.ok) throw new Error(`Provedor ${input.provider} retornou ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Resposta sem conteúdo do provedor");
  return content;
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

function geminiParts(content: Message["content"]): GeminiPart[] {
  if (typeof content === "string") return [{ text: content }];
  return content.reduce<GeminiPart[]>((parts, part) => {
    if (part.type === "text") return [...parts, { text: String(part.text ?? "") }];
    const source = part.type === "image_url" ? (part.image_url as { url?: string } | undefined)?.url : (part.file_url as { url?: string } | undefined)?.url;
    if (!source?.startsWith("data:")) return [...parts, { text: "[Anexo externo não disponível para o adaptador Gemini]" }];
    const match = source.match(/^data:([^;]+);base64,(.+)$/);
    return match ? [...parts, { inlineData: { mimeType: match[1] ?? "application/octet-stream", data: match[2] ?? "" } }] : [...parts, { text: "[Anexo inválido]" }];
  }, []);
}

async function gemini(apiKey: string, model: string, input: AdapterInput) {
  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = input.messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: geminiParts(message.content) }));
  const system = input.messages.find((message) => message.role === "system");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: textFromContent(system.content) }] } : undefined, contents }),
  });
  if (!response.ok) throw new Error(`Gemini retornou ${response.status}`);
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!content) throw new Error("Gemini retornou resposta vazia");
  return content;
}

export async function completeWithProvider(input: AdapterInput) {
  if (input.provider === "manus") {
    const response = await invokeLLM({ model: input.model, messages: input.messages as never, response_format: input.responseFormat as never });
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Manus retornou resposta vazia");
    return content;
  }
  if (!input.apiKey) {
    if (input.provider === "kimi") throw new Error(`Chave de API não configurada para ${input.provider}`);
    const response = await invokeLLM({ model: input.model, messages: input.messages as never, response_format: input.responseFormat as never });
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Gateway retornou resposta vazia");
    return content;
  }
  if (input.provider === "gemini") return gemini(input.apiKey, input.model ?? "gemini-1.5-flash", input);
  if (input.provider === "kimi") return openAiCompatible("https://api.moonshot.cn/v1", input.apiKey, input.model ?? "moonshot-v1-8k", input);
  return openAiCompatible("https://api.openai.com/v1", input.apiKey, input.model ?? "gpt-4o-mini", input);
}
