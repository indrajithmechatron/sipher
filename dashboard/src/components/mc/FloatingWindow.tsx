import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minus, Monitor, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dot } from "./chrome";

export type WinRect = { x: number; y: number; w: number; h: number };

export function FloatingWindow({
  title,
  subtitle,
  rect,
  onChange,
  onClose,
  onFocus,
  z,
  display,
  onCycleDisplay,
  children,
}: {
  title: string;
  subtitle?: string;
  rect: WinRect;
  onChange: (r: WinRect) => void;
  onClose: () => void;
  onFocus: () => void;
  z: number;
  display: number;
  onCycleDisplay: () => void;
  children: ReactNode;
}) {
  const [min, setMin] = useState(false);
  const [max, setMax] = useState(false);
  const drag = useRef<{ mode: "move" | "resize"; x: number; y: number; r: WinRect } | null>(null);

  const start = useCallback(
    (mode: "move" | "resize") => (e: React.PointerEvent) => {
      e.preventDefault();
      onFocus();
      drag.current = { mode, x: e.clientX, y: e.clientY, r: rect };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [rect, onFocus],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (d.mode === "move") {
        onChange({
          ...d.r,
          x: Math.max(0, Math.min(window.innerWidth - 160, d.r.x + dx)),
          y: Math.max(36, Math.min(window.innerHeight - 60, d.r.y + dy)),
        });
      } else {
        onChange({
          ...d.r,
          w: Math.max(280, d.r.w + dx),
          h: Math.max(140, d.r.h + dy),
        });
      }
    };
    const up = () => (drag.current = null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [onChange]);

  const style = max
    ? { left: 60, top: 40, width: window.innerWidth - 120, height: window.innerHeight - 120 }
    : { left: rect.x, top: rect.y, width: rect.w, height: min ? 32 : rect.h };

  return (
    <div
      onPointerDown={onFocus}
      style={{ ...style, zIndex: z }}
      className="fixed overflow-hidden rounded-md border border-hairline bg-chrome shadow-[0_28px_70px_-14px_oklch(0_0_0/80%)]"
    >
      <div
        onPointerDown={start("move")}
        className="hairline-b flex h-8 cursor-grab items-center gap-2 bg-panel px-2 select-none active:cursor-grabbing"
      >
        <Dot tone="signal" live />
        <span className="truncate font-mono text-[11px] text-foreground/85">{title}</span>
        {subtitle && (
          <span className="truncate font-mono text-[10px] text-muted-foreground">{subtitle}</span>
        )}
        <div className="ml-auto flex items-center gap-0.5 text-muted-foreground">
          <button
            onClick={onCycleDisplay}
            title="Move to another display"
            className="flex h-6 items-center gap-1 rounded-sm px-1.5 font-mono text-[10px] hover:bg-accent hover:text-foreground"
          >
            <Monitor className="size-3" /> display {display}
          </button>
          <button
            onClick={() => setMin((m) => !m)}
            className="grid size-6 place-items-center rounded-sm hover:bg-accent hover:text-foreground"
          >
            <Minus className="size-3" />
          </button>
          <button
            onClick={() => setMax((m) => !m)}
            className="grid size-6 place-items-center rounded-sm hover:bg-accent hover:text-foreground"
          >
            <Maximize2 className="size-3" />
          </button>
          <button
            onClick={onClose}
            className="grid size-6 place-items-center rounded-sm hover:bg-danger/20 hover:text-danger"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
      {!min && (
        <div className="min-h-0 flex-1 overflow-hidden" style={{ height: (max ? window.innerHeight - 120 : rect.h) - 32 }}>
          {children}
        </div>
      )}
      {!min && !max && (
        <div
          onPointerDown={start("resize")}
          className={cn(
            "absolute right-0 bottom-0 size-4 cursor-nwse-resize",
            "after:absolute after:right-1 after:bottom-1 after:size-2 after:border-r after:border-b after:border-muted-foreground/50",
          )}
        />
      )}
    </div>
  );
}
