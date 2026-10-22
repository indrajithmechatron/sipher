import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { TERMINALS, TERMINAL_LINES } from "./data";
import { cn } from "@/lib/utils";
import { Dot } from "./chrome";
import { AIChat } from "./AIChat";
import type { Telemetry } from "./sipher";

type Line = { c: string; text: string; partial?: boolean };

const colorFor: Record<string, string> = {
  fg: "text-foreground/85",
  muted: "text-muted-foreground",
  warn: "text-warn",
  danger: "text-danger",
  ok: "text-ok",
  signal: "text-signal",
};

const PS_SID_KEY = "sipher-ps-session";

// xterm needs concrete colours; the theme tokens are oklch(), so resolve them
// through a 1px canvas (which converts any CSS colour to rgba).
function cssVarColor(name: string, fallback: string) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.fillStyle = "#000";
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}

function xtermTheme() {
  return {
    background: cssVarColor("--background", "#0b0d10"),
    foreground: cssVarColor("--foreground", "#d7dae0"),
    cursor: cssVarColor("--signal", "#5fd3c4"),
    cursorAccent: cssVarColor("--background", "#0b0d10"),
    selectionBackground: "#2f4a55",
    black: "#20242b",
    red: "#e35d6a",
    green: "#8cc265",
    yellow: "#d9a05b",
    blue: "#5aa7f0",
    magenta: "#c17ae0",
    cyan: "#54b9c8",
    white: "#cdd2da",
    brightBlack: "#5b6370",
    brightRed: "#ff7f8c",
    brightGreen: "#a6dc7f",
    brightYellow: "#f0bd7a",
    brightBlue: "#7cc2ff",
    brightMagenta: "#dd9df5",
    brightCyan: "#78d6e4",
    brightWhite: "#f2f5fa",
  };
}

type PsStatus = "connecting" | "ready" | "reconnecting" | "exited";

function PowerShellSession() {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<PsStatus>("connecting");
  const [engine, setEngine] = useState("powershell");
  const [cwd, setCwd] = useState("");
  const statusRef = useRef<PsStatus>("connecting");
  const pendingRef = useRef<string>("");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Lucida Console", monospace',
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 8000,
      theme: xtermTheme(),
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    host.querySelector(".xterm")?.setAttribute("aria-label", "PowerShell terminal");

    const safeFit = () => {
      try {
        if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
      } catch {
        /* panel hidden or animating */
      }
    };
    safeFit();

    let sid = "";
    try {
      sid = sessionStorage.getItem(PS_SID_KEY) ?? "";
      if (!sid) {
        sid = crypto.randomUUID();
        sessionStorage.setItem(PS_SID_KEY, sid);
      }
    } catch {
      sid = crypto.randomUUID();
    }

    let closed = false;
    let retries = 0;
    let retryTimer: number | undefined;

    const sendResize = () => {
      const ws = wsRef.current;
      if (ws?.readyState === 1) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    const connect = () => {
      if (closed) return;
      setStatus(retries ? "reconnecting" : "connecting");
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/api/pty?session=${encodeURIComponent(sid)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retries = 0;
        sendResize();
      };
      ws.onmessage = (ev) => {
        let m: { type?: string; [k: string]: unknown };
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (m.type === "hello") {
          setEngine(String(m.shell ?? "powershell").replace(/\.exe$/i, ""));
          if (typeof m.cwd === "string") setCwd(m.cwd);
          if (m.fresh) term.reset();
          setStatus("ready");
          sendResize();
          term.focus();
          if (pendingRef.current) {
            const pending = pendingRef.current;
            pendingRef.current = "";
            ws.send(JSON.stringify({ type: "in", data: pending }));
          }
        } else if (m.type === "data" && typeof m.data === "string") {
          term.write(m.data);
        } else if (m.type === "exit") {
          setStatus("exited");
          const code = typeof m.code === "number" ? ` · exit ${m.code}` : "";
          term.write(`\r\n\x1b[33m[session ended${code}]  type to start a new shell\x1b[0m\r\n`);
        }
      };
      ws.onclose = (ev) => {
        if (closed || ev.code === 4001) return;
        setStatus("reconnecting");
        retryTimer = window.setTimeout(connect, Math.min(5000, 400 * Math.pow(1.6, retries++)));
      };
      ws.onerror = () => {
        /* onclose drives the reconnect */
      };
    };

    const dataSub = term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState !== 1) return;
      if (statusRef.current === "exited") {
        // The shell is gone: the first keystroke restarts it, and whatever was
        // typed meanwhile is replayed once the new console is ready.
        const first = pendingRef.current === "";
        pendingRef.current += data;
        if (first) ws.send(JSON.stringify({ type: "reset" }));
        return;
      }
      ws.send(JSON.stringify({ type: "in", data }));
    });

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.shiftKey && (e.key === "c" || e.key === "C")) {
        const sel = term.getSelection();
        if (sel) void navigator.clipboard.writeText(sel);
        return false;
      }
      if (e.ctrlKey && e.shiftKey && (e.key === "v" || e.key === "V")) {
        void navigator.clipboard.readText().then((text) => {
          const ws = wsRef.current;
          if (ws?.readyState === 1) ws.send(JSON.stringify({ type: "in", data: text }));
        });
        return false;
      }
      return true;
    });

    const ro = new ResizeObserver(() => {
      safeFit();
      sendResize();
    });
    ro.observe(host);

    const mo = new MutationObserver(() => {
      term.options.theme = xtermTheme();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    connect();

    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      ro.disconnect();
      mo.disconnect();
      dataSub.dispose();
      try {
        wsRef.current?.close(1000, "view closed");
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, []);

  const restart = () => {
    const ws = wsRef.current;
    if (ws?.readyState === 1) ws.send(JSON.stringify({ type: "reset" }));
    else location.reload();
  };

  const tone = status === "ready" ? "ok" : status === "exited" ? "warn" : "signal";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="hairline-b flex shrink-0 items-center gap-2 px-3 py-1 font-mono text-[10px] text-muted-foreground">
        <Dot tone={tone} live={status === "ready"} />
        <span className="uppercase tracking-wide">local · win32 · conpty</span>
        <span className="truncate">
          {engine} · {status === "ready" ? "pty" : status}
        </span>
        {cwd && <span className="ml-auto truncate opacity-70">{cwd}</span>}
        <button
          type="button"
          onClick={restart}
          title="restart shell"
          className={cn(
            "flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] hover:bg-white/5 hover:text-foreground",
            cwd ? "ml-2" : "ml-auto",
          )}
        >
          <RotateCcw className="size-3" />
        </button>
      </div>
      <div
        ref={hostRef}
        onClick={() => termRef.current?.focus()}
        className="min-h-0 flex-1 overflow-hidden px-2 py-1"
      />
    </div>
  );
}


export function TerminalBody({ id, tele }: { id: string; tele?: Telemetry }) {
  const term = TERMINALS.find((t) => t.id === id);
  if (id === "ai") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <AIChat />
      </div>
    );
  }
  if (id === "powershell") return <PowerShellSession />;
  let live: { c: string; text: string }[] = [];
  if (tele && id === "agent") {
    live = tele.events.slice(0, 8).map((e) => ({
      c: e.status === "escalated" ? "warn" : e.status === "failed" ? "danger" : "signal",
      text: `▸ ${e.agent.padEnd(14)} ${e.action.replace("tool:", "").padEnd(18)} ${e.latency.padStart(7)}  ${e.status}`,
    }));
  } else if (tele && id === "sensors") {
    const s = tele.raw;
    live = [
      { c: "muted", text: "$ GET /api/sensors" },
      {
        c: tele.piOnline ? "ok" : "danger",
        text: `pi: ${tele.piOnline ? "LIVE" : "OFFLINE"} · pico: ${tele.picoOnline ? "LIVE" : "OFFLINE"}${tele.picoAgeMs != null ? ` · age ${tele.picoAgeMs}ms` : ""}`,
      },
      s
        ? {
            c: "fg",
            text: `mpu: [${(s.mpu ?? []).map((v) => Number(v).toFixed(2)).join(", ")}]`,
          }
        : { c: "muted", text: "mpu: —" },
      s?.ina
        ? {
            c: "fg",
            text: `ina: { voltage_v: ${s.ina.voltage_v ?? "—"}, current_ma: ${s.ina.current_ma ?? "—"} }`,
          }
        : { c: "warn", text: "ina: null" },
      s?.vl53_mm != null
        ? { c: "fg", text: `vl53_mm: ${s.vl53_mm}` }
        : { c: "warn", text: "vl53_mm: null" },
      s?.gps
        ? {
            c: s.gps.fix ? "ok" : "warn",
            text: `gps: fix=${s.gps.fix ? "yes" : "no"} sat=${s.gps.satellites ?? "—"} speed=${s.gps.speed_knots ?? "—"} kn raw=${(s.gps.raw ?? "").slice(0, 48)}`,
          }
        : { c: "muted", text: "gps: —" },
      s
        ? {
            c: "muted",
            text: `i2c0: [${(s.i2c0 ?? []).join(", ")}]  i2c1: [${(s.i2c1 ?? []).join(", ")}]`,
          }
        : { c: "muted", text: "i2c: —" },
    ];
  }
  return (
    <div className="h-full overflow-y-auto bg-background px-3 py-2 font-mono text-[11px] leading-[1.6]">
      {term?.host && (
        <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Dot tone="ok" live /> {term.host}
        </div>
      )}
      {[...live, ...(id === "sensors" || id === "agent" ? [] : TERMINAL_LINES[id] ?? [])].map((l, i) => (
        <div key={i} className={colorFor[l.c]}>
          {l.text}
        </div>
      ))}
      <div className="text-foreground/85">$ _</div>
    </div>
  );
}

export function TerminalDock({
  onDetach,
  collapsed,
  onToggle,
  tele,
}: {
  onDetach: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  tele: Telemetry;
}) {
  const [active, setActive] = useState("sensors");
  const [menu, setMenu] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col bg-chrome">
      <div className="hairline-b relative flex h-8 shrink-0 items-center">
        {TERMINALS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              "relative h-full px-3 font-mono text-[11px] transition-colors",
              active === t.id
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active === t.id && <span className="absolute top-0 right-0 left-0 h-[2px] bg-signal" />}
            {t.title}
          </button>
        ))}
        <button
          onClick={() => setMenu((m) => !m)}
          className="flex h-full items-center gap-1 px-2 font-mono text-[10px] text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3" /> terminals <ChevronDown className="size-3" />
        </button>
        {menu && (
          <div className="absolute top-8 left-0 z-40 w-72 rounded-sm border border-hairline bg-popover p-1 shadow-xl">
            <div className="px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
              Available terminals
            </div>
            {TERMINALS.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-[3px] px-2 py-1 hover:bg-accent"
              >
                <Dot tone={t.id === "problems" ? "warn" : "ok"} />
                <button
                  onClick={() => {
                    setActive(t.id);
                    setMenu(false);
                  }}
                  className="flex-1 text-left font-mono text-[11px] text-foreground/85"
                >
                  {t.title}
                  <span className="ml-2 text-[10px] text-muted-foreground">{t.host || "local"}</span>
                </button>
                <button
                  onClick={() => {
                    onDetach(t.id);
                    setMenu(false);
                  }}
                  className="rounded-sm border border-hairline px-1.5 py-[1px] font-mono text-[9px] text-muted-foreground hover:border-signal/40 hover:text-signal"
                >
                  detach
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1 pr-2 text-muted-foreground">
          <button
            onClick={() => onDetach(active)}
            title="Detach into a floating window"
            className="flex items-center gap-1 rounded-sm px-1.5 py-1 font-mono text-[10px] hover:bg-accent hover:text-foreground"
          >
            <ExternalLink className="size-3" /> detach
          </button>
          <button
            onClick={onToggle}
            className="grid size-6 place-items-center rounded-sm hover:bg-accent hover:text-foreground"
          >
            {collapsed ? <Maximize2 className="size-3" /> : <Minus className="size-3" />}
          </button>
          <button className="grid size-6 place-items-center rounded-sm hover:bg-accent hover:text-foreground">
            <X className="size-3" />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="min-h-0 flex-1">
          <TerminalBody id={active} tele={tele} />
        </div>
      )}
    </div>
  );
}
