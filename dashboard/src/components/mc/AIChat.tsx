import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Paperclip, Plus, Send, Square, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dot } from "./chrome";

// opencode shapes (subset we use) --------------------------------------------
type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "step-start" }
  | { type: "step-finish" }
  | { type: "tool"; tool?: string; state?: { status?: string; output?: string; error?: string } }
  | { type: "file"; mime: string; url: string; filename?: string };

type Msg = { info: { id: string; role: string; title?: string }; parts: Part[] };
type Session = { id: string; title: string; time?: { updated?: number; created?: number } };
type ModelOpt = { providerID: string; modelID: string; label: string; input: Partial<Record<"text" | "image" | "audio" | "video" | "pdf", boolean>> };
type Provider = { id: string; name: string; models: Record<string, { id?: string; name?: string; capabilities?: { input?: Record<string, boolean> } }> };

const AI = "/api/ai";
const LS_SESSION = "sipher.ai.session";
const LS_MODEL = "sipher.ai.model";
const MAX_FILE = 10 * 1024 * 1024;

type Attach = { mime: string; url: string; filename: string; kind: "image" | "audio" | "video" | "file" };

function kindOf(mime: string): Attach["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

async function toDataURL(file: File | Blob, name: string): Promise<Attach | null> {
  const mime = file.type || "application/octet-stream";
  if (file.size > MAX_FILE) return null;
  const url = await new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsDataURL(file);
  });
  return { mime, url, filename: name, kind: kindOf(mime) };
}

// Fetch with basic auth already injected by the /api/ai proxy.

export function AIChat() {
  const [up, setUp] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sid, setSid] = useState<string>(() => localStorage.getItem(LS_SESSION) ?? "");
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [model, setModel] = useState<ModelOpt | null>(() => {
    const raw = localStorage.getItem(LS_MODEL);
    if (raw) {
      try {
        return JSON.parse(raw) as ModelOpt;
      } catch {}
    }
    return null;
  });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [att, setAtt] = useState<Attach[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const busyRef = useRef(false);
  busyRef.current = busy;

  const session = useMemo(() => sessions.find((s) => s.id === sid), [sessions, sid]);

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  // Boot: ensure backend (vite spawns it), load providers + sessions.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const s = await fetch(`${AI}/start`, { method: "POST" });
        const j = await s.json().catch(() => ({ ok: s.ok }));
        if (dead) return;
        setUp(!!j.ok);
        if (!j.ok) return;
        const pr = await fetch(`${AI}/config/providers`);
        const pj = await pr.json().catch(() => null);
        if (dead) return;
        const opts: ModelOpt[] = [];
        const provs: Provider[] = pj?.providers ?? [];
        for (const p of provs) {
          for (const [mid, m] of Object.entries(p.models ?? {})) {
            opts.push({
              providerID: p.id,
              modelID: mid,
              label: `${p.name ?? p.id} · ${m.name ?? mid}`,
              input: m.capabilities?.input ?? {},
            });
          }
        }
        setModels(opts);
        if (!model && opts.length) {
          const defProv = pj?.default?.providerID ?? opts[0].providerID;
          const pick =
            opts.find((o) => o.providerID === defProv && o.modelID === (pj?.default?.modelID ?? "")) ??
            opts.find((o) => o.providerID === defProv) ??
            opts[0];
          setModel(pick);
          localStorage.setItem(LS_MODEL, JSON.stringify(pick));
        }
        const sr = await fetch(`${AI}/session`);
        const sj = await sr.json().catch(() => []);
        if (dead) return;
        const list: Session[] = Array.isArray(sj) ? sj : (sj?.data ?? []);
        list.sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0));
        setSessions(list);
      } catch {
        if (!dead) setUp(false);
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMessages = useCallback(
    async (id: string) => {
      if (!id) return setMessages([]);
      try {
        const r = await fetch(`${AI}/session/${id}/message`);
        const j = await r.json().catch(() => null);
        const list: Msg[] = Array.isArray(j) ? j : [];
        setMessages(list);
        scrollDown();
      } catch {
        setMessages([]);
      }
    },
    [scrollDown],
  );

  useEffect(() => {
    if (sid) void loadMessages(sid);
  }, [sid, loadMessages]);

  async function newSession(): Promise<string> {
    try {
      const r = await fetch(`${AI}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (j?.id) {
        const s: Session = { id: j.id, title: j.title || "new chat", time: j.time };
        setSessions((l) => [s, ...l.filter((x) => x.id !== s.id)]);
        setSid(s.id);
        localStorage.setItem(LS_SESSION, s.id);
        setMessages([]);
        return s.id;
      }
    } catch {
      setError("session create failed — backend down?");
    }
    return "";
  }

  async function send() {
    if (busy || (!input.trim() && att.length === 0)) return;
    const text = input.trim();
    const parts: Part[] = [];
    if (text) parts.push({ type: "text", text });
    for (const a of att) parts.push({ type: "file", mime: a.mime, url: a.url, filename: a.filename });
    const local: Msg = {
      info: { id: "local-" + Date.now(), role: "user" },
      parts,
    };
    setMessages((m) => [...m, local]);
    setInput("");
    setAtt([]);
    setBusy(true);
    setError("");
    scrollDown();
    try {
      const target = sidRef.current || (await ensureSession());
      const r = await fetch(`${AI}/session/${target}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
          parts,
        }),
      });
      const j = await r.json().catch(() => null);
      if (j?.info) {
        setMessages((m) => [...m, j as Msg]);
        setSessions((l) => l.map((s) => (s.id === target ? { ...s, title: j.info?.title || s.title } : s)));
      } else {
        setError("empty response from opencode");
      }
    } catch {
      setError("send failed — backend down? reload after npm run dev");
    } finally {
      setBusy(false);
      scrollDown();
      inputRef.current?.focus();
    }
  }

  // stable ref for the current session id inside async send()
  const sidRef = useRef(sid);
  sidRef.current = sid;
  async function ensureSession(): Promise<string> {
    if (sidRef.current) return sidRef.current;
    const id = await newSession();
    sidRef.current = id;
    return id;
  }

  function abort() {
    if (sidRef.current) void fetch(`${AI}/session/${sidRef.current}/abort`, { method: "POST" });
  }

  function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    void (async () => {
      const next: Attach[] = [];
      for (const f of Array.from(files)) {
        if (f.size > MAX_FILE) {
          setError(`${f.name}: over 10 MB — skipped`);
          continue;
        }
        const a = await toDataURL(f, f.name);
        if (a) next.push(a);
      }
      setAtt((l) => [...l, ...next]);
    })();
  }

  function toggleRecord() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const rec = new MediaRecorder(stream);
        chunksRef.current = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) chunksRef.current.push(e.data);
        };
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          setRecording(false);
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          void (async () => {
            const a = await toDataURL(blob, "voice-note.webm");
            if (a) setAtt((l) => [...l, a]);
            else setError("voice note too large (10 MB max)");
          })();
        };
        recRef.current = rec;
        rec.start();
        setRecording(true);
      })
      .catch(() => setError("microphone unavailable/denied"));
  }

  function modelPick(m: ModelOpt) {
    setModel(m);
    localStorage.setItem(LS_MODEL, JSON.stringify(m));
  }

  // render ---------------------------------------------------------------
  const lastModelOK = (mime: string) => {
    if (!model) return true;
    const k = kindOf(mime);
    if (k === "image") return model.input.image !== false;
    if (k === "audio") return model.input.audio === true;
    if (k === "video") return model.input.video === true;
    return true;
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="hairline-b flex shrink-0 items-center gap-2 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        <Dot tone={up === true ? "ok" : up === false ? "danger" : "warn"} live />
        <span>ai-chat · opencode {up === true ? "up" : up === false ? "down" : "…"}</span>
        <button
          onClick={() => void newSession()}
          className="ml-auto flex items-center gap-1 rounded-sm border border-hairline px-1.5 py-[1px] hover:border-signal/40 hover:text-signal"
        >
          <Plus className="size-3" /> new chat
        </button>
        <select
          value={session?.id ?? sid}
          onChange={(e) => {
            setSid(e.target.value);
            localStorage.setItem(LS_SESSION, e.target.value);
          }}
          className="max-w-[140px] rounded-sm border border-hairline bg-accent px-1 py-[1px] text-[10px] text-foreground/85 outline-none"
        >
          {!sessions.some((s) => s.id === sid) && <option value={sid}>{sid ? session?.title || sid.slice(0, 10) : "no chat"}</option>}
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {(s.title || "untitled").slice(0, 24)}
            </option>
          ))}
        </select>
        <select
          value={model ? `${model.providerID}::${model.modelID}` : ""}
          onChange={(e) => {
            const m = models.find((o) => `${o.providerID}::${o.modelID}` === e.target.value);
            if (m) modelPick(m);
          }}
          className="max-w-[180px] rounded-sm border border-hairline bg-accent px-1 py-[1px] text-[10px] text-foreground/85 outline-none"
        >
          {!model && <option value="">pick model…</option>}
          {models.map((m) => (
            <option key={`${m.providerID}::${m.modelID}`} value={`${m.providerID}::${m.modelID}`}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.6]">
        {messages.length === 0 && (
          <div className="space-y-1 text-muted-foreground">
            <div>opencode · git repo workspace context — text / images / audio / video / pdf inputs</div>
            <div>ask anything, or attach a file; agents can read & edit repo files</div>
          </div>
        )}
        {messages.map((m, mi) => {
          const isUser = m.info.role === "user";
          return (
            <div key={m.info.id + mi} className={cn("mb-2", isUser && "text-signal")}>
              <div className="mb-0.5 font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
                {isUser ? "you" : m.info.role === "user" ? "you" : "opencode"}
              </div>
              {m.parts.map((p, i) => {
                if (p.type === "step-start" || p.type === "step-finish") return null;
                if (p.type === "text" && p.text) {
                  return (
                    <div key={i} className={cn("whitespace-pre-wrap break-words", isUser ? "text-signal" : "text-foreground/85")}>
                      {p.text}
                    </div>
                  );
                }
                if (p.type === "reasoning" && p.text) {
                  return (
                    <div key={i} className="mb-0.5 text-muted-foreground/70 italic">
                      ~ {p.text.replace(/\n+/g, " ").slice(0, 200)}
                    </div>
                  );
                }
                if (p.type === "tool") {
                  const st = p.state?.status ?? "";
                  return (
                    <div key={i} className="text-muted-foreground">
                      ▸ tool {p.tool ?? ""} {st && `· ${st}`}
                    </div>
                  );
                }
                if (p.type === "file") {
                  const ok = !isUser || lastModelOK(p.mime);
                  if (p.mime.startsWith("image/")) {
                    return (
                      <div key={i} className="mt-1">
                        <img src={p.url} alt={p.filename ?? ""} className="max-h-56 rounded-sm border border-hairline" />
                        {!ok && <span className="text-[9px] text-warn"> · {p.mime} not supported by this model</span>}
                      </div>
                    );
                  }
                  if (p.mime.startsWith("video/")) {
                    return (
                      <div key={i} className="mt-1">
                        <video src={p.url} controls className="max-h-56 rounded-sm border border-hairline" />
                        {!ok && <span className="text-[9px] text-warn"> · video not supported by this model</span>}
                      </div>
                    );
                  }
                  if (p.mime.startsWith("audio/")) {
                    return (
                      <div key={i} className="mt-1 text-muted-foreground">
                        ♪ audio attachment {p.filename ? `· ${p.filename}` : ""}
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="mt-1 text-muted-foreground">
                      ▣ {p.filename ?? "file"} ({p.mime})
                    </div>
                  );
                }
                return null;
              })}
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> thinking…
          </div>
        )}
        {error && <div className="text-danger">{error}</div>}
      </div>

      <div className="hairline-t shrink-0 bg-chrome px-2 py-1.5">
        {att.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {att.map((a, i) => (
              <span
                key={i}
                className={cn(
                  "flex items-center gap-1 rounded-sm border px-1.5 py-[1px] font-mono text-[9px]",
                  a.kind === "image" ? "border-signal/40 text-signal" : "border-hairline text-muted-foreground",
                )}
              >
                {a.kind === "image" ? "▣" : a.kind === "video" ? "▶" : a.kind === "audio" ? "♪" : "▤"} {a.filename.slice(0, 20)}
                <button onClick={() => setAtt((l) => l.filter((_, j) => j !== i))} className="hover:text-danger">
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <button
            onClick={() => fileRef.current?.click()}
            title="attach image / video / audio / pdf / text"
            className="grid size-7 shrink-0 place-items-center rounded-sm border border-hairline text-muted-foreground hover:border-signal/40 hover:text-signal"
          >
            <Paperclip className="size-3.5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,application/pdf,text/*"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            onClick={toggleRecord}
            title={recording ? "stop recording (attach as voice note)" : "record voice note"}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-sm border text-muted-foreground hover:text-foreground",
              recording ? "border-danger text-danger" : "border-hairline hover:border-signal/40",
            )}
          >
            {recording ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
          </button>
          <textarea
            value={input}
            autoFocus
            rows={1}
            spellCheck={false}
            placeholder={recording ? "recording…" : "message opencode — repo context is loaded"}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            className="max-h-24 min-h-7 flex-1 resize-none bg-transparent font-mono text-[11px] text-foreground/85 caret-signal outline-none placeholder:text-muted-foreground/60"
          />
          {busy ? (
            <button
              onClick={abort}
              className="grid size-7 shrink-0 place-items-center rounded-sm border border-danger text-danger hover:bg-danger/10"
              title="abort"
            >
              <Square className="size-3" />
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!input.trim() && att.length === 0}
              className="grid size-7 shrink-0 place-items-center rounded-sm border border-hairline text-muted-foreground hover:border-signal/40 hover:text-signal disabled:opacity-40"
              title="send"
            >
              <Send className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
