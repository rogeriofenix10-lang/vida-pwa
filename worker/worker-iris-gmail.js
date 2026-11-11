const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MAX_PROMPT_LENGTH = 12000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 24000;
const MAX_JSON_BYTES = 128 * 1024;
const MAX_LOGIN_BYTES = 4096;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const SESSION_TTL_SECONDS = 6 * 60 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const R2_LIMITS = { bytes: 10 * 1024 * 1024 * 1024, classA: 1000000, classB: 10000000 };
const R2_GUARD = 0.98;
const consumedOAuthNonces = new Map();
const IRIS_SYSTEM_PROMPT = `Você é a Íris, consultora sênior multidisciplinar e assistente em português do Brasil.

Atue com rigor, não invente dados e diferencie fatos, estimativas e opiniões. Especialidades: marketing e inteligência artificial em nível avançado; estratégia, posicionamento, branding, pesquisa, segmentação, funil, conteúdo, mídia, métricas, automação e dados; Excel e Google Sheets, fórmulas, tabelas dinâmicas, validação, dashboards e modelagem; comercial, vendas, canais, precificação, margem e negociação; finanças, economia, administração e projetos; contratos e direito empresarial, civil e tributário, sempre avisando que não substitui advogado ou contador; textos, roteiros, apresentações, imagens, vídeos e áudio; saúde apenas de modo educacional, sem diagnóstico ou prescrição.

Responda com clareza e recomendação prática. Para voz, seja natural e direto. Se o usuário disser pare, parar, silêncio ou cancele a leitura, confirme e não continue. Nunca envie e-mails, crie eventos, compartilhe arquivos ou execute ações externas sem autorização explícita. Quando houver e-mail autorizado, informe a quantidade, liste títulos e remetentes um a um, leia o conteúdo somente quando solicitado e pare imediatamente ao comando do usuário.`;

function origins(v) { return v ? v.split(",").map(x => x.trim()).filter(Boolean) : []; }
function cors(o, c) { const list = origins(c); const ok = o && (list.includes(o) || o === "https://gentle-bread-2f69.pages.dev"); return { ...(ok ? { "Access-Control-Allow-Origin": o } : {}), "Access-Control-Allow-Headers": "content-type, authorization, x-iris-confirm, x-iris-filename, x-iris-file-id", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", Vary: "Origin" }; }
function json(body, status, o, c, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(o, c), ...extra } }); }
function b64(bytes) { const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let binary = ""; for (let i = 0; i < value.length; i++) binary += String.fromCharCode(value[i]); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function unb64(s) { const t = s.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((s.length + 3) % 4); return Uint8Array.from(atob(t), c => c.charCodeAt(0)); }
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function hasAccessSecret(env) { return typeof env.IRIS_ACCESS_SECRET === "string" && env.IRIS_ACCESS_SECRET.length > 0 && env.IRIS_ACCESS_SECRET.trim().length > 0; }
async function hmacKey(secret, usages) { return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages); }
async function signJwt(payload, secret) {
  const header = b64(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64(encoder.encode(JSON.stringify(payload)));
  const input = `${header}.${body}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), encoder.encode(input)));
  return `${input}.${b64(signature)}`;
}
async function verifyJwt(token, secret) {
  try {
    if (typeof token !== "string" || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(decoder.decode(unb64(parts[0])));
    if (header?.alg !== "HS256" || header?.typ !== "JWT") return null;
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), unb64(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    return JSON.parse(decoder.decode(unb64(parts[1])));
  } catch { return null; }
}
async function constantTimeSecretMatch(candidate, secret) {
  const [left, right] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(candidate)), crypto.subtle.digest("SHA-256", encoder.encode(secret))]);
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}
async function readBoundedBytes(req, maxBytes) {
  const rawLength = req.headers.get("Content-Length");
  let declaredLength = null;
  if (rawLength !== null) {
    if (!/^\d+$/.test(rawLength)) return { ok: false, status: 400, error: "Content-Length inválido." };
    declaredLength = Number(rawLength);
    if (!Number.isSafeInteger(declaredLength)) return { ok: false, status: 400, error: "Content-Length inválido." };
    if (declaredLength > maxBytes) return { ok: false, status: 413, error: "Corpo excede o limite permitido." };
  }
  if (!req.body) {
    if (declaredLength && declaredLength !== 0) return { ok: false, status: 400, error: "Content-Length não corresponde ao corpo." };
    return { ok: true, bytes: new Uint8Array(0) };
  }
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return { ok: false, status: 413, error: "Corpo excede o limite permitido." };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "Não foi possível ler o corpo da requisição." };
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  if (declaredLength !== null && total !== declaredLength) return { ok: false, status: 400, error: "Content-Length não corresponde ao corpo." };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, bytes };
}
async function readJson(req, maxBytes = MAX_JSON_BYTES, allowEmpty = false) {
  const result = await readBoundedBytes(req, maxBytes);
  if (!result.ok) return result;
  if (result.bytes.length === 0 && allowEmpty) return { ok: true, value: {} };
  try {
    const value = JSON.parse(decoder.decode(result.bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, status: 400, error: "O JSON deve ser um objeto." };
    return { ok: true, value };
  } catch { return { ok: false, status: 400, error: "JSON inválido." }; }
}
function readJsonError(result, origin, allowed) { return json({ error: result.error }, result.status, origin, allowed); }
function cookies(req) { return Object.fromEntries((req.headers.get("Cookie") || "").split(";").map(x => x.trim().split("=")).filter(x => x.length === 2)); }
function cookie(name, value, maxAge) { return `${name}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`; }
function redirectLocation(env) { return env.GOOGLE_REDIRECT_URI || "https://iris-gemini-proxy.rogeriofenix10.workers.dev/oauth/callback"; }
async function issueSessionToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ sub: "owner", typ: "session", iat: now, exp: now + SESSION_TTL_SECONDS }, secret);
}
async function login(req, env, origin, allowed) {
  if (!hasAccessSecret(env)) return json({ error: "Autenticação indisponível." }, 503, origin, allowed);
  const parsed = await readJson(req, MAX_LOGIN_BYTES);
  if (!parsed.ok) return readJsonError(parsed, origin, allowed);
  if (typeof parsed.value.password !== "string" || parsed.value.password.length === 0 || !await constantTimeSecretMatch(parsed.value.password, env.IRIS_ACCESS_SECRET)) return json({ error: "Credenciais inválidas." }, 401, origin, allowed);
  const now = Math.floor(Date.now() / 1000);
  const token = await issueSessionToken(env.IRIS_ACCESS_SECRET);
  return json({ token, tokenType: "Bearer", expiresIn: SESSION_TTL_SECONDS, expiresAt: new Date((now + SESSION_TTL_SECONDS) * 1000).toISOString() }, 200, origin, allowed, { "Cache-Control": "no-store" });
}
async function authenticatedSubject(req, env, origin, allowed) {
  if (!hasAccessSecret(env)) return { response: json({ error: "Autenticação indisponível." }, 503, origin, allowed) };
  if (req.headers.has("X-Iris-User")) return { response: json({ error: "X-Iris-User não é aceito." }, 401, origin, allowed) };
  const header = req.headers.get("Authorization") || "";
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) return { response: json({ error: "Autenticação necessária." }, 401, origin, allowed) };
  const claims = await verifyJwt(match[1], env.IRIS_ACCESS_SECRET);
  const now = Math.floor(Date.now() / 1000);
  if (!claims || claims.typ !== "session" || claims.sub !== "owner" || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > now + 30 || claims.exp <= now || claims.exp <= claims.iat || claims.exp - claims.iat < 4 * 60 * 60 || claims.exp - claims.iat > 8 * 60 * 60) return { response: json({ error: "Token ausente, inválido ou expirado." }, 401, origin, allowed) };
  return { subject: claims.sub };
}
async function createOAuthState(env, product) {
  if (!env.IRIS_GMAIL_OAUTH || typeof env.IRIS_GMAIL_OAUTH.put !== "function") return null;
  const now = Math.floor(Date.now() / 1000);
  const nonce = b64(crypto.getRandomValues(new Uint8Array(32)));
  const exp = now + OAUTH_STATE_TTL_SECONDS;
  const state = await signJwt({ typ: "oauth", nonce, product, iat: now, exp }, env.IRIS_ACCESS_SECRET);
  await env.IRIS_GMAIL_OAUTH.put(`oauth-state:${nonce}`, JSON.stringify({ nonce, product, exp }), { expirationTtl: OAUTH_STATE_TTL_SECONDS });
  return state;
}
async function consumeOAuthState(state, env) {
  if (!hasAccessSecret(env) || !env.IRIS_GMAIL_OAUTH || typeof env.IRIS_GMAIL_OAUTH.get !== "function" || typeof env.IRIS_GMAIL_OAUTH.delete !== "function") return null;
  const claims = await verifyJwt(state, env.IRIS_ACCESS_SECRET);
  const now = Math.floor(Date.now() / 1000);
  if (!claims || claims.typ !== "oauth" || typeof claims.nonce !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(claims.nonce) || !["gmail", "drive", "calendar"].includes(claims.product) || !Number.isInteger(claims.exp) || claims.exp <= now || claims.exp - now > OAUTH_STATE_TTL_SECONDS || !Number.isInteger(claims.iat) || claims.iat > now + 30) return null;
  for (const [nonce, expiry] of consumedOAuthNonces) if (expiry <= now) consumedOAuthNonces.delete(nonce);
  if (consumedOAuthNonces.has(claims.nonce)) return null;
  // Claim synchronously in this isolate before awaiting KV to reject concurrent duplicate callbacks here.
  consumedOAuthNonces.set(claims.nonce, claims.exp);
  let stored;
  try { stored = await env.IRIS_GMAIL_OAUTH.get(`oauth-state:${claims.nonce}`); } catch { return null; }
  if (!stored) return null;
  try {
    const record = JSON.parse(stored);
    if (record?.nonce !== claims.nonce || record?.product !== claims.product || record?.exp !== claims.exp) return null;
  } catch { return null; }
  try { await env.IRIS_GMAIL_OAUTH.delete(`oauth-state:${claims.nonce}`); } catch { return null; }
  return { product: claims.product };
}
async function oauthStart(req, env, origin, allowed) {
  if (!env.GOOGLE_CLIENT_ID) return json({ error: "Configuração OAuth indisponível." }, 503, origin, allowed);
  const parsed = await readJson(req, MAX_JSON_BYTES, true);
  if (!parsed.ok) return readJsonError(parsed, origin, allowed);
  const product = parsed.value.product === undefined ? "gmail" : String(parsed.value.product);
  if (!["gmail", "drive", "calendar"].includes(product)) return json({ error: "Produto OAuth inválido." }, 400, origin, allowed);
  const state = await createOAuthState(env, product);
  if (!state) return json({ error: "Armazenamento OAuth indisponível." }, 503, origin, allowed);
  const scopes = product === "drive" ? DRIVE_SCOPE : product === "calendar" ? CALENDAR_SCOPE : GMAIL_SCOPE;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectLocation(env), response_type: "code", access_type: "offline", prompt: "consent", scope: scopes, state }).toString();
  return json({ url: url.toString() }, 200, origin, allowed, { "Cache-Control": "no-store" });
}
async function exchangeCode(code, env) { const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectLocation(env), grant_type: "authorization_code" }) }); return { ok: r.ok, data: await r.json() }; }
async function oauthCallback(req, env, origin, allowed) {
  if (!hasAccessSecret(env)) return json({ error: "Autenticação indisponível." }, 503, origin, allowed);
  if (!env.IRIS_GMAIL_OAUTH || typeof env.IRIS_GMAIL_OAUTH.get !== "function" || typeof env.IRIS_GMAIL_OAUTH.delete !== "function") return json({ error: "Armazenamento OAuth indisponível." }, 503, origin, allowed);
  const url = new URL(req.url);
  const consumed = await consumeOAuthState(url.searchParams.get("state"), env);
  if (!consumed) return json({ error: "Autorização inválida, expirada ou já utilizada." }, 400, origin, allowed);
  const code = url.searchParams.get("code");
  if (!code) return json({ error: "Código OAuth ausente." }, 400, origin, allowed);
  const x = await exchangeCode(code, env);
  if (!x.ok || !x.data?.refresh_token) return json({ error: "O Google não retornou autorização persistente. Tente novamente." }, 502, origin, allowed);
  const session = { access_token: x.data.access_token, refresh_token: x.data.refresh_token, expires_at: Date.now() + (x.data.expires_in || 3600) * 1000 };
  await env.IRIS_GMAIL_OAUTH.put(consumed.product === "gmail" ? "session" : `session:${consumed.product}`, JSON.stringify(session), { expirationTtl: 2592000 });
  const label = consumed.product === "drive" ? "Google Drive" : consumed.product === "calendar" ? "Google Calendar" : "Gmail";
  return new Response(`${label} autorizado. Você já pode voltar à Iris.`, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...cors(origin, allowed), "Cache-Control": "no-store" } });
}
async function cryptoKey(secret) { return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", encoder.encode(secret)), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function seal(value, secret) { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(secret), encoder.encode(JSON.stringify(value))); return b64(iv) + "." + b64(data); }
async function openSeal(value, secret) { const [iv, data] = String(value || "").split("."); if (!iv || !data) return null; try { const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await cryptoKey(secret), unb64(data)); return JSON.parse(decoder.decode(raw)); } catch { return null; } }
async function gmailToken(req, env) {
  const stored = env.IRIS_GMAIL_OAUTH ? await env.IRIS_GMAIL_OAUTH.get("session") : null;
  const session = stored ? JSON.parse(stored) : await openSeal(cookies(req).iris_gmail, env.GOOGLE_CLIENT_SECRET);
  if (!session) return null;
  if (session.expires_at > Date.now() + 60000) return { session };
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: session.refresh_token, grant_type: "refresh_token" }) });
  const data = await r.json();
  if (!r.ok || !data.access_token) return null;
  const renewed = { ...session, access_token: data.access_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000 };
  if (env.IRIS_GMAIL_OAUTH) await env.IRIS_GMAIL_OAUTH.put("session", JSON.stringify(renewed), { expirationTtl: 2592000 });
  return { session: renewed };
}
async function googleToken(req, env, product) {
  const key = `session:${product}`;
  const stored = env.IRIS_GMAIL_OAUTH ? await env.IRIS_GMAIL_OAUTH.get(key) : null;
  const session = stored ? JSON.parse(stored) : null;
  if (!session) return null;
  if (session.expires_at > Date.now() + 60000) return session;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: session.refresh_token, grant_type: "refresh_token" }) });
  const data = await r.json();
  if (!r.ok || !data.access_token) return null;
  const renewed = { ...session, access_token: data.access_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000 };
  if (env.IRIS_GMAIL_OAUTH) await env.IRIS_GMAIL_OAUTH.put(key, JSON.stringify(renewed), { expirationTtl: 2592000 });
  return renewed;
}
async function googleApi(req, env, product, path, init = {}) {
  const token = await googleToken(req, env, product);
  if (!token) return json({ error: `${product === "drive" ? "Google Drive" : "Google Calendar"} não autorizado. Abra POST /oauth/start.` }, 401, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const r = await fetch(`https://www.googleapis.com/${path}`, { ...init, headers: { Authorization: `Bearer ${token.access_token}`, ...(init.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  return json(data, r.status, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
}
async function googleWrite(req, env, product, path, method, body) {
  if (req.headers.get("X-Iris-Confirm") !== "true") return json({ error: "CONFIRMATION_REQUIRED", product, method, path }, 409, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  return googleApi(req, env, product, path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
function calendarPoint(value) {
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return calendarDateIsValid(value) ? { date: value } : null;
    return value.length <= 64 && Number.isFinite(Date.parse(value)) ? { dateTime: value } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.date === "string" && calendarDateIsValid(value.date) && !value.dateTime) return { date: value.date };
  if (typeof value.dateTime === "string" && value.dateTime.length <= 64 && Number.isFinite(Date.parse(value.dateTime))) {
    return { dateTime: value.dateTime, ...(typeof value.timeZone === "string" && value.timeZone.length <= 64 ? { timeZone: value.timeZone } : {}) };
  }
  return null;
}
function calendarDateIsValid(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function calendarInterval(startValue, endValue) {
  const start = calendarPoint(startValue), end = calendarPoint(endValue);
  if (!start || !end || Boolean(start.date) !== Boolean(end.date)) return null;
  const valid = start.date && end.date
    ? end.date > start.date
    : Date.parse(end.dateTime || "") > Date.parse(start.dateTime || "");
  return valid ? { start, end } : null;
}
function calendarPatch(body) {
  const allowed = new Set(["summary", "description", "location", "start", "end", "recurrence"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  const patch = {};
  if (Object.hasOwn(body, "summary")) patch.summary = String(body.summary || "").slice(0, 180);
  if (Object.hasOwn(body, "description")) patch.description = String(body.description || "").slice(0, 4000);
  if (Object.hasOwn(body, "location")) patch.location = String(body.location || "").slice(0, 300);
  if (Object.hasOwn(body, "recurrence")) {
    if (!Array.isArray(body.recurrence) || body.recurrence.length > 10 || body.recurrence.some((item) => typeof item !== "string" || item.length > 256)) return null;
    patch.recurrence = body.recurrence;
  }
  const hasStart = Object.hasOwn(body, "start"), hasEnd = Object.hasOwn(body, "end");
  if (hasStart !== hasEnd) return null;
  if (hasStart) {
    const interval = calendarInterval(body.start, body.end);
    if (!interval) return null;
    patch.start = interval.start;
    patch.end = interval.end;
  }
  return Object.keys(patch).length ? patch : null;
}
async function gmail(req, env, path) {
  const token = await gmailToken(req, env);
  if (!token) return json({ error: "Gmail não autorizado. Use POST /oauth/start." }, 401, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/" + path);
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token.session.access_token } });
  const data = await r.json();
  const extra = token.cookie ? { "Set-Cookie": cookie("iris_gmail", token.cookie, 2592000) } : {};
  return json(data, r.status, req.headers.get("Origin"), env.ALLOWED_ORIGIN, extra);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function gemini(model, key, payload) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (r.ok) return { r, d };
      last = { r, d };
      if (![408, 429, 500, 502, 503, 504].includes(r.status)) return last;
      if (i < 2) await sleep(1000 * 2 ** i);
    } catch (e) { last = { e }; if (i < 2) await sleep(1000 * 2 ** i); }
  }
  return last;
}
async function advancedGemini(body, env, origin) {
  const mode = String(body?.mode || "");
  const text = String(body?.text || body?.message || "").slice(0, MAX_PROMPT_LENGTH);
  const image = body?.imageBase64 && body?.mimeType ? { inline_data: { mime_type: String(body.mimeType), data: String(body.imageBase64).replace(/^data:[^,]+,/, "").slice(0, 8000000) } } : null;
  const instructions = {
    vision: "Interprete a imagem com precisão. Descreva somente o que é observável e separe leitura, inferência e incerteza.",
    translate: "Traduza o conteúdo mantendo sentido, estrutura e números. Não resuma.",
    compare: "Compare os dois textos/documentos fornecidos, destaque diferenças, riscos, valores e itens ausentes. Não invente dados.",
    spreadsheet: "Transforme os dados em uma estrutura de planilha empresarial. Responda em JSON válido com columns, rows e formulas.",
    document: "Produza um documento empresarial claro, com título, resumo, seções e próximos passos. Responda em JSON com title, sections e notes."
  };
  if (!(mode in instructions)) return null;
  const prompt = `${instructions[mode]}\n${text}`.trim();
  const parts = [{ text: prompt }]; if (image) parts.push(image);
  const result = await gemini(env.GEMINI_MODEL || DEFAULT_MODEL, env.GEMINI_API_KEY, { system_instruction: { parts: [{ text: IRIS_SYSTEM_PROMPT }] }, contents: [{ role: "user", parts }] });
  if (result?.r?.ok) return json({ text: result.d?.candidates?.[0]?.content?.parts?.map(x => x.text || "").join("").trim() || "Sem resposta gerada.", model: env.GEMINI_MODEL || DEFAULT_MODEL, mode }, 200, origin, env.ALLOWED_ORIGIN);
  return json({ error: "Gemini HTTP " + (result?.r?.status || 503) + ".", details: result?.d?.error?.message || "Falha temporária após novas tentativas." }, result?.r?.status || 503, origin, env.ALLOWED_ORIGIN);
}
function userId(subject) { return subject; }
async function dbJson(req, env, kind, subject) {
  if (!env.IRIS_DB) return json({ error: "Banco D1 não vinculado ao Worker." }, 503, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const uid = userId(subject);
  if (req.method === "GET") {
    const tables = { settings: "iris_settings", radar: "iris_radar", finances: "iris_finances", documents: "iris_documents", conversations: "iris_conversations", memories: "iris_memories", tasks: "iris_tasks", business: "iris_business" };
    const table = tables[kind]; if (!table) return json({ error: "Tipo inválido." }, 400, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
    const r = await env.IRIS_DB.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500`).bind(uid).all();
    return json({ items: r.results || [] }, 200, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  }
  if (req.method !== "POST") return json({ error: "Use GET ou POST." }, 405, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const parsed = await readJson(req);
  if (!parsed.ok) return readJsonError(parsed, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const body = parsed.value;
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
  } else if (kind === "memories") {
    await env.IRIS_DB.prepare("INSERT OR REPLACE INTO iris_memories(id,user_id,content,category,source,importance,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(id,uid,String(body.content||""),String(body.category||"other"),String(body.source||"user-approved"),Math.min(5,Math.max(1,Number(body.importance||3)))).run();
  } else if (kind === "tasks") {
    await env.IRIS_DB.prepare("INSERT OR REPLACE INTO iris_tasks(id,user_id,title,detail,status,priority,category,due_at,recurrence,completed_at,payload,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(id,uid,String(body.title||body.label||""),String(body.detail||""),String(body.status||"pending"),String(body.priority||"normal"),String(body.category||"Geral"),body.due_at||null,body.recurrence||null,body.completed_at||null,JSON.stringify(body.payload||{})).run();
  } else if (kind === "business") {
    await env.IRIS_DB.prepare("INSERT OR REPLACE INTO iris_business(id,user_id,kind,name,company,email,phone,notes,payload,updated_at) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(id,uid,String(body.kind||"contact"),String(body.name||""),String(body.company||""),String(body.email||""),String(body.phone||""),String(body.notes||""),JSON.stringify(body.payload||{})).run();
  } else return json({ error: "Tipo inválido." }, 400, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  return json({ ok: true, id }, 200, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
}
async function storageQuota(req, env, subject) {
  if (!env.IRIS_DB) return json({ error: "Banco D1 não vinculado ao Worker." }, 503, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const uid = userId(subject), period = new Date().toISOString().slice(0, 7);
  const stored = await env.IRIS_DB.prepare("SELECT COALESCE(SUM(stored_bytes),0) AS stored_bytes FROM iris_storage_usage WHERE user_id = ?").bind(uid).first();
  const monthly = await env.IRIS_DB.prepare("SELECT class_a,class_b,updated_at FROM iris_storage_usage WHERE user_id = ? AND period = ?").bind(uid, period).first();
  const usage = { bytes: Number(stored?.stored_bytes || 0), classA: Number(monthly?.class_a || 0), classB: Number(monthly?.class_b || 0) };
  const percent = { storage: usage.bytes / R2_LIMITS.bytes, classA: usage.classA / R2_LIMITS.classA, classB: usage.classB / R2_LIMITS.classB };
  const blocked = Object.values(percent).some(value => value >= R2_GUARD);
  return json({ ok: true, period, limits: R2_LIMITS, usage, percent, guardPercent: R2_GUARD, blocked, warning: blocked ? "Franquia protegida: novas operações R2 bloqueadas antes do limite gratuito." : null }, 200, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
}
async function storageFile(req, env, id, subject) {
  if (req.method !== "GET" && req.method !== "DELETE") return json({ error: "Método não permitido." }, 405, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  if (!env.IRIS_DB || !env.IRIS_FILES) return json({ error: "Armazenamento R2 não vinculado ao Worker." }, 503, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const uid = userId(subject), period = new Date().toISOString().slice(0, 7);
  const row = await env.IRIS_DB.prepare("SELECT id,name,mime_type,storage_key,payload FROM iris_documents WHERE id=? AND user_id=?").bind(id, uid).first();
  if (!row?.storage_key) return json({ error: "Arquivo não encontrado." }, 404, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  if (req.method === "GET") {
    const usage = await env.IRIS_DB.prepare("SELECT class_b FROM iris_storage_usage WHERE user_id=? AND period=?").bind(uid, period).first();
    if (Number(usage?.class_b || 0) + 1 >= R2_LIMITS.classB * R2_GUARD) return json({ error: "Franquia de leituras protegida em 98%." }, 429, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
    const object = await env.IRIS_FILES.get(row.storage_key);
    if (!object) return json({ error: "Objeto não encontrado no R2." }, 404, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
    await env.IRIS_DB.prepare("INSERT INTO iris_storage_usage(user_id,period,class_b,updated_at) VALUES(?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(user_id,period) DO UPDATE SET class_b=class_b+1,updated_at=CURRENT_TIMESTAMP").bind(uid, period).run();
    const filename = String(row.name || "arquivo").replace(/[^a-zA-Z0-9._-]/g, "_");
    const headers = new Headers(cors(req.headers.get("Origin"), env.ALLOWED_ORIGIN));
    headers.set("Content-Type", row.mime_type || object.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Content-Length", String(object.size));
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "no-store");
    return new Response(object.body, { status: 200, headers });
  }
  await env.IRIS_FILES.delete(row.storage_key);
  await env.IRIS_DB.batch([
    env.IRIS_DB.prepare("DELETE FROM iris_documents WHERE id=? AND user_id=?").bind(id, uid),
    env.IRIS_DB.prepare("INSERT INTO iris_storage_usage(user_id,period,stored_bytes,updated_at) VALUES(?,?,0,CURRENT_TIMESTAMP) ON CONFLICT(user_id,period) DO UPDATE SET stored_bytes=MAX(0,stored_bytes-?),updated_at=CURRENT_TIMESTAMP").bind(uid, period, Number(row.payload ? JSON.parse(row.payload).size || 0 : 0)),
  ]);
  return json({ ok: true, id }, 200, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
}
async function storageUpload(req, env, subject) {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const bounded = await readBoundedBytes(req, MAX_UPLOAD_BYTES);
  if (!bounded.ok) return readJsonError(bounded, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  if (!env.IRIS_DB || !env.IRIS_FILES) return json({ error: "Armazenamento R2 não vinculado ao Worker." }, 503, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  const uid = userId(subject), period = new Date().toISOString().slice(0, 7);
  const storedUsage = await env.IRIS_DB.prepare("SELECT COALESCE(SUM(stored_bytes),0) AS stored_bytes FROM iris_storage_usage WHERE user_id=?").bind(uid).first();
  const usage = await env.IRIS_DB.prepare("SELECT class_a FROM iris_storage_usage WHERE user_id=? AND period=?").bind(uid, period).first();
  const contentType = req.headers.get("Content-Type") || "application/octet-stream";
  let id = req.headers.get("X-Iris-File-Id") || crypto.randomUUID(), name = req.headers.get("X-Iris-Filename") || "arquivo", mime = contentType, data = bounded.bytes;
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    try {
      const copy = new Request(req.url, { method: "POST", headers: { "Content-Type": contentType }, body: bounded.bytes });
      const form = await copy.formData(), file = form.get("file");
      if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Use upload binário direto com X-Iris-Filename ou envie um campo file válido." }, 400, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
      if (file.size > MAX_UPLOAD_BYTES) return json({ error: "Upload excede 25 MB." }, 413, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
      id = String(form.get("id") || id); name = String(file.name || name); mime = file.type || mime; data = new Uint8Array(await file.arrayBuffer());
    } catch { return json({ error: "Multipart inválido ou acima do limite." }, 400, req.headers.get("Origin"), env.ALLOWED_ORIGIN); }
  }
  const size = Number(data.byteLength || 0);
  if (!size) return json({ error: "Arquivo vazio." }, 400, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  if (size > MAX_UPLOAD_BYTES) return json({ error: "Upload excede 25 MB." }, 413, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
  if (Number(storedUsage?.stored_bytes || 0) + size >= R2_LIMITS.bytes * R2_GUARD || Number(usage?.class_a || 0) + 1 >= R2_LIMITS.classA * R2_GUARD) return json({ error: "Franquia protegida em 98%. Upload bloqueado." }, 429, req.headers.get("Origin"), env.ALLOWED_ORIGIN);
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
  const origin = req.headers.get("Origin"), allowed = env.ALLOWED_ORIGIN || "";
  if (req.headers.has("X-Iris-User")) return json({ error: "X-Iris-User não é aceito." }, 401, origin, allowed);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin, allowed) });
  const url = new URL(req.url), path = url.pathname;
  if (path === "/" && req.method === "GET") return json({ ok: true, service: "iris-gemini-proxy", model: env.GEMINI_MODEL || DEFAULT_MODEL }, 200, origin, allowed);
  if (path === "/auth/login") {
    if (req.method !== "POST") return json({ error: "Use POST." }, 405, origin, allowed);
    return login(req, env, origin, allowed);
  }
  if (path === "/oauth/callback") {
    if (req.method !== "GET") return json({ error: "Método não permitido." }, 405, origin, allowed);
    return oauthCallback(req, env, origin, allowed);
  }
  const auth = await authenticatedSubject(req, env, origin, allowed);
  if (auth.response) return auth.response;
  const subject = auth.subject;

  if (path === "/oauth/start") {
    if (req.method !== "POST") return json({ error: "Use POST." }, 405, origin, allowed);
    return oauthStart(req, env, origin, allowed);
  }
  if (path === "/gmail/status") { if (req.method !== "GET") return json({ error: "Use GET." }, 405, origin, allowed); return json({ authorized: !!(await gmailToken(req, env)) }, 200, origin, allowed); }
  if (path === "/gmail/messages") { if (req.method !== "GET") return json({ error: "Use GET." }, 405, origin, allowed); return gmail(req, env, "messages?maxResults=20"); }
  if (path === "/gmail/message") { if (req.method !== "GET") return json({ error: "Use GET." }, 405, origin, allowed); const id = url.searchParams.get("id"); if (!id) return json({ error: "Informe id." }, 400, origin, allowed); return gmail(req, env, "messages/" + encodeURIComponent(id) + "?format=full"); }
  if (path === "/google/drive/status") { if (req.method !== "GET") return json({ error: "Use GET." }, 405, origin, allowed); return json({ authorized: !!(await googleToken(req, env, "drive")) }, 200, origin, allowed); }
  if (path === "/google/calendar/status") { if (req.method !== "GET") return json({ error: "Use GET." }, 405, origin, allowed); return json({ authorized: !!(await googleToken(req, env, "calendar")) }, 200, origin, allowed); }
  if (path === "/google/drive/files") {
    if (req.method !== "GET") return json({ error: "Use GET." }, 405, origin, allowed);
    const q = url.searchParams.get("q") || ""; const query = q ? ` and name contains '${q.replace(/'/g, "\\'")}'` : "";
    return googleApi(req, env, "drive", `drive/v3/files?spaces=drive&pageSize=50&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,size,webViewLink,parents,trashed)&q=trashed%20%3D%20false${encodeURIComponent(query)}`);
  }
  if (path === "/google/drive/folders") {
    if (req.method !== "POST") return json({ error: "Use POST." }, 405, origin, allowed);
    const parsed = await readJson(req); if (!parsed.ok) return readJsonError(parsed, origin, allowed); const body = parsed.value;
    return googleWrite(req, env, "drive", "drive/v3/files", "POST", { name: String(body.name || "Nova pasta").slice(0, 180), mimeType: "application/vnd.google-apps.folder", parents: Array.isArray(body.parents) ? body.parents : undefined });
  }
  const driveRename = path.match(/^\/google\/drive\/files\/([^/]+)$/);
  if (driveRename) {
    if (req.method !== "PATCH") return json({ error: "Use PATCH." }, 405, origin, allowed);
    const parsed = await readJson(req); if (!parsed.ok) return readJsonError(parsed, origin, allowed); const body = parsed.value;
    return googleWrite(req, env, "drive", `drive/v3/files/${encodeURIComponent(driveRename[1])}`, "PATCH", { name: String(body.name || "").slice(0, 180) });
  }
  const driveCopy = path.match(/^\/google\/drive\/files\/([^/]+)\/copy$/);
  if (driveCopy) {
    if (req.method !== "POST") return json({ error: "Use POST." }, 405, origin, allowed);
    const parsed = await readJson(req); if (!parsed.ok) return readJsonError(parsed, origin, allowed); const body = parsed.value;
    return googleWrite(req, env, "drive", `drive/v3/files/${encodeURIComponent(driveCopy[1])}/copy`, "POST", { name: String(body.name || "Cópia").slice(0, 180), parents: Array.isArray(body.parents) ? body.parents : undefined });
  }
  if (path === "/google/calendar/events") {
    if (req.method === "GET") {
      const params = new URLSearchParams({ calendarId: "primary", singleEvents: "true", orderBy: "startTime", maxResults: "100", timeMin: url.searchParams.get("timeMin") || new Date().toISOString(), ...(url.searchParams.get("timeMax") ? { timeMax: url.searchParams.get("timeMax") } : {}) });
      return googleApi(req, env, "calendar", `calendar/v3/calendars/primary/events?${params}`);
    }
    if (req.method !== "POST") return json({ error: "Use GET ou POST." }, 405, origin, allowed);
    const parsed = await readJson(req); if (!parsed.ok) return readJsonError(parsed, origin, allowed); const body = parsed.value;
    const interval = calendarInterval(body.start, body.end);
    if (!interval || (body.allDay && (!interval.start.date || !interval.end.date))) return json({ error: "Datas do compromisso inválidas; o término precisa ser posterior ao início." }, 400, origin, allowed);
    if (body.recurrence !== undefined && (!Array.isArray(body.recurrence) || body.recurrence.length > 10 || body.recurrence.some((item) => typeof item !== "string" || item.length > 256))) return json({ error: "Recorrência inválida." }, 400, origin, allowed);
    return googleWrite(req, env, "calendar", "calendar/v3/calendars/primary/events", "POST", { summary: String(body.summary || body.title || "Compromisso").slice(0, 180), description: String(body.description || "").slice(0, 4000), location: String(body.location || "").slice(0, 300), ...interval, recurrence: body.recurrence });
  }
  const calendarEvent = path.match(/^\/google\/calendar\/events\/([^/]+)$/);
  if (calendarEvent) {
    if (req.method !== "PATCH" && req.method !== "DELETE") return json({ error: "Use PATCH ou DELETE." }, 405, origin, allowed);
    const apiPath = `calendar/v3/calendars/primary/events/${encodeURIComponent(calendarEvent[1])}`;
    if (req.method === "DELETE") return googleWrite(req, env, "calendar", apiPath, "DELETE", undefined);
    if (req.headers.get("X-Iris-Confirm") !== "true") return json({ error: "CONFIRMATION_REQUIRED", product: "calendar", method: "PATCH", path: apiPath }, 409, origin, allowed);
    const parsed = await readJson(req); if (!parsed.ok) return readJsonError(parsed, origin, allowed);
    const patch = calendarPatch(parsed.value);
    if (!patch) return json({ error: "Campos do compromisso inválidos ou não permitidos." }, 400, origin, allowed);
    return googleWrite(req, env, "calendar", apiPath, "PATCH", patch);
  }
  if (path === "/db/health") { if (req.method !== "GET") return json({ error: "Use GET." }, 405, origin, allowed); return json({ ok: !!env.IRIS_DB, database: env.IRIS_DB ? "d1" : "missing" }, env.IRIS_DB ? 200 : 503, origin, allowed); }
  if (path === "/storage/quota") { if (req.method !== "GET") return json({ error: "Use GET." }, 405, origin, allowed); return storageQuota(req, env, subject); }
  if (path === "/storage/upload") return storageUpload(req, env, subject);
  const storageMatch = path.match(/^\/storage\/file\/([^/]+)$/);
  if (storageMatch) {
    let id; try { id = decodeURIComponent(storageMatch[1]); } catch { return json({ error: "Identificador inválido." }, 400, origin, allowed); }
    return storageFile(req, env, id, subject);
  }
  const dataMatch = path.match(/^\/data\/(settings|radar|finances|documents|conversations|memories|tasks|business)$/);
  if (dataMatch) return dbJson(req, env, dataMatch[1], subject);
  if (path === "/" && req.method !== "POST") return json({ error: "Use POST." }, 405, origin, allowed);
  if (path !== "/") return json({ error: "Não encontrado." }, 404, origin, allowed);
  const parsed = await readJson(req);
  if (!parsed.ok) return readJsonError(parsed, origin, allowed);
  const body = parsed.value;
  if (body?.mode) { const advanced = await advancedGemini(body, env, origin); if (advanced) return advanced; }
  if (/\b(r2|franquia|armazenamento|limite)\b/i.test(String(body?.message || body?.prompt || ""))) return storageQuota(req, env, subject);
  const raw = body?.message ?? body?.prompt ?? "", message = typeof raw === "string" ? raw.trim() : "";
  if (!message && !(Array.isArray(body?.messages) && body.messages.length)) return json({ error: "Mensagem não informada." }, 400, origin, allowed);
  if (message.length > MAX_PROMPT_LENGTH) return json({ error: "Mensagem excede o limite de 12000 caracteres." }, 413, origin, allowed);
  if (!env.GEMINI_API_KEY) return json({ error: "Chave da API do Gemini não configurada." }, 500, origin, allowed);
  let contents;
  if (Array.isArray(body?.messages) && body.messages.length) {
    const selected = body.messages.slice(-MAX_HISTORY_MESSAGES);
    const normalized = selected.map(x => { const item = x && typeof x === "object" ? x : {}; return { role: item.role === "model" ? "model" : "user", text: String(item.text ?? item.content ?? "") }; });
    const historyLength = normalized.reduce((sum, item) => sum + item.text.length, 0);
    if (historyLength > MAX_HISTORY_CHARS) return json({ error: "Histórico excede o limite de 24000 caracteres." }, 413, origin, allowed);
    contents = normalized.map(item => ({ role: item.role, parts: [{ text: item.text }] })).filter(item => item.parts[0].text);
  } else contents = [{ role: "user", parts: [{ text: message }] }];
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const result = await gemini(model, env.GEMINI_API_KEY, { system_instruction: { parts: [{ text: IRIS_SYSTEM_PROMPT }] }, contents });
  if (result?.r?.ok) return json({ text: result.d?.candidates?.[0]?.content?.parts?.map(x => x.text || "").join("").trim() || "Sem resposta gerada.", model }, 200, origin, allowed);
  return json({ error: "Gemini HTTP " + (result?.r?.status || 503) + ".", details: result?.d?.error?.message || "Falha temporária após novas tentativas." }, result?.r?.status || 503, origin, allowed);
}
export default { fetch: (req, env) => handle(req, env) };
