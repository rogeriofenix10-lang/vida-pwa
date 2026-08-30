const API="http://localhost:3000";let token=localStorage.getItem("vida_token");let dash=null;
const $=id=>document.getElementById(id);
function toggleAuth(){ $("loginForm").hidden=!$("loginForm").hidden; $("registerForm").hidden=!$("registerForm").hidden }
async function api(path,opt={}){opt.headers={...(opt.headers||{}),"Content-Type":"application/json"};if(token)opt.headers.Authorization="Bearer "+token;const r=await fetch(API+path,opt);const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Erro");return j}
async function login(){try{const j=await api("/auth/login",{method:"POST",body:JSON.stringify({email:$("loginEmail").value,password:$("loginPass").value})});token=j.token;localStorage.setItem("vida_token",token);start()}catch(e){alert(e.message)}}
async function register(){try{const j=await api("/auth/register",{method:"POST",body:JSON.stringify({name:$("regName").value,email:$("regEmail").value,password:$("regPass").value})});token=j.token;localStorage.setItem("vida_token",token);start()}catch(e){alert(e.message)}}
function logout(){localStorage.removeItem("vida_token");token=null;location.reload()}
function go(id){document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active");if(id==="home")load()}
async function start(){ $("auth").hidden=true;$("app").hidden=false;$("hello").textContent="Olá! 👋";load(); addBot("Olá! Eu sou o VIDA. Pergunte o que precisa organizar.");}
async function load(){try{dash=await api("/dashboard");render()}catch(e){if(e.message==="Não autorizado")logout();else console.error(e)}}
function render(){ $("taskN").textContent=dash.tasks.filter(x=>!x.done).length;$("billN").textContent=dash.bills.filter(x=>!x.paid).length;$("docN").textContent=dash.documents.length;
let alerts=[];const now=new Date();const days=d=>Math.ceil((new Date(d+"T00:00:00")-new Date(now.toDateString()))/86400000);
dash.bills.forEach(x=>{if(x.due_date&&days(x.due_date)<=7)alerts.push(["💰",x.title,"Vence "+new Date(x.due_date+"T12:00").toLocaleDateString("pt-BR"),days(x.due_date)<=0?"URGENTE":"ATENÇÃO",days(x.due_date)<=0?"danger":""])});dash.documents.forEach(x=>{if(x.due_date&&days(x.due_date)<=30)alerts.push(["📄",x.title,"Vence "+new Date(x.due_date+"T12:00").toLocaleDateString("pt-BR"),days(x.due_date)<0?"VENCIDO":days(x.due_date)+" dias",days(x.due_date)<0?"danger":""])});dash.tasks.filter(x=>!x.done).forEach(x=>{if(x.due_date&&days(x.due_date)<=1)alerts.push(["📋",x.title,"Tarefa",days(x.due_date)<0?"ATRASADA":"HOJE",days(x.due_date)<0?"danger":""])});$("radar").innerHTML=alerts.length?alerts.map(i=>item(...i)).join(""):`<div class="empty">🟢 Nenhum alerta importante.</div>`;
$("tasksList").innerHTML=dash.tasks.length?dash.tasks.map(x=>item(x.done?"✅":"📋",x.title,x.due_date?new Date(x.due_date+"T12:00").toLocaleDateString("pt-BR"):"Sem data",x.done?"CONCLUÍDA":"PENDENTE",x.done?"ok":"")).join(""):`<div class="empty">Nenhuma tarefa.</div>`;
$("docsList").innerHTML=dash.documents.length?dash.documents.map(x=>item("📄",x.title,x.due_date?"Vence "+new Date(x.due_date+"T12:00").toLocaleDateString("pt-BR"):"Sem vencimento","DOCUMENTO","")).join(""):`<div class="empty">Nenhum documento.</div>`}
function item(icon,title,meta,pill,cls){return `<div class="item"><div>${icon}</div><div class="item-main"><b>${escapeHtml(title)}</b><div class="meta">${escapeHtml(meta)}</div></div><span class="pill ${cls}">${pill}</span></div>`}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
async function addTask(){const title=prompt("Qual é a tarefa?");if(!title)return;const dueDate=prompt("Data (AAAA-MM-DD), ou deixe vazio:")||null;await api("/tasks",{method:"POST",body:JSON.stringify({title,dueDate})});load()}
async function addBill(){const title=prompt("Nome da conta?");if(!title)return;const dueDate=prompt("Vencimento (AAAA-MM-DD):");const amount=prompt("Valor (opcional):");await api("/bills",{method:"POST",body:JSON.stringify({title,dueDate,amount})});load()}
async function addDoc(){const title=prompt("Nome do documento?");if(!title)return;const dueDate=prompt("Vencimento (AAAA-MM-DD), ou vazio:")||null;await api("/documents",{method:"POST",body:JSON.stringify({title,dueDate})});load()}
async function saveMemory(){const content=$("memory").value.trim();if(!content)return;await api("/memories",{method:"POST",body:JSON.stringify({content})});$("memory").value="";alert("Memória salva.");load()}
function addBot(t){const d=document.createElement("div");d.className="bubble bot";d.textContent=t;$("chat").appendChild(d)}
function addUser(t){const d=document.createElement("div");d.className="bubble user";d.textContent=t;$("chat").appendChild(d)}
async function send(){const v=$("msg").value.trim();if(!v)return;addUser(v);$("msg").value="";try{const j=await api("/ai/chat",{method:"POST",body:JSON.stringify({message:v})});addBot(j.reply)}catch(e){addBot("Não consegui falar com a IA agora: "+e.message)}}
$("msg").addEventListener("keydown",e=>{if(e.key==="Enter")send()});
function voice(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){alert("Reconhecimento de voz não disponível neste navegador.");return}const r=new SR();r.lang="pt-BR";r.onresult=e=>{go("ai");$("msg").value=e.results[0][0].transcript;send()};r.start()}
if(token)start();
