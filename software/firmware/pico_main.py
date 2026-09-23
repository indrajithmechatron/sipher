"""
pico_main.py — Sipher Pico 2 W unified firmware v3
Hardware:
  I2C0  GP8=SDA GP9=SCL  (PCA9685@0x40, INA219@0x41, VL53L0X@0x29)
  I2C1  GP2=SDA GP3=SCL  (MPU6050@0x68)
  UART0 GP0=TX  GP1=RX    (NEO-6M GPS 9600 baud)
  SPI0  GP16=MISO GP17=CS(TFT) GP18=SCK GP19=MOSI  (ILI9341 TFT)
        GP20=CSN(nRF) GP21=CE(nRF) GP22=IRQ(nRF)   (nRF24L01+ PA+LNA)
  USB   CDC port -> /dev/ttyACM0 on Pi (115200)
"""
import machine, time, struct, sys, json as _json

# ---------------------------------------------------------------------------
# Hardware init — dual I2C buses
# ---------------------------------------------------------------------------
i2c0 = machine.I2C(0, sda=machine.Pin(8), scl=machine.Pin(9), freq=100_000)
i2c1 = machine.I2C(1, sda=machine.Pin(2), scl=machine.Pin(3), freq=100_000)
uart = machine.UART(0, baudrate=9600, tx=machine.Pin(0), rx=machine.Pin(1))

try:
    led = machine.Pin(25, machine.Pin.OUT)
except Exception:
    led = None

# ---------------------------------------------------------------------------
# PCA9685 — 12-channel servo driver at I2C0 0x40
# ---------------------------------------------------------------------------
PCA_ADDR = 0x40
try:
    i2c0.writeto_mem(PCA_ADDR, 0x00, b'\x10')
    time.sleep_ms(5)
    i2c0.writeto_mem(PCA_ADDR, 0xFE, bytes([121]))
    i2c0.writeto_mem(PCA_ADDR, 0x00, b'\x80')
    time.sleep_ms(5)
except Exception:
    pass

def pca_set_channel(ch, pulse_us):
    try:
        val = int(pulse_us / 20000.0 * 4096) & 0xFFF
        addr = 0x06 + ch * 2
        i2c0.writeto_mem(PCA_ADDR, addr, bytes([val & 0xFF]))
        i2c0.writeto_mem(PCA_ADDR, addr + 1, bytes([(val >> 8) & 0xFF]))
    except Exception:
        pass

def pca_set_servos(positions):
    for ch, pos in enumerate(positions[:12]):
        if isinstance(pos, (int, float)):
            if pos > 500:
                pca_set_channel(ch, pos)
            else:
                pca_set_channel(ch, int(500 + (pos / 180.0) * 2000))

# ---------------------------------------------------------------------------
# MPU6050 on I2C1 0x68
# ---------------------------------------------------------------------------
def read_mpu():
    try:
        d = i2c1.readfrom_mem(0x68, 0x3B, 14)
        ax, ay, az = struct.unpack(">hhh", d[0:6])
        gx, gy, gz = struct.unpack(">hhh", d[8:14])
        return [ax, ay, az, gx, gy, gz]
    except Exception:
        return None

# ---------------------------------------------------------------------------
# VL53L0X on I2C0 0x29 — proper single-shot ranging
# ---------------------------------------------------------------------------
_vl53_ready = False

def _vl53_init():
    global _vl53_ready
    try:
        i2c0.writeto_mem(0x29, 0x01, b'\x01')
        time.sleep_ms(20)
        i2c0.writeto_mem(0x29, 0x00, b'\x00')
        time.sleep_ms(50)
        _vl53_ready = True
    except Exception:
        _vl53_ready = False

def read_vl53():
    if not _vl53_ready:
        _vl53_init()
    try:
        i2c0.writeto_mem(0x29, 0x00, b'\x01')
        time.sleep_ms(35)
        for _ in range(10):
            st = i2c0.readfrom_mem(0x29, 0x14, 1)[0]
            if st & 0x01:
                break
            time.sleep_ms(5)
        d = i2c0.readfrom_mem(0x29, 0x1E, 2)
        dist = (d[0] << 8) | d[1]
        return dist if dist < 8000 else None
    except Exception:
        return None

_vl53_init()

# ---------------------------------------------------------------------------
# INA219 on I2C0 0x41 — proper current/power reading
# ---------------------------------------------------------------------------
INA_ADDR = 0x41

def _ina_init():
    try:
        i2c0.writeto_mem(INA_ADDR, 0x05, b'\x1F\x00')
        time.sleep_ms(1)
        i2c0.writeto_mem(INA_ADDR, 0x00, b'\x39\x9F')
        time.sleep_ms(1)
    except Exception:
        pass

def read_ina():
    try:
        raw_bus = i2c0.readfrom_mem(INA_ADDR, 0x02, 2)
        bus_raw = int.from_bytes(raw_bus, 'big')
        bus_v = (bus_raw >> 3) * 0.004

        raw_shunt = i2c0.readfrom_mem(INA_ADDR, 0x01, 2)
        shunt_raw = struct.unpack(">h", raw_shunt)[0]
        shunt_uv = shunt_raw * 10

        current_ma = shunt_uv / 10.0

        return {
            "voltage_v": round(bus_v, 3),
            "current_ma": round(current_ma, 2),
            "shunt_uv": shunt_uv
        }
    except Exception:
        return None

_ina_init()

# ---------------------------------------------------------------------------
# GPS — NEO-6M via UART0, parse NMEA to lat/lon
# ---------------------------------------------------------------------------
_gps_lat = None
_gps_lon = None
_gps_fix = False
_gps_speed_knots = None
_gps_satellites = None
_gps_raw = None

def _nmea_parse_lat(raw, ns):
    """Convert NMEA ddmm.mmmm to decimal degrees."""
    try:
        deg = int(raw[:2])
        minutes = float(raw[2:])
        dd = deg + minutes / 60.0
        if ns == 'S':
            dd = -dd
        return round(dd, 6)
    except Exception:
        return None

def _nmea_parse_lon(raw, ew):
    try:
        deg = int(raw[:3])
        minutes = float(raw[3:])
        dd = deg + minutes / 60.0
        if ew == 'W':
            dd = -dd
        return round(dd, 6)
    except Exception:
        return None

def _parse_nmea(line):
    global _gps_lat, _gps_lon, _gps_fix, _gps_speed_knots, _gps_raw
    try:
        if line.startswith('$GPRMC'):
            parts = line.split(',')
            if len(parts) >= 7 and parts[2] == 'A':
                _gps_lat = _nmea_parse_lat(parts[3], parts[4])
                _gps_lon = _nmea_parse_lon(parts[5], parts[6])
                _gps_fix = True
                try:
                    _gps_speed_knots = float(parts[7]) if parts[7] else None
                except Exception:
                    _gps_speed_knots = None
            elif len(parts) >= 3 and parts[2] == 'V':
                _gps_fix = False
        elif line.startswith('$GPGGA'):
            parts = line.split(',')
            if len(parts) >= 7 and parts[6] != '0':
                _gps_lat = _nmea_parse_lat(parts[2], parts[3])
                _gps_lon = _nmea_parse_lon(parts[4], parts[5])
                _gps_fix = True
                try:
                    _gps_satellites = int(parts[7]) if parts[7] else None
                except Exception:
                    pass
    except Exception:
        pass

def read_gps():
    global _gps_raw
    try:
        while uart.any():
            line = uart.readline()
            if line:
                decoded = line.decode().strip()
                _gps_raw = decoded
                _parse_nmea(decoded)
    except Exception:
        pass
    result = {"raw": _gps_raw}
    if _gps_lat is not None:
        result["lat"] = _gps_lat
    if _gps_lon is not None:
        result["lon"] = _gps_lon
    result["fix"] = _gps_fix
    if _gps_speed_knots is not None:
        result["speed_knots"] = _gps_speed_knots
    if _gps_satellites is not None:
        result["satellites"] = _gps_satellites
    return result

# ---------------------------------------------------------------------------
# TFT — ILI9341 via SPI0
#   SCK=GP18, MOSI=GP19, MISO=GP16, CS=GP17, DC=GP4, RST=GP5
# ---------------------------------------------------------------------------
_TFT_CS = machine.Pin(17, machine.Pin.OUT, value=1)
_TFT_RST = machine.Pin(5, machine.Pin.OUT, value=1)
_TFT_DC = machine.Pin(4, machine.Pin.OUT, value=0)
_TFT_SPI = None

def _tft_init_spi():
    global _TFT_SPI
    if _TFT_SPI is not None:
        return _TFT_SPI
    try:
        _TFT_SPI = machine.SPI(0, baudrate=40_000_000, polarity=0, phase=0,
                                sck=machine.Pin(18), mosi=machine.Pin(19),
                                miso=machine.Pin(16))
    except Exception:
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

def _tft_set_window(x0, y0, x1, y1):
    _tft_cmd(0x2A)
    _tft_data(bytes([x0 >> 8, x0 & 0xFF, x1 >> 8, x1 & 0xFF]))
    _tft_cmd(0x2B)
    _tft_data(bytes([y0 >> 8, y0 & 0xFF, y1 >> 8, y1 & 0xFF]))
    _tft_cmd(0x2C)

def tft_init():
    try:
        _TFT_RST.value(0)
        time.sleep_ms(10)
        _TFT_RST.value(1)
        time.sleep_ms(10)
        _tft_cmd(0x28)
        _tft_cmd(0x11)
        time.sleep_ms(120)
        _tft_cmd(0x3A); _tft_data(b'\x55')
        _tft_cmd(0x36); _tft_data(b'\x20')
        _tft_cmd(0x29)
        time.sleep_ms(50)
        return True
    except Exception:
        return False

def tft_fill(color):
    spi = _tft_init_spi()
    if spi is None:
        return
    _tft_set_window(0, 0, 319, 239)
    _TFT_CS.value(0)
    _TFT_DC.value(1)
    pixel = struct.pack(">H", color & 0xFFFF)
    chunk = pixel * 1024
    total = 320 * 240 * 2
    sent = 0
    while sent < total:
        to_send = min(len(chunk), total - sent)
        spi.write(chunk[:to_send])
        sent += to_send
    _TFT_CS.value(1)

def tft_set_pixel(x, y, color):
    spi = _tft_init_spi()
    if spi is None:
        return
    _tft_set_window(x, y, x, y)
    _TFT_CS.value(0)
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

def tft_blit(x, y, w, h, data):
    spi = _tft_init_spi()
    if spi is None:
        return
    _tft_set_window(x, y, x + w - 1, y + h - 1)
    _TFT_CS.value(0)
    _TFT_DC.value(1)
    CHUNK = 4096
    offset = 0
    total = len(data)
    while offset < total:
        end = min(offset + CHUNK, total)
        spi.write(data[offset:end])
        offset = end
    _TFT_CS.value(1)

# ---------------------------------------------------------------------------
# nRF24L01+ PA+LNA
# ---------------------------------------------------------------------------
_nrf = None

def nrf_init(channel=76, rate=250000, pa="MAX"):
    global _nrf
    try:
        from nrf24l01 import NRF24L01
        spi = _tft_init_spi()
        if spi is None:
            return {"error": "SPI not available"}
        _nrf = NRF24L01(spi, cs=20, ce=21, channel=channel, data_rate=rate, pa_level=pa)
        return {"nrf_init": True, "channel": channel, "rate": rate, "pa": pa}
    except Exception as e:
        return {"nrf_init": False, "error": str(e)}

def nrf_send(data, pipe_addr="e1f0f0f0f0"):
    if _nrf is None:
        return {"error": "nrf not initialized"}
    try:
        if isinstance(data, str):
            data = data.encode()
        _nrf.open_tx_pipe(bytes.fromhex(pipe_addr))
        ok = _nrf.send(data)
        return {"nrf_send": ok, "bytes": len(data)}
    except Exception as e:
        return {"nrf_send": False, "error": str(e)}

def nrf_recv():
    if _nrf is None:
        return {"error": "nrf not initialized"}
    try:
        _nrf.start_listening()
        data = _nrf.recv()
        if data:
            return {"nrf_recv": data.hex(), "len": len(data)}
        return {"nrf_recv": None}
    except Exception as e:
        return {"nrf_recv": None, "error": str(e)}

def nrf_status_cmd():
    if _nrf is None:
        return {"nrf_status": "not initialized"}
    return {"nrf_status": _nrf.status_str()}

def nrf_test(count=10, delay_ms=1000):
    if _nrf is None:
        return {"error": "nrf not initialized"}
    try:
        _nrf.open_tx_pipe(b"\xe1\xf0\xf0\xf0\xf0")
        results = {"sent": 0, "acked": 0, "failed": 0, "latencies": []}
        for i in range(count):
            msg = f"test_{i:04d}".encode()
            t0 = time.ticks_ms()
            ok = _nrf.send(msg)
            lat = time.ticks_diff(time.ticks_ms(), t0)
            results["latencies"].append(lat)
            if ok:
                results["acked"] += 1
            else:
                results["failed"] += 1
            results["sent"] += 1
            time.sleep_ms(delay_ms)
        avg = sum(results["latencies"]) / len(results["latencies"]) if results["latencies"] else 0
        results["avg_latency_ms"] = round(avg, 1)
        return results
    except Exception as e:
        return {"nrf_test": False, "error": str(e)}

# ---------------------------------------------------------------------------
# RTC / Time
# ---------------------------------------------------------------------------
_rtc = machine.RTC()
_epoch_offset = 0

def rtc_set(unix_ts):
    global _epoch_offset
    _epoch_offset = int(unix_ts) - time.time()
    t = time.gmtime(int(unix_ts))
    _rtc.datetime((t[0], t[1], t[2], t[6] + 1, t[3], t[4], t[5], 0))

def rtc_now():
    return int(time.time()) + _epoch_offset

# ---------------------------------------------------------------------------
# Command dispatch
# ---------------------------------------------------------------------------
def cmd_scan():
    try:
        return {"i2c0": [hex(x) for x in i2c0.scan()], "i2c1": [hex(x) for x in i2c1.scan()]}
    except Exception as e:
        return {"error": str(e)}

def cmd_sensors():
    mpu = read_mpu()
    vl = read_vl53()
    ina = read_ina()
    gps = read_gps()
    return {
        "mpu": mpu,
        "vl53_mm": vl,
        "ina": ina,
        "gps": gps,
        "i2c0": [hex(x) for x in i2c0.scan()],
        "i2c1": [hex(x) for x in i2c1.scan()]
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
    spi = _tft_init_spi()
    if spi is None:
        return {"line": "error"}
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    while True:
        tft_set_pixel(x0, y0, color)
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy
    return {"line": "ok"}

def cmd_rect(x, y, w, h, color):
    tft_line(x, y, x + w - 1, y, color)
    tft_line(x + w - 1, y, x + w - 1, y + h - 1, color)
    tft_line(x + w - 1, y + h - 1, x, y + h - 1, color)
    tft_line(x, y + h - 1, x, y, color)
    return {"rect": "ok"}

def tft_line(x0, y0, x1, y1, color):
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    while True:
        tft_set_pixel(x0, y0, color)
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy

def tft_rect(x, y, w, h, color):
    tft_line(x, y, x + w - 1, y, color)
    tft_line(x + w - 1, y, x + w - 1, y + h - 1, color)
    tft_line(x + w - 1, y + h - 1, x, y + h - 1, color)
    tft_line(x, y + h - 1, x, y, color)

def cmd_circle(x, y, r, color):
    for angle in range(0, 360, 3):
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

def cmd_show_image():
    """Display the pre-loaded image from flash (anime.rgb565, 320x240 RGB565)."""
    try:
        with open("anime.rgb565", "rb") as f:
            CHUNK = 8192
            spi = _tft_init_spi()
            if spi is None:
                return {"show_image": "error"}
            _tft_set_window(0, 0, 319, 239)
            _TFT_CS.value(0)
            _TFT_DC.value(1)
            while True:
                data = f.read(CHUNK)
                if not data:
                    break
                spi.write(data)
            _TFT_CS.value(1)
        return {"show_image": "ok"}
    except Exception as e:
        return {"show_image": "error", "detail": str(e)}

def cmd_dashboard(interval_ms):
    global _dashboard_interval, _dashboard_running
    _dashboard_interval = interval_ms
    _dashboard_running = interval_ms > 0
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
        "version": "sipher-pico-main-v3",
        "uptime_s": time.ticks_ms() // 1000,
        "i2c0": [hex(x) for x in i2c0.scan()],
        "i2c1": [hex(x) for x in i2c1.scan()]
    }

def cmd_led(on):
    if led:
        led.value(1 if on else 0)
    return {"led": on}

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
    "show_image": (lambda p: cmd_show_image()),
    "dashboard": (lambda p: cmd_dashboard(p.get("interval_ms", 1000))),
    "ping": (lambda p: cmd_ping()),
    "time": (lambda p: cmd_set_time(p.get("set", 0)) if "set" in p else cmd_get_time()),
    "status": (lambda p: cmd_status()),
    "led": (lambda p: cmd_led(p.get("on", False))),
    "nrf_init": (lambda p: nrf_init(p.get("channel", 76), p.get("rate", 250000), p.get("pa", "MAX"))),
    "nrf_send": (lambda p: nrf_send(p.get("data", ""), p.get("pipe", "e1f0f0f0f0"))),
    "nrf_recv": (lambda p: nrf_recv()),
    "nrf_status": (lambda p: nrf_status_cmd()),
    "nrf_test": (lambda p: nrf_test(p.get("count", 10), p.get("delay_ms", 1000))),
}

_dashboard_interval = 1000
_dashboard_running = True

def main():
    tft_ok = tft_init()
    print(_json.dumps({"version": "sipher-pico-main-v3", "tft": tft_ok, "ready": True}))
    buf = b""
    last_tick = time.ticks_ms()
    while True:
        try:
            if _dashboard_running and _dashboard_interval > 0:
                if time.ticks_diff(time.ticks_ms(), last_tick) >= _dashboard_interval:
                    last_tick = time.ticks_ms()
                    sensors = cmd_sensors()
                    sensors["cmd"] = "dashboard_tick"
                    print(_json.dumps(sensors))
            ch = sys.stdin.buffer.read(1)
            if not ch:
                time.sleep_ms(2)
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
                    print(_json.dumps({"error": "bad json"}))
                    continue
                cmd = req.get("cmd", "")
                handler = CMD_MAP.get(cmd)
                if handler:
                    try:
                        resp = handler(req)
                    except Exception as e:
                        resp = {"error": str(e)}
                else:
                    resp = {"echo": req, "ts": time.ticks_ms()}
                print(_json.dumps(resp))
        except Exception as e:
            print(_json.dumps({"error": str(e)}))
            buf = b""
            time.sleep_ms(100)

if __name__ == "__main__":
    main()
