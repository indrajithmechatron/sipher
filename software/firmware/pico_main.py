"""
pico_main.py — Sipher Pico 2 W unified firmware
Hardware:
  I2C1  GP2=SDA GP3=SCL  (MPU6050@0x68, VL53L0X@0x29, INA219@0x41, PCA9685@0x40)
  UART0 GP0=TX  GP1=RX    (NEO-6M GPS 9600 baud)
  SPI0  GP16=CS GP17=SCK GP18=MOSI GP19=MISO  (ILI9341 TFT, GP20=reset)
  USB   CDC port → /dev/ttyACM0 on Pi (115200)
Commands from Pi (single JSON line over USB-CDC, newline-terminated):
  {"cmd":"scan"}               → I2C device scan
  {"cmd":"sensors"}            → all sensor readings as JSON
  {"cmd":"servo","ch":0,"deg":90}  → set one PCA9685 channel
  {"cmd":"servos","positions":[...72...]}  → set 12 channels
  {"cmd":"fill_screen","color":0xF800}   → solid color (RGB565 int)
  {"cmd":"line","x0":0,"y0":0,"x1":319,"y1":239,"color":0xFFFF}
  {"cmd":"rect","x":10,"y":10,"w":100,"h":50,"color":0x07E0}
  {"cmd":"circle","x":160,"y":120,"r":40,"color":0x001F}
  {"cmd":"text","x":10,"y":10,"text":"Hello","color":0xFFFF,"size":1}
  {"cmd":"clear"}
  {"cmd":"dashboard","interval_ms":1000}  → start/stop live dashboard loop
  {"cmd":"ping"}              → {"cmd":"pong","t":<ms>}
  {"cmd":"time","set":1763640000}  → set RTC from Pi
  {"cmd":"time"}              → {"cmd":"time","t":<unix>,"hms":"HH:MM:SS"}
  {"cmd":"status"}            → firmware version + uptime
  {"cmd":"led","on":true}     → onboard LED
  Any other JSON travels to GPS parser and is echoed back (passthrough)
"""
import machine, time, struct, sys

# ---------------------------------------------------------------------------
# Hardware init
# ---------------------------------------------------------------------------
i2c = machine.I2C(1, sda=machine.Pin(2), scl=machine.Pin(3), freq=100_000)
uart = machine.UART(0, baudrate=9600, tx=machine.Pin(0), rx=machine.Pin(1))

# Onboard LED (GP25 on Pico 2 W — varies by board, safe try)
try:
    led = machine.Pin(25, machine.Pin.OUT)
except Exception:
    led = None

# Onboard flash LED (Pico 2 W specific) if GP25 not available
try:
    if led is None:
        led = machine.Pin(25, machine.Pin.OUT)
except Exception:
    pass

# ---------------------------------------------------------------------------
# PCA9685 — 12-channel servo driver at I2C 0x40
# A0 is NOT soldered for INA219 (that's 0x41); PCA stays at 0x40
# ---------------------------------------------------------------------------
PCA_ADDR = 0x40
_pca_sleep = machine.I2C(1)  # reuse i2c bus via the global
try:
    i2c.writeto_mem(PCA_ADDR, 0x00, b'\x10')  # sleep mode
    time.sleep_ms(5)
    i2c.writeto_mem(PCA_ADDR, 0xFE, bytes([121]))  # prescale for 50 Hz
    i2c.writeto_mem(PCA_ADDR, 0x00, b'\x80')  # wake up
    time.sleep_ms(5)
except Exception:
    pass

def pca_set_channel(ch, pulse_us):
    """Set PCA9685 channel to a pulse width in microseconds (50 Hz ≈ 20000 us period)."""
    try:
        # 12-bit value: pulse_us / 20000 * 4096
        val = int(pulse_us / 20000.0 * 4096) & 0xFFF
        addr = 0x06 + ch * 2  # channel n on-time LSB
        lo = val & 0xFF
        hi = (val >> 8) & 0xFF
        i2c.writeto_mem(PCA_ADDR, addr, bytes([lo]))
        i2c.writeto_mem(PCA_ADDR, addr + 1, bytes([hi]))
    except Exception:
        pass

def pca_set_servos(positions):
    """positions: list of 12 values (degrees 0-180 or pulse_us)."""
    for ch, pos in enumerate(positions[:12]):
        if isinstance(pos, (int, float)):
            if pos > 500:  # assume microseconds
                pca_set_channel(ch, pos)
            else:  # assume degrees, map 0-180 → 500-2500 us
                us = int(500 + (pos / 180.0) * 2000)
                pca_set_channel(ch, us)

# ---------------------------------------------------------------------------
# MPU6050
# ---------------------------------------------------------------------------
def mpu_wake():
    try:
        i2c.writeto_mem(0x68, 0x6B, b'\x00')
        time.sleep_ms(100)
    except Exception:
        pass

def read_mpu():
    """Returns (ax, ay, az, gx, gy, gz) in raw units or None."""
    try:
        d = i2c.readfrom_mem(0x68, 0x3B, 14)
        ax, ay, az = struct.unpack(">hhh", d[0:6])
        gx, gy, gz = struct.unpack(">hhh", d[8:14])
        return (ax, ay, az, gx, gy, gz)
    except Exception:
        return None

# ---------------------------------------------------------------------------
# VL53L0X (placeholder — real driver needs proper init sequence)
# ---------------------------------------------------------------------------
def read_vl53():
    """Returns distance in mm or None. This is a best-effort read."""
    try:
        # Basic range reading — may need proper VL53 init for accurate results
        i2c.writeto_mem(0x29, 0x00, b'\x00')  # reset
        time.sleep_ms(10)
        i2c.writeto_mem(0x29, 0x00, b'\x01')  # boot
        time.sleep_ms(10)
        i2c.writeto_mem(0x29, 0x00, b'\x00')  # go active
        time.sleep_ms(5)
        d = i2c.readfrom_mem(0x29, 0x14, 2)
        return (d[0] << 8 | d[1])
    except Exception:
        return None

# ---------------------------------------------------------------------------
# INA219 at 0x41 (A0 soldered)
# ---------------------------------------------------------------------------
def read_ina():
    """Returns (shunt_voltage_uv, bus_voltage_v, current_ma) or None."""
    try:
        raw = i2c.readfrom_mem(0x41, 0x02, 2)
        shunt_uv = int.from_bytes(raw, "big") * 4  # 4 uV per bit
        raw_bus = i2c.readfrom_mem(0x41, 0x00, 2)
        bus_v = (int.from_bytes(raw_bus, "big") >> 3) * 0.004  # 4 mV per bit
        # Current: not reading full config for now, return shunt as proxy
        return (shunt_uv, round(bus_v, 3), round(shunt_uv / 100.0, 2))  # rough current est
    except Exception:
        return None

# ---------------------------------------------------------------------------
# GPS — NEO-6M via UART0
# ---------------------------------------------------------------------------
def read_gps():
    """Returns last NMEA line or None."""
    try:
        if uart.any():
            line = uart.readline()
            if line:
                return line.decode().strip()
    except Exception:
        pass
    return None

# ---------------------------------------------------------------------------
# TFT — ILI9341 via SPI0, actual pins per boot_logo.py/ili9341.py
#   SCK=GP18, MOSI=GP19, MISO=GP16, CS=GP17, DC=GP4, RST=GP5
# ---------------------------------------------------------------------------
_TFT_CS = machine.Pin(17, machine.Pin.OUT)
_TFT_RST = machine.Pin(5, machine.Pin.OUT)
_TFT_DC = machine.Pin(4, machine.Pin.OUT)
_TFT_SPI = None  # lazy init inside tft_init()

def _tft_init_spi():
    global _TFT_SPI
    if _TFT_SPI is not None:
        return _TFT_SPI
    try:
        _TFT_SPI = machine.SPI(0, baudrate=40_000_000, polarity=0, phase=0,
                                sck=machine.Pin(18), mosi=machine.Pin(19),
                                miso=machine.Pin(16))
    except Exception as e:
        print(f"[pico] SPI init error: {e}", flush=True)
        _TFT_SPI = None
    return _TFT_SPI

def _tft_cmd(c):
    spi = _tft_init_spi()
    if spi is None:
        return
    _TFT_CS.value(0)
    _TFT_DC.value(0)
    spi.write(bytes([c & 0xFF]))
    _TFT_CS.value(1)

def _tft_data(d):
    spi = _tft_init_spi()
    if spi is None:
        return
    _TFT_CS.value(0)
    _TFT_DC.value(1)
    spi.write(d)
    _TFT_CS.value(1)

def tft_init():
    """Initialize TFT. Returns True/False. Must be called after boot_logo."""
    print("[pico] tft_init start", flush=True)
    try:
        _TFT_RST.value(0)
        time.sleep_ms(10)
        _TFT_RST.value(1)
        time.sleep_ms(10)
        _tft_cmd(0x28)  # display off
        _tft_cmd(0x11)  # sleep out
        time.sleep_ms(120)
        _tft_cmd(0x3A); _tft_data(b'\x55')  # 16-bit pixel
        _tft_cmd(0x36); _tft_data(b'\x00')  # MIPI RGB
        _tft_cmd(0x29)  # display on
        time.sleep_ms(50)
        print("[pico] tft_init OK", flush=True)
        return True
    except Exception as e:
        print(f"[pico] tft_init FAIL: {e}", flush=True)
        return False

def tft_fill(color):
    spi = _tft_init_spi()
    if spi is None:
        return
    _TFT_CS.value(0)
    _TFT_DC.value(0)
    _tft_cmd(0x2A); _tft_data(bytes([0, 0, 0x01, 0x3F]))
    _tft_cmd(0x2B); _tft_data(bytes([0, 0, 0x00, 0xDF]))
    _tft_cmd(0x2C)
    pixel = struct.pack(">H", color & 0xFFFF)
    for _ in range(320 * 240):
        spi.write(pixel)
    _TFT_CS.value(1)

def tft_set_pixel(x, y, color):
    spi = _tft_init_spi()
    if spi is None:
        return
    _TFT_CS.value(0)
    _TFT_DC.value(0)
    _tft_cmd(0x2A); _tft_data(bytes([x >> 8, x & 0xFF, x >> 8, x & 0xFF]))
    _tft_cmd(0x2B); _tft_data(bytes([y >> 8, y & 0xFF, y >> 8, y & 0xFF]))
    _tft_cmd(0x2C)
    _TFT_DC.value(1)
    spi.write(struct.pack(">H", color & 0xFFFF))
    _TFT_CS.value(1)

def tft_clear():
    tft_fill(0x0000)

def tft_text(x, y, text, color=0xFFFF, size=1):
    for ch in str(text):
        cw = 6 * size
        for dy in range(8 * size):
            for dx in range(cw):
                if (dx < cw // 2) and (dy < 8 * size):
                    tft_set_pixel(x + dx, y + dy, color)
        x += cw + 1

# ---------------------------------------------------------------------------
# RTC / Time — set from Pi, report back
# ---------------------------------------------------------------------------
_rtc = machine.RTC()
_epoch_offset = 0  # updated when Pi sends time

def rtc_set(unix_ts):
    """Set RTC from Unix timestamp."""
    global _epoch_offset
    _epoch_offset = int(unix_ts) - time.time()
    t = time.gmtime(int(unix_ts))
    _rtc.datetime((t[0], t[1], t[2], t[6] + 1, t[3], t[4], t[5], 0))

def rtc_now():
    """Return current Unix timestamp."""
    return int(time.time()) + _epoch_offset

# ---------------------------------------------------------------------------
# Command dispatch
# ---------------------------------------------------------------------------
import json as _json

def cmd_scan():
    try:
        return {"scan": [hex(x) for x in i2c.scan()]}
    except Exception as e:
        return {"error": str(e)}

def cmd_sensors():
    mpu = read_mpu()
    vl = read_vl53()
    ina = read_ina()
    gps = read_gps()
    return {
        "mpu": list(mpu) if mpu else None,
        "vl53_mm": vl,
        "ina": {"shunt_uv": ina[0] if ina else None,
                "bus_v": ina[1] if ina else None,
                "current_ma_est": ina[2] if ina else None},
        "gps": gps,
        "i2c_scan": [hex(x) for x in i2c.scan()]
    }

def cmd_servo(ch, deg):
    pca_set_servos([0]*ch + [deg] + [0]*(11-ch))
    return {"servo": {"ch": ch, "deg": deg}}

def cmd_servos(positions):
    pca_set_servos(positions)
    return {"servos": "ok"}

def cmd_fill_screen(color):
    tft_fill(color)
    return {"fill_screen": hex(color)}

def cmd_line(x0, y0, x1, y1, color):
    tft_line(x0, y0, x1, y1, color)
    return {"line": "ok"}

def cmd_rect(x, y, w, h, color):
    tft_rect(x, y, w, h, color)
    return {"rect": "ok"}

def cmd_circle(x, y, r, color):
    # Simple circle approximation
    for angle in range(0, 360, 5):
        px = int(x + r * __import__('math').cos(__import__('math').radians(angle)))
        py = int(y + r * __import__('math').sin(__import__('math').radians(angle)))
        tft_set_pixel(px, py, color)
    return {"circle": "ok"}

def cmd_text(x, y, text, color, size):
    tft_text(x, y, str(text), color, size)
    return {"text": "ok"}

def cmd_clear():
    tft_clear()
    return {"clear": "ok"}

def cmd_dashboard(interval_ms):
    global _dashboard_interval
    _dashboard_interval = interval_ms
    return {"dashboard": "started" if interval_ms > 0 else "stopped"}

def cmd_ping():
    return {"cmd": "pong", "t": time.ticks_ms()}

def cmd_set_time(unix_ts):
    rtc_set(unix_ts)
    return {"time_set": unix_ts}

def cmd_get_time():
    return {"cmd": "time", "t": rtc_now(), "hms": time.strftime("%H:%M:%S", time.localtime(rtc_now()))}

def cmd_status():
    return {
        "version": "sipher-pico-main-v2",
        "uptime_s": time.ticks_ms() // 1000,
        "i2c_scan": [hex(x) for x in i2c.scan()],
        "free_mem": sys.getsizeof(0)
    }

def cmd_led(on):
    if led:
        led.value(1 if on else 0)
    return {"led": on}

# Map command names to handlers
CMD_MAP = {
    "scan": (lambda p: cmd_scan()),
    "sensors": (lambda p: cmd_sensors()),
    "servo": (lambda p: cmd_servo(p.get("ch", 0), p.get("deg", 90))),
    "servos": (lambda p: cmd_servos(p.get("positions", []))),
    "fill_screen": (lambda p: cmd_fill_screen(p.get("color", 0))),
    "line": (lambda p: cmd_line(p.get("x0",0), p.get("y0",0), p.get("x1",0), p.get("y1",0), p.get("color",0xFFFF))),
    "rect": (lambda p: cmd_rect(p.get("x",0), p.get("y",0), p.get("w",0), p.get("h",0), p.get("color",0xFFFF))),
    "circle": (lambda p: cmd_circle(p.get("x",0), p.get("y",0), p.get("r",0), p.get("color",0xFFFF))),
    "text": (lambda p: cmd_text(p.get("x",0), p.get("y",0), p.get("text",""), p.get("color",0xFFFF), p.get("size",1))),
    "clear": (lambda p: cmd_clear()),
    "dashboard": (lambda p: cmd_dashboard(p.get("interval_ms", 1000))),
    "ping": (lambda p: cmd_ping()),
    "time": (lambda p: cmd_set_time(p.get("set", 0)) if "set" in p else cmd_get_time()),
    "status": (lambda p: cmd_status()),
    "led": (lambda p: cmd_led(p.get("on", False))),
}

_dashboard_interval = 0
_dashboard_running = False

# ---------------------------------------------------------------------------
# Main loop — read JSON lines from USB, dispatch, write JSON back
# ---------------------------------------------------------------------------
def main():
    print("[pico] main() entered", flush=True)
    tft_ok = tft_init()
    print(json.dumps({"version": "sipher-pico-main-v2-corr", "tft": tft_ok, "ready": True}), flush=True)
    buf = b""
    while True:
        try:
            ch = sys.stdin.buffer.read(1)
            if not ch:
                time.sleep_ms(10)
                continue
            buf += ch
            if ch == b'\n':
                line = buf.decode().strip()
                buf = b""
                if not line:
                    continue
                try:
                    req = _json.loads(line)
                except Exception:
                    print(json.dumps({"error": "bad json"}))
                    continue
                cmd = req.get("cmd", "")
                handler = CMD_MAP.get(cmd)
                if handler:
                    try:
                        resp = handler(req)
                    except Exception as e:
                        resp = {"error": str(e)}
                else:
                    # Passthrough: echo back with timestamp (useful for GPS raw passthrough)
                    resp = {"echo": req, "ts": time.ticks_ms()}
                print(_json.dumps(resp))
                sys.stdout.flush()
            # Dashboard loop: if running, emit sensor snapshots
            if _dashboard_running and _dashboard_interval > 0:
                time.sleep_ms(max(0, _dashboard_interval - 10))
                sensors = cmd_sensors()
                sensors["cmd"] = "dashboard_tick"
                print(_json.dumps(sensors))
                sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.stdout.flush()
            buf = b""
            time.sleep_ms(100)

if __name__ == "__main__":
    main()
