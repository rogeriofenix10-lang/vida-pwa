import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const pnpmCheck = spawnSync(pnpm, ["--version"], {
  cwd: root,
  shell: false,
});
if (pnpmCheck.status !== 0) {
  console.log("pnpm/Corepack indisponível; instalando pnpm 10.4.1 via npm...");
  const installPnpm = spawnSync("npm", ["install", "-g", "pnpm@10.4.1"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (installPnpm.status !== 0) process.exit(installPnpm.status ?? 1);
}
const port = process.env.PORT || "3000";
const packageJson = JSON.parse(
  await import("node:fs/promises").then(({ readFile }) =>
    readFile(resolve(root, "package.json"), "utf8"),
  ),
);

console.log("\nIris PWA local");
console.log(`Pasta: ${root}`);
console.log(`Versão: ${packageJson.version}`);
console.log("URLs: /  /seguranca  /midia  /laboratorio\n");

if (
  !existsSync(resolve(root, "node_modules/.bin/tsx")) &&
  !existsSync(resolve(root, "node_modules/.bin/tsx.cmd"))
) {
  console.log(
    "Dependências de desenvolvimento ausentes; instalando com --prod=false...",
  );
  const install = spawnSync(
    pnpm,
    ["install", "--prod=false", "--ignore-scripts"],
    { cwd: root, stdio: "inherit", shell: false },
  );
  if (install.status !== 0) process.exit(install.status ?? 1);
}

const child = spawnSync(
  pnpm,
  ["exec", "tsx", "watch", "server/_core/index.ts"],
  {
    cwd: root,
    env: { ...process.env, NODE_ENV: "development", PORT: port },
    stdio: "inherit",
    shell: false,
  },
);
process.exit(child.status ?? 1);
