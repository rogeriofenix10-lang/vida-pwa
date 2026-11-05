import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
console.log("IRIS 5.5 · PREFLIGHT LOCAL/CUSTO ZERO");
if (!existsSync(join(root, "package.json"))) {
  console.error("package.json ausente");
  process.exit(1);
}
if (!existsSync(join(root, "client", "public", "manifest.webmanifest"))) {
  console.error("manifesto PWA ausente");
  process.exit(1);
}

const environmentFiles = [];
function scan(dir, depth = 0) {
  if (depth > 4 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path, depth + 1);
    else if (entry.name === ".env" || entry.name.startsWith(".env."))
      environmentFiles.push(path);
  }
}
scan(root);
if (environmentFiles.length)
  console.warn(
    "ATENÇÃO: arquivo de ambiente encontrado; mantenha-o fora dos ZIPs.",
  );

const secretPattern =
  /(?:sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|BEGIN (?:RSA|OPENSSH) PRIVATE KEY)/;
let secretFound = false;
function inspect(dir, depth = 0) {
  if (depth > 4 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) inspect(path, depth + 1);
    else if (statSync(path).size < 2_000_000) {
      try {
        if (secretPattern.test(readFileSync(path, "utf8"))) secretFound = true;
      } catch {}
    }
  }
}
inspect(root);
if (secretFound) {
  console.error("ERRO: possível segredo detectado");
  process.exit(1);
}
console.log(
  "Modo seguro: integrações externas continuam dependentes de aprovação.",
);
console.log("Preflight concluído.");
