// Arranca la API (tsx watch) y Vite a la vez.
import { spawn } from "node:child_process";

const run = (cmd, args) =>
  spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });

const api = run("npx", ["tsx", "watch", "server/index.ts"]);
const web = run("npx", ["vite"]);
const stop = () => {
  api.kill();
  web.kill();
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
