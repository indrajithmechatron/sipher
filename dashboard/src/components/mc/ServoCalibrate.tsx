import { useState } from "react";
import { cn } from "@/lib/utils";

type ChannelState = {
  ch: number;
  angle: number;
  target: number;
  busy: boolean;
};

const CHANNELS = Array.from({ length: 16 }, (_, i) => i);

export function ServoCalibrate() {
  const [channels, setChannels] = useState<ChannelState[]>(
    CHANNELS.map((ch) => ({ ch, angle: 90, target: 90, busy: false })),
  );
  const [globalLo, setGlobalLo] = useState(60);
  const [globalHi, setGlobalHi] = useState(120);
  const [globalStep, setGlobalStep] = useState(20);
  const [globalDelay, setGlobalDelay] = useState(130);

  const moveChannel = async (ch: number, lo: number, hi: number) => {
    setChannels((prev) =>
      prev.map((c) => (c.ch === ch ? { ...c, busy: true } : c)),
    );
    try {
      const res = await fetch("/api/bridge_cmd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: "sweep",
          ch,
          lo,
          hi,
          step: globalStep,
          delay_ms: globalDelay,
          hold_end: true,
        }),
      });
      if (res.ok) {
        setChannels((prev) =>
          prev.map((c) =>
            c.ch === ch ? { ...c, angle: hi, target: hi, busy: false } : c,
          ),
        );
      } else {
        setChannels((prev) =>
          prev.map((c) => (c.ch === ch ? { ...c, busy: false } : c)),
        );
      }
    } catch {
      setChannels((prev) =>
        prev.map((c) => (c.ch === ch ? { ...c, busy: false } : c)),
      );
    }
  };

  const moveAll = async () => {
    for (const ch of CHANNELS) {
      const c = channels.find((x) => x.ch === ch)!;
      await moveChannel(ch, globalLo, globalHi);
    }
  };

  const setTarget = (ch: number, val: number) => {
    setChannels((prev) =>
      prev.map((c) => (c.ch === ch ? { ...c, target: val } : c)),
    );
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-foreground/80">
          Servo Calibrate — 16 channels
        </span>
        <div className="ml-auto flex items-center gap-2 text-[10px]">
          <label className="flex items-center gap-1">
            Lo
            <input
              type="number"
              value={globalLo}
              onChange={(e) => setGlobalLo(Number(e.target.value))}
              className="w-12 rounded-sm border border-hairline bg-accent px-1 py-0.5 text-[10px]"
            />
          </label>
          <label className="flex items-center gap-1">
            Hi
            <input
              type="number"
              value={globalHi}
              onChange={(e) => setGlobalHi(Number(e.target.value))}
              className="w-12 rounded-sm border border-hairline bg-accent px-1 py-0.5 text-[10px]"
            />
          </label>
          <label className="flex items-center gap-1">
            Step
            <input
              type="number"
              value={globalStep}
              onChange={(e) => setGlobalStep(Number(e.target.value))}
              className="w-12 rounded-sm border border-hairline bg-accent px-1 py-0.5 text-[10px]"
            />
          </label>
          <label className="flex items-center gap-1">
            Delay
            <input
              type="number"
              value={globalDelay}
              onChange={(e) => setGlobalDelay(Number(e.target.value))}
              className="w-12 rounded-sm border border-hairline bg-accent px-1 py-0.5 text-[10px]"
            />
          </label>
          <button
            onClick={moveAll}
            className="rounded-sm border border-signal/50 bg-signal/10 px-2 py-1 text-[10px] text-signal hover:bg-signal/20"
          >
            Move All
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {channels.map((c) => (
          <div
            key={c.ch}
            className="rounded-sm border border-hairline bg-chrome p-2"
          >
            <div className="mb-1 flex items-center justify-between text-[10px]">
              <span className="font-mono text-foreground/80">CH {c.ch}</span>
              <span
                className={cn(
                  "font-mono",
                  c.busy ? "text-signal animate-pulse" : "text-muted-foreground",
                )}
              >
                {c.angle}°
              </span>
            </div>
            <div className="mb-1 h-[3px] w-full overflow-hidden rounded-full bg-rail">
              <div
                className="h-full bg-signal transition-all"
                style={{ width: `${(c.angle / 180) * 100}%` }}
              />
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={180}
                value={c.target}
                onChange={(e) => setTarget(c.ch, Number(e.target.value))}
                className="w-14 rounded-sm border border-hairline bg-accent px-1 py-0.5 text-[10px]"
              />
              <button
                onClick={() => moveChannel(c.ch, c.angle, c.target)}
                disabled={c.busy}
                className="rounded-sm border border-signal/50 bg-signal/10 px-2 py-0.5 text-[10px] text-signal hover:bg-signal/20 disabled:opacity-40"
              >
                {c.busy ? "…" : "Move"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}