import { ArrowRight, BatteryMedium, Bot, CheckCircle2, Clock3, Gauge, MapPin, Thermometer, Wrench, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Telemetry } from "./sipher";

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  tone = "signal",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: "ok" | "warn" | "signal";
}) {
  return (
    <div className="border border-hairline bg-panel px-4 py-3">
      <div className="flex items-center gap-2 text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
        <Icon className={cn("size-3.5", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-signal")} />
        {label}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="tabular text-2xl font-medium text-foreground">{value}</span>
        <span className={cn("font-mono text-[10px]", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-muted-foreground")}>{detail}</span>
      </div>
    </div>
  );
}

export function CustomerDashboard({
  tele,
  onDeveloperControl,
  onWorkspaceSelect,
}: {
  tele: Telemetry;
  onDeveloperControl: () => void;
  onWorkspaceSelect: () => void;
}) {
  const missionProgress = (tele.mission.step / tele.mission.total) * 100;
  const missionComplete = tele.mission.step >= tele.mission.total;

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background">
      <header className="hairline-b flex h-16 shrink-0 items-center justify-between bg-rail px-6">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center border border-signal/40 bg-signal/10 text-signal">
            <Bot className="size-4" />
          </span>
          <div>
            <div className="text-sm font-medium tracking-[0.12em] text-foreground uppercase">            Sipher Mission Control</div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">Customer operations · spot-alpha</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 font-mono text-[10px] text-ok sm:flex">
            <span className="live-dot size-1.5 rounded-full bg-ok" /> All systems operational
          </span>
          <Button variant="outline" size="sm" onClick={onDeveloperControl} className="border-hairline bg-transparent font-mono text-[10px] text-muted-foreground">
            <Wrench /> Developer control
          </Button>
          <Button variant="ghost" size="sm" onClick={onWorkspaceSelect} className="font-mono text-[10px] text-muted-foreground">
            Switch view
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-7 lg:px-10">
          <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="font-mono text-[10px] tracking-[0.2em] text-signal uppercase">Operations overview</div>
              <h1 className="mt-2 text-3xl font-medium tracking-tight text-foreground">Good afternoon, your fleet is ready.</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Monitor active missions, robot health, and the latest field activity from one place.</p>
            </div>
            <div className="flex items-center gap-2 border border-hairline bg-panel px-3 py-2 font-mono text-[10px] text-muted-foreground">
              <MapPin className="size-3.5 text-signal" /> Warehouse perimeter · Live
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Gauge} label="Mission progress" value={`${Math.round(missionProgress)}%`} detail={`${tele.mission.step}/${tele.mission.total} steps`} />
            <Metric icon={BatteryMedium} label="Battery" value={`${tele.battery.toFixed(0)}%`} detail={`${tele.minutes} min remaining`} tone={tele.battery < 25 ? "warn" : "ok"} />
            <Metric icon={Thermometer} label="Robot temperature" value={`${tele.tempCore.toFixed(1)}°C`} detail="Within limits" tone={tele.tempCore > 65 ? "warn" : "ok"} />
            <Metric icon={Bot} label="Fleet status" value="1 / 3" detail="On mission" tone="ok" />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
            <div className="border border-hairline bg-panel">
              <div className="hairline-b flex items-center justify-between px-5 py-4">
                <div>
                  <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">Active mission</div>
                  <div className="mt-1 text-lg text-foreground">{tele.mission.name.replaceAll("_", " ")}</div>
                </div>
                <span className="flex items-center gap-2 font-mono text-[10px] text-ok"><span className="live-dot size-1.5 rounded-full bg-ok" /> {tele.mission.state}</span>
              </div>
              <div className="space-y-5 p-5">
                <div className="flex items-start gap-4">
                  <div className="grid size-10 shrink-0 place-items-center border border-signal/30 bg-signal/10 text-signal"><MapPin className="size-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3"><span className="text-sm text-foreground">Warehouse perimeter inspection</span><span className="font-mono text-[10px] text-muted-foreground">ETA 18 min</span></div>
                    <div className="mt-3 h-1.5 overflow-hidden bg-rail"><div className="h-full bg-signal transition-all" style={{ width: `${missionProgress}%` }} /></div>
                    <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground"><span>Gate A</span><span>Loading dock</span><span>Return to base</span></div>
                  </div>
                </div>
                <div className="grid gap-2 border-t border-hairline/60 pt-4 sm:grid-cols-3">
                  {["Perimeter sweep", "Thermal capture", "Dock return"].map((step, index) => {
                    const complete = index < tele.mission.step - 1;
                    const current = index === tele.mission.step - 1;
                    return <div key={step} className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className={cn("size-3.5", complete || (current && missionComplete) ? "text-ok" : current ? "text-signal" : "text-muted-foreground/40")} /> {step}</div>;
                  })}
                </div>
              </div>
            </div>

            <div className="border border-hairline bg-panel">
              <div className="hairline-b flex items-center justify-between px-5 py-4"><div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">Fleet overview</div><span className="font-mono text-[10px] text-muted-foreground">3 robots</span></div>
              <div className="divide-y divide-hairline/60">
                {[{ name: "spot-alpha", place: "Warehouse perimeter", status: "On mission", tone: "signal" }, { name: "spot-bravo", place: "Charging bay 02", status: "Charging", tone: "ok" }, { name: "sim-quad", place: "Simulation lab", status: "Available", tone: "muted" }].map((robot) => (
                  <div key={robot.name} className="flex items-center gap-3 px-5 py-4"><span className={cn("size-2 rounded-full", robot.tone === "signal" ? "bg-signal live-dot" : robot.tone === "ok" ? "bg-ok" : "bg-muted-foreground")} /><div className="min-w-0 flex-1"><div className="font-mono text-xs text-foreground">{robot.name}</div><div className="truncate text-[11px] text-muted-foreground">{robot.place}</div></div><span className={cn("font-mono text-[10px]", robot.tone === "signal" ? "text-signal" : robot.tone === "ok" ? "text-ok" : "text-muted-foreground")}>{robot.status}</span></div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="border border-hairline bg-panel">
              <div className="hairline-b flex items-center justify-between px-5 py-4"><div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">Recent activity</div><Button variant="ghost" size="sm" className="h-6 px-2 font-mono text-[10px] text-muted-foreground">View all <ArrowRight /></Button></div>
              <div className="divide-y divide-hairline/60">{tele.events.slice(0, 4).map((event) => <div key={event.id} className="flex items-center gap-3 px-5 py-3"><span className={cn("size-1.5 rounded-full", event.status === "failed" ? "bg-danger" : event.status === "escalated" ? "bg-warn" : "bg-ok")} /><div className="min-w-0 flex-1"><div className="truncate text-xs text-foreground">{event.detail}</div><div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{event.agent} · {event.action}</div></div><span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground"><Clock3 className="size-3" /> {event.t}</span></div>)}</div>
            </div>
            <div className="border border-hairline bg-panel p-5"><div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">Connection health</div><div className="mt-5 space-y-4">{[["Robot connection", `${tele.linkMs} ms latency`, tele.ros === "connected"], ["Mission control", `${tele.loopHz} Hz control loop`, tele.loopHz > 380], ["Safety systems", `${tele.contacts}/4 foot contacts`, tele.contacts >= 3]].map(([label, detail, good]) => <div key={String(label)} className="flex items-center gap-3"><CheckCircle2 className={cn("size-4", good ? "text-ok" : "text-warn")} /><div><div className="text-xs text-foreground">{label}</div><div className="font-mono text-[10px] text-muted-foreground">{detail}</div></div></div>)}</div></div>
          </section>
        </div>
      </main>
      <footer className="hairline-t flex h-8 shrink-0 items-center justify-between bg-rail px-5 font-mono text-[10px] text-muted-foreground"><span>Last updated {tele.clock} UTC</span><span className="text-muted-foreground/70">Customer view · Live telemetry</span></footer>
    </div>
  );
}