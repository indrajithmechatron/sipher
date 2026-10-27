"""
command_endpoint.py — Pi-side HTTP server for Sipher

Single server, two purposes:
  1. Command execution for Hermes (POST /command)
  2. Live sensor dashboard (GET / or /dashboard + GET /api/sensors)

Runs on Pi:  python3 -m control.command_endpoint
Port: 8888 (configurable via PORT env var)

Architecture:
  Dashboard (browser) -> command_endpoint.py (:8888) -> bridge.py (:5000) -> Pico (USB serial)
"""

import base64
import hashlib
import hmac
import secrets
import http.server
import ipaddress
import json
import os
import pathlib
import re
import shlex
import subprocess
import sys
import threading
import time
import urllib.request

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PORT = int(os.environ.get("SIPHER_PORT", "8888"))
AI_BASE = os.environ.get("SIPHER_AI_BASE", "http://192.168.1.38:4096").rstrip("/")
ASR_BASE = os.environ.get("SIPHER_ASR_BASE", "http://192.168.1.38:3000").rstrip("/")
AI_PASSWORD = os.environ.get("SIPHER_AI_PASSWORD", "")
if not AI_PASSWORD:
    try:
        AI_PASSWORD = (pathlib.Path(os.environ.get("SIPHER_REPO_DIR", "/home/sipher/sipher")) / ".ai_password").read_text(encoding="utf-8").strip()
    except Exception:
        AI_PASSWORD = ""
AI_AUTH = "Basic " + base64.b64encode(("opencode:" + AI_PASSWORD).encode("utf-8")).decode("ascii")
SESSION_SECRET = os.environ.get("SIPHER_SESSION_SECRET", "")
if not SESSION_SECRET:
    _sf = pathlib.Path(os.environ.get("SIPHER_REPO_DIR", "/home/sipher/sipher")) / ".session_secret"
    if _sf.exists():
        SESSION_SECRET = _sf.read_text(encoding="utf-8").strip()
    else:
        SESSION_SECRET = secrets.token_urlsafe(32)
        _sf.write_text(SESSION_SECRET, encoding="utf-8")
        try:
            _sf.chmod(0o600)
        except Exception:
            pass
PROFILES_FILE = pathlib.Path(os.environ.get("SIPHER_REPO_DIR", "/home/sipher/sipher")) / "profiles.json"
PICO_SERIAL = os.environ.get("SIPHER_PICO_SERIAL", "/dev/ttyACM0")
PICO_BAUD = int(os.environ.get("SIPHER_PICO_BAUD", "115200"))
REPO_DIR = os.environ.get("SIPHER_REPO_DIR", "/home/sipher/sipher")
LOG_DIR = os.environ.get("SIPHER_LOG_DIR", "/home/sipher/logs")
BRIDGE_SENSOR_URL = os.environ.get("SIPHER_BRIDGE_SENSOR_URL", "http://localhost:5001/sensor")
BRIDGE_MAP_URL = os.environ.get("SIPHER_BRIDGE_MAP_URL", "http://localhost:5001/map")

_THIS_DIR = pathlib.Path(os.path.dirname(os.path.abspath(__file__)))
DASHBOARD_PATH = _THIS_DIR.parent / "dashboard" / "index.html"

# Make sibling packages (control, robot, rag, ...) importable when this file is
# run directly instead of with PYTHONPATH=/home/sipher/sipher/software.
_SOFTWARE_DIR = str(_THIS_DIR.parent)
if _SOFTWARE_DIR not in sys.path:
    sys.path.insert(0, _SOFTWARE_DIR)

# ---------------------------------------------------------------------------
# Sensor data — polled from bridge HTTP endpoint (port 5001)
# ---------------------------------------------------------------------------
_latest_sensor = {}
_sensor_meta = {"pico_live": False, "pico_age_ms": None, "bridge_ok": False}
_sensor_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Pi host stats — real readings, refreshed by the poller thread
# ---------------------------------------------------------------------------
_pi_stats = {"cpu_pct": None, "cpu_temp_c": None, "load1": None, "load5": None,
             "load15": None, "mem_used_pct": None, "mem_free_mb": None,
             "disk_used_pct": None, "uptime_s": None, "cores": None}
_cpu_prev = {}

def _read_float(path):
    try:
        with open(path) as f:
            return float(f.read().strip())
    except Exception:
        return None

def _cpu_temp_c():
    t = _read_float("/sys/class/thermal/thermal_zone0/temp")
    if t is None:
        # some kernels expose the sensor under hwmon only
        for i in range(4):
            t = _read_float(f"/sys/class/hwmon/hwmon{i}/temp1_input")
            if t is not None:
                break
    return round(t / 1000.0, 1) if t is not None else None

def _cpu_pct():
    """CPU utilisation from /proc/stat deltas between two poller samples."""
    global _cpu_prev
    try:
        with open("/proc/stat") as f:
            parts = f.readline().split()
        idle = int(parts[4]) + int(parts[5])
        total = sum(int(x) for x in parts[1:])
    except Exception:
        return None
    prev = _cpu_prev
    _cpu_prev = {"idle": idle, "total": total}
    if not prev or total <= prev["total"]:
        return None
    d_total = total - prev["total"]
    d_idle = idle - prev["idle"]
    return round(max(0.0, min(100.0, (1 - d_idle / d_total) * 100.0)), 1)

def _mem_stats():
    info = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                info[k] = int(v.strip().split()[0])   # kB
    except Exception:
        return None, None
    total = info.get("MemTotal")
    if not total:
        return None, None
    avail = info.get("MemAvailable", info.get("MemFree", 0))
    used_pct = round((total - avail) / total * 100.0, 1)
    return used_pct, round(avail / 1024.0, 0)

def _disk_used_pct():
    try:
        st = os.statvfs("/")
        used = (st.f_blocks - st.f_bfree) * st.f_frsize
        total = st.f_blocks * st.f_frsize
        return round(used / total * 100.0, 1) if total else None
    except Exception:
        return None

def _uptime_s():
    try:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    except Exception:
        return None

def _loadavg():
    try:
        with open("/proc/loadavg") as f:
            a = f.read().split()
        return round(float(a[0]), 2), round(float(a[1]), 2), round(float(a[2]), 2)
    except Exception:
        return None, None, None

def refresh_pi_stats():
    l1, l5, l15 = _loadavg()
    used, free = _mem_stats()
    stats = {
        "cpu_pct": _cpu_pct(),
        "cpu_temp_c": _cpu_temp_c(),
        "load1": l1, "load5": l5, "load15": l15,
        "mem_used_pct": used, "mem_free_mb": free,
        "disk_used_pct": _disk_used_pct(),
        "uptime_s": _uptime_s(),
        "cores": os.cpu_count(),
        "ts": time.time(),
    }
    _pi_stats.update({k: v for k, v in stats.items() if v is not None})
    return stats

def get_pi_stats():
    return dict(_pi_stats)

def _sensor_poller():
    """Poll bridge /sensor endpoint every 1s for latest snapshot + Pi host stats."""
    while True:
        try:
            with urllib.request.urlopen(BRIDGE_SENSOR_URL, timeout=3) as resp:
                data = json.loads(resp.read().decode())
                if data:
                    meta = data.pop("_meta", {}) or {}
                    pico = meta.get("pico")
                    pico_live = pico.get("live") if isinstance(pico, dict) else bool(pico)
                    pico_age = pico.get("age_ms") if isinstance(pico, dict) else meta.get("pico_age_ms")
                    with _sensor_lock:
                        pico_live_bool = bool(pico_live)
                        if pico_live_bool and any(k in data for k in ("mpu", "vl53_mm", "ina", "gps", "i2c0", "i2c1")):
                            _latest_sensor.clear()
                            _latest_sensor.update(data)
                        if not pico_live_bool:
                            _latest_sensor.clear()
                        _sensor_meta["pico_live"] = pico_live_bool
                        _sensor_meta["pico_age_ms"] = pico_age
                        _sensor_meta["bridge_ok"] = True
        except Exception:
            with _sensor_lock:
                _sensor_meta["bridge_ok"] = False
                _sensor_meta["pico_live"] = False
                _latest_sensor.clear()
        try:
            refresh_pi_stats()
        except Exception:
            pass
        time.sleep(1)

def get_latest_sensor():
    with _sensor_lock:
        pico_live = _sensor_meta.get("pico_live", False)
        data = dict(_latest_sensor) if pico_live else {}
        meta = dict(_sensor_meta)
    data["_meta"] = {
        "pi": True,
        "pico": meta.get("pico_live", False),
        "pico_age_ms": meta.get("pico_age_ms"),
        "bridge": meta.get("bridge_ok", False),
        "pi_stats": get_pi_stats(),
        "ts": time.time(),
    }
    return data


_sensor_thread = threading.Thread(target=_sensor_poller, daemon=True)
_sensor_thread.start()

# ---------------------------------------------------------------------------
# Dashboard HTML — loaded from file
# ---------------------------------------------------------------------------
_dashboard_html = None
_dashboard_dir = None

def load_dashboard():
    global _dashboard_html, _dashboard_dir
    # Try multiple paths (built Vite bundle first)
    candidates = [
        pathlib.Path(REPO_DIR) / "dashboard" / "dist" / "index.html",
        pathlib.Path(REPO_DIR) / "dashboard" / "index.html",
        _THIS_DIR.parent / "dashboard" / "index.html",
        pathlib.Path(REPO_DIR) / "software" / "dashboard" / "index.html",
        pathlib.Path("/home/sipher/sipher/software/dashboard/index.html"),
    ]
    for p in candidates:
        if p.exists():
            _dashboard_html = p.read_text(encoding="utf-8")
            _dashboard_dir = p.parent
            print(f"[http] loaded dashboard from {p}", flush=True)
            return
    _dashboard_html = "<h1>Dashboard not found</h1><p>Searched: " + "<br>".join(str(p) for p in candidates) + "</p>"
    print(f"[http] WARNING: dashboard not found, searched {len(candidates)} paths", flush=True)

# ---------------------------------------------------------------------------
# Restricted command execution
#
# /command is reachable from the LAN (the dashboard runs on another host), so
# it is NOT a shell. The request string is parsed into an argv with shlex, the
# program must be one of the checkers below, and every argument is validated.
# Nothing else runs. `python3 <anything>` is deliberately not allowed, and no
# argument can be interpreted by a shell (`;`, `&&`, `$(...)`, newlines, ...).
# ---------------------------------------------------------------------------
MAX_COMMAND_CHARS = 240
MAX_TIMEOUT_S = 60

# Optional shared secret. When set, /command requires `X-Sipher-Token`. When
# unset, only loopback/private/link-local clients may call it (no port-forward
# exposure), and a warning is printed at startup.
COMMAND_TOKEN = os.environ.get("SIPHER_COMMAND_TOKEN", "").strip()

_SIPHER_UNIT = re.compile(r"^sipher-[a-z0-9][a-z0-9@._-]*$")
_SYSTEMCTL_VERBS = {"status", "is-active", "is-enabled", "show", "list-units", "list-timers"}
_GIT_SUBS = {"status", "log", "diff", "show", "rev-parse", "remote",
             "describe", "ls-files", "pull", "fetch"}
# Flags that make git execute another program (pager, diff driver, hook helper,
# upload/receive pack, alternate config, alternate repo) rather than read data.
_GIT_FORBIDDEN = {
    "-c", "-O", "--exec-path", "--upload-pack", "--receive-pack",
    "--open-files-in-pager", "--ext-diff", "--textconv", "--pager",
    "--config-env", "--git-dir", "--work-tree", "--namespace", "--super-prefix",
}
_GIT_FLAG = re.compile(r"^(?:--[A-Za-z][A-Za-z0-9-]*(?:=\S*)?|-[A-Za-z]|-[0-9]+)$")


def _check_systemctl(args):
    """systemctl <verb> [flags] [sipher-* unit] — no arbitrary units, no verbs
    that change state (start/stop/restart/enable/disable need root anyway and
    belong to deploy/update.sh, which has its own sudoers rule)."""
    out = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("--no-pager", "--value", "--all", "--quiet", "--full"):
            out.append(a)
            i += 1
        elif a in ("-n", "--lines", "-p", "--property"):
            if i + 1 >= len(args):
                return None, f"systemctl {a} needs a value"
            out += [a, args[i + 1]]
            i += 2
        elif a.startswith("--lines=") and a.split("=", 1)[1].isdigit():
            out.append(a)
            i += 1
        elif a.startswith("--property="):
            out.append(a)
            i += 1
        elif a in _SYSTEMCTL_VERBS or _SIPHER_UNIT.match(a):
            out.append(a)
            i += 1
        else:
            return None, f"systemctl argument not allowed: {a}"
    verbs = [a for a in out if a in _SYSTEMCTL_VERBS]
    units = [a for a in out if _SIPHER_UNIT.match(a)]
    if not verbs:
        return None, "systemctl needs a verb"
    if len(verbs) > 1:
        return None, "one systemctl verb at a time"
    if verbs[0] in ("status", "is-active", "is-enabled", "show") and not units:
        return None, "systemctl needs a sipher-* unit"
    return ["systemctl"] + out, None


def _check_git(args):
    """Read-only git plus pull/fetch, always inside REPO_DIR."""
    argv = ["git"]
    i = 0
    if args[:1] == ["-C"]:
        if len(args) < 2 or not _same_dir(args[1], REPO_DIR):
            return None, "git -C is only allowed for the repository"
        argv += args[:2]
        i = 2
    if i >= len(args) or args[i] not in _GIT_SUBS:
        return None, f"git subcommand not allowed: {args[i] if i < len(args) else '(none)'}"
    argv.append(args[i])
    for a in args[i + 1:]:
        if a.split("=", 1)[0] in _GIT_FORBIDDEN:
            return None, f"git flag not allowed: {a}"
        if a.startswith("-") and a != "--" and not _GIT_FLAG.match(a):
            return None, f"git flag not allowed: {a}"
    return argv + args[i + 1:], None


def _same_dir(path, base):
    try:
        return os.path.realpath(path) == os.path.realpath(base)
    except (OSError, ValueError):
        return False


def _inside(path, base):
    try:
        p = os.path.realpath(path)
        b = os.path.realpath(base)
    except (OSError, ValueError):
        return False
    return p == b or p.startswith(b + os.sep)


def _check_cat(args):
    """cat a single file inside the repository or the log directory."""
    if len(args) != 1:
        return None, "cat takes exactly one path"
    p = args[0]
    full = p if os.path.isabs(p) else os.path.join(REPO_DIR, p)
    if not (_inside(full, REPO_DIR) or _inside(full, LOG_DIR)):
        return None, "path outside the repository/log directory"
    return ["cat", full], None


def _check_tailscale(args):
    if not args:
        return None, "tailscale needs a subcommand"
    sub, rest = args[0], args[1:]
    if sub == "status" and all(a in ("--json", "--peers", "--self") for a in rest):
        return ["tailscale", sub] + rest, None
    if sub == "ip" and all(a in ("-4", "-6") for a in rest):
        return ["tailscale", sub] + rest, None
    if sub == "version" and not rest:
        return ["tailscale", sub], None
    return None, f"tailscale subcommand not allowed: {sub}"


_CHECKERS = {
    "systemctl": _check_systemctl,
    "git": _check_git,
    "cat": _check_cat,
    "tailscale": _check_tailscale,
}


def build_argv(cmd):
    """Parse + validate a command. Returns (argv, None) or (None, reason)."""
    if not isinstance(cmd, str):
        return None, "command must be a string"
    if not cmd.strip():
        return None, "empty command"
    if len(cmd) > MAX_COMMAND_CHARS:
        return None, f"command longer than {MAX_COMMAND_CHARS} characters"
    if any(c in cmd for c in "\x00\n\r"):
        return None, "control characters not allowed"
    if any(c in cmd for c in ";&|`$<>"):
        return None, "shell metacharacters not allowed"
    try:
        parts = shlex.split(cmd)
    except ValueError as e:
        return None, f"cannot parse command: {e}"
    if not parts:
        return None, "empty command"
    checker = _CHECKERS.get(parts[0])
    if checker is None:
        return None, f"program not allowed: {parts[0]}"
    return checker(parts[1:])


def is_safe_command(cmd: str) -> bool:
    argv, _ = build_argv(cmd)
    return argv is not None


def run_command(cmd: str, timeout: int = 30) -> dict:
    argv, reason = build_argv(cmd)
    if argv is None:
        return {"error": f"command not allowed: {reason}", "rc": -1}
    try:
        t = float(timeout)
    except (TypeError, ValueError):
        t = 30.0
    t = max(1.0, min(float(MAX_TIMEOUT_S), t))
    try:
        result = subprocess.run(
            argv, shell=False, capture_output=True, text=True, timeout=t,
            cwd=REPO_DIR,
        )
        return {
            "rc": result.returncode,
            "stdout": result.stdout[-5000:],
            "stderr": result.stderr[-5000:],
        }
    except subprocess.TimeoutExpired:
        return {"error": f"command timed out after {t:g}s", "rc": -1}
    except Exception as e:
        return {"error": str(e), "rc": -1}


def _client_address_ok(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(str(addr).split("%", 1)[0])
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_loopback or ip.is_private or ip.is_link_local


def command_authorized(addr: str, token: str) -> tuple:
    """(allowed, reason) for a /command request."""
    if COMMAND_TOKEN:
        if token and hmac.compare_digest(str(token), COMMAND_TOKEN):
            return True, ""
        return False, "missing or invalid X-Sipher-Token"
    if not _client_address_ok(addr):
        return False, "non-private client (set SIPHER_COMMAND_TOKEN to allow)"
    return True, ""

# ---------------------------------------------------------------------------
# HTTP Request Handler
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Auth / profiles
# ---------------------------------------------------------------------------
_DEFAULT_SEED = "Sipher2026!"
_SEEDED_ADMINS = ["admin", "admin2", "admin3"]
_SEEDED_USERS = ["user1", "user2", "user3", "user4", "user5"]


def _hash_password(password: str, salt: bytes = None) -> str:
    if salt is None:
        salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return "pbkdf2$%s$%s" % (salt.hex(), dk.hex())


def _verify_password(password: str, stored: str) -> bool:
    try:
        _tag, salt_hex, dk_hex = stored.split("$", 2)
        if _tag != "pbkdf2":
            return False
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


def _load_profiles() -> dict:
    if not PROFILES_FILE.exists():
        return {}
    try:
        data = json.loads(PROFILES_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _save_profiles(profiles: dict) -> None:
    PROFILES_FILE.write_text(json.dumps(profiles, indent=2), encoding="utf-8")
    try:
        PROFILES_FILE.chmod(0o600)
    except Exception:
        pass


def _seed_profiles() -> dict:
    profiles = _load_profiles()
    if profiles:
        return profiles
    profiles = {}
    for name in _SEEDED_ADMINS:
        profiles[name] = {"role": "admin", "password": _hash_password(_DEFAULT_SEED), "must_change": True}
    for name in _SEEDED_USERS:
        profiles[name] = {"role": "user", "password": _hash_password(_DEFAULT_SEED), "must_change": True}
    _save_profiles(profiles)
    print("[auth] seeded %d profiles (default password: %s) - change on first login" % (len(profiles), _DEFAULT_SEED), flush=True)
    return profiles


def _make_token(username: str, role: str) -> str:
    import time as _t
    payload = json.dumps({"u": username, "r": role, "exp": int(_t.time()) + 8 * 3600})
    sig = hmac.new(SESSION_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    import base64 as _b
    return _b.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii") + "." + sig


def _parse_token(tok: str):
    try:
        import time as _t, base64 as _b
        if "." not in tok:
            return None
        b64, sig = tok.rsplit(".", 1)
        payload = _b.urlsafe_b64decode(b64.encode("ascii") + b"==").decode("utf-8")
        expected = hmac.new(SESSION_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return None
        data = json.loads(payload)
        if int(data.get("exp", 0)) < int(_t.time()):
            return None
        return data
    except Exception:
        return None


def _session_from_request(self):
    cookie = self.headers.get("Cookie", "")
    tok = None
    for part in cookie.split(";"):
        part = part.strip()
        if part.startswith("sipher_session="):
            tok = part[len("sipher_session="):]
            break
    if not tok:
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            tok = auth[7:].strip()
    data = _parse_token(tok) if tok else None
    if not data:
        return None
    profiles = _load_profiles()
    p = profiles.get(data.get("u"))
    if not p:
        return None
    return {"username": data["u"], "role": data["r"]}


def _require_auth(self, role: str = None):
    sess = _session_from_request(self)
    if not sess:
        self.send_json({"error": "unauthorized"}, 401)
        return None
    if role == "admin" and sess["role"] != "admin":
        self.send_json({"error": "admin required"}, 403)
        return None
    return sess

try:
    _seed_profiles()
except Exception as e:
    print("[auth] seed failed: %s" % e, flush=True)

class SipherHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(f"[http] {args[0]}", flush=True)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Sipher-Token, Authorization")
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, html):
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_asset(self, path):
        """Serve built dashboard assets (/assets/*)."""
        if not _dashboard_dir:
            self.send_json({"error": "dashboard not loaded"}, 500)
            return
        rel = path[len("/assets/"):]
        target = (_dashboard_dir / "assets" / rel).resolve()
        base = _dashboard_dir.resolve()
        if not str(target).startswith(str(base) + os.sep) or not target.is_file():
            self.send_json({"error": "not found"}, 404)
            return
        ctype = {
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".map": "application/json",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".woff2": "font/woff2",
        }.get(target.suffix.lower(), "application/octet-stream")
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Sipher-Token, Authorization")
        self.end_headers()

    def _read_body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            n = 0
        if n <= 0:
            return b""
        n = min(n, 30 * 1024 * 1024)
        return self.rfile.read(n)

    def _ai_proxy(self, base: str, strip: bool = True):
        """Forward /api/ai/* to the PC's opencode (or ASR) backend."""
        if self.path == "/api/ai/start":
            try:
                req = urllib.request.Request(base.replace("/api/ai", "") + "/global/health",
                                            headers={"Authorization": AI_AUTH})
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=10) as r:
                    self.send_json({"ok": r.status == 200})
                    return
            except Exception:
                self.send_json({"ok": False}, 502)
                return
        body = self._read_body()
        ctype = self.headers.get("Content-Type", "application/json")
        path = self.path.replace("/api/ai", "", 1) if strip else self.path
        target = base + path
        req = urllib.request.Request(target, data=body if body else None, method=self.command)
        req.add_header("Authorization", AI_AUTH)
        req.add_header("Content-Type", ctype)
        if body:
            req.add_header("Content-Length", str(len(body)))
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=600) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Sipher-Token, Authorization")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_json({"error": "ai upstream %s failed: %s" % (base, e)}, 502)

    def do_GET(self):
        if self.path == "/api/ai" or self.path.startswith("/api/ai/"):
            self._ai_proxy(AI_BASE)
        elif self.path == "/api/auth/me":
            self.handle_auth_me()
        elif self.path == "/api/profiles":
            self.handle_profiles_list()
        elif self.path in ("/", "/dashboard"):
            if _dashboard_html:
                self.send_html(_dashboard_html)
            else:
                self.send_json({"error": "dashboard not loaded"}, 500)
        elif self.path == "/api/sensors":
            if not _require_auth(self):
                return
            self.send_json(get_latest_sensor())
        elif self.path == "/api/pi":
            if not _require_auth(self):
                return
            self.send_json(get_pi_stats())
        elif self.path.startswith("/api/rag"):
            self.handle_rag("GET")
        elif self.path.startswith("/api/map"):
            self.handle_map()
        elif self.path == "/api/info":
            uptime = "unknown"
            try:
                with open("/proc/uptime") as f:
                    uptime = f.read().split()[0]
            except Exception:
                pass
            self.send_json({
                "pi_ip": os.environ.get("PI_IP", "unknown"),
                "uptime": uptime,
                "pico_serial": PICO_SERIAL,
                "port": PORT,
                "pi_live": True,
                "pico_live": get_latest_sensor().get("_meta", {}).get("pico", False),
            })
        elif self.path == "/health":
            self.send_json({"status": "ok"})
        elif self.path.startswith("/assets/"):
            self.send_asset(self.path.split("?", 1)[0])
        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path == "/command":
            self.handle_command()
        elif self.path == "/api/bridge_cmd":
            self.handle_bridge_cmd()
        elif self.path == "/api/ai/transcribe":
            self._ai_proxy(ASR_BASE, strip=False)
        elif self.path == "/api/auth/login":
            self.handle_auth_login()
        elif self.path == "/api/auth/logout":
            self.handle_auth_logout()
        elif self.path == "/api/auth/change-password":
            self.handle_auth_change_password()
        elif self.path == "/api/profiles/create":
            self.handle_profiles_create()
        elif self.path == "/api/profiles/delete":
            self.handle_profiles_delete()
        elif self.path == "/api/ai" or self.path.startswith("/api/ai/"):
            self._ai_proxy(AI_BASE)
        elif self.path.startswith("/api/rag"):
            self.handle_rag("POST")
        else:
            self.send_json({"error": "not found"}, 404)

    def handle_rag(self, method):
        """Serve the retrieval layer (Layer 1) at /api/rag/*.

        Indexing is lazy: the first request loads .rag/index.json or builds it.
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > 8_000_000:
            self.send_json({"error": "body too large"}, 413)
            return
        body = self.rfile.read(length) if length > 0 else b""
        try:
            from rag.http_api import dispatch
            from rag.service import get_knowledge_base
        except Exception as e:
            self.send_json({"error": f"RAG unavailable: {e}"}, 503)
            return
        status, payload = dispatch(
            get_knowledge_base(),
            method,
            self.path,
            body,
            self.headers.get("Content-Type", ""),
        )
        self.send_json(payload, status)

    def handle_map(self):
        """Proxy occupancy-map requests to the bridge (Layer 2 owns the mapper).

        GET /api/map            -> full map incl. base64 grid
        GET /api/map?nogrid=1   -> map metadata only (cheap polling)
        GET /api/map?action=start|stop|reset -> control the sweep
        """
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        url = BRIDGE_MAP_URL + ("?" + query if query else "")
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                body = resp.read()
                status = resp.status
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self.send_json({"error": f"bridge map not reachable: {e}"}, 502)

    def handle_bridge_cmd(self):
        """Forward a command to the bridge via TCP port 5000."""
        sess = _session_from_request(self)
        if not sess or sess["role"] != "admin":
            self.send_json({"error": "admin required"}, 403)
            return
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self.send_json({"error": "empty body"}, 400)
            return
        body = self.rfile.read(content_length)
        try:
            req = json.loads(body)
        except json.JSONDecodeError:
            self.send_json({"error": "invalid json"}, 400)
            return
        try:
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(3)
            sock.connect(("127.0.0.1", 5000))
            sock.sendall((json.dumps(req) + "\n").encode())
            buf = b""
            while b"\n" not in buf:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                buf += chunk
            sock.close()
            line = buf.split(b"\n", 1)[0].decode(errors="replace").strip()
            if not line:
                self.send_json({"bridge": "ok"})
                return
            self.send_json(json.loads(line))
        except Exception as e:
            self.send_json({"error": f"bridge not reachable: {e}"})

    def _set_session_cookie(self, token: str):
        self.send_header("Set-Cookie", "sipher_session=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800" % token)

    def _clear_session_cookie(self):
        self.send_header("Set-Cookie", "sipher_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")

    def handle_auth_login(self):
        body = self._read_body()
        try:
            req = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_json({"error": "invalid json"}, 400)
            return
        username = str(req.get("username", "")).strip()
        password = str(req.get("password", ""))
        profiles = _load_profiles()
        p = profiles.get(username)
        if not p or not _verify_password(password, p.get("password", "")):
            self.send_json({"error": "invalid credentials"}, 401)
            return
        token = _make_token(username, p.get("role", "user"))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self._set_session_cookie(token)
        body = json.dumps({"ok": True, "username": username, "role": p.get("role", "user"), "must_change": bool(p.get("must_change"))}).encode()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_auth_logout(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self._clear_session_cookie()
        body = b'{"ok": true}'
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_auth_me(self):
        sess = _session_from_request(self)
        if not sess:
            self.send_json({"error": "unauthorized"}, 401)
            return
        profiles = _load_profiles()
        p = profiles.get(sess["username"], {})
        self.send_json({"username": sess["username"], "role": sess["role"], "must_change": bool(p.get("must_change"))})

    def handle_auth_change_password(self):
        sess = _session_from_request(self)
        if not sess:
            self.send_json({"error": "unauthorized"}, 401)
            return
        body = self._read_body()
        try:
            req = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_json({"error": "invalid json"}, 400)
            return
        new_pw = str(req.get("new_password", ""))
        if len(new_pw) < 6:
            self.send_json({"error": "password too short (min 6)"}, 400)
            return
        profiles = _load_profiles()
        p = profiles.get(sess["username"])
        if not p:
            self.send_json({"error": "profile not found"}, 404)
            return
        p["password"] = _hash_password(new_pw)
        p["must_change"] = False
        _save_profiles(profiles)
        self.send_json({"ok": True})

    def handle_profiles_list(self):
        sess = _require_auth(self, "admin")
        if not sess:
            return
        profiles = _load_profiles()
        out = [{"username": u, "role": p.get("role", "user"), "must_change": bool(p.get("must_change"))} for u, p in profiles.items()]
        self.send_json({"profiles": out})

    def handle_profiles_create(self):
        sess = _require_auth(self, "admin")
        if not sess:
            return
        body = self._read_body()
        try:
            req = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_json({"error": "invalid json"}, 400)
            return
        username = str(req.get("username", "")).strip()
        password = str(req.get("password", _DEFAULT_SEED))
        role = str(req.get("role", "user"))
        if not username or not username.replace("_", "").replace("-", "").isalnum():
            self.send_json({"error": "invalid username"}, 400)
            return
        if role not in ("admin", "user"):
            self.send_json({"error": "role must be admin or user"}, 400)
            return
        profiles = _load_profiles()
        if username in profiles:
            self.send_json({"error": "user already exists"}, 409)
            return
        profiles[username] = {"role": role, "password": _hash_password(password), "must_change": True}
        _save_profiles(profiles)
        self.send_json({"ok": True, "username": username, "role": role})

    def handle_profiles_delete(self):
        sess = _require_auth(self, "admin")
        if not sess:
            return
        body = self._read_body()
        try:
            req = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_json({"error": "invalid json"}, 400)
            return
        username = str(req.get("username", "")).strip()
        if username == sess["username"]:
            self.send_json({"error": "cannot delete yourself"}, 400)
            return
        profiles = _load_profiles()
        if username not in profiles:
            self.send_json({"error": "not found"}, 404)
            return
        del profiles[username]
        _save_profiles(profiles)
        self.send_json({"ok": True})

    def handle_command(self):
        """Execute one allowlisted argv (never a shell) — see build_argv()."""
        try:
            content_length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            content_length = 0
        # Drain the body first (bounded) so rejections don't reset the socket
        # while the client is still writing.
        body = self.rfile.read(min(content_length, 65536)) if content_length > 0 else b""
        sess = _session_from_request(self)
        if sess is not None and sess["role"] == "admin":
            allowed, why = True, ""
        else:
            allowed, why = command_authorized(
                self.client_address[0], self.headers.get("X-Sipher-Token", "")
            )
            if not allowed:
                self.send_json({"error": "unauthorized: admin login or X-Sipher-Token required", "rc": -1}, 401)
                return

        if not allowed:
            print(f"[http] rejected /command from {self.client_address[0]}: {why}", flush=True)
            self.send_json({"error": f"forbidden: {why}", "rc": -1}, 403)
            return
        if content_length <= 0:
            self.send_json({"error": "empty body"}, 400)
            return
        if content_length > 4096:
            self.close_connection = True
            self.send_json({"error": "body too large"}, 413)
            return
        try:
            req = json.loads(body)
        except json.JSONDecodeError:
            self.send_json({"error": "invalid json"}, 400)
            return
        command = req.get("command", "")
        timeout = req.get("timeout", 30)
        if not command:
            self.send_json({"error": "no command"}, 400)
            return
        self.send_json(run_command(command, timeout))

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    load_dashboard()
    if COMMAND_TOKEN:
        print("[command_endpoint] /command requires X-Sipher-Token", flush=True)
    else:
        print(
            "[command_endpoint] WARNING: SIPHER_COMMAND_TOKEN is unset - /command "
            "accepts private/LAN clients only. Set a token before exposing the port.",
            flush=True,
        )
    server = http.server.HTTPServer(("0.0.0.0", PORT), SipherHandler)
    print(f"[command_endpoint] listening on 0.0.0.0:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[command_endpoint] shutting down", flush=True)
        server.shutdown()

if __name__ == "__main__":
    main()
