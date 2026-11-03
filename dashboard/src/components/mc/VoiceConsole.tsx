import { useEffect, useRef, useState } from "react";
import { Dot } from "./chrome";
import { cn } from "@/lib/utils";

type VoiceEvent = {
  seq: number;
  ts: number;
  role: "user" | "assistant" | "action" | "error" | "wake" | string;
  text: string;
  action?: unknown;
};

const roleStyle: Record<string, { prefix: string; cls: string }> = {
  user: { prefix: "you>", cls: "text-signal" },
  assistant: { prefix: "sipher>", cls: "text-foreground/85" },
  action: { prefix: "  ->", cls: "text-warn" },
  error: { prefix: "  !!", cls: "text-danger" },
  wake: { prefix: "  ..", cls: "text-muted-foreground" },
};

function clock(ts: number) {
  const d = new Date(ts * 1000);
  return d.toTimeString().slice(0, 8);
}

/** Live transcript of the Pi voice agent (`software/voice/agent.py`). */
export function VoiceConsole() {
  const [events, setEvents] = useState<VoiceEvent[]>([]);
  const [online, setOnline] = useState(false);
  const [follow, setFollow] = useState(true);
  const seqRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    let timer = 0;

    const tick = async () => {
      try {
        const res = await fetch(`/api/voice/log?since=${seqRef.current}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (Array.isArray(data.events) && data.events.length) {
          seqRef.current = Number(data.seq) || seqRef.current;
          setEvents((prev) => [...prev, ...data.events].slice(-400));
        }
        setOnline(true);
      } catch {
        setOnline(false);
      }
      if (!stopped) timer = window.setTimeout(tick, 1000);
    };

    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ block: "end" });
  }, [events, follow]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="hairline-b flex shrink-0 items-center gap-2 px-3 py-1 font-mono text-[10px] text-muted-foreground">
        <Dot tone={online ? "ok" : "danger"} live={online} />
        <span className="uppercase tracking-wide">voice · groq</span>
        <span>{online ? "live" : "offline"}</span>
        <span className="opacity-60">{events.length} events</span>
        <button
          type="button"
          onClick={() => setFollow((f) => !f)}
          className={cn(
            "ml-auto rounded-sm px-1.5 py-0.5 hover:bg-accent hover:text-foreground",
            follow && "text-signal",
          )}
        >
          {follow ? "follow" : "paused"}
        </button>
        <button
          type="button"
          onClick={() => setEvents([])}
          className="rounded-sm px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
        >
          clear
        </button>
      </div>

      <div
        ref={boxRef}
        onWheel={(e) => {
          const el = boxRef.current;
          if (!el) return;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (!atBottom && follow) setFollow(false);
          if (atBottom && !follow) setFollow(true);
          if (e.deltaY < 0) setFollow(false);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.65]"
      >
        {events.length === 0 && (
          <div className="text-muted-foreground">
            waiting for the voice agent — say “sipher” or “buddy” near the USB mic
          </div>
        )}
        {events.map((e) => {
          const s = roleStyle[e.role] ?? roleStyle.assistant!;
          return (
            <div key={e.seq} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground/60">{clock(e.ts)}</span>
              <span className={cn("shrink-0", s.cls)}>{s.prefix}</span>
              <span className={cn("min-w-0 break-words", s.cls)}>{e.text}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
