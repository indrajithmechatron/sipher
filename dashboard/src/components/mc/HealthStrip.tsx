import { AlertTriangle, BatteryMedium, Cpu, Gauge, Radio, Server, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dot } from "./chrome";
import type { Telemetry } from "./sipher";

function Metric({
  icon: Icon,
  label,
  value,
  tone = "muted",
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "ok" | "warn" | "danger" | "signal" | "muted";
}) {
  const text = {
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    signal: "text-signal",
    muted: "text-foreground/75",
  }[tone];
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {Icon ? <Icon className={cn("size-3", text)} /> : <Dot tone={tone} live={tone === "signal"} />}
      <span className="text-muted-foreground/70">{label}</span>
      <span className={cn("tabular", text)}>{value}</span>
    </span>
  );
}

export function HealthStrip({
  tele,
  preset,
  onCommand,
}: {
  tele: Telemetry;
  preset: string;
  onCommand: () => void;
}) {
  const warnings = tele.agents.filter((a) => a.state === "escalated" || a.state === "failed").length;
  const battTone = tele.battery < 20 ? "danger" : tele.battery < 40 ? "warn" : "ok";
  const tempTone = tele.tempCore > 65 ? "danger" : tele.tempCore > 55 ? "warn" : "ok";
  const loopTone = tele.loopHz < 380 ? "warn" : "ok";

  return (
    <footer className="hairline-t flex h-7 shrink-0 items-center gap-4 overflow-x-auto bg-rail px-3 font-mono text-[10px] text-muted-foreground select-none">
      <span className="flex items-center gap-1.5 rounded-sm bg-signal/10 px-1.5 py-[1px] text-signal">
        <Dot tone="signal" live /> {preset}
      </span>
      <Metric
        icon={Server}
        label="Pi"
        value={tele.piOnline ? "live" : "offline"}
        tone={tele.piOnline ? "ok" : "danger"}
      />
      <Metric
        icon={Radio}
        label="Pico"
        value={tele.picoOnline ? "live" : "offline"}
        tone={tele.picoOnline ? "ok" : tele.piOnline ? "warn" : "danger"}
      />
      <Metric
        label="Sensors"
        value={`${tele.mcp.up}/${tele.mcp.total}`}
        tone={tele.mcp.up < tele.mcp.total ? "warn" : "ok"}
      />
      <Metric
        label="link"
        value={tele.picoAgeMs != null ? `${tele.picoAgeMs} ms` : "—"}
        tone={tele.picoAgeMs != null && tele.picoAgeMs < 2000 ? "ok" : "warn"}
      />
      <Metric icon={Gauge} label="loop" value={`${tele.loopHz} Hz`} tone={loopTone} />
      <Metric icon={Cpu} label="infer" value={`${tele.inferenceMs.toFixed(1)} ms`} />
      <Metric
        icon={BatteryMedium}
        label="batt"
        value={`${tele.battery.toFixed(0)}% · ${tele.minutes}m`}
        tone={battTone}
      />
      <Metric label="core" value={`${tele.tempCore.toFixed(1)} C`} tone={tempTone} />
      <Metric label="motor" value={`${tele.tempMotor.toFixed(1)}°C`} tone={tele.tempMotor > 75 ? "warn" : "muted"} />
      <Metric
        label="mission"
        value={`${tele.mission.name} ${tele.mission.step}/${tele.mission.total} ${tele.mission.state}`}
        tone="signal"
      />
      <Metric label="pitch" value={`${tele.pitch.toFixed(1)}°`} tone={tele.pitch > 18 ? "warn" : "muted"} />

      <span className="ml-auto flex items-center gap-3">
        {warnings > 0 && (
          <span className="flex items-center gap-1 rounded-sm bg-warn/10 px-1.5 py-[1px] text-warn">
            <AlertTriangle className="size-3" /> {warnings} warning{warnings > 1 ? "s" : ""}
          </span>
        )}
        <span className="tabular">{tele.clock} UTC</span>
        <button onClick={onCommand} className="text-foreground/70 hover:text-signal">
          ⌘K commands
        </button>
      </span>
    </footer>
  );
}
