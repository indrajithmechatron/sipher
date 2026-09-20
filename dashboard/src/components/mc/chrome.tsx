import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Dot({
  tone = "muted",
  live,
}: {
  tone?: "ok" | "warn" | "danger" | "signal" | "muted" | "violet";
  live?: boolean;
}) {
  const map = {
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    signal: "bg-signal",
    violet: "bg-violet",
    muted: "bg-muted-foreground",
  } as const;
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full", map[tone], live && "live-dot")}
    />
  );
}

export function PanelHeader({
  title,
  right,
  sub,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="hairline-b flex h-8 shrink-0 items-center gap-2 bg-chrome px-3">
      <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
        {title}
      </span>
      {sub && <span className="truncate font-mono text-[10px] text-muted-foreground/60">{sub}</span>}
      <div className="ml-auto flex items-center gap-1.5">{right}</div>
    </div>
  );
}

export function Chip({
  children,
  active,
  tone,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  tone?: "ok" | "warn" | "danger" | "signal";
  onClick?: () => void;
}) {
  const toneCls = tone
    ? {
        ok: "text-ok border-ok/30",
        warn: "text-warn border-warn/30",
        danger: "text-danger border-danger/30",
        signal: "text-signal border-signal/30",
      }[tone]
    : "text-muted-foreground border-hairline";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-sm border px-1.5 py-[1px] font-mono text-[10px] tracking-wide whitespace-nowrap transition-colors",
        active
          ? "border-signal/50 bg-signal/10 text-signal"
          : cn(toneCls, onClick && "hover:bg-accent"),
      )}
    >
      {children}
    </button>
  );
}

export function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-[5px] hover:bg-accent/40">
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("tabular font-mono text-[11px] text-foreground", tone)}>{value}</span>
    </div>
  );
}

export function Meter({ value, tone = "signal" }: { value: number; tone?: string }) {
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-rail">
      <div
        className={cn("h-full rounded-full", `bg-${tone}`)}
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}
