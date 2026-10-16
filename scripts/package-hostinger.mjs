/**
 * Genera release/nexistore-hostinger.zip: la app ya compilada, lista para subir a Hostinger (Node.js).
 * Incluye solo lo necesario en producción; Hostinger instala las dependencias con `npm install`.
 * Uso: npm run package:hostinger
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "release");
const stage = join(out, "nexistore-hostinger");
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });

console.log("› Compilando frontend y servidor…");
run("npm run build");

rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const p of ["dist", "db/migrations"]) cpSync(join(root, p), join(stage, p), { recursive: true });
cpSync(join(root, ".env.example"), join(stage, ".env.example"));
cpSync(join(root, "docs/LEEME-HOSTINGER.md"), join(stage, "LEEME-HOSTINGER.md"));
// Instalación en VPS (Linode, DigitalOcean…): instalador, actualizador y guía.
cpSync(join(root, "docs/LEEME-VPS.md"), join(stage, "LEEME-VPS.md"));
for (const f of ["instalar.sh", "actualizar.sh"]) cpSync(join(root, "scripts/vps", f), join(stage, f));

// package.json de producción: solo las dependencias que usa el servidor (el frontend ya va compilado).
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const RUNTIME = ["express", "mysql2", "zod", "helmet", "express-rate-limit", "nodemailer"];
const prod = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  description: pkg.description,
  type: "module",
  main: "dist/node/server/index.js",
  engines: { node: ">=20.12" },
  scripts: {
    start: "node dist/node/server/index.js",
    "db:migrate": "node dist/node/server/cli/migrate.js",
    "db:seed": "node dist/node/server/cli/seed.js",
    "admin:create": "node dist/node/server/cli/create-admin.js",
  },
  dependencies: Object.fromEntries(RUNTIME.map((d) => [d, pkg.dependencies[d]])),
};
for (const [d, v] of Object.entries(prod.dependencies)) if (!v) throw new Error(`Falta la dependencia ${d} en package.json`);
writeFileSync(join(stage, "package.json"), `${JSON.stringify(prod, null, 2)}\n`);

console.log("› Generando package-lock.json de producción…");
run("npm install --package-lock-only --ignore-scripts --no-audit --no-fund", stage);

console.log("› Comprimiendo…");
const zip = join(out, "nexistore-hostinger.zip");
run(`python3 -c "import shutil; shutil.make_archive('${zip.replace(/\.zip$/, "")}', 'zip', '${stage}')"`);
if (!existsSync(zip)) throw new Error("No se generó el zip");
// Mismo contenido con un nombre más claro para quien instala en un VPS.
cpSync(zip, join(out, "nexistore-vps.zip"));
console.log(`✔ Listo: ${zip}`);
