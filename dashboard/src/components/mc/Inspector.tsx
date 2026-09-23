import { AlertTriangle } from "lucide-react";
import { Chip, Dot, Field, PanelHeader } from "./chrome";
import { cn } from "@/lib/utils";
import type { Telemetry } from "./sipher";
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
      <Field
        label="Pi"
        value={tele.piOnline ? "LIVE" : "OFFLINE"}
        tone={tele.piOnline ? "text-ok" : "text-danger"}
      />
      <Field
        label="Pico"
        value={tele.picoOnline ? "LIVE" : "OFFLINE"}
        tone={tele.picoOnline ? "text-ok" : "text-danger"}
      />
      <Field
        label="Pico age"
        value={tele.picoAgeMs != null ? `${tele.picoAgeMs} ms` : "—"}
        tone={tele.picoAgeMs != null && tele.picoAgeMs < 2000 ? "text-ok" : "text-warn"}
      />
      <Field label="Mode" value={tele.picoOnline ? "AUTONOMOUS" : "STANDBY"} tone="text-signal" />
      <Field label="Gait" value="idle" />
      <Field label="Velocity" value={`${tele.velocity.toFixed(2)} m/s`} />
      <Field
        label="Battery"
        value={tele.bus > 0 ? `${tele.bus.toFixed(2)} V` : "—"}
        tone={tele.bus > 0 && tele.bus < 10 ? "text-warn" : "text-ok"}
      />
      <Field label="Bus voltage" value={tele.bus > 0 ? `${tele.bus.toFixed(2)} V` : "—"} />
      <Field
        label="Temp (core)"
        value={tele.tempCore > 0 ? `${tele.tempCore.toFixed(1)} C` : "—"}
        tone={tele.tempCore > 60 ? "text-warn" : ""}
      />
      <Field
        label="ToF height"
        value={
          tele.contacts >= 4
            ? "< 500 mm"
            : tele.contacts >= 3
              ? "500-1000 mm"
              : tele.contacts > 0
                ? "> 1000 mm"
                : "—"
        }
      />
      <Section title="Live sensors" />
      <Field
        label="MPU6050"
        value={tele.raw?.mpu?.length ? `ok · ${tele.raw.mpu.length} axes` : "—"}
        tone={tele.raw?.mpu?.length ? "text-ok" : "text-warn"}
      />
      <Field
        label="INA219"
        value={
          tele.raw?.ina
            ? `${tele.raw.ina.voltage_v ?? "—"} V · ${tele.raw.ina.current_ma ?? "—"} mA`
            : "null"
        }
        tone={tele.raw?.ina ? "text-ok" : "text-warn"}
      />
      <Field
        label="VL53L0X"
        value={tele.raw?.vl53_mm != null ? `${tele.raw.vl53_mm} mm` : "null"}
        tone={tele.raw?.vl53_mm != null ? "text-ok" : "text-warn"}
      />
      <Field
        label="GPS"
        value={
          tele.raw?.gps
            ? tele.raw.gps.fix
              ? `fix · ${tele.raw.gps.satellites ?? "—"} sat`
              : "no fix"
            : "—"
        }
        tone={tele.raw?.gps?.fix ? "text-ok" : "text-warn"}
      />
      <Field
        label="I2C0"
        value={(tele.raw?.i2c0 ?? []).join(" ") || "empty"}
        tone={(tele.raw?.i2c0 ?? []).length ? "text-ok" : "text-warn"}
      />
      <Field
        label="I2C1"
        value={(tele.raw?.i2c1 ?? []).join(" ") || "empty"}
        tone={(tele.raw?.i2c1 ?? []).length ? "text-ok" : "text-warn"}
      />
      <Section title="Safety Envelope" />
      <Field label="Slope limit" value="18.0 deg" />
      <Field label="Current pitch" value={`${tele.pitch.toFixed(1)} deg`} tone={tele.pitch > 18 ? "text-warn" : "text-ok"} />
      <Field label="E-stop" value="ARMED" tone="text-ok" />
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
