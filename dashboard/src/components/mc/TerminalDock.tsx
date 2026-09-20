import { useState } from "react";
import { ChevronDown, ExternalLink, Maximize2, Minus, Plus, X } from "lucide-react";
import { TERMINALS, TERMINAL_LINES } from "./data";
import { cn } from "@/lib/utils";
import { Dot } from "./chrome";
import type { Telemetry } from "./sipher";

const colorFor: Record<string, string> = {
  fg: "text-foreground/85",
  muted: "text-muted-foreground",
  warn: "text-warn",
  danger: "text-danger",
  ok: "text-ok",
  signal: "text-signal",
};

export function TerminalBody({ id, tele }: { id: string; tele?: Telemetry }) {
  const term = TERMINALS.find((t) => t.id === id);
  const live =
    tele && id === "agent"
      ? tele.events.slice(0, 8).map((e) => ({
          c: e.status === "escalated" ? "warn" : e.status === "failed" ? "danger" : "signal",
          text: `▸ ${e.agent.padEnd(14)} ${e.action.replace("tool:", "").padEnd(18)} ${e.latency.padStart(7)}  ${e.status}`,
        }))
      : [];
  return (
    <div className="h-full overflow-y-auto bg-background px-3 py-2 font-mono text-[11px] leading-[1.6]">
      {term?.host && (
        <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Dot tone="ok" live /> {term.host}
        </div>
      )}
      {[...live, ...(TERMINAL_LINES[id] ?? [])].map((l, i) => (
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
