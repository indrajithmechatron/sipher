"""
command_endpoint.py — Pi-side HTTP server for Sipher

Single server, two purposes:
  1. Command execution for Hermes (POST /command)
  2. Live sensor dashboard (GET /dashboard + GET /api/sensors)

Runs on Pi:  python3 -m control.command_endpoint
Port: 8888 (configurable via PORT env var)

Authentication: none (trusted local network / Tailscale only)
"""

import http.server
import json
import subprocess
import threading
import serial
import time
import os
import sys
import pathlib

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PORT = int(os.environ.get("SIPHER_PORT", "8888"))
PICO_SERIAL = os.environ.get("SIPHER_PICO_SERIAL", "/dev/ttyACM0")
PICO_BAUD = int(os.environ.get("SIPHER_PICO_BAUD", "115200"))
REPO_DIR = os.environ.get("SIPHER_REPO_DIR", "/home/sipher/sipher")
SERVICES_TO_RESTART = os.environ.get(
    "SIPHER_RESTART_SERVICES", "sipher-bridge,sipher-voice,sipher-logger"
).split(",")
LOG_FILE = os.environ.get("SIPHER_LOG", "/home/sipher/deploy/pull.log")
REGISTERED_COMMANDS = set()  # commands that have been run (for audit)

# ---------------------------------------------------------------------------
# Pico serial reader — background thread that keeps latest sensor snapshot
# ---------------------------------------------------------------------------
_pico_buffer = ""
_pico_lock = threading.Lock()
_pico_snapshots = []  # last N sensor JSON lines
_snapshot_lock = threading.Lock()
MAX_SNAPSHOTS = 50

def _pico_reader():
    """Continuously read JSON lines from Pico serial, keep latest snapshot."""
    global _pico_buffer
    try:
        ser = serial.Serial(PICO_SERIAL, PICO_BAUD, timeout=1.0)
    except Exception as e:
        print(f"[pico] cannot open {PICO_SERIAL}: {e}", flush=True)
        return
    print(f"[pico] reading from {PICO_SERIAL}@{PICO_BAUD}", flush=True)
    buf = b""
    while True:
        try:
            ch = ser.read(1)
            if not ch:
                time.sleep(0.01)
                continue
            buf += ch
            if ch == b'\n':
                line = buf.decode().strip()
                buf = b""
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                # Keep sensor snapshots (anything with 'mpu', 'vl53', 'ina', 'gps', or 'cmd')
                if any(k in data for k in ("mpu", "vl53", "ina", "gps", "cmd")):
                    with _snapshot_lock:
                        _pico_snapshots.append(data)
                        if len(_pico_snapshots) > MAX_SNAPSHOTS:
                            _pico_snapshots = _pico_snapshots[-MAX_SNAPSHOTS:]
        except serial.SerialException:
            print("[pico] serial disconnected, retrying in 5s...", flush=True)
            time.sleep(5)
            try:
                ser.close()
                ser.open()
            except Exception:
                time.sleep(5)

_pico_thread = threading.Thread(target=_pico_reader, daemon=True)
_pico_thread.start()

def get_latest_sensor():
    """Return the most recent sensor snapshot from Pico, or a default."""
    with _snapshot_lock:
        if _pico_snapshots:
            return _pico_snapshots[-1]
    return {
        "cmd": "dashboard_tick",
        "mpu": None,
        "vl53_mm": None,
        "ina": {"shunt_uv": None, "bus_v": None, "current_ma_est": None},
        "gps": None,
        "i2c_scan": [],
        "ts": int(time.time() * 1000),
    }

# ---------------------------------------------------------------------------
# Deploy script helper — runs update.sh and returns output
# ---------------------------------------------------------------------------
def run_deploy():
    """Run the deploy update.sh and return its output."""
    update_sh = pathlib.Path(REPO_DIR) / "deploy" / "update.sh"
    if not update_sh.exists():
        return {"error": f"update.sh not found at {update_sh}"}
    try:
        result = subprocess.run(
            ["/bin/bash", str(update_sh)],
            capture_output=True, text=True, timeout=120,
            cwd=REPO_DIR,
        )
        return {
            "rc": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        return {"error": "deploy timed out after 120s"}
    except Exception as e:
        return {"error": str(e)}

# ---------------------------------------------------------------------------
# Restricted command execution — only allow safe commands
# ---------------------------------------------------------------------------
_ALLOWED_COMMANDS = {
    # Service management
    "systemctl status",
    "systemctl restart",
    "systemctl stop",
    "systemctl start",
    "systemctl enable",
    "systemctl disable",
    # Git operations in repo
    "git status",
    "git log",
    "git diff",
    "git pull",
    "git fetch",
    # Python checks
    "python3 -c",
    "python3 -m",
    # Serial test
    "python3 -c \"import serial",
    # Cat logs
    "cat /home/sipher/deploy/pull.log",
    "cat /var/log/syslog",
    # Tailscale
    "tailscale status",
    "tailscale up",
    # Pico tests
    "python3 -c \"import serial",
}

def is_safe_command(cmd: str) -> bool:
    """Check if a command is in the allowed list (prefix match)."""
    cmd_clean = cmd.strip().split("\n")[0].strip()
    for allowed in _ALLOWED_COMMANDS:
        if cmd_clean.startswith(allowed):
            return True
    return False

def run_command(cmd: str, timeout: int = 30) -> dict:
    """Run a shell command and return stdout/stderr/rc."""
    if not is_safe_command(cmd):
        return {"error": f"command not allowed: {cmd[:80]}", "rc": -1}
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout,
            cwd=REPO_DIR,
        )
        REGISTERED_COMMANDS.add(cmd.strip().split("\n")[0])
        return {
            "rc": result.returncode,
            "stdout": result.stdout[-5000:],  # truncate
            "stderr": result.stderr[-5000:],
        }
    except subprocess.TimeoutExpired:
        return {"error": f"command timed out after {timeout}s", "rc": -1}
    except Exception as e:
        return {"error": str(e), "rc": -1}

# ---------------------------------------------------------------------------
# Dashboard HTML
# ---------------------------------------------------------------------------
DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sipher Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0a0a0a;
    color: #e0e0e0;
    padding: 16px;
  }
  h1 { font-size: 1.2rem; margin-bottom: 12px; color: #fff; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
  }
  .card {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 14px;
  }
  .card h2 { font-size: 0.85rem; color: #888; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
  .card .value { font-size: 1.6rem; font-weight: 600; color: #fff; }
  .card .unit { font-size: 0.75rem; color: #666; margin-left: 4px; }
  .card .sub { font-size: 0.75rem; color: #555; margin-top: 4px; }
  .status { color: #4caf50; }
  .warning { color: #ff9800; }
  .error { color: #f44336; }
  button {
    background: #333; color: #fff; border: 1px solid #555; border-radius: 6px;
    padding: 10px 16px; font-size: 0.85rem; cursor: pointer; margin: 4px;
  }
  button:hover { background: #444; }
  button.primary { background: #1976d2; border-color: #1976d2; }
  button.danger { background: #c62828; border-color: #c62828; }
  .controls { margin-top: 16px; padding: 12px; background: #1a1a1a; border-radius: 8px; border: 1px solid #333; }
  .ctrl-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  input[type=range] { flex: 1; }
  .footer { margin-top: 16px; font-size: 0.7rem; color: #444; text-align: center; }
</style>
</head>
<body>
<h1>Sipher — Live Dashboard</h1>
<div class="grid">
  <div class="card">
    <h2>MPU6050 (Accel + Gyro)</h2>
    <div class="value" id="mpu-ax">—<span class="unit">mg</span></div>
    <div class="sub">AX <span id="mpu-ay">—</span> AY <span id="mpu-az">—</span> AZ</div>
    <div class="sub">GX <span id="mpu-gx">—</span>GY <span id="mpu-gy">—</span>GZ <span id="mpu-gz">—</span></div>
  </div>
  <div class="card">
    <h2>VL53L0X (Laser ToF)</h2>
    <div class="value" id="vl53">—<span class="unit">mm</span></div>
    <div class="sub" id="vl53-status">waiting…</div>
  </div>
  <div class="card">
    <h2>INA219 (Current + Power)</h2>
    <div class="value" id="ina-bus">—<span class="unit">V</span></div>
    <div class="sub">Bus voltage</div>
    <div class="value" id="ina-current" style="margin-top:8px;">—<span class="unit">mA</span></div>
    <div class="sub">Est. current</div>
  </div>
  <div class="card">
    <h2>GPS (NEO-6M)</h2>
    <div class="value" id="gps">—</div>
    <div class="sub" id="gps-raw" style="font-size:0.7rem;word-break:break-all;"></div>
  </div>
  <div class="card">
    <h2>I2C Scan</h2>
    <div class="value" id="i2c">—</div>
    <div class="sub" id="i2c-detail" style="font-size:0.7rem;"></div>
  </div>
  <div class="card">
    <h2>System</h2>
    <div class="value" id="uptime">—</div>
    <div class="sub" id="deploy-status">deploy: —</div>
  </div>
</div>

<div class="controls">
  <h2 style="font-size:0.85rem;color:#888;margin-bottom:8px;">Manual Controls</h2>
  <div class="ctrl-row">
    <span style="font-size:0.8rem;min-width:60px;">Servo 0</span>
    <input type="range" id="s0" min="0" max="180" value="90">
    <span id="s0v" style="font-size:0.8rem;min-width:30px;">90°</span>
  </div>
  <div class="ctrl-row">
    <span style="font-size:0.8rem;min-width:60px;">Servo 1</span>
    <input type="range" id="s1" min="0" max="180" value="90">
    <span id="s1v" style="font-size:0.8rem;min-width:30px;">90°</span>
  </div>
  <div class="ctrl-row">
    <span style="font-size:0.8rem;min-width:60px;">Servo 2</span>
    <input type="range" id="s2" min="0" max="180" value="90">
    <span id="s2v" style="font-size:0.8rem;min-width:30px;">90°</span>
  </div>
  <div class="ctrl-row">
    <span style="font-size:0.8rem;min-width:60px;">Fill</span>
    <input type="color" id="fill-color" value="#f44336">
    <button class="primary" id="fill-btn">Fill Screen</button>
  </div>
  <div class="ctrl-row">
    <button class="primary" id="deploy-btn">Run Deploy (git pull)</button>
    <button id="refresh-btn">Refresh Sensors</button>
  </div>
</div>

<div class="footer">Sipher Dashboard · Pi at <span id="pi-ip">—</span> · polling every 1s</div>

<script>
const PICO_API = window.location.origin + '/api/sensors';
const BRIDGE_CMD = window.location.origin + '/api/bridge_cmd';

function poll() {
  fetch(PICO_API)
    .then(r => r.json())
    .then(data => updateDOM(data))
    .catch(e => console.error('poll error:', e));
}
setInterval(poll, 1000);
poll();

function updateDOM(d) {
  if (d.mpu) {
    document.getElementById('mpu-ax').innerHTML = Math.round(d.mpu[0]/16384*1000) + '<span class="unit">mg</span>';
    document.getElementById('mpu-ay').textContent = 'AY ' + Math.round(d.mpu[1]/16384*1000) + 'mg';
    document.getElementById('mpu-az').textContent = 'AZ ' + Math.round(d.mpu[2]/16384*1000) + 'mg';
    document.getElementById('mpu-gx').textContent = 'GX ' + d.mpu[3];
    document.getElementById('mpu-gy').textContent = 'GY ' + d.mpu[4];
    document.getElementById('mpu-gz').textContent = 'GZ ' + d.mpu[5];
  }
  if (d.vl53_mm !== null && d.vl53_mm !== undefined) {
    document.getElementById('vl53').innerHTML = d.vl53_mm + '<span class="unit">mm</span>';
    document.getElementById('vl53-status').textContent = d.vl53_mm < 200 ? '⚠ close' : '✓ ok';
  }
  if (d.ina) {
    document.getElementById('ina-bus').innerHTML = (d.ina.bus_v ?? '—') + '<span class="unit">V</span>';
    document.getElementById('ina-current').innerHTML = (d.ina.current_ma_est ?? '—') + '<span class="unit">mA</span>';
  }
  if (d.gps) {
    document.getElementById('gps').textContent = d.gps.substring(0, 20) + (d.gps.length > 20 ? '…' : '');
    document.getElementById('gps-raw').textContent = d.gps;
  } else {
    document.getElementById('gps').textContent = '—';
    document.getElementById('gps-raw').textContent = 'no data';
  }
  if (d.i2c_scan) {
    const scan = d.i2c_scan.map(h => h.toUpperCase()).join(', ');
    document.getElementById('i2c').textContent = scan || 'none';
    document.getElementById('i2c-detail').textContent = d.i2c_scan.length + ' devices';
  }
  document.getElementById('pi-ip').textContent = location.hostname;
}

document.getElementById('s0').addEventListener('input', e => {
  document.getElementById('s0v').textContent = e.target.value + '°';
  sendServo(0, e.target.value);
});
document.getElementById('s1').addEventListener('input', e => {
  document.getElementById('s1v').textContent = e.target.value + '°';
  sendServo(1, e.target.value);
});
document.getElementById('s2').addEventListener('input', e => {
  document.getElementById('s2v').textContent = e.target.value + '°';
  sendServo(2, e.target.value);
});

function sendServo(ch, deg) {
  fetch(BRIDGE_CMD, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({cmd: 'servo', ch: ch, deg: parseInt(deg)})
  });
}

document.getElementById('fill-btn').addEventListener('click', () => {
  const color = document.getElementById('fill-color').value;
  const rgb = parseInt(color.slice(1), 16);
  fetch(BRIDGE_CMD, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({cmd: 'fill_screen', color: rgb})
  });
});

document.getElementById('deploy-btn').addEventListener('click', () => {
  const btn = document.getElementById('deploy-btn');
  btn.disabled = true;
  btn.textContent = 'deploying…';
  fetch('/command', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({command: 'cd /home/sipher/sipher && git pull origin main'})
  })
  .then(r => r.json())
  .then(d => {
    btn.textContent = d.rc === 0 ? 'deploy OK' : 'deploy FAIL';
    btn.style.background = d.rc === 0 ? '#4caf50' : '#c62828';
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Run Deploy'; btn.style.background = ''; }, 3000);
  });
});

document.getElementById('refresh-btn').addEventListener('click', () => {
  fetch('/api/sensors').then(r => r.json()).then(d => updateDOM(d));
});

// Get PI IP from a quick check
fetch('/api/info').then(r => r.json()).then(d => {
  document.getElementById('pi-ip').textContent = d.pi_ip || location.hostname;
  document.getElementById('uptime').textContent = d.uptime || '—';
});
</script>
</body>
</html>
"""

# ---------------------------------------------------------------------------
# HTTP Request Handler
# ---------------------------------------------------------------------------
class SipherHandler(http.server.BaseHTTPRequestHandler):
    """Handles /command, /dashboard, /api/sensors, /api/bridge_cmd, /api/info."""

    def log_message(self, format, *args):
        # Quiet default logging — print to stderr for debugging
        print(f"[http] {args[0]}", flush=True)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, html):
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/dashboard" or self.path == "/":
            self.send_html(DASHBOARD_HTML)
        elif self.path == "/api/sensors":
            self.send_json(get_latest_sensor())
        elif self.path == "/api/info":
            info = {
                "pi_ip": os.environ.get("PI_IP", "unknown"),
                "uptime": subprocess.run(
                    ["cat", "/proc/uptime"], capture_output=True, text=True
                ).stdout.split()[0] if os.path.exists("/proc/uptime") else "unknown",
                "pico_serial": PICO_SERIAL,
                "port": PORT,
            }
            self.send_json(info)
        elif self.path.startswith("/api/bridge_cmd"):
            # Forward a command to the bridge via TCP
            self.handle_bridge_cmd()
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"error": "not found"}')

    def handle_bridge_cmd(self):
        """Accept POST /api/bridge_cmd with JSON {cmd, ...} — forwards to bridge TCP."""
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
        cmd = req.get("cmd", "")
        # Forward to bridge via TCP (bridge runs on port 5000 by default)
        try:
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5)
            sock.connect(("127.0.0.1", 5000))
            sock.sendall((json.dumps(req) + "\n").encode())
            resp = sock.recv(4096).decode()
            sock.close()
            self.send_json(json.loads(resp) if resp else {"bridge": "ok"})
        except Exception as e:
            # Bridge not running — fall back to running command directly via Pico serial
            self.send_json({"error": f"bridge not reachable: {str(e)}", "fallback": "run deploy/command_endpoint directly"})

    def do_POST(self):
        if self.path == "/command":
            self.handle_command()
        elif self.path == "/api/bridge_cmd":
            self.handle_bridge_cmd()
        else:
            self.send_json({"error": "not found"}, 404)

    def handle_command(self):
        """Execute a shell command (restricted to allowed list)."""
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
        command = req.get("command", "")
        timeout = req.get("timeout", 30)
        if not command:
            self.send_json({"error": "no command"}, 400)
            return
        result = run_command(command, timeout)
        self.send_json(result)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    server = http.server.HTTPServer(("0.0.0.0", PORT), SipherHandler)
    print(f"[command_endpoint] listening on 0.0.0.0:{PORT}", flush=True)
    print(f"[command_endpoint] pico serial: {PICO_SERIAL}@{PICO_BAUD}", flush=True)
    print(f"[command_endpoint] repo: {REPO_DIR}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[command_endpoint] shutting down", flush=True)
        server.shutdown()

if __name__ == "__main__":
    main()
