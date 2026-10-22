import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import http from "node:http";

// Where /api and /command are proxied. Defaults to the robot; override with
// SIPHER_API (e.g. a local mock) when the Pi is offline.
const api = process.env.SIPHER_API ?? "http://192.168.1.37:8888";

const LOOPBACK = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/;
const DONE_PREFIX = "__SIPHER_DONE__|";
const READY_PREFIX = "__SIPHER_READY__|";
const ERR_PREFIX = "__SIPHER_ERR__";
const CMD_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 4;

// ---- opencode AI backend ---------------------------------------------------
// Headless `opencode serve` process, bound to the Sipher repository as its
// project root so chats/agents see repo files, git state and agent tools.
// The supervisor spawns it with `npm run dev`, pings it periodically and
// restarts it if it ever dies. The dashboard talks to it through the
// /api/ai proxy (Basic auth injected here, never in the browser).
const AI_PORT = Number(process.env.SIPHER_AI_PORT ?? 4096);
const AI_PASSWORD = process.env.SIPHER_AI_PASSWORD ?? "SipherDev2026";
const AI_REPO_ROOT = path.resolve(__dirname, "..");

const AI_AUTH = "Basic " + Buffer.from(`opencode:${AI_PASSWORD}`).toString("base64");

function resolveOpencodeBin(): string {
  const custom = process.env.SIPHER_OPENCODE_BIN;
  if (custom && existsSync(custom)) return custom;
  const npmGlobal = path.join(
    process.env.APPDATA ?? "",
    "npm",
    "node_modules",
    "opencode-windows-x64",
    "bin",
    "opencode.exe",
  );
  if (existsSync(npmGlobal)) return npmGlobal;
  return "opencode";
}

function aiAlive(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: AI_PORT, path: "/global/health", headers: { Authorization: AI_AUTH }, timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function opencodeSupervisor(): Plugin {
  let child: ChildProcess | null = null;
  let launching = false;
  const bin = resolveOpencodeBin();

  const ensure = async (): Promise<boolean> => {
    if (await aiAlive()) return true;
    if (launching) return false;
    launching = true;
    if (child) {
      try {
        child.kill();
      } catch {}
      child = null;
    }
    child = spawn(bin, ["serve", "--port", String(AI_PORT), "--hostname", "0.0.0.0"], {
      cwd: AI_REPO_ROOT,
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: AI_PASSWORD },
      windowsHide: true,
      shell: !bin.endsWith(".exe") && !bin.includes("node_modules"),
    });
    child.on("error", () => {
      child = null;
    });
    child.on("exit", () => {
      child = null;
    });
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await aiAlive()) break;
    }
    launching = false;
    return await aiAlive();
  };

  return {
    name: "sipher-opencode",
    async configureServer(server) {
      // Explicit starter endpoint — the chat panel hits it on mount.
      server.middlewares.use("/api/ai/start", (req, res) => {
        void ensure().then((up) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: up }));
        });
      });
      const t = setInterval(() => {
        void ensure();
      }, 30_000);
      t.unref?.();
      await ensure();
    },
    async configurePreviewServer(server) {
      const t = setInterval(() => {
        void ensure();
      }, 30_000);
      t.unref?.();
      await ensure();
    },
  };
}

// Engine: prefer PowerShell 7 (pwsh) when available, else Windows PowerShell.
const PS_ENGINE = process.env.SIPHER_PS_ENGINE ?? "powershell.exe";
const PS_ARGS = ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"];

// A real pseudo-console (ConPTY) per browser view, bridged over WebSocket.
// Unlike the old stdin/stdout REPL this runs a genuine console, so PSReadLine
// gives syntax colouring, tab completion, history, Read-Host and full-screen
// console apps. Output is retained in a ring buffer so a remount (tab switch,
// detach, reload) reattaches with scrollback instead of losing the session.
const PTY_IDLE_MS = 10 * 60 * 1000;
const PTY_MAX = 4;
const PTY_BUF = 256 * 1024;

type PtySession = {
  id: string;
  term: import("node-pty").IPty;
  // One shell, many views: the dock and a detached window can watch the same
  // console at once (input from either goes to the same PTY).
  clients: Set<import("ws").WebSocket>;
  buf: string;
  cwd: string;
  cols: number;
  rows: number;
  lastUsed: number;
};

function trimRing(s: string): string {
  if (s.length <= PTY_BUF) return s;
  const from = s.length - PTY_BUF;
  const cut = s.indexOf("\n", from);
  return s.slice(cut >= 0 ? cut + 1 : from);
}

function powershellPty(): Plugin {
  const sessions = new Map<string, PtySession>();
  let ptyMod: Promise<any> | null = null;

  // Loaded lazily: `vite build` must not require the native addon.
  const loadPty = () =>
    (ptyMod ??= import("node-pty")
      .then((m: any) => (typeof m.spawn === "function" ? m : m.default))
      .catch((e) => {
        console.error("[ps] node-pty unavailable:", e?.message ?? e);
        return null;
      }));

  const send = (ws: import("ws").WebSocket, msg: unknown) => {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  };

  const broadcast = (s: PtySession, msg: unknown) => {
    for (const c of s.clients) send(c, msg);
  };

  const hello = (s: PtySession, ws: import("ws").WebSocket, fresh: boolean) => {
    send(ws, {
      type: "hello",
      session: s.id,
      fresh,
      shell: PS_ENGINE,
      cwd: s.cwd,
      cols: s.cols,
      rows: s.rows,
    });
    if (!fresh && s.buf) send(ws, { type: "data", data: s.buf });
  };

  // Wire a fresh console into a session. The session object stays stable so a
  // reset (or reattach) never orphans the views already attached to it.
  const wire = (pty: any, s: PtySession) => {
    const term = pty.spawn(PS_ENGINE, PS_ARGS, {
      name: "xterm-256color",
      cols: s.cols,
      rows: s.rows,
      cwd: s.cwd,
      env: { ...process.env, TERM: "xterm-256color", TERM_PROGRAM: "sipher-dashboard" },
    });
    s.term = term;
    term.onData((d: string) => {
      s.lastUsed = Date.now();
      s.buf = trimRing(s.buf + d);
      broadcast(s, { type: "data", data: d });
    });
    term.onExit(({ exitCode }: { exitCode: number }) => {
      if (s.term !== term) return;
      if (sessions.get(s.id) === s) sessions.delete(s.id);
      broadcast(s, { type: "exit", code: exitCode });
    });
  };

  const kill = (s: PtySession) => {
    if (sessions.get(s.id) === s) sessions.delete(s.id);
    const term = s.term;
    s.term = null as any;
    for (const c of s.clients) {
      try {
        c.close(1000, "session closed");
      } catch {}
    }
    s.clients.clear();
    try {
      term?.kill();
    } catch {}
  };

  const spawnSession = (pty: any, id: string, cols: number, rows: number): PtySession => {
    const s: PtySession = {
      id,
      term: null as any,
      clients: new Set(),
      buf: "",
      cwd: process.env.SIPHER_PS_CWD ?? path.resolve(__dirname, ".."),
      cols,
      rows,
      lastUsed: Date.now(),
    };
    sessions.set(id, s);
    wire(pty, s);
    return s;
  };

  const restart = (pty: any, s: PtySession) => {
    const old = s.term;
    s.term = null as any;
    try {
      old?.kill();
    } catch {}
    s.buf = "";
    s.lastUsed = Date.now();
    wire(pty, s);
    for (const c of s.clients) hello(s, c, true);
  };

  const gc = setInterval(() => {
    const now = Date.now();
    for (const s of [...sessions.values()]) {
      if (s.clients.size === 0 && now - s.lastUsed > PTY_IDLE_MS) kill(s);
    }
    while (sessions.size > PTY_MAX) {
      const idle = [...sessions.values()]
        .filter((s) => s.clients.size === 0)
        .sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!idle) break;
      kill(idle);
    }
  }, 60_000);
  gc.unref?.();

  function onConnection(pty: any, ws: import("ws").WebSocket, u: URL) {
    const wanted = (u.searchParams.get("session") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    const id = wanted || randomUUID();
    const existing = sessions.get(id);
    const s = existing ?? spawnSession(pty, id, 120, 30);

    s.clients.add(ws);
    s.lastUsed = Date.now();
    hello(s, ws, !existing);

    ws.on("message", (raw) => {
      s.lastUsed = Date.now();
      let m: any;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.type === "in" && typeof m.data === "string") {
        try {
          s.term.write(m.data);
        } catch {}
      } else if (m.type === "resize") {
        const cols = Math.round(Number(m.cols));
        const rows = Math.round(Number(m.rows));
        if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 20 || rows < 5 || cols > 500 || rows > 300) return;
        s.cols = cols;
        s.rows = rows;
        try {
          s.term.resize(cols, rows);
        } catch {}
      } else if (m.type === "reset") {
        restart(pty, s);
      }
    });

    const detach = () => {
      s.clients.delete(ws);
      s.lastUsed = Date.now();
    };
    ws.on("close", detach);
    ws.on("error", detach);
  }


  function attach(server: { httpServer: http.Server | null }, wss: WebSocketServer) {
    const httpServer = server.httpServer;
    if (!httpServer) return;
    httpServer.on("upgrade", (req, socket, head) => {
      const u = new URL(req.url ?? "/", "http://localhost");
      if (u.pathname !== "/api/pty") return;
      if (!LOOPBACK.test(req.socket.remoteAddress ?? "")) {
        socket.destroy();
        return;
      }
      void loadPty().then((pty) => {
        if (!pty) {
          socket.write(
            "HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nnode-pty is not installed",
          );
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => onConnection(pty, ws, u));
      });
    });
    httpServer.on("close", () => {
      for (const s of [...sessions.values()]) kill(s);
    });
  }

  // Loopback-only diagnostics: full scrollback for a session (the browser only
  // renders the visible rows, so tests and debugging read the ring buffer).
  const bufferRoute = (server: { middlewares: { use: (fn: any) => void } }) => {
    server.middlewares.use((req: any, res: any, next: () => void) => {
      const u = new URL(req.url ?? "/", "http://localhost");
      if (u.pathname !== "/api/pty/buf") return next();
      if (!LOOPBACK.test(req.socket.remoteAddress ?? "")) {
        res.statusCode = 403;
        return res.end("loopback only");
      }
      const s = sessions.get(u.searchParams.get("session") ?? "");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: !!s,
          sessions: [...sessions.keys()],
          attached: (s?.clients.size ?? 0) > 0,
          cols: s?.cols,
          rows: s?.rows,
          buf: s?.buf ?? "",
        }),
      );
    });
  };

  return {
    name: "sipher-powershell",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
      void loadPty();
      attach(server, wss);
      bufferRoute(server);
    },
    configurePreviewServer(server) {
      const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
      void loadPty();
      attach(server, wss);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), powershellPty(), opencodeSupervisor()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Fail fast when the robot is unreachable; otherwise dozens of hung sockets
    // starve the browser's per-origin connection pool (and the ps terminal).
    proxy: {
      "/api/ai": {
        target: `http://127.0.0.1:${AI_PORT}`,
        rewrite: (p) => p.replace(/^\/api\/ai/, ""),
        timeout: 600_000,
        proxyTimeout: 600_000,
        ws: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Authorization", AI_AUTH);
          });
          proxy.on("error", (_e, _req, res) => {
            if (res && !res.headersSent) {
              res.statusCode = 503;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, err: "opencode backend down" }));
            }
          });
        },
      },
      "/api": { target: api, timeout: 3000, proxyTimeout: 3000 },
      "/command": { target: api, timeout: 5000, proxyTimeout: 5000 },
    },
  },
  preview: {
    proxy: {
      "/api/ai": {
        target: `http://127.0.0.1:${AI_PORT}`,
        rewrite: (p) => p.replace(/^\/api\/ai/, ""),
        timeout: 600_000,
        proxyTimeout: 600_000,
        ws: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Authorization", AI_AUTH);
          });
        },
      },
      "/api": { target: api, timeout: 3000, proxyTimeout: 3000 },
      "/command": { target: api, timeout: 5000, proxyTimeout: 5000 },
    },
  },
});
