import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

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

// Engine: prefer PowerShell 7 (pwsh) when available, else Windows PowerShell.
// Both speak the same child-process protocol, so they are interchangeable.
const PS_ENGINE = process.env.SIPHER_PS_ENGINE ?? "powershell.exe";

// The REPL runs inside one long-lived PowerShell process. Each command arrives
// as "<token>\n<base64(cmd)>\n"; the marker line carries token, success, exit
// code and working directory back. stdout/stderr are streamed verbatim, so the
// dashboard sees output live (including slow pipelines).
const REPL = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
Write-Output ('${READY_PREFIX}' + $PSVersionTable.PSVersion.ToString() + '|' + (Get-Location).Path)
while ($true) {
  $tok = [Console]::In.ReadLine()
  if ($null -eq $tok) { break }
  $b64 = [Console]::In.ReadLine()
  if ($null -eq $b64) { break }
  $cmd = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
  $ok = 1
  try {
    $sb = [ScriptBlock]::Create($cmd)
    . $sb *>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) {
        foreach ($ln in (($_ | Out-String).TrimEnd() -split "\\r?\\n")) { '${ERR_PREFIX}' + $ln }
      } else { $_ }
    } | Out-String -Stream -Width 200 | ForEach-Object { Write-Output $_ }
  } catch {
    $ok = 0
    foreach ($ln in (($_ | Out-String).TrimEnd() -split "\\r?\\n")) { '${ERR_PREFIX}' + $ln }
  }
  $ec = 0
  if ($null -ne $LASTEXITCODE) { $ec = [int]$LASTEXITCODE }
  Write-Output ('${DONE_PREFIX}' + $tok + '|' + $ok + '|' + $ec + '|' + (Get-Location).Path)
}
`;

type DoneInfo = { cwd: string; ok: boolean; code: number };
type Pending = {
  tok: string;
  onChunk: (s: string) => void;
  onErr: (s: string) => void;
  resolve: (d: DoneInfo) => void;
  outBuf: string;
  errBuf: string;
  timer: NodeJS.Timeout;
};

type PsSession = {
  child: ChildProcessWithoutNullStreams;
  version: string;
  cwd: string;
  ready: boolean;
  pending: Pending | null;
  lastUsed: number;
  alive: boolean;
};

function powershellApi(): Plugin {
  const sessions = new Map<string, PsSession>();

  const destroy = (id: string) => {
    const s = sessions.get(id);
    if (!s) return;
    s.alive = false;
    try {
      s.child.kill();
    } catch {}
    sessions.delete(id);
  };

  const create = (id: string): PsSession => {
    const child = spawn(
      PS_ENGINE,
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-OutputFormat",
        "Text",
        "-EncodedCommand",
        Buffer.from(REPL, "utf16le").toString("base64"),
      ],
      { windowsHide: true },
    );
    const s: PsSession = {
      child,
      version: "?",
      cwd: process.env.SIPHER_PS_CWD ?? path.resolve(__dirname, ".."),
      ready: false,
      pending: null,
      lastUsed: Date.now(),
      alive: true,
    };
    sessions.set(id, s);

    const feed = (buf: Buffer, which: "out" | "err") => {
      try {
        const text = buf.toString("utf8");
        const p = s.pending;
        if (!p) {
          if (which === "out") {
            const at = text.indexOf(READY_PREFIX);
            if (at >= 0) {
              const line = text.slice(at + READY_PREFIX.length).split(/\r?\n/)[0] ?? "";
              const cut = line.indexOf("|");
              if (cut > 0) {
                s.version = line.slice(0, cut).trim();
                s.cwd = line.slice(cut + 1).trim();
                s.ready = true;
              }
            }
          }
          return;
        }
      if (which === "out") {
        p.outBuf += text;
        let idx = p.outBuf.indexOf(DONE_PREFIX);
        if (idx === -1) {
          p.onChunk(text);
          p.outBuf = "";
          return;
        }
        // Marker found: everything before it is still live output.
        const before = p.outBuf.slice(0, idx);
        const lineEnd = p.outBuf.indexOf("\n", idx);
        if (lineEnd === -1) {
          // Partial marker line — keep it buffered, emit the rest.
          if (before) p.onChunk(before);
          p.outBuf = p.outBuf.slice(idx);
          return;
        }
        const line = p.outBuf.slice(idx, lineEnd).replace(/\r/g, "");
        const after = p.outBuf.slice(lineEnd + 1);
        const m = line.match(/^__SIPHER_DONE__\|([^|]+)\|(\d)\|(-?\d+)\|(.*)$/);
        if (before) p.onChunk(before);
        if (after) p.onChunk(after);
        p.outBuf = "";
        s.pending = null;
        clearTimeout(p.timer);
        s.lastUsed = Date.now();
        if (m && m[1] === p.tok) {
          s.cwd = m[4].trim();
          p.resolve({ cwd: s.cwd, ok: m[2] === "1", code: Number(m[3]) });
        } else {
          p.resolve({ cwd: s.cwd, ok: false, code: -1 });
        }
      } else {
        p.onErr(text);
      }
      } catch (e) {
        // Never let a parse hiccup take the dev server down.
        console.error("[ps] stream parse error:", e);
        const pend = s.pending;
        if (pend) {
          s.pending = null;
          clearTimeout(pend.timer);
          pend.resolve({ cwd: s.cwd, ok: false, code: -1 });
        }
      }
    };

    child.stdout.on("data", (b: Buffer) => feed(b, "out"));
    child.stderr.on("data", (b: Buffer) => feed(b, "err"));
    child.on("exit", () => {
      s.alive = false;
      const p = s.pending;
      s.pending = null;
      if (p) {
        clearTimeout(p.timer);
        p.resolve({ cwd: s.cwd, ok: false, code: -1 });
      }
      sessions.delete(id);
    });
    child.on("error", () => {
      s.alive = false;
      sessions.delete(id);
    });
    return s;
  };

  const gc = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (!s.pending && now - s.lastUsed > IDLE_MS) destroy(id);
    }
    if (sessions.size > MAX_SESSIONS) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) destroy(oldest[0]);
    }
  }, 60_000);
  gc.unref?.();

  return {
    name: "sipher-powershell",
    configureServer(server) {
      server.middlewares.use("/api/ps", (req, res) => {
        const url = (req.url ?? "").split("?")[0];
        const json = (code: number, obj: unknown) => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(obj));
        };
        if (!LOOPBACK.test(req.socket.remoteAddress ?? ""))
          return json(403, { ok: false, err: "powershell runner is loopback-only" });

        if (url === "/reset") {
          if (req.method !== "POST") return json(405, { ok: false, err: "POST only" });
          let body = "";
          req.on("data", (c: Buffer) => (body += c));
          req.on("end", () => {
            let id = "";
            try {
              id = String(JSON.parse(body).session ?? "");
            } catch {}
            if (id) destroy(id);
            json(200, { ok: true, reset: true });
          });
          return;
        }

        if (req.method !== "POST") return json(405, { ok: false, err: "POST {cmd, session} only" });
        let body = "";
        req.on("data", (c: Buffer) => {
          body += c;
          if (body.length > 64_000) req.destroy();
        });
        req.on("end", () => {
          let cmd = "";
          let id = "";
          try {
            const j = JSON.parse(body);
            cmd = String(j.cmd ?? "");
            id = String(j.session ?? "");
          } catch {
            return json(400, { ok: false, err: "invalid json" });
          }
          if (!id) id = randomUUID();
          if (!cmd.trim()) return json(400, { ok: false, err: "empty command" });

          const stream = (req.headers.accept ?? "").includes("text/event-stream");
          if (stream) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.setHeader("X-Accel-Buffering", "no");
            res.flushHeaders?.();
          }
          const send = (obj: unknown) => {
            if (stream) res.write(`data: ${JSON.stringify(obj)}\n\n`);
          };
          if (!stream) res.setHeader("Content-Type", "application/json");

          let s = sessions.get(id);
          const fresh = !s || !s.alive;
          if (fresh) s = create(id);
          const sess = s as PsSession;

          const run = () => {
            if (!sess.alive) {
              if (stream) {
                send({ error: "powershell session died" });
                res.end();
              } else json(500, { ok: false, err: "powershell session died" });
              return;
            }
            if (sess.pending) {
              if (stream) {
                send({ error: "busy: one command at a time" });
                res.end();
              } else json(409, { ok: false, err: "busy" });
              return;
            }
            const tok = randomUUID();
            let accOut = "";
            let accErr = "";
            const pending: Pending = {
              tok,
              outBuf: "",
              errBuf: "",
              onChunk: (text) => {
                if (stream) send({ chunk: text });
                else accOut += text;
              },
              onErr: (text) => {
                if (stream) send({ err: text });
                else accErr += text;
              },
              resolve: (d) => {
                if (stream) {
                  send({ done: true, cwd: d.cwd, ok: d.ok, code: d.code, session: id });
                  res.end();
                } else {
                  json(200, {
                    ok: d.ok,
                    out: accOut.replace(/\r/g, "").replace(/\n+$/, ""),
                    err: accErr.replace(/\r/g, "").replace(/\n+$/, ""),
                    code: d.code,
                    cwd: d.cwd,
                    session: id,
                  });
                }
              },
              timer: setTimeout(() => {
                destroy(id);
                if (stream) {
                  send({ error: "command exceeded 10 min — session reset" });
                  res.end();
                }
              }, CMD_TIMEOUT_MS),
            };
            sess.pending = pending;
            if (stream && fresh) send({ ready: true, engine: "Windows PowerShell", version: sess.version || "5.1" });
            sess.child.stdin.write(`${tok}\n${Buffer.from(cmd, "utf8").toString("base64")}\n`);
          };

          // New sessions need the READY marker before the first command.
          if (fresh && !sess.ready) {
            const wait = setInterval(() => {
              if (!sess.alive) {
                clearInterval(wait);
                if (stream) {
                  send({ error: "powershell failed to start" });
                  res.end();
                } else json(500, { ok: false, err: "powershell failed to start" });
                return;
              }
              if (sess.ready) {
                clearInterval(wait);
                run();
              }
            }, 25);
            setTimeout(() => {
              clearInterval(wait);
              if (!sess.ready && sess.alive && !sess.pending) {
                destroy(id);
                if (stream) {
                  send({ error: "powershell readiness timeout" });
                  res.end();
                } else json(500, { ok: false, err: "powershell readiness timeout" });
              }
            }, 10_000);
          } else {
            run();
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), powershellApi()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Fail fast when the robot is unreachable; otherwise dozens of hung sockets
    // starve the browser's per-origin connection pool (and the ps terminal).
    proxy: {
      "/api": { target: api, timeout: 3000, proxyTimeout: 3000 },
      "/command": { target: api, timeout: 5000, proxyTimeout: 5000 },
    },
  },
  preview: {
    proxy: {
      "/api": { target: api, timeout: 3000, proxyTimeout: 3000 },
      "/command": { target: api, timeout: 5000, proxyTimeout: 5000 },
    },
  },
});
