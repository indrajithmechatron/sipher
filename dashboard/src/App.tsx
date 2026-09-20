import { useMemo, useState } from "react";
import { X, SplitSquareHorizontal, PanelBottom, Command as CommandIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MenuBar } from "@/components/mc/MenuBar";
import { Explorer } from "@/components/mc/Explorer";
import { Inspector, type Selection } from "@/components/mc/Inspector";
import { HealthStrip } from "@/components/mc/HealthStrip";
import { TerminalDock, TerminalBody } from "@/components/mc/TerminalDock";
import { FloatingWindow, type WinRect } from "@/components/mc/FloatingWindow";
import { DigitalTwin } from "@/components/mc/DigitalTwin";
import { AiOperations } from "@/components/mc/AgentOps";
import { CommandPalette, type Command } from "@/components/mc/CommandPalette";
import { ProjectManager, PROJECTS, type Project } from "@/components/mc/ProjectManager";
import { CustomerDashboard } from "@/components/mc/CustomerDashboard";
import { CameraMap, MemoryViewer, MissionEditor, RosGraph } from "@/components/mc/Panels";
import { PRESETS, TABS, TERMINALS, type PresetId } from "@/components/mc/data";
import { useSipherTelemetry } from "@/components/mc/sipher";

type Win = { id: string; title: string; rect: WinRect; z: number; display: number };
type AppMode = "chooser" | "customer" | "developer";

export default function App() {
  const tele = useSipherTelemetry();
  const [project, setProject] = useState<Project | null>(null);
  const [showPM, setShowPM] = useState(true);
  const [appMode, setAppMode] = useState<AppMode>("chooser");
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [preset, setPreset] = useState<PresetId>("robot-control");
  const presetDef = PRESETS.find((p) => p.id === preset)!;
  const [layouts, setLayouts] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(PRESETS.map((p) => [p.id, p.tabs])),
  );
  const tabs = layouts[preset] ?? presetDef.tabs;
  const [active, setActive] = useState<string>(presetDef.tabs[0]!);
  const [sel, setSel] = useState<Selection>({
    kind: "node",
    id: "r-gait",
    path: ["Robot", "Gait Controller"],
  });
  const [wins, setWins] = useState<Win[]>([]);
  const [termCollapsed, setTermCollapsed] = useState(false);

  const applyPreset = (id: PresetId) => {
    const def = PRESETS.find((p) => p.id === id)!;
    setPreset(id);
    setActive((layouts[id] ?? def.tabs)[0]!);
  };

  const setTabs = (next: string[]) => setLayouts((l) => ({ ...l, [preset]: next }));

  const openTab = (id: string) => {
    if (!tabs.includes(id)) setTabs([...tabs, id]);
    setActive(id);
  };

  const detach = (id: string) => {
    const t = TERMINALS.find((x) => x.id === id);
    setWins((w) => [
      ...w.filter((x) => x.id !== id),
      {
        id,
        title: t?.title ?? id,
        rect: { x: 380 + w.length * 32, y: 220 + w.length * 28, w: 460, h: 260 },
        z: 40 + w.length,
        display: 1,
      },
    ]);
  };

  const commands: Command[] = useMemo(
    () => [
      ...PRESETS.map((p) => ({
        id: `preset-${p.id}`,
        group: "Workspaces",
        label: `Switch workspace: ${p.label}`,
        run: () => applyPreset(p.id),
      })),
      ...Object.entries(TABS).map(([id, t]) => ({
        id: `panel-${id}`,
        group: "Panels",
        label: `Open panel: ${t.title}`,
        run: () => openTab(id),
      })),
      ...TERMINALS.map((t) => ({
        id: `term-${t.id}`,
        group: "Terminals",
        label: `Detach terminal: ${t.title}`,
        run: () => detach(t.id),
      })),
      {
        id: "term-toggle",
        group: "View",
        label: termCollapsed ? "Show terminal dock" : "Hide terminal dock",
        shortcut: "⌘J",
        run: () => setTermCollapsed((c) => !c),
      },
      {
        id: "pm",
        group: "Project",
        label: "Open Project Manager…",
        shortcut: "⌘⇧O",
        run: () => setShowPM(true),
      },
      ...PROJECTS.map((p) => ({
        id: `open-${p.id}`,
        group: "Project",
        label: `Open recent: ${p.name}`,
        run: () => setProject(p),
      })),
      { id: "estop", group: "Robot", label: "Trigger E-STOP", shortcut: "⌘.", run: () => {} },
    ],
    [preset, tabs, termCollapsed, layouts],
  );

  const renderPanel = (id: string) => {
    switch (id) {
      case "digital-twin":
        return <DigitalTwin tele={tele} />;
      case "ai-monitor":
        return (
          <AiOperations
            tele={tele}
            selectedAgent={sel.kind === "agent" ? sel.id : ""}
            onSelectAgent={(a) => setSel({ kind: "agent", id: a.id, path: ["AI Agents", a.name] })}
          />
        );
      case "mission-editor":
        return <MissionEditor />;
      case "camera-map":
        return <CameraMap />;
      case "ros-graph":
        return <RosGraph />;
      case "memory-viewer":
        return <MemoryViewer />;
      default:
        return <DigitalTwin tele={tele} />;
    }
  };

  if (appMode === "customer") {
    return (
      <CustomerDashboard
        tele={tele}
        onDeveloperControl={() => {
          setAppMode("developer");
          setProject(PROJECTS[0]!);
        }}
        onWorkspaceSelect={() => {
          setAppMode("chooser");
          setShowPM(true);
        }}
      />
    );
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <MenuBar
        crumbs={[project?.robot ?? "sipher", presetDef.label, ...sel.path]}
      />

      <div className="relative flex min-h-0 flex-1">
        <nav className="hairline-r flex w-12 shrink-0 flex-col items-center gap-1 bg-rail py-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              title={`${p.label} workspace`}
              className={cn(
                "relative grid size-9 place-items-center rounded-sm font-mono text-[10px] tracking-wider transition-colors",
                preset === p.id
                  ? "bg-signal/10 text-signal"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {preset === p.id && (
                <span className="absolute top-1 bottom-1 left-0 w-[2px] rounded-full bg-signal" />
              )}
              {p.short}
            </button>
          ))}
          <button
            onClick={() => setPaletteOpen(true)}
            title="Command palette (⌘K)"
            className="mt-auto grid size-9 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <CommandIcon className="size-4" />
          </button>
        </nav>

        <aside className="hairline-r w-64 shrink-0">
          <Explorer
            selected={sel.id}
            onSelect={(id, path) =>
              setSel({ kind: id.startsWith("a-") ? "agent" : "node", id, path })
            }
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="hairline-b flex h-9 shrink-0 items-center bg-chrome">
            {tabs.map((t) => (
              <div
                key={t}
                onClick={() => setActive(t)}
                className={cn(
                  "group relative flex h-full cursor-pointer items-center gap-2 border-r border-hairline px-3 text-[12px]",
                  active === t
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active === t && <span className="absolute top-0 right-0 left-0 h-[2px] bg-signal" />}
                {TABS[t]?.title}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = tabs.filter((x) => x !== t);
                    setTabs(next);
                    if (active === t && next[0]) setActive(next[0]);
                  }}
                  className="opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-1 pr-2 text-muted-foreground">
              <button
                onClick={() => setPaletteOpen(true)}
                className="rounded-sm border border-hairline px-2 py-[3px] font-mono text-[10px] hover:text-foreground"
              >
                ⌘K
              </button>
              <button className="grid size-6 place-items-center rounded-sm hover:bg-accent hover:text-foreground">
                <SplitSquareHorizontal className="size-3.5" />
              </button>
              <button
                onClick={() => setTermCollapsed((c) => !c)}
                className="grid size-6 place-items-center rounded-sm hover:bg-accent hover:text-foreground"
              >
                <PanelBottom className="size-3.5" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">{renderPanel(active)}</div>

          <div
            className={cn("hairline-t shrink-0", termCollapsed ? "h-8" : "h-[240px]")}
          >
            <TerminalDock
              tele={tele}
              collapsed={termCollapsed}
              onToggle={() => setTermCollapsed((c) => !c)}
              onDetach={detach}
            />
          </div>
        </main>

        <aside className="hairline-l w-72 shrink-0">
          <Inspector sel={sel} tele={tele} />
        </aside>

        {wins.map((w) => (
          <FloatingWindow
            key={w.id}
            title={w.title}
            subtitle={`display ${w.display}`}
            rect={w.rect}
            z={w.z}
            display={w.display}
            onChange={(r) => setWins((s) => s.map((x) => (x.id === w.id ? { ...x, rect: r } : x)))}
            onFocus={() =>
              setWins((s) => {
                const top = Math.max(...s.map((x) => x.z)) + 1;
                return s.map((x) => (x.id === w.id ? { ...x, z: top } : x));
              })
            }
            onCycleDisplay={() =>
              setWins((s) =>
                s.map((x) => (x.id === w.id ? { ...x, display: (x.display % 3) + 1 } : x)),
              )
            }
            onClose={() => setWins((s) => s.filter((x) => x.id !== w.id))}
          >
            <TerminalBody id={w.id} tele={tele} />
          </FloatingWindow>
        ))}
      </div>

      <HealthStrip tele={tele} preset={presetDef.label} onCommand={() => setPaletteOpen(true)} />

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
      <ProjectManager
        open={showPM}
        startup={appMode === "chooser"}
        onOpen={(p) => {
          setProject(p);
          setAppMode("developer");
          setShowPM(false);
        }}
        onCustomerView={() => {
          setAppMode("customer");
          setShowPM(false);
        }}
        onClose={() => setShowPM(false)}
      />
    </div>
  );
}
