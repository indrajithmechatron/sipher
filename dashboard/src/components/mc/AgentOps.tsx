import { AlertTriangle, ShieldAlert, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dot, Chip } from "./chrome";
import type { Agent, LiveEvent, Telemetry } from "./sipher";

const stateTone: Record<string, "ok" | "warn" | "danger" | "signal" | "muted"> = {
  running: "signal",
  idle: "muted",
  escalated: "warn",
  failed: "danger",
  blocked: "warn",
};

const stateText: Record<string, string> = {
  running: "text-signal",
  idle: "text-muted-foreground",
  escalated: "text-warn",
  failed: "text-danger",
  blocked: "text-warn",
};

export function AgentCard({
  a,
  compact,
  onClick,
  active,
}: {
  a: Agent;
  compact?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  const alert = a.state === "escalated" || a.state === "failed";
  return (
    <button
      onClick={onClick}
      className={cn(
        "block w-full border-b border-hairline/60 px-3 py-2 text-left transition-colors",
        active ? "bg-signal/5" : "hover:bg-accent/30",
        alert && (a.state === "failed" ? "bg-danger/5" : "bg-warn/5"),
      )}
    >
      <div className="flex items-center gap-2">
        <Dot tone={stateTone[a.state]!} live={a.state === "running"} />
        <span className="font-mono text-[11px] text-foreground/90">{a.name}</span>
        <span
          className={cn(
            "font-mono text-[9px] tracking-[0.14em] uppercase",
            stateText[a.state],
          )}
        >
          {a.state}
        </span>
        <span className="tabular ml-auto font-mono text-[10px] text-muted-foreground">
          {a.latency} ms
        </span>
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
        {a.task}
      </div>
      {!compact && (
        <div className="mt-1 flex items-center gap-3 font-mono text-[9px] text-muted-foreground/70">
          <span>tool:{a.tool}</span>
          <span>{(a.tokens / 1000).toFixed(1)}k tok</span>
          <span>${a.cost.toFixed(4)}</span>
          <span>{a.steps} steps</span>
        </div>
      )}
      <div className="mt-1.5 h-[2px] w-full overflow-hidden rounded-full bg-rail">
        <div
          className={cn(
            "h-full transition-all",
            a.state === "failed" ? "bg-danger" : a.state === "escalated" ? "bg-warn" : "bg-signal/70",
          )}
          style={{ width: `${Math.min(100, a.latency / 6)}%` }}
        />
      </div>
      {alert && (
        <div
          className={cn(
            "mt-2 rounded-sm border px-2 py-1.5",
            a.state === "failed" ? "border-danger/40 bg-danger/10" : "border-warn/40 bg-warn/10",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-1.5 font-mono text-[10px] tracking-wide uppercase",
              a.state === "failed" ? "text-danger" : "text-warn",
            )}
          >
            {a.state === "failed" ? (
              <AlertTriangle className="size-3" />
            ) : (
              <ShieldAlert className="size-3" />
            )}
            {a.state === "failed" ? "agent failure" : "safety escalation"}
          </div>
          <div className="mt-1 font-mono text-[10px] text-foreground/80">{a.reason}</div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            → {a.escalateTo} · awaiting acknowledgement
          </div>
        </div>
      )}
    </button>
  );
}

export function EventTimeline({ events }: { events: LiveEvent[] }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <span className="absolute top-2 bottom-2 left-[18px] w-px bg-hairline" />
      {events.length === 0 && (
        <div className="px-1 font-mono text-[10px] text-muted-foreground">listening…</div>
      )}
      {events.map((e) => (
        <div key={e.id} className="relative flex gap-3 pb-2.5 pl-4">
          <span className="absolute top-[6px] left-[2px]">
            <Dot
              tone={
                e.status === "escalated"
                  ? "warn"
                  : e.status === "failed"
                    ? "danger"
                    : e.status === "ok"
                      ? "ok"
                      : "signal"
              }
              live={e.status === "running"}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] text-foreground/85">{e.agent}</span>
              <span className="truncate font-mono text-[10px] text-muted-foreground/80">
                {e.action}
              </span>
              <span className="tabular ml-auto font-mono text-[10px] text-muted-foreground/70">
                {e.latency}
              </span>
            </div>
            <div className="truncate font-mono text-[10px] text-muted-foreground">{e.detail}</div>
            <div className="flex gap-3 font-mono text-[9px] text-muted-foreground/60">
              <span className="tabular">{e.t}</span>
              <span>{e.tokens} tok</span>
              <span
                className={cn(
                  "uppercase",
                  e.status === "escalated"
                    ? "text-warn"
                    : e.status === "failed"
                      ? "text-danger"
                      : e.status === "ok"
                        ? "text-ok/80"
                        : "text-signal",
                )}
              >
                {e.status}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Full AI Operations workspace panel. */
export function AiOperations({
  tele,
  onSelectAgent,
  selectedAgent,
}: {
  tele: Telemetry;
  onSelectAgent?: (a: Agent) => void;
  selectedAgent?: string;
}) {
  const alerts = tele.agents.filter((a) => a.state === "escalated" || a.state === "failed");
  const tokens = tele.agents.reduce((s, a) => s + a.tokens, 0);
  const cost = tele.agents.reduce((s, a) => s + a.cost, 0);
  return (
    <div className="flex h-full min-h-0 bg-background">
      <div className="hairline-r flex w-[300px] shrink-0 flex-col bg-panel">
        <div className="hairline-b flex h-8 items-center gap-2 bg-chrome px-3">
          <Dot tone="signal" live />
          <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            Agents
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {tele.agents.filter((a) => a.state === "running").length}/{tele.agents.length} active
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tele.agents.map((a) => (
            <AgentCard
              key={a.id}
              a={a}
              active={selectedAgent === a.id}
              {...(onSelectAgent ? { onClick: () => onSelectAgent(a) } : {})}
            />
          ))}
        </div>
        <div className="hairline-t grid grid-cols-3 gap-2 bg-chrome px-3 py-2 font-mono text-[10px]">
          <Stat label="tokens" value={`${(tokens / 1000).toFixed(1)}k`} />
          <Stat label="spend" value={`$${cost.toFixed(4)}`} />
          <Stat label="p95" value={`${Math.max(...tele.agents.map((a) => a.latency))} ms`} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hairline-b flex h-8 items-center gap-2 bg-chrome px-3">
          <Chip active>Timeline</Chip>
          <Chip>Traces</Chip>
          <Chip {...(alerts.length ? { tone: "warn" as const } : {})}>
            Escalations {alerts.length ? `· ${alerts.length}` : ""}
          </Chip>
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <Zap className="size-3 text-signal" /> orchestrator live
          </span>
        </div>
        {alerts.map((a) => (
          <div
            key={a.id}
            className={cn(
              "hairline-b flex items-center gap-2 px-3 py-1.5 font-mono text-[10px]",
              a.state === "failed" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn",
            )}
          >
            <AlertTriangle className="size-3 shrink-0" />
            <span className="uppercase">{a.name}</span>
            <span className="truncate text-foreground/80">{a.reason}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">→ {a.escalateTo}</span>
            <button
              className={cn(
                "shrink-0 rounded-sm border px-1.5 py-[1px]",
                a.state === "failed" ? "border-danger/40" : "border-warn/40",
              )}
            >
              acknowledge
            </button>
          </div>
        ))}
        <EventTimeline events={tele.events} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] tracking-[0.14em] text-muted-foreground/60 uppercase">{label}</div>
      <div className="tabular text-foreground/85">{value}</div>
    </div>
  );
}
