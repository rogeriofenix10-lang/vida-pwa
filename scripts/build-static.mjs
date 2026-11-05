import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vite = resolve(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);
const result = spawnSync(vite, ["build"], {
  cwd: root,
  env: { ...process.env, VITE_IRIS_STATIC: "true", NODE_ENV: "production" },
  stdio: "inherit",
  shell: false,
});
if (result.status !== 0) process.exit(result.status ?? 1);
const output = resolve(root, "dist", "public");
const index = resolve(output, "index.html");
if (!existsSync(index))
  throw new Error("Build estático não gerou dist/public/index.html");
mkdirSync(output, { recursive: true });
const manifestPath = resolve(output, "manifest.webmanifest");
if (existsSync(manifestPath)) {
  const manifest = readFileSync(manifestPath, "utf8")
    .replace('"start_url": "/"', '"start_url": "."')
    .replaceAll('"src": "/image.png"', '"src": "./image.png"');
  writeFileSync(manifestPath, manifest);
}
const serviceWorkerPath = resolve(output, "sw.js");
if (existsSync(serviceWorkerPath)) {
  writeFileSync(
    serviceWorkerPath,
    readFileSync(serviceWorkerPath, "utf8").replace(
      '["/", "/manifest.webmanifest", "/iris.svg"]',
      '["./", "./manifest.webmanifest", "./iris.svg"]',
    ),
  );
}
copyFileSync(index, resolve(output, "404.html"));
console.log(`PWA estático pronto em ${output}`);
