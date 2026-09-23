#!/usr/bin/env python3
# pi_logger.py — sipher Pi 4 logs Pico JSON by subscribing to the bridge TCP stream
# The bridge (robot.pico_bridge) owns /dev/ttyACM0. Never open the serial port here.
# Run on sipher@192.168.1.35: python3 pi_logger.py
import socket, time, pathlib, os

HOST = os.environ.get("SIPHER_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("SIPHER_BRIDGE_PORT", "5000"))
log = pathlib.Path(os.environ.get("SIPHER_LOG_FILE", "/home/sipher/sipher.log"))

print(f"Logging bridge TCP {HOST}:{PORT} → {log}")
while True:
    try:
        s = socket.create_connection((HOST, PORT), timeout=5)
        print(f"Connected to bridge at {HOST}:{PORT}")
        s.settimeout(None)
        buf = b""
        while True:
            ch = s.recv(1)
            if not ch:
                print("Bridge closed, reconnecting in 5s...")
                time.sleep(5)
                break
            buf += ch
            if ch == b"\n":
                l = buf.decode(errors="ignore").strip()
                buf = b""
                if l:
                    print(l)
                    with log.open("a") as f:
                        f.write(l + "\n")
    except Exception as e:
        print(f"Bridge connection error: {e}, retrying in 5s...")
        time.sleep(5)