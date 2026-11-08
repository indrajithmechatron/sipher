import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { login, logout, me, changePassword, type AuthUser } from "@/lib/auth";

type AuthCtx = {
  user: AuthUser | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<AuthUser & { must_change?: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  changePassword: (p: string) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthGate");
  return v;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUser(await me());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doLogin = useCallback(async (u: string, p: string) => {
    const r = await login(u, p);
    const m = await me();
    setUser(m ?? { username: r.username, role: r.role, must_change: r.must_change });
    return r;
  }, []);

  const doLogout = useCallback(async () => {
    await logout();
    setUser(null);
  }, []);

  const doChange = useCallback(async (p: string) => {
    await changePassword(p);
    const m = await me();
    setUser(m);
  }, []);

  if (loading) {
    return (
      <div className="grid h-screen place-items-center bg-background font-mono text-[11px] text-muted-foreground">
        checking session…
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={doLogin} />;
  }

  if (user.must_change) {
    return <ChangePasswordScreen onSubmit={doChange} onLogout={doLogout} username={user.username} />;
  }

  return (
    <Ctx.Provider value={{ user, loading: false, login: doLogin, logout: doLogout, refresh, changePassword: doChange }}>
      {children}
    </Ctx.Provider>
  );
}

function LoginScreen({ onLogin }: { onLogin: (u: string, p: string) => Promise<AuthUser & { must_change?: boolean }> }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await onLogin(u.trim(), p);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-screen place-items-center bg-background font-mono text-[11px]">
      <form onSubmit={submit} className="w-[320px] space-y-3 rounded-sm border border-hairline bg-chrome p-5">
        <div className="text-[14px] text-foreground/85">Sipher Mission Control</div>
        <div className="text-[9px] tracking-[0.16em] text-muted-foreground uppercase">sign in</div>
        <input
          value={u}
          onChange={(e) => setU(e.target.value)}
          placeholder="username"
          autoFocus
          className="w-full rounded-sm border border-hairline bg-accent px-2 py-1.5 text-[11px] text-foreground/85 outline-none focus:border-signal/50"
        />
        <input
          type="password"
          value={p}
          onChange={(e) => setP(e.target.value)}
          placeholder="password"
          className="w-full rounded-sm border border-hairline bg-accent px-2 py-1.5 text-[11px] text-foreground/85 outline-none focus:border-signal/50"
        />
        {err && <div className="text-danger">{err}</div>}
        <button
          type="submit"
          disabled={busy || !u.trim() || !p}
          className="w-full rounded-sm border border-signal/50 bg-signal/10 px-2 py-1.5 text-[11px] text-signal hover:bg-signal/20 disabled:opacity-40"
        >
          {busy ? "signing in…" : "sign in"}
        </button>
        <div className="text-[9px] text-muted-foreground/60">default seed password: Sipher2026! (change on first login)</div>
      </form>
    </div>
  );
}

function ChangePasswordScreen({
  username,
  onSubmit,
  onLogout,
}: {
  username: string;
  onSubmit: (p: string) => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (p1 !== p2) {
      setErr("passwords do not match");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onSubmit(p1);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-screen place-items-center bg-background font-mono text-[11px]">
      <form onSubmit={submit} className="w-[320px] space-y-3 rounded-sm border border-hairline bg-chrome p-5">
        <div className="text-[14px] text-foreground/85">Change password</div>
        <div className="text-[9px] tracking-[0.16em] text-muted-foreground uppercase">{username} · first login</div>
        <input
          type="password"
          value={p1}
          onChange={(e) => setP1(e.target.value)}
          placeholder="new password (min 6)"
          autoFocus
          className="w-full rounded-sm border border-hairline bg-accent px-2 py-1.5 text-[11px] text-foreground/85 outline-none focus:border-signal/50"
        />
        <input
          type="password"
          value={p2}
          onChange={(e) => setP2(e.target.value)}
          placeholder="confirm"
          className="w-full rounded-sm border border-hairline bg-accent px-2 py-1.5 text-[11px] text-foreground/85 outline-none focus:border-signal/50"
        />
        {err && <div className="text-danger">{err}</div>}
        <button
          type="button"
          onClick={() => void onLogout()}
          className="w-full text-[9px] text-muted-foreground/60 hover:text-foreground"
        >
          sign out instead
        </button>
      </form>
    </div>
  );
}