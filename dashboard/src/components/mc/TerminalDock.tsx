import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Maximize2, Minus, Plus, X } from "lucide-react";
import { TERMINALS, TERMINAL_LINES } from "./data";
import { cn } from "@/lib/utils";
import { Dot } from "./chrome";
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

type PsEvent = {
  ready?: boolean;
  version?: string;
  cwd?: string;
  chunk?: string;
  err?: string;
  error?: string;
  done?: boolean;
  ok?: boolean;
  code?: number;
  session?: string;
};

function PowerShellSession() {
  const [lines, setLines] = useState<Line[]>([
    { c: "muted", text: "Windows PowerShell · persistent session on this machine (dev host)" },
    { c: "muted", text: "variables, functions, modules and cwd persist · ↑/↓ history · ctrl+L clear · ctrl+C resets shell" },
  ]);
  const [cwd, setCwd] = useState("");
  const [input, setInput] = useState("");
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sid = useRef<string>(crypto.randomUUID());
  const busyRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const prompt = cwd ? `PS ${cwd}> ` : "PS> ";

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // Append streamed text, continuing the last line when it has no trailing newline.
  // Lines prefixed with the runner's error sentinel are painted as errors.
  const append = (c: string, text: string) => {
    if (!text) return;
    const ERR = "__SIPHER_ERR__";
    const paint = (s: string) =>
      s.startsWith(ERR) ? { c: "danger", text: s.slice(ERR.length) } : { c, text: s };
    setLines((prev) => {
      const next = prev.slice();
      const parts = text.replace(/\r/g, "").split("\n");
      const first = parts.shift() ?? "";
      const last = next[next.length - 1];
      if (first) {
        if (last && last.partial && last.text !== "")
          next[next.length - 1] = { ...last, text: last.text + first };
        else if (last && last.partial) next[next.length - 1] = { ...paint(first), partial: true };
        else next.push({ ...paint(first), partial: true });
      }
      for (const p of parts) next.push({ ...paint(p), partial: true });
      return next;
    });
  };

  async function run(raw: string) {
    const cmd = raw.trim();
    if (!cmd || busyRef.current) return;
    if (cmd === "cls" || cmd === "clear") {
      setLines([]);
      setInput("");
      return;
    }
    setLines((l) => [...l, { c: "fg", text: prompt + cmd }]);
    setInput("");
    setHi(-1);
    setHist((h) => (h[h.length - 1] === cmd ? h : [...h, cmd]));
    setBusy(true);
    let finished = false;
    try {
      const res = await fetch("/api/ps", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ cmd, session: sid.current }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const ev = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = ev.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          let msg: PsEvent;
          try {
            msg = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }
          if (msg.ready) {
            if (msg.version) {
              setLines((l) => {
                const next = l.slice();
                if (next[0]) next[0] = { c: "muted", text: `Windows PowerShell ${msg.version} · persistent session (state persists)` };
                return next;
              });
            }
            if (msg.cwd) setCwd(msg.cwd.replace(/\\+$/, ""));
          } else if (typeof msg.chunk === "string") {
            append("fg", msg.chunk);
          } else if (typeof msg.err === "string") {
            append("danger", msg.err);
          } else if (msg.error) {
            append("danger", msg.error);
          } else if (msg.done) {
            finished = true;
            if (msg.cwd) setCwd(String(msg.cwd).replace(/\\+$/, ""));
            setLines((prev) => {
              const next = prev.slice();
              const last = next[next.length - 1];
              if (last?.partial) next[next.length - 1] = { ...last, partial: false };
              return next;
            });
          }
        }
      }
      if (!finished) append("warn", "(stream ended — shell may have exited)");
    } catch (e) {
      append("danger", `/api/ps unreachable (${String(e)}) — runner runs on the dev host`);
    } finally {
      setBusy(false);
    }
  }

  async function killShell() {
    append("warn", "^C — resetting shell (variables and cwd cleared)");
    try {
      await fetch("/api/ps/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: sid.current }),
      });
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      ref={scrollRef}
      onClick={() => inputRef.current?.focus()}
      className="min-h-0 flex-1 overflow-y-auto bg-background px-3 py-2 font-mono text-[11px] leading-[1.6]"
    >
      {lines.map((l, i) => (
        <div key={i} className={colorFor[l.c]}>
          {l.text || " "}
        </div>
      ))}
      <div className="flex text-foreground/85">
        <span className="shrink-0 whitespace-pre">{prompt}</span>
        <input
          ref={inputRef}
          data-ps-input
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder={busy ? "running… (ctrl+C to reset)" : ""}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!busy) void run(input);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (hist.length) {
                const n = hi < 0 ? hist.length - 1 : Math.max(0, hi - 1);
                setHi(n);
                setInput(hist[n]);
              }
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              if (hi >= 0) {
                const n = hi + 1;
                if (n >= hist.length) {
                  setHi(-1);
                  setInput("");
                } else {
                  setHi(n);
                  setInput(hist[n]);
                }
              }
            } else if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
              e.preventDefault();
              setLines([]);
            } else if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
              e.preventDefault();
              if (busy) void killShell();
              else setInput("");
            }
          }}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground/85 caret-signal outline-none"
        />
      </div>
    </div>
  );
}

export function TerminalBody({ id, tele }: { id: string; tele?: Telemetry }) {
  const term = TERMINALS.find((t) => t.id === id);
  if (id === "powershell") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        {term?.host && (
          <div className="hairline-b flex shrink-0 items-center gap-1.5 px-3 py-1 font-mono text-[10px] text-muted-foreground">
            <Dot tone="ok" live /> {term.host}
          </div>
        )}
        <PowerShellSession />
      </div>
    );
  }
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
