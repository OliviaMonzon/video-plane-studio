import { spawn } from "node:child_process";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const host = "127.0.0.1";
const port = 5173;
const url = `http://${host}:${port}`;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteCli = resolve(rootDir, "node_modules/vite/bin/vite.js");

const waitForPort = () =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const attempt = () => {
      const socket = net.connect({ host, port }, () => {
        socket.end();
        resolve();
      });

      socket.on("error", () => {
        socket.destroy();

        if (Date.now() - startedAt > 30000) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(attempt, 250);
      });
    };

    attempt();
  });

const spawnOptions = {
  cwd: rootDir,
  stdio: "inherit",
  shell: process.platform === "win32",
};

const vite = spawn(process.execPath, [viteCli, "--host", host, "--port", String(port), "--strictPort"], spawnOptions);

const shutdown = (code = 0) => {
  if (!vite.killed) {
    vite.kill();
  }
  process.exit(code);
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

vite.on("exit", (code) => {
  if (code !== 0) {
    shutdown(code ?? 1);
  }
});

try {
  await waitForPort();
  const electron = spawn(electronPath, ["."], {
    ...spawnOptions,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: url,
    },
  });

  electron.on("exit", (code) => shutdown(code ?? 0));
} catch (error) {
  console.error(error);
  shutdown(1);
}
