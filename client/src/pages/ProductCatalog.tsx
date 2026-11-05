import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Package, Plus, Search, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { downloadJson, readLocal, writeLocal } from "@/lib/irisLocalStore";

type Product = { id: string; name: string; code: string; price: string; stock: string; category: string; description: string; image?: string; createdAt: string };
const blank: Omit<Product, "id" | "createdAt"> = { name: "", code: "", price: "", stock: "", category: "", description: "" };

function csv(products: Product[]) { const head = "nome,codigo,preco,estoque,categoria,descricao"; const rows = products.map((p) => [p.name, p.code, p.price, p.stock, p.category, p.description].map((v) => `"${v.replaceAll('"', '""')}"`).join(",")); return [head, ...rows].join("\n"); }
function downloadText(name: string, text: string) { const blob = new Blob([text], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function parseCsv(text: string): Omit<Product, "id" | "createdAt">[] { return text.split(/\r?\n/).slice(1).filter(Boolean).map((line) => { const values = [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map((m) => (m[1] ?? m[2] ?? "").replaceAll('""', '"').trim()); return { name: values[0] ?? "", code: values[1] ?? "", price: values[2] ?? "", stock: values[3] ?? "", category: values[4] ?? "", description: values[5] ?? "" }; }); }

export default function ProductCatalog() {
  const [products, setProducts] = useState<Product[]>([]); const [draft, setDraft] = useState(blank); const [query, setQuery] = useState(""); const [image, setImage] = useState<string>(); const [message, setMessage] = useState("");
  useEffect(() => { void readLocal<Product[]>("products", []).then(setProducts); }, []);
  const filtered = useMemo(() => products.filter((p) => `${p.name} ${p.code} ${p.category}`.toLowerCase().includes(query.toLowerCase())), [products, query]);
  const save = async (next: Product[]) => { setProducts(next); await writeLocal("products", next); };
  const add = async () => { if (!draft.name.trim()) { setMessage("Informe o nome do produto."); return; } const item: Product = { ...draft, id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...(image ? { image } : {}) }; await save([item, ...products]); setDraft(blank); setImage(undefined); setMessage("Produto salvo somente neste dispositivo."); };
  const remove = async (id: string) => save(products.filter((p) => p.id !== id));
  const exportJson = () => { downloadJson(`iris-catalogo-${new Date().toISOString().slice(0, 10)}.json`, { format: "iris-product-catalog", exportedAt: new Date().toISOString(), products }); setMessage("Catálogo JSON exportado localmente."); };
  const importCsv = async (file: File) => { const imported = parseCsv(await file.text()).filter((p) => p.name); const next = [...imported.map((p) => ({ ...p, id: crypto.randomUUID(), createdAt: new Date().toISOString() })), ...products]; await save(next); setMessage(`${imported.length} produto(s) importado(s) localmente.`); };
  return <main className="profile-page"><div className="profile-card">
    <Link href="/" className="back-link"><ArrowLeft size={16}/> Voltar ao Radar</Link>
    <div className="profile-heading"><div className="profile-icon"><Package size={22}/></div><div><div className="eyebrow">IRIS COMERCIAL · LOCAL</div><h1>Catálogo de produtos</h1><p>Organize produtos e imagens no dispositivo, sem upload automático.</p></div></div>
    <div className="notification-settings"><strong>Modo local e custo zero</strong><p>Os dados ficam no IndexedDB deste navegador. Use exportação JSON/CSV para compartilhar manualmente, após revisar o conteúdo.</p></div>
    <div className="memory-settings"><strong>Novo produto</strong><div style={{display:"grid",gap:8,gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",marginTop:10}}>{(["name","code","price","stock","category"] as const).map((key) => <input key={key} value={draft[key]} onChange={(e) => setDraft({...draft, [key]: e.target.value})} placeholder={{name:"Nome",code:"Código",price:"Preço",stock:"Estoque",category:"Categoria"}[key]}/>)}<textarea value={draft.description} onChange={(e) => setDraft({...draft, description:e.target.value})} placeholder="Descrição" rows={2}/><label className="button-like">Imagem<input type="file" accept="image/*" hidden onChange={(e) => { const file=e.target.files?.[0]; if (!file) return; const reader=new FileReader(); reader.onload=()=>setImage(String(reader.result)); reader.readAsDataURL(file); }}/></label><Button onClick={() => void add()}><Plus size={15}/> Salvar produto</Button></div></div>
    <div className="memory-settings"><div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}><strong style={{marginRight:"auto"}}>Produtos ({filtered.length})</strong><div style={{display:"flex",gap:6,alignItems:"center"}}><Search size={15}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Buscar"/></div><label className="button-like">Importar CSV<input type="file" accept=".csv,text/csv" hidden onChange={(e)=>{const file=e.target.files?.[0]; if(file) void importCsv(file); e.currentTarget.value="";}}/></label><Button variant="outline" onClick={exportJson}><Download size={15}/> JSON</Button><Button variant="outline" onClick={()=>downloadText("iris-catalogo.csv",csv(products))}><Download size={15}/> CSV</Button></div>{filtered.length===0 ? <small>Nenhum produto local cadastrado.</small> : filtered.map((p)=><div className="memory-row" key={p.id}><span>{p.image && <img src={p.image} alt="" style={{width:42,height:42,objectFit:"cover",borderRadius:8,verticalAlign:"middle",marginRight:8}}/>}<b>{p.name}</b><br/><small>{p.code} · {p.category} · Preço: {p.price || "—"} · Estoque: {p.stock || "—"}</small></span><Button size="sm" variant="ghost" onClick={()=>void remove(p.id)} aria-label={`Excluir ${p.name}`}><Trash2 size={15}/></Button></div>)}</div>
    {message && <div className="profile-message">{message}</div>}
  </div></main>;
}
