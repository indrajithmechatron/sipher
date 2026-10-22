#!/usr/bin/env python3
"""Sipher Layer-1 instincts: flinch, balance reaction, battery guard, idle life.

Runs on the Pi as sipher-instincts.service. Talks to the Pico only through
pico_bridge (TCP :5000 commands, HTTP :5001 sensor/map) — never the serial
port directly. Stdlib only.

Safety governor (non-negotiable):
  * WHITELIST channels only (0, 1, 14, 15). Anything else is dropped + logged.
  * Angles clamped to 30..150 deg.
  * Battery floor: below FLOOR -> relax_all + stop mapper + go DORMANT until
    voltage recovers past RESUME. Nothing moves while dormant.
  * Staleness: bridge/poll unhealthy for >3 s -> stop commanding (hold).
  * E-stop latch: GET /estop (relax + freeze until /clear). Always wins.

Test hooks (env): SIPHER_FLINCH_MM, SIPHER_BATT_FLOOR, SIPHER_BATT_RESUME.
"""

import json
import os
import socket
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BRIDGE_TCP = ("127.0.0.1", 5000)
SENSOR_URL = "http://127.0.0.1:5001/sensor"
HEALTH_URL = "http://127.0.0.1:5001/health"
MAP_URL = "http://127.0.0.1:5001/map?action=stop"
ESTOP_PORT = 8899

WHITELIST = (0, 1, 14, 15)
ANGLE_LO, ANGLE_HI = 30, 150
POLL_HZ = 10.0
STALE_S = 3.0

FLINCH_MM = int(os.environ.get("SIPHER_FLINCH_MM", "300"))
FLINCH_CLOSE_MM = 60
FLINCH_COOLDOWN_S = 5.0
TILT_DEG = 22.0
TILT_DELTA_DEG = 14.0
TILT_COOLDOWN_S = 6.0
IDLE_S = 25.0

BATT_FLOOR_V = float(os.environ.get("SIPHER_BATT_FLOOR", "7.2"))
BATT_RESUME_V = float(os.environ.get("SIPHER_BATT_RESUME", "7.8"))

HOME = {0: 90, 1: 90, 14: 90, 15: 90}
FLINCH_POSE = {0: 60, 1: 115, 14: 60, 15: 120}
BRACE_POSE = {0: 90, 1: 110, 14: 90, 15: 90}


def log(msg):
    print(f"[instincts {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def clamp_deg(d):
    return max(ANGLE_LO, min(ANGLE_HI, int(d)))


def pitch_roll(mpu):
    try:
        ax, ay, az = mpu[0], mpu[1], mpu[2]
        import math
        pitch = math.atan2(ay, math.sqrt(ax * ax + az * az)) * 180.0 / math.pi
        roll = math.atan2(-ax, math.sqrt(ay * ay + az * az)) * 180.0 / math.pi
        return pitch, roll
    except Exception:
        return 0.0, 0.0


class Instincts:
    def __init__(self):
        self.estop = False
        self.dormant = False
        self.last_event = time.monotonic()
        self.last_flinch = 0.0
        self.last_brace = 0.0
        self.last_dist = None
        self.last_pr = (0.0, 0.0)
        self.last_ok = time.monotonic()
        self.lock = threading.Lock()

    # ---- IO ----
    def fetch(self, url, timeout=3):
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode())

    def send_pico(self, req):
        """Fire one command at the Pico via the bridge. Returns True if the
        bridge accepted it (ack). The Pico itself replies nothing usable."""
        try:
            s = socket.create_connection(BRIDGE_TCP, timeout=3)
            s.settimeout(3)
            s.sendall((json.dumps(req) + "\n").encode())
            ack = b""
            try:
                while not ack.endswith(b"\n"):
                    chunk = s.recv(256)
                    if not chunk:
                        break
                    ack += chunk
            except socket.timeout:
                pass
            s.close()
            return b"bridge_ack" in ack
        except Exception as e:
            log(f"bridge-cmd failed: {e}")
            return False

    def pose(self, mapping, why):
        """Drive whitelisted channels to a pose dict. Returns True if sent."""
        with self.lock:
            if self.estop:
                log(f"blocked [{why}]: e-stop latched")
                return False
            if self.dormant:
                log(f"blocked [{why}]: dormant (battery)")
                return False
        positions = [None] * 16
        for ch, deg in mapping.items():
            if ch not in WHITELIST:
                log(f"blocked [{why}]: ch{ch} not whitelisted")
                return False
            positions[ch] = clamp_deg(deg)
        ok = self.send_pico({"cmd": "servos", "positions": positions})
        log(f"pose [{why}] {mapping} -> {'sent' if ok else 'FAILED'}")
        if ok:
            self.last_event = time.monotonic()
        return ok

    def relax(self, why):
        with self.lock:
            if self.estop and why != "e-stop":
                return False
        ok = self.send_pico({"cmd": "relax_all"})
        log(f"relax [{why}] -> {'sent' if ok else 'FAILED'}")
        return ok

    # ---- events ----
    def on_flinch(self, dist):
        now = time.monotonic()
        if now - self.last_flinch < FLINCH_COOLDOWN_S:
            return
        self.last_flinch = now
        log(f"FLINCH dist={dist}mm")
        self.pose(FLINCH_POSE, "flinch-recoil")
        time.sleep(0.4)
        self.pose(HOME, "flinch-return")

    def on_brace(self, pitch, roll):
        now = time.monotonic()
        if now - self.last_brace < TILT_COOLDOWN_S:
            return
        self.last_brace = now
        log(f"BRACE pitch={pitch:.1f} roll={roll:.1f}")
        self.pose(BRACE_POSE, "brace")
        time.sleep(0.6)
        self.pose(HOME, "brace-return")

    def on_idle(self):
        self.last_event = time.monotonic()
        log("IDLE look-around")
        self.pose({0: 90, 1: 90, 14: 60, 15: 120}, "idle-look")
        time.sleep(1.0)
        self.pose(HOME, "idle-return")

    def on_low_batt(self, v):
        log(f"BATTERY {v:.2f}V < floor {BATT_FLOOR_V}V -> dormant")
        try:
            urllib.request.urlopen(MAP_URL, timeout=3).read()
            log("mapper stopped")
        except Exception as e:
            log(f"mapper stop failed: {e}")
        self.relax("battery-guard")
        self.dormant = True

    def on_recover(self, v):
        log(f"BATTERY {v:.2f}V > resume {BATT_RESUME_V}V -> awake")
        self.dormant = False
        self.pose(HOME, "wake-park")

    # ---- main loop ----
    def tick(self, s):
        now = time.monotonic()
        with self.lock:
            estop = self.estop
        if estop:
            return
        ina = s.get("ina") or {}
        v = ina.get("voltage_v")
        if v is not None:
            if not self.dormant and v < BATT_FLOOR_V:
                self.on_low_batt(v)
                return
            if self.dormant and v > BATT_RESUME_V:
                self.on_recover(v)
                return
            if self.dormant:
                return

        dist = s.get("vl53_mm")
        if isinstance(dist, (int, float)) and 0 < dist < 4000:
            if self.last_dist is not None and dist < FLINCH_MM \
                    and (self.last_dist - dist) > FLINCH_CLOSE_MM:
                self.on_flinch(int(dist))
            self.last_dist = dist

        pitch, roll = pitch_roll(s.get("mpu") or [])
        lp, lr = self.last_pr
        if abs(pitch) > TILT_DEG or abs(roll) > TILT_DEG \
                or abs(pitch - lp) > TILT_DELTA_DEG \
                or abs(roll - lr) > TILT_DELTA_DEG:
            self.on_brace(pitch, roll)
        self.last_pr = (pitch, roll)

        if now - self.last_event > IDLE_S:
            self.on_idle()

    def run(self):
        log(f"start flinch<{FLINCH_MM}mm tilt>{TILT_DEG}deg "
            f"batt<{BATT_FLOOR_V}/{BATT_RESUME_V}V whitelist={list(WHITELIST)}")
        period = 1.0 / POLL_HZ
        while True:
            try:
                s = self.fetch(SENSOR_URL)
                h = None
                try:
                    h = self.fetch(HEALTH_URL)
                except Exception:
                    pass
                pico_ok = bool((h or {}).get("pico", True))
                if s is not None and pico_ok:
                    self.last_ok = time.monotonic()
                    self.tick(s)
                else:
                    if time.monotonic() - self.last_ok > STALE_S:
                        log("stale link >3s: holding (no motion)")
            except Exception as e:
                if time.monotonic() - self.last_ok > STALE_S:
                    log(f"poll fault + stale: {e}")
            time.sleep(period)


class Handler(BaseHTTPRequestHandler):
    brain = None

    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        b = Handler.brain
        if self.path == "/estop":
            with b.lock:
                b.estop = True
            b.relax("e-stop")
            self._json({"estop": True})
        elif self.path == "/clear":
            with b.lock:
                b.estop = False
            b.pose(HOME, "estop-clear")
            self._json({"estop": False})
        else:
            with b.lock:
                estop, dormant = b.estop, b.dormant
            self._json({"estop": estop, "dormant": dormant,
                        "idle_s": round(time.monotonic() - b.last_event, 1)})

    def log_message(self, *a):
        pass


def main():
    brain = Instincts()
    Handler.brain = brain
    srv = ThreadingHTTPServer(("127.0.0.1", ESTOP_PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    log(f"e-stop on 127.0.0.1:{ESTOP_PORT} (/estop /clear)")
    brain.run()


if __name__ == "__main__":
    main()
