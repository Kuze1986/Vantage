import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const port = process.env.PORT ?? "3000";

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["serve", "-s", "dist", "-l", `tcp://0.0.0.0:${port}`],
  { stdio: "inherit", cwd: root, shell: process.platform === "win32" },
);

child.on("exit", (code) => process.exit(code ?? 0));
