"""
pico_bridge.py — Sipher Pico bridge (Layer 2)

Connects to Pico 2 W via USB serial (/dev/ttyACM0, 115200 baud).
Reads JSON sensor lines from Pico, broadcasts to TCP clients.
Accepts commands from TCP clients and forwards to Pico.

Architecture:
  Pico (USB serial) <──> pico_bridge.py (TCP :5000) <──> control/ROS 2/voice

Protocol (JSON lines over TCP):
  Client -> Bridge: {"cmd": "servo", "ch": 0, "deg": 90}
  Bridge -> Pico:   {"cmd": "servo", "ch": 0, "deg": 90}\n
  Pico -> Bridge:   {"mpu":[...], "vl53_mm":1234, ...}
  Bridge -> Client: {"mpu":[...], "vl53_mm":1234, ...}  (broadcast)

Also supports:
  GET /sensor  -> returns latest sensor snapshot (HTTP, for dashboard)
"""

import serial
import json
import threading
import socket
import time
import sys
import os

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PICO_SERIAL = os.environ.get("SIPHER_PICO_SERIAL", "/dev/ttyACM0")
PICO_BAUD = int(os.environ.get("SIPHER_PICO_BAUD", "115200"))
TCP_PORT = int(os.environ.get("SIPHER_BRIDGE_PORT", "5000"))
TCP_HOST = os.environ.get("SIPHER_BRIDGE_HOST", "0.0.0.0")

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
_latest_sensor = {}
_sensor_lock = threading.Lock()
_clients = []  # TCP client sockets
_clients_lock = threading.Lock()
_stdin_buf = b""
_serial = None  # shared serial connection
_serial_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Serial reader — read JSON lines from Pico
# ---------------------------------------------------------------------------
def read_pico():
    """Continuously read JSON lines from Pico serial port."""
    global _stdin_buf, _latest_sensor, _serial
    while True:
        try:
            _serial = serial.Serial(PICO_SERIAL, PICO_BAUD, timeout=2)
            print(f"[bridge] connected to {PICO_SERIAL}@{PICO_BAUD}", flush=True)
            break
        except Exception as e:
            print(f"[bridge] ERROR opening {PICO_SERIAL}: {e}, retrying...", flush=True)
            time.sleep(3)

    # Drain boot noise
    time.sleep(2)
    with _serial_lock:
        _serial.reset_input_buffer()

    # Enable dashboard mode on Pico
    try:
        with _serial_lock:
            _serial.write(json.dumps({"cmd": "dashboard", "interval_ms": 1000}).encode() + b"\n")
        print("[bridge] enabled dashboard mode on Pico", flush=True)
    except Exception as e:
        print(f"[bridge] failed to enable dashboard: {e}", flush=True)

    buf = b""
    while True:
        try:
            # Read all available bytes at once (much faster than byte-by-byte)
            with _serial_lock:
                waiting = _serial.in_waiting
                if waiting > 0:
                    chunk = _serial.read(waiting)
                    buf += chunk
                else:
                    # Small sleep to avoid busy-waiting
                    time.sleep(0.05)
                    continue

            # Process complete lines
            while b'\n' in buf:
                line, buf = buf.split(b'\n', 1)
                line = line.decode().strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                # Update latest sensor snapshot
                with _sensor_lock:
                    _latest_sensor = data
                # Broadcast to all TCP clients
                broadcast(data)
        except serial.SerialException:
            print("[bridge] serial disconnected, reconnecting in 5s...", flush=True)
            time.sleep(5)
            try:
                if _serial and _serial.is_open:
                    _serial.close()
                _serial = serial.Serial(PICO_SERIAL, PICO_BAUD, timeout=2)
                with _serial_lock:
                    _serial.reset_input_buffer()
                print("[bridge] reconnected to serial", flush=True)
            except Exception:
                time.sleep(3)
        except Exception as e:
            print(f"[bridge] read error: {e}", flush=True)
            time.sleep(1)

# ---------------------------------------------------------------------------
# Broadcast to TCP clients
# ---------------------------------------------------------------------------
def broadcast(data):
    """Send JSON data to all connected TCP clients."""
    if not data:
        return
    payload = json.dumps(data) + "\n"
    with _clients_lock:
        dead = []
        for sock in _clients:
            try:
                sock.sendall(payload.encode())
            except Exception:
                dead.append(sock)
        for sock in dead:
            _clients.remove(sock)
            try:
                sock.close()
            except Exception:
                pass

# ---------------------------------------------------------------------------
# TCP server — accept commands from clients
# ---------------------------------------------------------------------------
def tcp_server():
    """Accept TCP connections and forward commands to Pico."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((TCP_HOST, TCP_PORT))
    server.listen(5)
    print(f"[bridge] TCP server listening on {TCP_HOST}:{TCP_PORT}", flush=True)

    while True:
        try:
            sock, addr = server.accept()
            print(f"[bridge] client connected: {addr}", flush=True)
            with _clients_lock:
                _clients.append(sock)
            # Handle client in a thread
            threading.Thread(target=handle_client, args=(sock,), daemon=True).start()
        except Exception as e:
            print(f"[bridge] accept error: {e}", flush=True)
            time.sleep(1)

def handle_client(sock):
    """Read commands from a TCP client and forward to Pico."""
    buf = b""
    try:
        while True:
            ch = sock.recv(1)
            if not ch:
                break
            buf += ch
            if ch == b'\n':
                line = buf.decode().strip()
                buf = b""
                if not line:
                    continue
                try:
                    req = json.loads(line)
                except json.JSONDecodeError:
                    continue
                # Forward to Pico via serial
                forward_to_pico(req)
    except Exception as e:
        print(f"[bridge] client error: {e}", flush=True)
    finally:
        with _clients_lock:
            if sock in _clients:
                _clients.remove(sock)
        try:
            sock.close()
        except Exception:
            pass
        print("[bridge] client disconnected", flush=True)

def forward_to_pico(req):
    """Send a command to the Pico via shared serial connection."""
    global _serial
    try:
        with _serial_lock:
            if _serial and _serial.is_open:
                _serial.write((json.dumps(req) + "\n").encode())
            else:
                print("[bridge] serial not connected, cannot forward", flush=True)
    except Exception as e:
        print(f"[bridge] error forwarding to Pico: {e}", flush=True)

# ---------------------------------------------------------------------------
# HTTP endpoint — for dashboard / simple sensor queries
# ---------------------------------------------------------------------------
def http_handler(conn):
    """Simple HTTP handler for /sensor endpoint."""
    try:
        data = conn.recv(4096).decode()
    except Exception:
        conn.close()
        return
    request_line = data.split("\r\n")[0] if data else ""
    if "GET /sensor" in request_line:
        with _sensor_lock:
            snapshot = dict(_latest_sensor)
        body = json.dumps(snapshot).encode()
        response = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "\r\n"
        )
        conn.sendall(response.encode() + body)
    elif "GET /health" in request_line:
        body = b'{"status":"ok","pico_serial":"' + PICO_SERIAL.encode() + b'"}'
        response = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            "\r\n"
        )
        conn.sendall(response.encode() + body)
    else:
        body = b'{"error":"not found"}'
        response = (
            "HTTP/1.1 404 Not Found\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            "\r\n"
        )
        conn.sendall(response.encode() + body)
    conn.close()

def http_server():
    """Simple HTTP server for /sensor and /health endpoints."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((TCP_HOST, TCP_PORT + 1))  # HTTP on port 5001
    server.listen(5)
    print(f"[bridge] HTTP server listening on {TCP_HOST}:{TCP_PORT + 1}", flush=True)
    while True:
        try:
            conn, addr = server.accept()
            threading.Thread(target=http_handler, args=(conn,), daemon=True).start()
        except Exception as e:
            print(f"[bridge] HTTP accept error: {e}", flush=True)
            time.sleep(1)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print(f"[bridge] starting — Pico={PICO_SERIAL}@{PICO_BAUD}, TCP={TCP_HOST}:{TCP_PORT}", flush=True)

    # Start serial reader
    serial_thread = threading.Thread(target=read_pico, daemon=True)
    serial_thread.start()

    # Start TCP server
    tcp_thread = threading.Thread(target=tcp_server, daemon=True)
    tcp_thread.start()

    # Start HTTP server
    http_thread = threading.Thread(target=http_server, daemon=True)
    http_thread.start()

    # Keep main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[bridge] shutting down", flush=True)

if __name__ == "__main__":
    main()
