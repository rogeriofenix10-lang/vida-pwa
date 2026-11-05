const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MAX_PROMPT_LENGTH = 12000;
const MAX_HISTORY_MESSAGES = 20;
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const R2_LIMITS = { bytes: 10 * 1024 * 1024 * 1024, classA: 1000000, classB: 10000000 };
const R2_GUARD = 0.98;
const IRIS_SYSTEM_PROMPT = `Você é a Íris, consultora sênior multidisciplinar e assistente em português do Brasil.

Atue com rigor, não invente dados e diferencie fatos, estimativas e opiniões. Especialidades: marketing e inteligência artificial em nível avançado; estratégia, posicionamento, branding, pesquisa, segmentação, funil, conteúdo, mídia, métricas, automação e dados; Excel e Google Sheets, fórmulas, tabelas dinâmicas, validação, dashboards e modelagem; comercial, vendas, canais, precificação, margem e negociação; finanças, economia, administração e projetos; contratos e direito empresarial, civil e tributário, sempre avisando que não substitui advogado ou contador; textos, roteiros, apresentações, imagens, vídeos e áudio; saúde apenas de modo educacional, sem diagnóstico ou prescrição.

Responda com clareza e recomendação prática. Para voz, seja natural e direto. Se o usuário disser pare, parar, silêncio ou cancele a leitura, confirme e não continue. Nunca envie e-mails, crie eventos, compartilhe arquivos ou execute ações externas sem autorização explícita. Quando houver e-mail autorizado, informe a quantidade, liste títulos e remetentes um a um, leia o conteúdo somente quando solicitado e pare imediatamente ao comando do usuário.`;

function origins(v) { return v ? v.split(",").map(x => x.trim()).filter(Boolean) : []; }
function cors(o, c) { const list = origins(c); const ok = o && (list.includes(o) || (o.startsWith("https://") && o.endsWith(".pages.dev"))); return { "Access-Control-Allow-Origin": ok ? o : (list[0] || "*"), "Access-Control-Allow-Headers": "content-type, authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Credentials": "true", Vary: "Origin" }; }
function json(body, status, o, c, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(o, c), ...extra } }); }
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function unb64(s) { const t = s.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((s.length + 3) % 4); return Uint8Array.from(atob(t), c => c.charCodeAt(0)); }
async function cryptoKey(secret) { return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function seal(value, secret) { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(secret), new TextEncoder().encode(JSON.stringify(value))); return b64(iv) + "." + b64(data); }
async function openSeal(value, secret) { const [iv, data] = String(value || "").split("."); if (!iv || !data) return null; try { const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await cryptoKey(secret), unb64(data)); return JSON.parse(new TextDecoder().decode(raw)); } catch { return null; } }
function cookies(req) { return Object.fromEntries((req.headers.get("Cookie") || "").split(";").map(x => x.trim().split("=")).filter(x => x.length === 2)); }
function cookie(name, value, maxAge) { return `${name}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`; }
function redirectLocation(env) { return env.GOOGLE_REDIRECT_URI || "https://iris-gemini-proxy.rogeriofenix10.workers.dev/oauth/callback"; }
function oauthStart(env) { const state = b64(crypto.getRandomValues(new Uint8Array(18))); const u = new URL("https://accounts.google.com/o/oauth2/v2/auth"); u.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectLocation(env), response_type: "code", access_type: "offline", prompt: "consent", scope: GMAIL_SCOPE, state }).toString(); return new Response(null, { status: 302, headers: { Location: u.toString(), "Set-Cookie": cookie("iris_oauth_state", state, 600) } }); }
async function exchangeCode(code, env) { const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectLocation(env), grant_type: "authorization_code" }) }); return { ok: r.ok, data: await r.json() }; }
async function gmailToken(req, env) { const stored = env.IRIS_GMAIL_OAUTH ? await env.IRIS_GMAIL_OAUTH.get("session") : null; const session = stored ? JSON.parse(stored) : await openSeal(cookies(req).iris_gmail, env.GOOGLE_CLIENT_SECRET); if (!session) return null; if (session.expires_at > Date.now() + 60000) return { session }; const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: session.refresh_token, grant_type: "refresh_token" }) }); const data = await r.json(); if (!r.ok || !data.access_token) return null; const renewed = { ...session, access_token: data.access_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000 }; if (env.IRIS_GMAIL_OAUTH) await env.IRIS_GMAIL_OAUTH.put("session", JSON.stringify(renewed), { expirationTtl: 2592000 }); return { session: renewed };
}
async function gmail(req, env, path) { const token = await gmailToken(req, env); if (!token) return json({ error: "Gmail não autorizado. Abra /oauth/start primeiro." }, 401, req.headers.get("Origin"), env.ALLOWED_ORIGIN); const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/" + path); const r = await fetch(url, { headers: { Authorization: "Bearer " + token.session.access_token } }); const data = await r.json(); const extra = token.cookie ? { "Set-Cookie": cookie("iris_gmail", token.cookie, 2592000) } : {}; return json(data, r.status, req.headers.get("Origin"), env.ALLOWED_ORIGIN, extra); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function gemini(model, key, payload) { const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key); let last; for (let i = 0; i < 3; i++) { try { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const d = await r.json(); if (r.ok) return { r, d }; last = { r, d }; if (![408, 429, 500, 502, 503, 504].includes(r.status)) return last; if (i < 2) await sleep(1000 * 2 ** i); } catch (e) { last = { e }; if (i < 2) await sleep(1000 * 2 ** i); } } return last; }

function userId(req, env) { return req.headers.get("X-Iris-User") || env.IRIS_USER_ID || "owner"; }
async function dbJson(req, env, kind) {
  if (!env.IRIS_DB) return json({ error: "Banco D1 não vinculado ao Worker." }, 503, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const uid = userId(req, env);
  if (req.method === "GET") {
    const tables = { settings: "iris_settings", radar: "iris_radar", finances: "iris_finances", documents: "iris_documents", conversations: "iris_conversations" };
    const table = tables[kind]; if (!table) return json({ error: "Tipo inválido." }, 400, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
    const r = await env.IRIS_DB.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500`).bind(uid).all();
    return json({ items: r.results || [] }, 200, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  }
  if (req.method !== "POST") return json({ error: "Use GET ou POST." }, 405, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  let body; try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, req.headers.get("Origin"), env.ALLOWED_ORIGIN); }
  const id = String(body.id || crypto.randomUUID());
  if (kind === "settings") {
    if (!body.key) return json({ error: "key obrigatório." }, 400, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
    await env.IRIS_DB.prepare("INSERT INTO iris_settings(user_id,key,value,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").bind(uid, String(body.key), JSON.stringify(body.value ?? null)).run();
  } else if (kind === "radar") {
    await env.IRIS_DB.prepare("INSERT OR REPLACE INTO iris_radar(id,user_id,label,detail,status,category,due_at,payload,updated_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(id,uid,String(body.label||""),String(body.detail||""),String(body.status||"pending"),String(body.category||"Geral"),body.due_at||null,JSON.stringify(body.payload||{})).run();
  } else if (kind === "finances") {
    await env.IRIS_DB.prepare("INSERT OR REPLACE INTO iris_finances(id,user_id,type,description,amount_cents,status,due_at,payload,updated_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(id,uid,String(body.type||"expense"),String(body.description||""),Number(body.amount_cents||0),String(body.status||"open"),body.due_at||null,JSON.stringify(body.payload||{})).run();
  } else if (kind === "documents") {
    await env.IRIS_DB.prepare("INSERT OR REPLACE INTO iris_documents(id,user_id,name,mime_type,storage_key,payload) VALUES(?,?,?,?,?,?)").bind(id,uid,String(body.name||""),body.mime_type||null,body.storage_key||null,JSON.stringify(body.payload||{})).run();
  } else return json({ error: "Tipo inválido." }, 400, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  return json({ ok: true, id }, 200, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
}

async function storageQuota(req, env) {
  if (!env.IRIS_DB) return json({ error: "Banco D1 não vinculado ao Worker." }, 503, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const uid = userId(req, env), period = new Date().toISOString().slice(0, 7);
  const row = await env.IRIS_DB.prepare("SELECT stored_bytes,class_a,class_b,updated_at FROM iris_storage_usage WHERE user_id = ? AND period = ?").bind(uid, period).first();
  const usage = { bytes: Number(row?.stored_bytes || 0), classA: Number(row?.class_a || 0), classB: Number(row?.class_b || 0) };
  const percent = { storage: usage.bytes / R2_LIMITS.bytes, classA: usage.classA / R2_LIMITS.classA, classB: usage.classB / R2_LIMITS.classB };
  const blocked = Object.values(percent).some(value => value >= R2_GUARD);
  return json({ ok: true, period, limits: R2_LIMITS, usage, percent, guardPercent: R2_GUARD, blocked, warning: blocked ? "Franquia protegida: novas operações R2 bloqueadas antes do limite gratuito." : null }, 200, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
}

async function storageFile(req, env, id) {
  if (!env.IRIS_DB || !env.IRIS_FILES) return json({ error: "Armazenamento R2 não vinculado ao Worker." }, 503, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const uid = userId(req, env), period = new Date().toISOString().slice(0, 7);
  const row = await env.IRIS_DB.prepare("SELECT id,name,mime_type,storage_key,payload FROM iris_documents WHERE id=? AND user_id=?").bind(id, uid).first();
  if (!row?.storage_key) return json({ error: "Arquivo não encontrado." }, 404, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  if (req.method === "GET") {
    const usage = await env.IRIS_DB.prepare("SELECT class_b FROM iris_storage_usage WHERE user_id=? AND period=?").bind(uid, period).first();
    if (Number(usage?.class_b || 0) + 1 >= R2_LIMITS.classB * R2_GUARD) return json({ error: "Franquia de leituras protegida em 98%." }, 429, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
    const object = await env.IRIS_FILES.get(row.storage_key);
    if (!object) return json({ error: "Objeto não encontrado no R2." }, 404, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
    await env.IRIS_DB.prepare("INSERT INTO iris_storage_usage(user_id,period,class_b,updated_at) VALUES(?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(user_id,period) DO UPDATE SET class_b=class_b+1,updated_at=CURRENT_TIMESTAMP").bind(uid, period).run();
    const headers = new Headers(cors(req.headers.get("Origin"), env.ALLOWED_ORIGIN)); headers.set("Content-Type", row.mime_type || object.httpMetadata?.contentType || "application/octet-stream"); headers.set("Content-Length", String(object.size)); headers.set("Content-Disposition", `inline; filename="${String(row.name || "arquivo").replace(/["\r\n]/g, "")}"`);
    return new Response(object.body, { status: 200, headers });
  }
  if (req.method === "DELETE") {
    await env.IRIS_FILES.delete(row.storage_key);
    await env.IRIS_DB.batch([
      env.IRIS_DB.prepare("DELETE FROM iris_documents WHERE id=? AND user_id=?").bind(id, uid),
      env.IRIS_DB.prepare("INSERT INTO iris_storage_usage(user_id,period,stored_bytes,updated_at) VALUES(?,?,0,CURRENT_TIMESTAMP) ON CONFLICT(user_id,period) DO UPDATE SET stored_bytes=MAX(0,stored_bytes-?),updated_at=CURRENT_TIMESTAMP").bind(uid, period, Number(row.payload ? JSON.parse(row.payload).size || 0 : 0)),
    ]);
    return json({ ok: true, id }, 200, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  }
  return json({ error: "Método não permitido." }, 405, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
}

async function storageUpload(req, env) {
  if (!env.IRIS_DB || !env.IRIS_FILES) return json({ error: "Armazenamento R2 não vinculado ao Worker." }, 503, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  if (req.method !== "POST") return json({ error: "Use POST." }, 405, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const uid = userId(req, env), period = new Date().toISOString().slice(0, 7), usage = await env.IRIS_DB.prepare("SELECT stored_bytes,class_a FROM iris_storage_usage WHERE user_id=? AND period=?").bind(uid, period).first();
  const contentType = req.headers.get("Content-Type") || "application/octet-stream";
  let id = req.headers.get("X-Iris-File-Id") || crypto.randomUUID(), name = req.headers.get("X-Iris-Filename") || "arquivo", mime = contentType, data;
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const form = await req.formData(), file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Use upload binário direto com X-Iris-Filename ou envie um campo file válido." }, 400, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
    id = String(form.get("id") || id); name = String(file.name || name); mime = file.type || mime; data = await file.arrayBuffer();
  } else data = await req.arrayBuffer();
  const size = Number(data.byteLength || 0); if (!size) return json({ error: "Arquivo vazio." }, 400, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  if (Number(usage?.stored_bytes || 0) + size >= R2_LIMITS.bytes * R2_GUARD || Number(usage?.class_a || 0) + 1 >= R2_LIMITS.classA * R2_GUARD) return json({ error: "Franquia protegida em 98%. Upload bloqueado." }, 429, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const key = `${uid}/${id}/${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  try {
    await env.IRIS_FILES.put(key, data, { httpMetadata: { contentType: mime } });
  } catch (error) {
    return json({ error: "R2.put falhou", detail: String(error?.message || error) }, 502, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  }
  try {
    await env.IRIS_DB.batch([
      env.IRIS_DB.prepare("INSERT OR REPLACE INTO iris_documents(id,user_id,name,mime_type,storage_key,payload) VALUES(?,?,?,?,?,?)").bind(id, uid, name, mime, key, JSON.stringify({ size, storedAt: new Date().toISOString() })),
      env.IRIS_DB.prepare("INSERT INTO iris_storage_usage(user_id,period,stored_bytes,class_a,updated_at) VALUES(?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(user_id,period) DO UPDATE SET stored_bytes=stored_bytes+?,class_a=class_a+1,updated_at=CURRENT_TIMESTAMP").bind(uid, period, size, size),
    ]);
  } catch (error) {
    try { await env.IRIS_FILES.delete(key); } catch {}
    return json({ error: "D1.batch falhou", detail: String(error?.message || error) }, 502, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  }
  return json({ ok: true, id, key, name, size }, 201, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
}

async function handle(req, env) {
  const o = req.headers.get("Origin"), c = env.ALLOWED_ORIGIN || "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(o, c) });
  const url = new URL(req.url);
  if (url.pathname === "/oauth/start") return oauthStart(env);
  if (url.pathname === "/oauth/callback") { const state = url.searchParams.get("state"), code = url.searchParams.get("code"); if (!state || state !== cookies(req).iris_oauth_state || !code) return new Response("Autorização inválida ou expirada.", { status: 400 }); const x = await exchangeCode(code, env); if (!x.ok || !x.data.refresh_token) return new Response("O Google não retornou autorização persistente. Tente novamente.", { status: 502 }); const session = { access_token: x.data.access_token, refresh_token: x.data.refresh_token, expires_at: Date.now() + (x.data.expires_in || 3600) * 1000 }; if (env.IRIS_GMAIL_OAUTH) await env.IRIS_GMAIL_OAUTH.put("session", JSON.stringify(session), { expirationTtl: 2592000 }); const response = new Response("Gmail autorizado para leitura. Você já pode voltar à Iris.", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }); response.headers.append("Set-Cookie", cookie("iris_oauth_state", "", 0)); return response; }
  if (url.pathname === "/gmail/status") return json({ authorized: !!(await gmailToken(req, env)) }, 200, o, c);
  if (url.pathname === "/gmail/messages") return gmail(req, env, "messages?maxResults=20");
  if (url.pathname === "/gmail/message") { const id = url.searchParams.get("id"); if (!id) return json({ error: "Informe id." }, 400, o, c); return gmail(req, env, "messages/" + encodeURIComponent(id) + "?format=full"); }
  if (url.pathname === "/db/health") return json({ ok: !!env.IRIS_DB, database: env.IRIS_DB ? "d1" : "missing" }, env.IRIS_DB ? 200 : 503, o, c);
  if (url.pathname === "/storage/quota") return storageQuota(req, env);
  if (url.pathname === "/storage/upload") return storageUpload(req, env);
  const storageMatch = url.pathname.match(/^\/storage\/file\/([^/]+)$/); if (storageMatch) return storageFile(req, env, decodeURIComponent(storageMatch[1]));
  const dataMatch = url.pathname.match(/^\/data\/(settings|radar|finances|documents|conversations)$/); if (dataMatch) return dbJson(req, env, dataMatch[1]);
  if (req.method === "GET") return json({ ok: true, service: "iris-gemini-proxy", model: env.GEMINI_MODEL || DEFAULT_MODEL }, 200, o, c);
  if (req.method !== "POST") return json({ error: "Use POST." }, 405, o, c);
  let body; try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, o, c); }
  if (/\b(r2|franquia|armazenamento|limite)\b/i.test(String(body?.message || body?.prompt || ""))) return storageQuota(req, env);
  const raw = body?.message ?? body?.prompt ?? "", message = typeof raw === "string" ? raw.trim() : ""; if (!message && !(Array.isArray(body?.messages) && body.messages.length)) return json({ error: "Mensagem não informada." }, 400, o, c); if (message.length > MAX_PROMPT_LENGTH) return json({ error: "Mensagem excede o limite de 12000 caracteres." }, 413, o, c); if (!env.GEMINI_API_KEY) return json({ error: "Chave da API do Gemini não configurada." }, 500, o, c); const contents = Array.isArray(body?.messages) && body.messages.length ? body.messages.slice(-MAX_HISTORY_MESSAGES).map(x => ({ role: x.role === "model" ? "model" : "user", parts: [{ text: String(x.text ?? x.content ?? "").slice(0, MAX_PROMPT_LENGTH) }] })).filter(x => x.parts[0].text) : [{ role: "user", parts: [{ text: message }] }]; const model = env.GEMINI_MODEL || DEFAULT_MODEL; const result = await gemini(model, env.GEMINI_API_KEY, { system_instruction: { parts: [{ text: IRIS_SYSTEM_PROMPT }] }, contents }); if (result?.r?.ok) return json({ text: result.d?.candidates?.[0]?.content?.parts?.map(x => x.text || "").join("").trim() || "Sem resposta gerada.", model }, 200, o, c); return json({ error: "Gemini HTTP " + (result?.r?.status || 503) + ".", details: result?.d?.error?.message || "Falha temporária após novas tentativas." }, result?.r?.status || 503, o, c);
}
export default { fetch: (req, env) => handle(req, env) };
