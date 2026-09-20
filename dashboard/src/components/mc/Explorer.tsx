import { useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { EXPLORER } from "./data";
import { Dot, PanelHeader } from "./chrome";

export function Explorer({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string, path: string[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    robot: true,
    missions: true,
    agents: true,
  });
  const [q, setQ] = useState("");

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <PanelHeader title="Explorer" />
      <div className="hairline-b flex items-center gap-2 px-3 py-1.5">
        <Search className="size-3 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter workspace"
          className="w-full bg-transparent font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {EXPLORER.map((group) => {
          const kids = (group.children ?? []).filter((c) =>
            c.label.toLowerCase().includes(q.toLowerCase()),
          );
          if (q && kids.length === 0) return null;
          const isOpen = open[group.id] ?? Boolean(q);
          return (
            <div key={group.id}>
              <button
                onClick={() => setOpen((s) => ({ ...s, [group.id]: !isOpen }))}
                className="flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-accent/50"
              >
                {isOpen ? (
                  <ChevronDown className="size-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3 text-muted-foreground" />
                )}
                <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
                  {group.label}
                </span>
                <span className="ml-auto pr-1 font-mono text-[10px] text-muted-foreground/50">
                  {group.children?.length}
                </span>
              </button>
              {isOpen &&
                kids.map((child) => {
                  const active = selected === child.id;
                  return (
                    <button
                      key={child.id}
                      onClick={() => onSelect(child.id, [group.label, child.label])}
                      className={cn(
                        "group relative flex w-full items-center gap-2 py-[3px] pr-2 pl-7 text-left",
                        active ? "bg-signal/10" : "hover:bg-accent/40",
                      )}
                    >
                      {active && (
                        <span className="absolute top-0 bottom-0 left-0 w-[2px] bg-signal" />
                      )}
                      <Dot tone={child.tone ?? "muted"} live={child.tone === "signal"} />
                      <span
                        className={cn(
                          "truncate font-mono text-[11px]",
                          active ? "text-signal" : "text-foreground/85",
                        )}
                      >
                        {child.label}
                      </span>
                      {child.meta && (
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
                          {child.meta}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
