import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { ChevronRight, Minus, Square, X } from "lucide-react";
import { Dot } from "./chrome";

const MENUS: Record<string, string[][]> = {
  File: [
    ["New Mission…", "Open Workspace…", "Open Recording…"],
    ["Save Layout", "Export Telemetry…"],
    ["Exit"],
  ],
  Edit: [["Undo", "Redo"], ["Find in Graph…", "Command Palette…"]],
  View: [
    ["Toggle Explorer", "Toggle Inspectors", "Toggle Terminals"],
    ["Zen Mode", "Full Screen"],
  ],
  Robot: [
    ["Arm", "Disarm", "Emergency Stop"],
    ["Calibrate IMU", "Zero Joints", "Return to Dock"],
  ],
  AI: [
    ["Start Orchestrator", "Pause Agents", "Clear Episodic Memory"],
    ["Escalation Policy…", "Model Routing…"],
  ],
  ROS2: [["Discover Nodes", "Record Bag…", "Play Bag…"], ["QoS Profiles…", "TF Tree"]],
  MCP: [["Connect Server…", "Reload Manifests"], ["Tool Permissions…"]],
  Tools: [["Gait Tuner", "URDF Inspector", "Latency Profiler"], ["Extensions…"]],
  Window: [["Split Right", "Detach Panel", "Move Terminal to Display 2"], ["Reset Workspace"]],
  Help: [["Documentation", "Keyboard Map", "About Mission Control"]],
};

export function MenuBar({ crumbs }: { crumbs: string[] }) {
  return (
    <header className="shrink-0 select-none">
      <div className="hairline-b flex h-9 items-center bg-rail pr-2 pl-3">
        <div className="mr-4 flex items-center gap-2">
          <span className="grid size-4 place-items-center rounded-[3px] border border-signal/50 bg-signal/10">
            <span className="block size-1.5 rounded-[1px] bg-signal" />
          </span>
          <span className="font-mono text-[11px] tracking-[0.2em] text-foreground/80 uppercase">
            Quadruped<span className="text-signal">·</span>MC
          </span>
        </div>

        <Menubar className="h-auto gap-0 border-none bg-transparent p-0">
          {Object.entries(MENUS).map(([name, groups]) => (
            <MenubarMenu key={name}>
              <MenubarTrigger className="rounded-sm px-2 py-1 text-[12px] font-normal text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground focus:bg-accent focus:text-foreground">
                {name}
              </MenubarTrigger>
              <MenubarContent className="min-w-56 rounded-sm border-hairline bg-popover p-1">
                {groups.map((group, gi) => (
                  <div key={gi}>
                    {gi > 0 && <MenubarSeparator className="bg-hairline" />}
                    {group.map((item) => (
                      <MenubarItem
                        key={item}
                        className="rounded-[3px] text-[12px] focus:bg-accent focus:text-accent-foreground"
                      >
                        {item}
                        {item.includes("…") && (
                          <MenubarShortcut className="font-mono text-[10px]">⌘</MenubarShortcut>
                        )}
                      </MenubarItem>
                    ))}
                  </div>
                ))}
              </MenubarContent>
            </MenubarMenu>
          ))}
        </Menubar>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <Dot tone="ok" live />
            LINK 6 ms
            <span className="text-hairline">|</span>
            <Dot tone="signal" live />
            AGENTS 4
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            {[Minus, Square, X].map((Icon, i) => (
              <button
                key={i}
                className="grid size-6 place-items-center rounded-sm hover:bg-accent hover:text-foreground"
              >
                <Icon className="size-3" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="hairline-b flex h-7 items-center gap-1 bg-chrome px-3 font-mono text-[11px]">
        {crumbs.map((c, i) => (
          <span key={c} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3 text-muted-foreground/50" />}
            <button
              className={
                i === crumbs.length - 1
                  ? "text-signal"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              {c}
            </button>
          </span>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground/60">
          spot-alpha · fw 4.19.2 · ros humble
        </span>
      </div>
    </header>
  );
}
