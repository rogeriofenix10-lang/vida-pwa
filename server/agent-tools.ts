import type { MySql2Database } from "drizzle-orm/mysql2";
import { aiMemories, radarItems, storageFiles } from "../drizzle/schema";
import { and, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { externalSearch } from "./integrations";
import { postIntegration } from "./integration-manager";
import { getGoogleToken } from "./oauth-integrations";

type ToolRisk = "low" | "medium" | "high";
export type ToolScope = "radar:read" | "radar:write" | "memory:read" | "memory:write" | "documents:read" | "calendar:read" | "calendar:write" | "communication:prepare" | "communication:send" | "external:read" | "external:write";
export type ToolCategory = "productivity" | "memory" | "communication" | "external";
export type AgentToolContext = { db: MySql2Database<any>; userId: number };
export type AgentTool = {
  name: string; risk: ToolRisk; scope: ToolScope; category: ToolCategory;
  description: string; capabilities: string[]; supportsCompensation?: boolean;
  inputSchema: z.ZodType;
  execute: (ctx: AgentToolContext, input: unknown) => Promise<{ result: unknown }>;
};

const priorities = ["urgente", "importante", "atencao", "normal", "informacao"] as const;
type RadarCreateInput = { label:string; detail:string; dateLabel:string; priority:typeof priorities[number]; action:string; dueAt:string|null; reminderAt:string|null; timezone:string };

const radarCreateSchema=z.object({label:z.string().trim().min(1).max(255),detail:z.string().trim().min(1).max(4000),dateLabel:z.string().max(64).default(""),priority:z.enum(priorities),action:z.string().max(255).default(""),dueAt:z.string().datetime().nullable().default(null),reminderAt:z.string().datetime().nullable().default(null),timezone:z.string().max(64).default("America/Sao_Paulo")});
const radarCreate: AgentTool = {
  name:"radar.create", risk:"low", scope:"radar:write", category:"productivity", inputSchema:radarCreateSchema,
  description:"Cria um item persistente no Radar do usuário.", capabilities:["criar lembrete","criar tarefa","organizar pendência","acompanhar prazo"],
  async execute({db,userId}, raw) {
    const input=radarCreateSchema.parse(raw);
    if(!input.label?.trim()||!input.detail?.trim()) throw new Error("Dados do Radar incompletos");
    if(!priorities.includes(input.priority)) throw new Error("Prioridade inválida");
    const inserted=await db.insert(radarItems).values({userId,label:input.label.trim().slice(0,255),detail:input.detail.trim().slice(0,4000),dateLabel:(input.dateLabel??"").slice(0,64),priority:input.priority,action:(input.action??"").slice(0,255),dueAt:input.dueAt?new Date(input.dueAt):null,reminderAt:input.reminderAt?new Date(input.reminderAt):null,timezone:(input.timezone||"America/Sao_Paulo").slice(0,64)});
    return {result:{radarItemId:Number(inserted[0].insertId)}};
  }
};

const memoryCreateSchema=z.object({content:z.string().trim().min(1).max(4000),source:z.string().max(64).default("agent-approved")});
const memoryCreate: AgentTool = {
  name:"memory.create", risk:"low", scope:"memory:write", category:"memory", inputSchema:memoryCreateSchema,
  description:"Registra uma memória operacional explicitamente autorizada pelo usuário.", capabilities:["guardar preferência","registrar contexto","aprender com resultado"],
  async execute({db,userId}, raw) {
    const input=memoryCreateSchema.parse(raw);
    const inserted=await db.insert(aiMemories).values({userId,content:input.content,source:input.source});
    return {result:{memoryId:Number(inserted[0].insertId)}};
  }
};

const radarCompleteSchema=z.object({radarItemId:z.number().int().positive()});
const radarComplete: AgentTool = {
  name:"radar.complete", risk:"low", scope:"radar:write", category:"productivity", inputSchema:radarCompleteSchema,
  description:"Conclui um item do Radar pertencente ao usuário.", capabilities:["concluir tarefa","marcar lembrete como concluído"],
  async execute({db,userId}, raw) {
    const input=radarCompleteSchema.parse(raw);
    const result=await db.update(radarItems).set({status:"completed"}).where(and(eq(radarItems.id,input.radarItemId),eq(radarItems.userId,userId)));
    if((result as any).rowsAffected!==undefined && (result as any).rowsAffected!==1) throw new Error("Item do Radar não encontrado");
    return {result:{radarItemId:input.radarItemId,status:"completed"}};
  }
};

const documentsSearchSchema=z.object({query:z.string().trim().min(1).max(180)});
const documentsSearch: AgentTool={name:"documents.search",risk:"low",scope:"documents:read",category:"productivity",inputSchema:documentsSearchSchema,description:"Pesquisa documentos pertencentes ao usuário no armazenamento IRIS e, quando conectado, no Google Drive.",capabilities:["localizar documento","buscar arquivo"],async execute({db,userId},raw){const input=documentsSearchSchema.parse(raw);const q=`%${input.query}%`;const rows=await db.select({id:storageFiles.id,originalName:storageFiles.originalName,mimeType:storageFiles.mimeType,sizeBytes:storageFiles.sizeBytes,createdAt:storageFiles.createdAt}).from(storageFiles).where(and(eq(storageFiles.userId,userId),or(like(storageFiles.originalName,q),like(storageFiles.mimeType,q)))).limit(20);let drive:unknown[]=[];try{const token=await getGoogleToken(db,userId,"drive");const query=`name contains '${input.query.replace(/'/g,"\\'")}' and trashed = false`;const r=await fetch(`https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=20&fields=files(id,name,mimeType,modifiedTime,webViewLink)&q=${encodeURIComponent(query)}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});if(r.ok){const data=await r.json() as {files?:unknown[]};drive=data.files??[]}}catch{}return {result:{query:input.query,count:rows.length+drive.length,documents:rows,drive}};}};

const externalSearchSchema=z.object({query:z.string().trim().min(2).max(500)});
const externalSearchTool: AgentTool={name:"external.search",risk:"medium",scope:"external:read",category:"external",inputSchema:externalSearchSchema,description:"Pesquisa na web por meio de um adaptador externo configurado pelo administrador.",capabilities:["pesquisa externa","consultar informação atual"],async execute(_ctx,raw){const input=externalSearchSchema.parse(raw);return {result:await externalSearch(input.query)}}};

const calendarCreateSchema=z.object({title:z.string().trim().min(1).max(200),startAt:z.string().datetime(),endAt:z.string().datetime().optional(),notes:z.string().max(2000).optional()});
const communicationPrepareSchema=z.object({channel:z.enum(["email","whatsapp","sms","other"]),recipient:z.string().trim().min(1).max(320),message:z.string().trim().min(1).max(4000),subject:z.string().trim().max(200).optional()});
const communicationPrepare:AgentTool={name:"communication.prepare",risk:"medium",scope:"communication:prepare",category:"communication",inputSchema:communicationPrepareSchema,description:"Prepara uma mensagem para revisão; nunca envia automaticamente.",capabilities:["redigir mensagem","preparar comunicação"],async execute(_ctx,raw){const input=communicationPrepareSchema.parse(raw);return {result:{status:"draft",...input}}}};

const communicationSendSchema=communicationPrepareSchema.extend({integration:z.string().trim().min(1).max(64).default("communication")});
const communicationSend:AgentTool={name:"communication.send",risk:"high",scope:"communication:send",category:"communication",inputSchema:communicationSendSchema,description:"Envia uma comunicação por uma integração configurada pelo usuário.",capabilities:["enviar mensagem","enviar comunicação"],async execute({db,userId},raw){const input=communicationSendSchema.parse(raw);if(input.integration==="google:gmail"||input.channel==="email"){const token=await getGoogleToken(db,userId,"gmail");const rawMessage=[`To: ${input.recipient}`,`Subject: ${input.subject ?? input.message.slice(0,80)}`,"Content-Type: text/plain; charset=UTF-8","",input.message].join("\r\n");const encoded=Buffer.from(rawMessage).toString("base64url");const r=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({raw:encoded}),signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error(`Gmail respondeu ${r.status}`);return {result:{status:"sent",channel:"email",recipient:input.recipient,provider:"google:gmail",response:await r.json()}}}const result=await postIntegration(db,userId,input.integration,"communication:send",{channel:input.channel,recipient:input.recipient,message:input.message});return {result:{status:"sent",channel:input.channel,recipient:input.recipient,provider:result.provider,response:result.data}}}};

const calendarCreateConfiguredSchema=calendarCreateSchema.extend({integration:z.string().trim().min(1).max(64).default("calendar")});
const calendarCreateConfigured:AgentTool={name:"calendar.create",risk:"medium",scope:"calendar:write",category:"productivity",inputSchema:calendarCreateConfiguredSchema,description:"Cria um evento em uma integração de agenda configurada pelo usuário.",capabilities:["criar evento","agendar compromisso"],async execute({db,userId},raw){const input=calendarCreateConfiguredSchema.parse(raw);if(input.integration==="google:calendar"||input.integration==="calendar"){const token=await getGoogleToken(db,userId,"calendar");const body={summary:input.title,description:input.notes??"",start:{dateTime:input.startAt},end:{dateTime:input.endAt??new Date(new Date(input.startAt).getTime()+3600000).toISOString()}};const r=await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error(`Google Calendar respondeu ${r.status}`);return {result:{status:"created",provider:"google:calendar",response:await r.json()}}}const result=await postIntegration(db,userId,input.integration,"calendar:write",{title:input.title,startAt:input.startAt,endAt:input.endAt??null,notes:input.notes??""});return {result:{status:"created",provider:result.provider,response:result.data}}}};

const TOOLS=new Map<string,AgentTool>([[radarCreate.name,radarCreate],[memoryCreate.name,memoryCreate],[radarComplete.name,radarComplete],[documentsSearch.name,documentsSearch],[externalSearchTool.name,externalSearchTool],[calendarCreateConfigured.name,calendarCreateConfigured],[communicationPrepare.name,communicationPrepare],[communicationSend.name,communicationSend]]);
export function getAgentTool(name:string){return TOOLS.get(name);}
export function listAgentTools(){return [...TOOLS.values()].map(({name,risk,scope,category,description,capabilities,supportsCompensation})=>({name,risk,scope,category,description,capabilities,supportsCompensation:Boolean(supportsCompensation)}));}
export function selectAgentTools(input:{intent:string;objective:string;message:string;riskLevel:ToolRisk}){
  const text=`${input.intent} ${input.objective} ${input.message}`.toLowerCase(); const selected:AgentTool[]=[];
  // Intentos estruturados vindos do núcleo cognitivo têm prioridade sobre heurísticas
  // de palavras-chave. Isso evita perder ações válidas quando a IA já classificou
  // explicitamente a intenção (ex.: create_radar_item).
  if(/\b(create_radar_item|create_reminder|create_task|schedule_task|radar_create)\b/i.test(input.intent) || /\b(lembrete|lembrar|lembra|tarefa|pendência|prazo|radar|agendar|anotar|acompanhar|criar tarefa)\b/i.test(text)) selected.push(radarCreate);
  if(/\b(concluir|concluída|concluido|finalizar tarefa|marcar como conclu[ií]d[ao])\b/i.test(text)) selected.push(radarComplete);
  if(/\b(guardar|guarde|lembrar de mim|memorizar|salvar preferência|aprenda|registre na memória)\b/i.test(text)) selected.push(memoryCreate);
  if(/\b(documento|documentos|arquivo|arquivos|pdf)\b/i.test(text) && /\b(buscar|pesquisar|encontrar|localizar|procure)\b/i.test(text)) selected.push(documentsSearch);
  if(/\b(pesquisar na internet|pesquisa na web|buscar na internet|notícias|cotação|preço atual)\b/i.test(text)) selected.push(externalSearchTool);
  if(/\b(agenda|calendário|calendario|compromisso|reunião|reuniao)\b/i.test(text) && /\b(criar|marcar|agendar)\b/i.test(text)) selected.push(calendarCreateConfigured);
  if(/\b(enviar|mande|mandar|mensagem|email|e-mail|whatsapp)\b/i.test(text)) selected.push(communicationPrepare);
  return selected.map(({name,risk,scope,category,description})=>({name,risk,scope,category,description}));
}
export function canToolExecute(name:string,allowedScopes:string[]=[]){const tool=TOOLS.get(name);return Boolean(tool&&allowedScopes.includes(tool.scope));}
