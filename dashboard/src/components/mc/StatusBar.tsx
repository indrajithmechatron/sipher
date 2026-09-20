import { Dot } from "./chrome";
import { cn } from "@/lib/utils";

export function StatusBar({ preset }: { preset: string }) {
  const items = [
    { label: "AUTONOMOUS", tone: "signal" as const },
    { label: "spot-alpha", tone: "ok" as const },
    { label: "ROS 2 humble · DDS cyclone" },
    { label: "MCP 3/4" },
    { label: "loop 400 Hz" },
    { label: "lat 6 ms" },
  ];
  return (
    <footer className="hairline-t flex h-6 shrink-0 items-center gap-3 bg-rail px-3 font-mono text-[10px] text-muted-foreground select-none">
      <span className="flex items-center gap-1.5 rounded-sm bg-signal/10 px-1.5 py-[1px] text-signal">
        <Dot tone="signal" live /> {preset}
      </span>
      {items.map((i) => (
        <span key={i.label} className={cn("flex items-center gap-1.5", i.tone && "text-foreground/80")}>
          {i.tone && <Dot tone={i.tone} />}
          {i.label}
        </span>
      ))}
      <span className="ml-auto flex items-center gap-3">
        <span className="text-warn">1 escalation</span>
        <span>battery 78%</span>
        <span>12:04:41 UTC</span>
        <span className="text-foreground/70">⌘K commands</span>
      </span>
    </footer>
  );
}
