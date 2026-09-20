import { useState } from "react";
import { ArrowRight, Boxes, Clock, Code2, FolderOpen, Plus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dot } from "./chrome";

export type Project = {
  id: string;
  name: string;
  robot: string;
  template: string;
  opened: string;
  path: string;
};

export const PROJECTS: Project[] = [
  {
    id: "p1",
    name: "Warehouse Perimeter",
    robot: "spot-alpha",
    template: "Inspection",
    opened: "2 min ago",
    path: "~/robotics/warehouse-perimeter",
  },
  {
    id: "p2",
    name: "Substation Thermal",
    robot: "spot-bravo",
    template: "Thermal survey",
    opened: "yesterday",
    path: "~/robotics/substation-thermal",
  },
  {
    id: "p3",
    name: "Stair Locomotion R&D",
    robot: "sim-quad",
    template: "Locomotion research",
    opened: "3 days ago",
    path: "~/robotics/stair-rnd",
  },
];

const TEMPLATES = [
  { id: "t1", name: "Inspection Patrol", desc: "Waypoint sweeps, thermal capture, dock return" },
  { id: "t2", name: "Locomotion R&D", desc: "Gait tuner, sim bridge, joint telemetry logging" },
  { id: "t3", name: "Agentic Autonomy", desc: "Orchestrator, MCP tools, escalation policies" },
  { id: "t4", name: "Empty Workspace", desc: "Bare ROS 2 workspace with URDF stub" },
];

export function ProjectManager({
  open,
  startup = false,
  onOpen,
  onCustomerView,
  onClose,
}: {
  open: boolean;
  startup?: boolean;
  onOpen: (p: Project) => void;
  onCustomerView: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"recent" | "new">("recent");
  const [sel, setSel] = useState(PROJECTS[0]!.id);
  const [tpl, setTpl] = useState(TEMPLATES[0]!.id);
  const [name, setName] = useState("New Robot Project");

  if (!open) return null;

  if (startup) {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-background/90 px-4 backdrop-blur-sm">
        <div className="w-[900px] max-w-full overflow-hidden border border-hairline bg-chrome shadow-[0_40px_120px_-20px_oklch(0_0_0/90%)]">
          <div className="hairline-b flex items-center gap-3 bg-rail px-5 py-4">
            <span className="grid size-7 place-items-center border border-signal/50 bg-signal/10"><Boxes className="size-4 text-signal" /></span>
            <div>
              <div className="font-mono text-[12px] tracking-[0.16em] text-foreground/90 uppercase">Quadruped Mission Control</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">Choose your workspace · spot-alpha · connected</div>
            </div>
            <div className="ml-auto hidden items-center gap-2 font-mono text-[10px] text-ok sm:flex"><span className="live-dot size-1.5 rounded-full bg-ok" /> Systems online</div>
          </div>
          <div className="px-5 pt-7 pb-6 sm:px-8">
            <div className="max-w-xl">
              <div className="font-mono text-[10px] tracking-[0.2em] text-signal uppercase">Welcome back</div>
              <h1 className="mt-2 text-2xl font-medium text-foreground">How would you like to work today?</h1>
              <p className="mt-2 text-sm text-muted-foreground">Choose an experience designed for your role. You can switch views at any time.</p>
            </div>
            <div className="mt-7 grid gap-4 md:grid-cols-2">
              <button type="button" onClick={onCustomerView} className="group border border-hairline bg-panel p-5 text-left transition-colors hover:border-signal/50 hover:bg-signal/5">
                <div className="flex items-start justify-between"><span className="grid size-10 place-items-center border border-signal/30 bg-signal/10 text-signal"><Users className="size-5" /></span><ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-signal" /></div>
                <div className="mt-6 text-lg text-foreground">Customer dashboard</div>
                <p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">A clear operations overview for missions, fleet status, health, and recent activity.</p>
                <div className="mt-5 flex flex-wrap gap-2 font-mono text-[10px] text-muted-foreground"><span className="border border-hairline px-2 py-1">Missions</span><span className="border border-hairline px-2 py-1">Fleet health</span><span className="border border-hairline px-2 py-1">Live status</span></div>
              </button>
              <button type="button" onClick={() => onOpen(PROJECTS[0]!)} className="group border border-hairline bg-panel p-5 text-left transition-colors hover:border-signal/50 hover:bg-signal/5">
                <div className="flex items-start justify-between"><span className="grid size-10 place-items-center border border-signal/30 bg-signal/10 text-signal"><Code2 className="size-5" /></span><ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-signal" /></div>
                <div className="mt-6 text-lg text-foreground">Developer control</div>
                <p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">The full engineering workspace for robot control, ROS 2, AI agents, terminals, and debugging.</p>
                <div className="mt-5 flex flex-wrap gap-2 font-mono text-[10px] text-muted-foreground"><span className="border border-hairline px-2 py-1">Digital twin</span><span className="border border-hairline px-2 py-1">AI operations</span><span className="border border-hairline px-2 py-1">ROS 2</span></div>
              </button>
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-hairline/60 pt-4 font-mono text-[10px] text-muted-foreground"><span>Last workspace · Warehouse Perimeter</span><button type="button" onClick={onClose} className="hover:text-foreground">Close</button></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-background/80 backdrop-blur-sm">
      <div className="w-[860px] max-w-[94vw] overflow-hidden rounded-md border border-hairline bg-chrome shadow-[0_40px_120px_-20px_oklch(0_0_0/90%)]">
        <div className="hairline-b flex items-center gap-3 bg-rail px-4 py-3">
          <span className="grid size-5 place-items-center rounded-[3px] border border-signal/50 bg-signal/10">
            <Boxes className="size-3 text-signal" />
          </span>
          <div>
            <div className="font-mono text-[12px] tracking-[0.16em] text-foreground/90 uppercase">
              Sipher Mission Control
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              Project Manager · v4.19.2 · ROS 2 humble
            </div>
          </div>
          <div className="ml-auto flex gap-1">
            {(["recent", "new"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-sm px-2.5 py-1 font-mono text-[11px]",
                  tab === t
                    ? "bg-signal/10 text-signal"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {t === "recent" ? "Recent projects" : "New project"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid h-[380px] grid-cols-[1fr_300px]">
          <div className="min-h-0 overflow-y-auto">
            {tab === "recent"
              ? PROJECTS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSel(p.id)}
                    onDoubleClick={() => onOpen(p)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-hairline/60 px-4 py-3 text-left",
                      sel === p.id ? "bg-signal/5" : "hover:bg-accent/30",
                    )}
                  >
                    <FolderOpen className={cn("size-4", sel === p.id ? "text-signal" : "text-muted-foreground")} />
                    <div className="min-w-0">
                      <div className="font-mono text-[12px] text-foreground/90">{p.name}</div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {p.path}
                      </div>
                    </div>
                    <div className="ml-auto text-right font-mono text-[10px] text-muted-foreground">
                      <div className="flex items-center justify-end gap-1.5">
                        <Dot tone={p.robot === "sim-quad" ? "violet" : "ok"} /> {p.robot}
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <Clock className="size-3" /> {p.opened}
                      </div>
                    </div>
                  </button>
                ))
              : TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTpl(t.id)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-hairline/60 px-4 py-3 text-left",
                      tpl === t.id ? "bg-signal/5" : "hover:bg-accent/30",
                    )}
                  >
                    <Plus className={cn("size-4", tpl === t.id ? "text-signal" : "text-muted-foreground")} />
                    <div>
                      <div className="font-mono text-[12px] text-foreground/90">{t.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{t.desc}</div>
                    </div>
                  </button>
                ))}
          </div>

          <div className="hairline-l flex flex-col bg-panel p-4">
            {tab === "recent" ? (
              <>
                <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                  Project details
                </div>
                {(() => {
                  const p = PROJECTS.find((x) => x.id === sel)!;
                  return (
                    <div className="mt-3 space-y-1.5 font-mono text-[11px] text-muted-foreground">
                      <div className="text-foreground/90">{p.name}</div>
                      <div>robot · {p.robot}</div>
                      <div>template · {p.template}</div>
                      <div>ros · humble / cyclonedds</div>
                      <div>agents · orchestrator v3, 5 tools</div>
                      <div className="truncate">{p.path}</div>
                    </div>
                  );
                })()}
              </>
            ) : (
              <>
                <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                  Configure
                </div>
                <label className="mt-3 block font-mono text-[10px] text-muted-foreground">
                  Project name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full rounded-sm border border-hairline bg-background px-2 py-1.5 font-mono text-[11px] text-foreground focus:border-signal/50 focus:outline-none"
                  />
                </label>
                <div className="mt-3 space-y-1.5 font-mono text-[11px] text-muted-foreground">
                  <div>target · spot-alpha</div>
                  <div>template · {TEMPLATES.find((t) => t.id === tpl)?.name}</div>
                </div>
              </>
            )}

            <div className="mt-auto flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-sm border border-hairline px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  tab === "recent"
                    ? onOpen(PROJECTS.find((x) => x.id === sel)!)
                    : onOpen({
                        id: "new",
                        name,
                        robot: "spot-alpha",
                        template: TEMPLATES.find((t) => t.id === tpl)!.name,
                        opened: "now",
                        path: `~/robotics/${name.toLowerCase().replace(/\s+/g, "-")}`,
                      })
                }
                className="flex-1 rounded-sm border border-signal/50 bg-signal/10 px-3 py-1.5 font-mono text-[11px] text-signal hover:bg-signal/20"
              >
                {tab === "recent" ? "Open project" : "Create project"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
