// Client-side auth helpers for the Sipher dashboard.
// The backend (Pi command_endpoint) owns sessions via an HttpOnly cookie;
// these helpers just talk to it. No secrets live in the browser.

export type AuthUser = { username: string; role: "owner" | "admin" | "user"; must_change?: boolean };

const BASE = ""; // same origin

async function req(path: string, init?: RequestInit): Promise<Response> {
  return fetch(BASE + path, { credentials: "include", ...init });
}

export async function me(): Promise<AuthUser | null> {
  const r = await req("/api/auth/me");
  if (!r.ok) return null;
  return (await r.json()) as AuthUser;
}

export async function login(username: string, password: string): Promise<AuthUser & { must_change?: boolean }> {
  const r = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j as AuthUser & { must_change?: boolean };
}

export async function logout(): Promise<void> {
  await req("/api/auth/logout", { method: "POST" }).catch(() => {});
}

export async function changePassword(newPassword: string): Promise<void> {
  const r = await req("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_password: newPassword }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
}