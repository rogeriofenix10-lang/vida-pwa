import type { ConnectorAdapter, ConnectorDefinition, ConnectorContext } from "./connector-types";
import type { ConnectorAction } from "./connector-contract";
import type { IntegrationCapability } from "./integration-manager";
import { getConnectorAccessToken } from "./oauth-connectors";
import { getGoogleToken } from "./oauth-integrations";

const registry = new Map<string, ConnectorAdapter & { actions?: ConnectorAction[]; health?: (ctx: ConnectorContext) => Promise<{ ok: boolean; detail?: string }> }>();

export function normalizeConnectorId(id: string) {
  return id.trim().toLowerCase().replace(/\s+/g, "-");
}

export function registerConnector(connector: ConnectorAdapter & { actions?: ConnectorAction[]; health?: (ctx: ConnectorContext) => Promise<{ ok: boolean; detail?: string }> }) {
  const id = normalizeConnectorId(connector.id);
  if (!id || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(id)) throw new Error("ID de conector inválido");
  if (registry.has(id)) throw new Error(`Conector já registrado: ${id}`);
  registry.set(id, { ...connector, id });
  return registry.get(id)!;
}

export function getConnector(id: string) { return registry.get(normalizeConnectorId(id)); }
export function listConnectors(): ConnectorDefinition[] { return [...registry.values()].map(({ connect: _c, disconnect: _d, execute: _e, ...definition }) => definition); }
export function connectorSupports(id: string, capability: IntegrationCapability) { return Boolean(getConnector(id)?.capabilities.includes(capability)); }

const lowRead = (name: string, capability: ConnectorAction["capability"] = "external:read"): ConnectorAction => ({ name, capability, risk: "low", confirmationRequired: false });
const send = (name: string): ConnectorAction => ({ name, capability: "communication:send", risk: "medium", confirmationRequired: true });
const write = (name: string): ConnectorAction => ({ name, capability: "external:write", risk: "medium", confirmationRequired: true });

async function googleFetch(ctx: ConnectorContext, product: "gmail" | "calendar" | "drive", path: string, init: RequestInit = {}) {
  const token = await getGoogleToken(ctx.db, ctx.userId, product);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`https://www.googleapis.com/${path.replace(/^\//, "")}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15_000) });
  const raw = await response.text();
  let data: unknown = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(`Google ${product} API respondeu HTTP ${response.status}`);
  return data;
}

const builtins: Array<ConnectorAdapter & { actions?: ConnectorAction[]; health?: (ctx: ConnectorContext) => Promise<{ ok: boolean; detail?: string }> }> = [
  {
    id: "google:gmail", name: "Gmail", category: "google", auth: "oauth2", capabilities: ["communication:send", "external:read"], official: true,
    description: "Gmail API oficial com OAuth 2.0.", supports: ["buscar e-mails", "enviar e-mail"], actions: [lowRead("messages.list"), send("messages.send")],
    execute: async (ctx, action, input: any) => {
      if (action === "messages.list") {
        const q = String(input?.query || "").trim();
        const query = q ? `gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${Math.min(Math.max(Number(input?.maxResults || 10), 1), 100)}` : `gmail/v1/users/me/messages?maxResults=${Math.min(Math.max(Number(input?.maxResults || 10), 1), 100)}`;
        return googleFetch(ctx, "gmail", query);
      }
      if (action === "messages.send") {
        const to = String(input?.to || "").trim(); const subject = String(input?.subject || "").trim(); const body = String(input?.body || "");
        if (!to || !subject || !body) throw new Error("Gmail exige to, subject e body");
        const raw = Buffer.from(`To: ${to}
Subject: ${subject}
Content-Type: text/plain; charset=UTF-8

${body}`, "utf8").toString("base64url");
        return googleFetch(ctx, "gmail", "gmail/v1/users/me/messages/send", { method: "POST", body: JSON.stringify({ raw }) });
      }
      throw new Error("Ação Gmail não suportada");
    },
  },
  {
    id: "google:calendar", name: "Google Calendar", category: "google", auth: "oauth2", capabilities: ["calendar:read", "calendar:write"], official: true,
    description: "Google Calendar API oficial com OAuth 2.0.", supports: ["consultar agenda", "criar eventos"], actions: [lowRead("events.list", "calendar:read"), write("events.create")],
    execute: async (ctx, action, input: any) => {
      if (action === "events.list") {
        const max = Math.min(Math.max(Number(input?.maxResults || 20), 1), 250);
        const timeMin = input?.timeMin ? `&timeMin=${encodeURIComponent(String(input.timeMin))}` : "";
        const timeMax = input?.timeMax ? `&timeMax=${encodeURIComponent(String(input.timeMax))}` : "";
        return googleFetch(ctx, "calendar", `calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=${max}${timeMin}${timeMax}`);
      }
      if (action === "events.create") {
        const summary = String(input?.summary || "").trim(); const start = String(input?.start || "").trim(); const end = String(input?.end || "").trim();
        if (!summary || !start || !end) throw new Error("Calendar exige summary, start e end");
        return googleFetch(ctx, "calendar", "calendar/v3/calendars/primary/events", { method: "POST", body: JSON.stringify({ summary, description: input?.description || undefined, location: input?.location || undefined, start: { dateTime: start }, end: { dateTime: end } }) });
      }
      throw new Error("Ação Calendar não suportada");
    },
  },
  {
    id: "google:drive", name: "Google Drive", category: "google", auth: "oauth2", capabilities: ["external:read"], official: true,
    description: "Google Drive API oficial com OAuth 2.0.", supports: ["buscar arquivos"], actions: [lowRead("files.search")],
    execute: async (ctx, action, input: any) => {
      if (action !== "files.search") throw new Error("Ação Drive não suportada");
      const q = String(input?.query || "trashed = false").trim() || "trashed = false";
      return googleFetch(ctx, "drive", `drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${Math.min(Math.max(Number(input?.pageSize || 20), 1), 100)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)`);
    },
  },
  {
    id: "whatsapp", name: "WhatsApp", category: "communication", auth: "oauth2", capabilities: ["communication:send", "external:read"], official: true,
    description: "WhatsApp Cloud API oficial da Meta.", supports: ["mensagens", "envio autorizado"], actions: [send("messages.send")],
    execute: async (ctx, action, input: any) => {
      if (action !== "messages.send") throw new Error("Ação WhatsApp não suportada");
      const phoneNumberId = String(input?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
      const to = String(input?.to || "").trim(); const text = String(input?.text || "").trim();
      if (!phoneNumberId || !to || !text) throw new Error("WhatsApp exige phoneNumberId, to e text");
      const { token } = await getConnectorAccessToken(ctx.db, ctx.userId, "meta:whatsapp");
      const version = process.env.META_GRAPH_VERSION || "v23.0";
      const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } }), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`WhatsApp API respondeu HTTP ${response.status}`);
      return await response.json();
    },
  },
  {
    id: "instagram", name: "Instagram", category: "social", auth: "oauth2", capabilities: ["external:read", "communication:send"], official: true,
    description: "Instagram Graph API oficial da Meta.", supports: ["mídia", "publicação autorizada"], actions: [lowRead("content.list")],
    execute: async (ctx, action, input: any) => {
      if (action !== "content.list") throw new Error("Ação Instagram não suportada");
      const igUserId = String(input?.igUserId || process.env.INSTAGRAM_USER_ID || "").trim();
      if (!igUserId) throw new Error("Instagram exige igUserId");
      const { token } = await getConnectorAccessToken(ctx.db, ctx.userId, "meta:instagram");
      const version = process.env.META_GRAPH_VERSION || "v23.0";
      const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(igUserId)}/media`); url.searchParams.set("access_token", token); url.searchParams.set("fields", "id,caption,media_type,media_url,permalink,timestamp");
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`Instagram API respondeu HTTP ${response.status}`); return await response.json();
    },
  },
  {
    id: "facebook", name: "Facebook", category: "social", auth: "oauth2", capabilities: ["external:read", "communication:send"], official: true,
    description: "Facebook Graph API oficial para páginas.", supports: ["páginas", "publicação autorizada"], actions: [lowRead("pages.read")],
    execute: async (ctx, action) => {
      if (action !== "pages.read") throw new Error("Ação Facebook não suportada");
      const { token } = await getConnectorAccessToken(ctx.db, ctx.userId, "meta:facebook");
      const version = process.env.META_GRAPH_VERSION || "v23.0";
      const url = new URL(`https://graph.facebook.com/${version}/me/accounts`); url.searchParams.set("access_token", token); url.searchParams.set("fields", "id,name,access_token,tasks");
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`Facebook API respondeu HTTP ${response.status}`); return await response.json();
    },
  },
  {
    id: "x", name: "X", category: "social", auth: "oauth2", capabilities: ["external:read", "communication:send"], official: true,
    description: "X API v2 oficial com OAuth 2.0 + PKCE.", supports: ["pesquisa", "publicação autorizada"], actions: [lowRead("posts.search"), send("posts.create")],
    execute: async (ctx, action, input: any) => {
      const { token } = await getConnectorAccessToken(ctx.db, ctx.userId, "x");
      if (action === "posts.search") { const url = new URL("https://api.x.com/2/tweets/search/recent"); url.searchParams.set("query", String(input?.query || "from:twitterdev")); url.searchParams.set("max_results", String(Math.min(Math.max(Number(input?.maxResults || 10), 10), 100))); const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`X API respondeu HTTP ${response.status}`); return await response.json(); }
      if (action === "posts.create") { const text = String(input?.text || "").trim(); if (!text) throw new Error("Texto obrigatório"); const response = await fetch("https://api.x.com/2/tweets", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`X API respondeu HTTP ${response.status}`); return await response.json(); }
      throw new Error("Ação X não suportada");
    },
  },
  {
    id: "tiktok", name: "TikTok", category: "social", auth: "oauth2", capabilities: ["external:read", "communication:send"], official: true,
    description: "TikTok Display API oficial com Login Kit OAuth 2.0.", supports: ["perfil", "vídeos autorizados"], actions: [lowRead("content.list")],
    execute: async (ctx, action) => {
      if (action !== "content.list") throw new Error("Ação TikTok não suportada");
      const { token } = await getConnectorAccessToken(ctx.db, ctx.userId, "tiktok");
      const url = new URL("https://open.tiktokapis.com/v2/video/list/"); url.searchParams.set("fields", "id,title,create_time,duration,cover_image_url");
      const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20 }), signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`TikTok API respondeu HTTP ${response.status}`); return await response.json();
    },
  },
  { id: "telegram", name: "Telegram", category: "communication", auth: "api_key", capabilities: ["communication:send", "external:read"], official: true, description: "Conector para Bot API.", supports: ["mensagens"], actions: [lowRead("messages.list"), send("messages.send")] },
  { id: "linkedin", name: "LinkedIn", category: "social", auth: "oauth2", capabilities: ["external:read", "communication:send"], official: true, description: "Conector para APIs oficiais do LinkedIn.", supports: ["conteúdo", "publicação autorizada"], actions: [lowRead("content.list"), send("content.publish")] },
  {
    id: "waze", name: "Waze", category: "navigation", auth: "none", capabilities: ["external:read"], official: true,
    description: "Navegação por deep links oficiais suportados, sem exigir credencial da conta.", supports: ["rota", "navegação", "mobilidade"], actions: [lowRead("route.build")],
    execute: async (_ctx, action, input: any) => {
      if (action !== "route.build") throw new Error("Ação Waze não suportada");
      const destination = String(input?.destination ?? "").trim();
      if (!destination) throw new Error("Destino obrigatório");
      return { url: `https://www.waze.com/ul?q=${encodeURIComponent(destination)}&navigate=yes`, destination };
    },
  },
  {
    id: "google:maps", name: "Google Maps", category: "navigation", auth: "none", capabilities: ["external:read"], official: true,
    description: "Mapas e rotas por recursos oficiais disponíveis.", supports: ["rota", "localização"], actions: [lowRead("route.build")],
    execute: async (_ctx, action, input: any) => {
      if (action !== "route.build") throw new Error("Ação Google Maps não suportada");
      const destination = String(input?.destination ?? "").trim();
      if (!destination) throw new Error("Destino obrigatório");
      return { url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`, destination };
    },
  },
  { id: "booking", name: "Booking.com", category: "travel", auth: "api_key", capabilities: ["external:read"], official: true, description: "Booking.com Demand/Connectivity APIs oficiais; acesso depende de programa/parceria.", supports: ["pesquisar hospedagem", "informações de viagem"], actions: [lowRead("stays.search")] },
  { id: "airbnb", name: "Airbnb", category: "travel", auth: "oauth2", capabilities: ["external:read"], official: true, description: "Conector reservado a acesso oficial/parceiro do Airbnb; sem automação não oficial.", supports: ["informações de viagem"], actions: [lowRead("stays.search")] },
  { id: "slack", name: "Slack", category: "productivity", auth: "oauth2", capabilities: ["communication:send", "external:read"], official: true, description: "Comunicação por API oficial.", supports: ["mensagens", "pesquisa"], actions: [lowRead("messages.search"), send("messages.send")] },
  { id: "discord", name: "Discord", category: "communication", auth: "api_key", capabilities: ["communication:send", "external:read"], official: true, description: "Comunicação via integrações oficiais suportadas.", supports: ["mensagens"], actions: [lowRead("messages.list"), send("messages.send")] },
  { id: "notion", name: "Notion", category: "productivity", auth: "oauth2", capabilities: ["external:read", "external:write"], official: true, description: "Documentos e bases por API oficial.", supports: ["pesquisa", "criação autorizada"], actions: [lowRead("search"), write("pages.create")] },
  { id: "trello", name: "Trello", category: "productivity", auth: "api_key", capabilities: ["external:read", "external:write"], official: true, description: "Quadros e tarefas por API oficial.", supports: ["consultar cartões", "criar cartões"], actions: [lowRead("cards.list"), write("cards.create")] },
];

for (const connector of builtins) registerConnector(connector);
