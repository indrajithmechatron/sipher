import { AlertTriangle } from "lucide-react";
import { Chip, Dot, Field, PanelHeader } from "./chrome";
import { cn } from "@/lib/utils";
import type { Telemetry } from "./sim";
import { EventTimeline } from "./AgentOps";

export type Selection = { kind: "node" | "agent" | "joint"; id: string; path: string[] };

function Section({ title }: { title: string }) {
  return (
    <div className="hairline-b hairline-t mt-2 bg-chrome px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
      {title}
    </div>
  );
}

function ContextBody({ sel, tele }: { sel: Selection; tele: Telemetry }) {
  const agent = tele.agents.find((a) => a.id === sel.id);
  if (agent) {
    return (
      <>
        <Section title="Agent" />
        <Field label="State" value={agent.state.toUpperCase()} tone={agent.state === "running" ? "text-signal" : agent.state === "failed" ? "text-danger" : agent.state === "escalated" ? "text-warn" : ""} />
        <Field label="Role" value={agent.role} />
        <Field label="Task" value={agent.task} />
        <Field label="Tool" value={agent.tool} />
        <Field label="Latency" value={`${agent.latency} ms`} />
        <Field label="Tokens" value={`${(agent.tokens / 1000).toFixed(1)}k`} />
        <Field label="Spend" value={`$${agent.cost.toFixed(4)}`} />
        <Field label="Steps" value={String(agent.steps)} />
        {agent.reason && (
          <div className="m-3 rounded-sm border border-warn/40 bg-warn/10 p-2">
            <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-warn uppercase">
              <AlertTriangle className="size-3" /> escalation
            </div>
            <div className="mt-1 font-mono text-[10px] text-foreground/80">{agent.reason}</div>
            <div className="font-mono text-[10px] text-muted-foreground">→ {agent.escalateTo}</div>
          </div>
        )}
      </>
    );
  }

  const joint = tele.joints.find((j) => j.name === sel.id);
  if (joint) {
    return (
      <>
        <Section title="Joint" />
        <Field label="Name" value={joint.name} />
        <Field label="Angle" value={`${joint.value.toFixed(2)}°`} tone="text-signal" />
        <Field label="Target" value={`${joint.target.toFixed(2)}°`} />
        <Field label="Load" value={`${joint.load.toFixed(0)}%`} tone={joint.load > 75 ? "text-warn" : ""} />
        <Field label="Controller" value="impedance · 400 Hz" />
      </>
    );
  }

  if (sel.id.startsWith("m-")) {
    return (
      <>
        <Section title="Mission" />
        <Field label="File" value={sel.path[1] ?? "—"} />
        <Field label="State" value={tele.mission.state} tone="text-signal" />
        <Field label="Progress" value={`${tele.mission.step}/${tele.mission.total} steps`} />
        <Field label="Waypoints" value="6 · sector_b" />
        <Field label="Est. runtime" value="14 min" />
        <Field label="Owner" value="task-planner" />
      </>
    );
  }

  if (sel.id.startsWith("n-")) {
    return (
      <>
        <Section title="ROS 2 Node" />
        <Field label="Node" value={sel.path[1] ?? "—"} />
        <Field label="QoS" value="reliable · volatile" />
        <Field label="Publishers" value="7" />
        <Field label="Subscribers" value="12" />
        <Field label="Rate" value={`${tele.loopHz} Hz`} />
        <Field label="Domain" value="ROS_DOMAIN_ID 14" />
      </>
    );
  }

  if (sel.id.startsWith("s-")) {
    return (
      <>
        <Section title="MCP Server" />
        <Field label="Server" value={sel.path[1] ?? "—"} />
        <Field label="Transport" value="stdio · jsonrpc" />
        <Field label="Tools" value="9 exposed" />
        <Field label="Health" value={`${tele.mcp.up}/${tele.mcp.total} connected`} tone={tele.mcp.up < tele.mcp.total ? "text-warn" : "text-ok"} />
      </>
    );
  }

  if (sel.id.startsWith("l-")) {
    return (
      <>
        <Section title="Recording" />
        <Field label="File" value={sel.path[1] ?? "—"} />
        <Field label="Format" value="mcap · zstd" />
        <Field label="Topics" value="42" />
        <Field label="Duration" value="00:18:42" />
      </>
    );
  }

  return (
    <>
      <Section title="State" />
      <Field label="Mode" value="AUTONOMOUS" tone="text-signal" />
      <Field label="Gait" value="careful_trot" />
      <Field label="Velocity" value={`${tele.velocity.toFixed(2)} m/s`} />
      <Field label="Battery" value={`${tele.battery.toFixed(0)}% · ${tele.minutes} min`} />
      <Field label="Bus voltage" value={`${tele.bus.toFixed(1)} V`} />
      <Field label="Temp (core)" value={`${tele.tempCore.toFixed(1)} °C`} tone={tele.tempCore > 55 ? "text-warn" : ""} />
      <Section title="Safety Envelope" />
      <Field label="Slope limit" value="18.0°" />
      <Field label="Current pitch" value={`${tele.pitch.toFixed(1)}°`} tone={tele.pitch > 18 ? "text-warn" : "text-ok"} />
      <Field label="E-stop" value="ARMED" tone="text-ok" />
      <Field label="Geofence" value="sector_b" />
      <Section title="Compute" />
      <Field label="CPU" value={`${tele.cpu}%`} />
      <Field label="GPU" value={`${tele.gpu}%`} />
      <Field label="Inference" value={`${tele.inferenceMs.toFixed(1)} ms`} />
      <Field label="Control loop" value={`${tele.loopHz} Hz`} />
    </>
  );
}

export function Inspector({ sel, tele }: { sel: Selection; tele: Telemetry }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <PanelHeader
        title="Inspector"
        right={
          <>
            <Chip active>Props</Chip>
            <Chip>Wiring</Chip>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="hairline-b px-3 py-2">
          <div className="font-mono text-[11px] text-signal">{sel.path[1] ?? sel.id}</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {sel.path[0]} · {sel.kind}
          </div>
        </div>
        <ContextBody sel={sel} tele={tele} />
      </div>

      <div className="hairline-t flex h-[38%] shrink-0 flex-col bg-rail">
        <div className="hairline-b flex h-8 items-center gap-2 px-3">
          <Dot tone="signal" live />
          <span className="font-mono text-[10px] tracking-[0.18em] text-foreground/80 uppercase">
            AI Operations
          </span>
          <span
            className={cn(
              "ml-auto font-mono text-[10px]",
              tele.agents.some((a) => a.state !== "running" && a.state !== "idle")
                ? "text-warn"
                : "text-muted-foreground",
            )}
          >
            {tele.agents.filter((a) => a.state === "running").length} active
          </span>
        </div>
        <EventTimeline events={tele.events.slice(0, 14)} />
      </div>
    </div>
  );
}
