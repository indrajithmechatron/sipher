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

import http.server
import json
import subprocess
import threading
import time
import os
import sys
import pathlib
import urllib.request

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PORT = int(os.environ.get("SIPHER_PORT", "8888"))
PICO_SERIAL = os.environ.get("SIPHER_PICO_SERIAL", "/dev/ttyACM0")
PICO_BAUD = int(os.environ.get("SIPHER_PICO_BAUD", "115200"))
REPO_DIR = os.environ.get("SIPHER_REPO_DIR", "/home/sipher/sipher")
BRIDGE_SENSOR_URL = os.environ.get("SIPHER_BRIDGE_SENSOR_URL", "http://localhost:5001/sensor")
BRIDGE_CMD_URL = os.environ.get("SIPHER_BRIDGE_CMD_URL", "http://localhost:5001/api/bridge_cmd")
DASHBOARD_PATH = pathlib.Path(__file__).parent.parent / "dashboard" / "index.html"

# ---------------------------------------------------------------------------
# Sensor data — polled from bridge HTTP endpoint (port 5001)
# ---------------------------------------------------------------------------
_latest_sensor = {}
_sensor_lock = threading.Lock()

def _sensor_poller():
    """Poll bridge /sensor endpoint every 1s for latest snapshot."""
    while True:
        try:
            with urllib.request.urlopen(BRIDGE_SENSOR_URL, timeout=3) as resp:
                data = json.loads(resp.read().decode())
                if data:
                    with _sensor_lock:
                        _latest_sensor.update(data)
        except Exception:
            pass
        time.sleep(1)

def get_latest_sensor():
    with _sensor_lock:
        return dict(_latest_sensor)

_sensor_thread = threading.Thread(target=_sensor_poller, daemon=True)
_sensor_thread.start()

# ---------------------------------------------------------------------------
# Dashboard HTML — loaded from file
# ---------------------------------------------------------------------------
_dashboard_html = None

def load_dashboard():
    global _dashboard_html
    if DASHBOARD_PATH.exists():
        _dashboard_html = DASHBOARD_PATH.read_text(encoding="utf-8")
        print(f"[http] loaded dashboard from {DASHBOARD_PATH}", flush=True)
    else:
        _dashboard_html = "<h1>Dashboard not found</h1><p>Expected at: " + str(DASHBOARD_PATH) + "</p>"
        print(f"[http] WARNING: dashboard not found at {DASHBOARD_PATH}", flush=True)

# ---------------------------------------------------------------------------
# Restricted command execution
# ---------------------------------------------------------------------------
_ALLOWED_PREFIXES = [
    "systemctl ", "git ", "python3 ", "cat /home/sipher/",
    "tailscale ", "cd /home/sipher/sipher && git pull",
]

def is_safe_command(cmd: str) -> bool:
    cmd_clean = cmd.strip().split("\n")[0].strip()
    return any(cmd_clean.startswith(p) for p in _ALLOWED_PREFIXES)

def run_command(cmd: str, timeout: int = 30) -> dict:
    if not is_safe_command(cmd):
        return {"error": f"command not allowed: {cmd[:80]}", "rc": -1}
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout,
            cwd=REPO_DIR,
        )
        return {
            "rc": result.returncode,
            "stdout": result.stdout[-5000:],
            "stderr": result.stderr[-5000:],
        }
    except subprocess.TimeoutExpired:
        return {"error": f"command timed out after {timeout}s", "rc": -1}
    except Exception as e:
        return {"error": str(e), "rc": -1}

# ---------------------------------------------------------------------------
# HTTP Request Handler
# ---------------------------------------------------------------------------
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
        if self.path in ("/", "/dashboard"):
            if _dashboard_html:
                self.send_html(_dashboard_html)
            else:
                self.send_json({"error": "dashboard not loaded"}, 500)
        elif self.path == "/api/sensors":
            self.send_json(get_latest_sensor())
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
            })
        elif self.path == "/health":
            self.send_json({"status": "ok"})
        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path == "/command":
            self.handle_command()
        elif self.path == "/api/bridge_cmd":
            self.handle_bridge_cmd()
        else:
            self.send_json({"error": "not found"}, 404)

    def handle_bridge_cmd(self):
        """Forward a command to the bridge via TCP port 5000."""
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
            sock.settimeout(5)
            sock.connect(("127.0.0.1", 5000))
            sock.sendall((json.dumps(req) + "\n").encode())
            resp = sock.recv(4096).decode()
            sock.close()
            self.send_json(json.loads(resp) if resp.strip() else {"bridge": "ok"})
        except Exception as e:
            self.send_json({"error": f"bridge not reachable: {e}"})

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
        self.send_json(run_command(command, timeout))

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    load_dashboard()
    server = http.server.HTTPServer(("0.0.0.0", PORT), SipherHandler)
    print(f"[command_endpoint] listening on 0.0.0.0:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[command_endpoint] shutting down", flush=True)
        server.shutdown()

if __name__ == "__main__":
    main()
