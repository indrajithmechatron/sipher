// ai-secret.mjs — local password shared by the Vite proxy and the headless
// `opencode serve` child it spawns.
//
// No secret is stored in this repository. A 32-byte random password is created
// once per user and kept outside the repo:
//
//   Windows: %LOCALAPPDATA%\Sipher\opencode-password
//            DPAPI-encrypted (CurrentUser) — the file alone is useless on
//            another account or machine.
//   other:   ~/.config/sipher/opencode-password   (mode 0600)
//
// Overrides:
//   SIPHER_AI_PASSWORD       use this value instead (e.g. CI / containers)
//   SIPHER_AI_PASSWORD_FILE  read/write the secret at a custom path
//
// The value never reaches the browser: the proxy injects Basic auth.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const WINDOWS = process.platform === "win32";
const PS_ARGS = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
];

const PS_DECRYPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$blob = [Convert]::FromBase64String(([IO.File]::ReadAllText($env:SIPHER_SECRET_FILE)).Trim())
$plain = [Security.Cryptography.ProtectedData]::Unprotect($blob, $null, 'CurrentUser')
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
`;

const PS_ENCRYPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plain = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())
$blob = [Security.Cryptography.ProtectedData]::Protect($plain, $null, 'CurrentUser')
[IO.File]::WriteAllText($env:SIPHER_SECRET_FILE, [Convert]::ToBase64String($blob))
`;

/** Path of the per-user secret file. */
export function secretFilePath() {
  const explicit = process.env.SIPHER_AI_PASSWORD_FILE;
  if (explicit) return path.resolve(explicit);

  if (WINDOWS) {
    const base =
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Sipher", "opencode-password");
  }

  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "sipher", "opencode-password");
}

function dpapiDecrypt(file) {
  return execFileSync("powershell.exe", [...PS_ARGS, PS_DECRYPT], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, SIPHER_SECRET_FILE: file },
  }).trim();
}

function dpapiEncrypt(password, file) {
  execFileSync("powershell.exe", [...PS_ARGS, PS_ENCRYPT], {
    input: password,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, SIPHER_SECRET_FILE: file },
  });
}

function newPassword() {
  return randomBytes(32).toString("base64url");
}

function readSecret(file) {
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) return "";

  if (WINDOWS) {
    try {
      return dpapiDecrypt(file);
    } catch {
      // Plain-text fallback written when DPAPI was unavailable.
      if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) return raw;
      throw new Error("unreadable DPAPI blob");
    }
  }
  return raw;
}

function writeSecret(password, file) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  if (WINDOWS) {
    try {
      dpapiEncrypt(password, file);
      return "dpapi";
    } catch (err) {
      console.warn(
        `[sipher] DPAPI unavailable (${err?.message ?? err}); storing the local secret as plain text`,
      );
    }
  }

  writeFileSync(file, password, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {}
  return "plain";
}

/**
 * Resolve the AI backend password, creating and persisting one on first use.
 * @returns {string}
 */
export function resolveAiPassword() {
  const explicit = process.env.SIPHER_AI_PASSWORD;
  if (explicit && explicit.trim()) return explicit.trim();

  const file = secretFilePath();

  if (existsSync(file)) {
    try {
      const stored = readSecret(file);
      if (stored) return stored;
    } catch (err) {
      console.warn(
        `[sipher] cannot read ${file} (${err?.message ?? err}); issuing a new local secret`,
      );
    }
  }

  const password = newPassword();
  writeSecret(password, file);
  console.log(`[sipher] generated a local AI password at ${file}`);
  return password;
}
