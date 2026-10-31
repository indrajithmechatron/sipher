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
try:
    import uselect
except ImportError:
    uselect = None

FW_VERSION = "sipher-pico-main-v6"

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

def _bus_for(addr):
    for _b in (i2c0, i2c1):
        try:
            if addr in _b.scan():
                return _b
        except Exception:
            pass
    return i2c0

# ---------------------------------------------------------------------------
# PCA9685 — 16-channel servo driver (auto-bus, addr 0x40)
# ---------------------------------------------------------------------------
PCA_ADDR = 0x40
pca_bus = _bus_for(PCA_ADDR)

def pca_init():
    """50 Hz PWM, auto-increment on, outputs enabled (PCA9685 power-on state)."""
    try:
        pca_bus.writeto_mem(PCA_ADDR, 0x00, b'\x10')          # SLEEP
        time.sleep_ms(5)
        pca_bus.writeto_mem(PCA_ADDR, 0xFE, bytes([121]))      # prescale -> 50 Hz
        pca_bus.writeto_mem(PCA_ADDR, 0x01, b'\x04')           # MODE2: totem-pole
        pca_bus.writeto_mem(PCA_ADDR, 0x02, b'\x00')
        # MODE1 = RESTART | AUTO_INCREMENT. AI is required for the 64-byte
        # register readback in pca_readback(); without it every byte returns ON_L.
        pca_bus.writeto_mem(PCA_ADDR, 0x00, b'\xA0')
        time.sleep_ms(5)
        return True
    except Exception:
        return False

pca_init()

def pca_set_channel(ch, pulse_us):
    try:
        val = int(pulse_us / 20000.0 * 4096) & 0xFFF
        base = 0x06 + ch * 4
        pca_bus.writeto_mem(PCA_ADDR, base, b'\x00')
        pca_bus.writeto_mem(PCA_ADDR, base + 1, b'\x00')
        pca_bus.writeto_mem(PCA_ADDR, base + 2, bytes([val & 0xFF]))
        pca_bus.writeto_mem(PCA_ADDR, base + 3, bytes([(val >> 8) & 0xFF]))
    except Exception:
        pass

def pca_set_servos(positions):
    for ch, pos in enumerate(positions[:16]):
        if isinstance(pos, (int, float)):
            if pos > 500:
                pca_set_channel(ch, pos)
            else:
                pca_set_channel(ch, int(500 + (pos / 180.0) * 2000))

# ---------------------------------------------------------------------------
# MPU6050 on I2C1 0x68
# ---------------------------------------------------------------------------
MPU_ADDR = 0x68
GYRO_LSB_PER_DPS = 131.2          # FS_SEL=0 -> +/-250 dps
_yaw_deg = 0.0                     # integrated heading, 0..360
_gz_bias = 0.0                     # gyro-z bias in raw LSB
_yaw_last_ms = 0

def _mpu_init():
    """Wake the MPU and lock it to +/-250 dps / +/-2 g so yaw maths is well defined."""
    try:
        i2c1.writeto_mem(MPU_ADDR, 0x6B, b'\x01')   # wake, clock = PLL X gyro
        time.sleep_ms(50)
        i2c1.writeto_mem(MPU_ADDR, 0x1A, b'\x03')   # DLPF: gyro 42 Hz
        i2c1.writeto_mem(MPU_ADDR, 0x1B, b'\x00')   # gyro FS +/-250 dps
        i2c1.writeto_mem(MPU_ADDR, 0x1C, b'\x00')   # accel FS +/-2 g
        time.sleep_ms(10)
        return True
    except Exception:
        return False

def read_mpu():
    try:
        d = i2c1.readfrom_mem(MPU_ADDR, 0x3B, 14)
        ax, ay, az = struct.unpack(">hhh", d[0:6])
        gx, gy, gz = struct.unpack(">hhh", d[8:14])
        return [ax, ay, az, gx, gy, gz]
    except Exception:
        return None

def mpu_temp_c():
    """Die temperature from MPU6050 TEMP_OUT (0x41), LSB = 1/340 C."""
    try:
        raw = struct.unpack(">h", i2c1.readfrom_mem(MPU_ADDR, 0x41, 2))[0]
        return round(raw / 340.0 + 36.53, 2)
    except Exception:
        return None

def gyro_calibrate(samples=100, delay_ms=5):
    """Average gyro-z while stationary so yaw integration does not drift immediately."""
    global _gz_bias
    total = 0
    got = 0
    for _ in range(samples):
        try:
            raw = struct.unpack(">h", i2c1.readfrom_mem(MPU_ADDR, 0x47, 2))[0]
            total += raw
            got += 1
        except Exception:
            pass
        time.sleep_ms(delay_ms)
    if got:
        _gz_bias = total / got
    return {"gyro_cal": round(_gz_bias, 2), "samples": got}

def _read_gz():
    # GYRO_ZOUT_H = 0x47.  0x44 is GYRO_XOUT_L and yields garbage that made
    # yaw integrate a bogus rate (gyro_cal ~ -22000 LSB).
    try:
        return struct.unpack(">h", i2c1.readfrom_mem(MPU_ADDR, 0x47, 2))[0]
    except Exception:
        return None

def update_yaw():
    """Integrate gyro-z into _yaw_deg. Call once per sensor tick."""
    global _yaw_deg, _yaw_last_ms
    now = time.ticks_ms()
    dt = time.ticks_diff(now, _yaw_last_ms) / 1000.0
    _yaw_last_ms = now
    if dt <= 0 or dt > 2.0:        # first call / stalled loop: no integration
        return _yaw_deg
    gz = _read_gz()
    if gz is None:
        return _yaw_deg
    _yaw_deg = (_yaw_deg + ((gz - _gz_bias) / GYRO_LSB_PER_DPS) * dt) % 360.0
    return _yaw_deg

def yaw_deg():
    return round(_yaw_deg, 2)


# ---------------------------------------------------------------------------
# VL53L0X — auto-bus (addr 0x29) — ST init sequence + single-shot ranging.
# Out of the box the sensor ACKs but never ranges: every tuning/timeout
# register is 0 and SYSRANGE_START completes with 0x1FFF (no data).  It needs
# the full ST DataInit/StaticInit path (port of the Adafruit/Pololu driver).
# ID registers are 0xC0/0xC1/0xC2 = EE/AA/10 (NOT 0xD0).
# ---------------------------------------------------------------------------
VL_ADDR = 0x29
vl_bus = _bus_for(VL_ADDR)
_vl53_ready = False
_vl53_stop = 0
_vl53_attempts = 0

def _v8(reg):
    return vl_bus.readfrom_mem(VL_ADDR, reg, 1)[0]

def _vw(reg, val):
    vl_bus.writeto_mem(VL_ADDR, reg, bytes([val & 0xFF]))

def _v16(reg):
    b = vl_bus.readfrom_mem(VL_ADDR, reg, 2)
    return (b[0] << 8) | b[1]

def _vw16(reg, val):
    vl_bus.writeto_mem(VL_ADDR, reg, bytes([(val >> 8) & 0xFF, val & 0xFF]))

def _tm_encode(mclks):
    mclks = int(mclks) & 0xFFFF
    if mclks <= 0:
        return 0
    ls = mclks - 1
    ms = 0
    while ls > 255:
        ls >>= 1
        ms += 1
    return ((ms << 8) | (ls & 0xFF)) & 0xFFFF

def _tm_decode(val):
    return float(val & 0xFF) * (2.0 ** ((val & 0xFF00) >> 8)) + 1

def _mclks_to_us(mclks, vpclks):
    macro = ((2304 * vpclks * 1655) + 500) // 1000
    return ((mclks * macro) + (macro // 2)) // 1000

def _us_to_mclks(us, vpclks):
    macro = ((2304 * vpclks * 1655) + 500) // 1000
    return ((us * 1000) + (macro // 2)) // macro

def _vcsel(kind):
    # kind 0 = pre-range (reg 0x50), 1 = final range (reg 0x70)
    v = _v8(0x50 if kind == 0 else 0x70)
    return (((v) + 1) & 0xFF) << 1

def _seq_enables():
    sc = _v8(0x01)
    return ((sc >> 4) & 1, (sc >> 3) & 1, (sc >> 2) & 1,
            (sc >> 6) & 1, (sc >> 7) & 1)          # tcc, dss, msrc, pre, final

def _seq_timeouts(pre_range):
    pre_vp = _vcsel(0)
    msrc_us = _mclks_to_us((_v8(0x46) + 1) & 0xFF, pre_vp)
    pre_mclks = _tm_decode(_v16(0x51))
    pre_us = _mclks_to_us(pre_mclks, pre_vp)
    fin_vp = _vcsel(1)
    fin_mclks = _tm_decode(_v16(0x71))
    if pre_range:
        fin_mclks -= pre_mclks
    fin_us = _mclks_to_us(fin_mclks, fin_vp)
    return (msrc_us, pre_us, fin_us, fin_vp, pre_mclks)

def _budget_get():
    tcc, dss, msrc, pre, fin = _seq_enables()
    msrc_us, pre_us, fin_us, _, _ = _seq_timeouts(pre)
    budget = 1910 + 960
    if tcc:
        budget += msrc_us + 590
    if dss:
        budget += 2 * (msrc_us + 690)
    elif msrc:
        budget += msrc_us + 660
    if pre:
        budget += pre_us + 660
    if fin:
        budget += fin_us + 550
    return int(budget)

def _budget_set(budget):
    used = 1320 + 960
    tcc, dss, msrc, pre, fin = _seq_enables()
    msrc_us, pre_us, _, fin_vp, pre_mclks = _seq_timeouts(pre)
    if tcc:
        used += msrc_us + 590
    if dss:
        used += 2 * (msrc_us + 690)
    elif msrc:
        used += msrc_us + 660
    if pre:
        used += pre_us + 660
    if not fin:
        return True
    used += 550
    if used > budget:
        return False
    fin_mclks = _us_to_mclks(budget - used, fin_vp)
    if pre:
        fin_mclks += pre_mclks
    _vw16(0x71, _tm_encode(fin_mclks))
    return True

def _spad_info():
    for reg, val in ((0x80, 0x01), (0xFF, 0x01), (0x00, 0x00), (0xFF, 0x06)):
        _vw(reg, val)
    _vw(0x83, _v8(0x83) | 0x04)
    for reg, val in ((0xFF, 0x07), (0x81, 0x01), (0x80, 0x01),
                     (0x94, 0x6B), (0x83, 0x00)):
        _vw(reg, val)
    t0 = time.ticks_ms()
    while _v8(0x83) == 0x00:
        if time.ticks_diff(time.ticks_ms(), t0) > 400:
            return None
        time.sleep_ms(1)
    _vw(0x83, 0x01)
    tmp = _v8(0x92)
    count = tmp & 0x7F
    aperture = ((tmp >> 7) & 1) == 1
    for reg, val in ((0x81, 0x00), (0xFF, 0x06)):
        _vw(reg, val)
    _vw(0x83, _v8(0x83) & ~0x04)
    for reg, val in ((0xFF, 0x01), (0x00, 0x01), (0xFF, 0x00), (0x80, 0x00)):
        _vw(reg, val)
    return (count, aperture)

def _ref_cal(vhv):
    _vw(0x00, 0x01 | vhv & 0xFF)
    t0 = time.ticks_ms()
    while (_v8(0x13) & 0x07) == 0:
        if time.ticks_diff(time.ticks_ms(), t0) > 400:
            return False
        time.sleep_ms(1)
    _vw(0x0B, 0x01)
    _vw(0x00, 0x00)
    return True

def _vl53_init():
    global _vl53_ready, _vl53_stop
    try:
        if (_v8(0xC0) != 0xEE) or (_v8(0xC1) != 0xAA) or (_v8(0xC2) != 0x10):
            _vl53_ready = False
            return False
        # unlock + read the stored stop variable
        for reg, val in ((0x88, 0x00), (0x80, 0x01), (0xFF, 0x01), (0x00, 0x00)):
            _vw(reg, val)
        _vl53_stop = _v8(0x91)
        for reg, val in ((0x00, 0x01), (0xFF, 0x00), (0x80, 0x00)):
            _vw(reg, val)
        _vw(0x60, _v8(0x60) | 0x12)
        _vw16(0x44, int(0.25 * (1 << 7)))            # signal rate limit 0.25 MCPS
        _vw(0x01, 0xFF)
        spad = _spad_info()
        if spad is None:
            _vl53_ready = False
            return False
        spad_count, is_aperture = spad
        vl_bus.writeto(VL_ADDR, b'\xB0')
        ref = bytearray(vl_bus.readfrom(VL_ADDR, 6))  # 0xB0..0xB5
        for reg, val in ((0xFF, 0x01), (0x4F, 0x00), (0x4E, 0x2C),
                         (0xFF, 0x00), (0xB6, 0xB4)):
            _vw(reg, val)
        first = 12 if is_aperture else 0
        enabled = 0
        for i in range(48):
            if i < first or enabled == spad_count:
                ref[i // 8] &= ~(1 << (i % 8))
            elif (ref[i // 8] >> (i % 8)) & 1:
                enabled += 1
        vl_bus.writeto(VL_ADDR, b'\xB0' + bytes(ref))
        # default tuning settings (ST VL53L0X_DEFAULT_TUNING_SETTINGS)
        for reg, val in (
            (0xFF, 0x01), (0x00, 0x00), (0xFF, 0x00), (0x09, 0x00),
            (0x10, 0x00), (0x11, 0x00), (0x24, 0x01), (0x25, 0xFF),
            (0x75, 0x00), (0xFF, 0x01), (0x4E, 0x2C), (0x48, 0x00),
            (0x30, 0x20), (0xFF, 0x00), (0x30, 0x09), (0x54, 0x00),
            (0x31, 0x04), (0x32, 0x03), (0x40, 0x83), (0x46, 0x25),
            (0x60, 0x00), (0x27, 0x00), (0x50, 0x06), (0x51, 0x00),
            (0x52, 0x96), (0x56, 0x08), (0x57, 0x30), (0x61, 0x00),
            (0x62, 0x00), (0x64, 0x00), (0x65, 0x00), (0x66, 0xA0),
            (0xFF, 0x01), (0x22, 0x32), (0x47, 0x14), (0x49, 0xFF),
            (0x4A, 0x00), (0xFF, 0x00), (0x7A, 0x0A), (0x7B, 0x00),
            (0x78, 0x21), (0xFF, 0x01), (0x23, 0x34), (0x42, 0x00),
            (0x44, 0xFF), (0x45, 0x26), (0x46, 0x05), (0x40, 0x40),
            (0x0E, 0x06), (0x20, 0x1A), (0x43, 0x40), (0xFF, 0x00),
            (0x34, 0x03), (0x35, 0x44), (0xFF, 0x01), (0x31, 0x04),
            (0x4B, 0x09), (0x4C, 0x05), (0x4D, 0x04), (0xFF, 0x00),
            (0x44, 0x00), (0x45, 0x20), (0x47, 0x08), (0x48, 0x28),
            (0x67, 0x00), (0x70, 0x04), (0x71, 0x01), (0x72, 0xFE),
            (0x76, 0x00), (0x77, 0x00), (0xFF, 0x01), (0x0D, 0x01),
            (0xFF, 0x00), (0x80, 0x01), (0x01, 0xF8), (0xFF, 0x01),
            (0x8E, 0x01), (0x00, 0x01), (0xFF, 0x00), (0x80, 0x00),
        ):
            _vw(reg, val)
        _vw(0x0A, 0x04)                              # new sample ready IRQ
        _vw(0x84, _v8(0x84) & ~0x10)                 # active low
        _vw(0x0B, 0x01)
        budget = _budget_get()
        _vw(0x01, 0xE8)
        if not _budget_set(budget):
            _vl53_ready = False
            return False
        _vw(0x01, 0x01)
        if not _ref_cal(0x40):
            _vl53_ready = False
            return False
        _vw(0x01, 0x02)
        if not _ref_cal(0x00):
            _vl53_ready = False
            return False
        _vw(0x01, 0xE8)
        _vl53_ready = True
        return True
    except Exception:
        _vl53_ready = False
        return False

def read_vl53():
    global _vl53_attempts
    if not _vl53_ready:
        if _vl53_attempts >= 3:
            return None
        _vl53_attempts += 1
        if not _vl53_init():
            return None
    try:
        for reg, val in ((0x80, 0x01), (0xFF, 0x01), (0x00, 0x00),
                         (0x91, _vl53_stop), (0x00, 0x01), (0xFF, 0x00),
                         (0x80, 0x00), (0x00, 0x01)):
            _vw(reg, val)
        t0 = time.ticks_ms()
        while (_v8(0x00) & 0x01) > 0:
            if time.ticks_diff(time.ticks_ms(), t0) > 150:
                return None
            time.sleep_ms(1)
        t0 = time.ticks_ms()
        while (_v8(0x13) & 0x07) == 0:
            if time.ticks_diff(time.ticks_ms(), t0) > 150:
                return None
            time.sleep_ms(1)
        dist = _v16(0x1E)                            # RESULT_RANGE_STATUS + 10
        _vw(0x0B, 0x01)
        return dist if dist < 8000 else None
    except Exception:
        return None

_vl53_init()

# ---------------------------------------------------------------------------
# INA219 — auto-bus (addr 0x41) — proper current/power reading
# ---------------------------------------------------------------------------
INA_ADDR = 0x41
ina_bus = _bus_for(INA_ADDR)
INA_SHUNT_OHM = 0.1                 # standard INA219 breakout shunt

def _ina_init():
    try:
        ina_bus.writeto_mem(INA_ADDR, 0x05, b'\x1F\x00')
        time.sleep_ms(1)
        # CONFIG 0x399F: 32V range, PGA +/-320mV, 2x bus / 8x shunt averaging, continuous
        ina_bus.writeto_mem(INA_ADDR, 0x00, b'\x39\x9F')
        time.sleep_ms(1)
    except Exception:
        pass

def read_ina():
    try:
        raw_bus = ina_bus.readfrom_mem(INA_ADDR, 0x02, 2)
        bus_raw = int.from_bytes(raw_bus, 'big')
        bus_v = (bus_raw >> 3) * 0.004            # BUSVOLTAGE LSB = 4 mV

        raw_shunt = ina_bus.readfrom_mem(INA_ADDR, 0x01, 2)
        shunt_raw = struct.unpack(">h", raw_shunt)[0]
        shunt_uv = shunt_raw * 10                 # SHUNTVOLTAGE LSB = 10 uV

        # I(mA) = V(uV) * 1e-6 / R(ohm) * 1000  =>  shunt_uv / (R * 1000)
        current_ma = shunt_uv / (INA_SHUNT_OHM * 1000.0)
        power_mw = bus_v * current_ma

        return {
            "voltage_v": round(bus_v, 3),
            "current_ma": round(current_ma, 2),
            "power_mw": round(power_mw, 1),
            "shunt_uv": shunt_uv,
            "shunt_ohm": INA_SHUNT_OHM
        }
    except Exception:
        return None


_ina_init()
# Touch sensors (TTP223 on GP6 = e-stop, GP7 = admin unlock)
ESTOP_PIN = 6
ADMIN_PIN = 7
try:
    estop_pin = machine.Pin(ESTOP_PIN, machine.Pin.IN)
    admin_pin = machine.Pin(ADMIN_PIN, machine.Pin.IN)
except Exception:
    estop_pin = None
    admin_pin = None

_estop_active = False
_admin_unlocked = False
_last_estop_ms = 0
_admin_hold_start = 0
_admin_hold_triggered = False
_ADMIN_HOLD_MS = 2000

def _estop_trigger():
    global _estop_active, _last_estop_ms
    now = time.ticks_ms()
    if time.ticks_diff(now, _last_estop_ms) < 300:
        return
    _last_estop_ms = now
    _estop_active = True
    cmd_relax_all()
    print(_json.dumps({cmd: estop, active: True}), flush=True)

def _estop_irq(pin):
    _estop_trigger()

if estop_pin is not None:
    try:
        estop_pin.irq(trigger=machine.Pin.IRQ_RISING, handler=_estop_irq)
    except Exception:
        pass

def _admin_hold_check():
    global _admin_hold_start, _admin_hold_triggered, _admin_unlocked
    if admin_pin is None:
        return
    if admin_pin.value():
        if _admin_hold_start == 0:
            _admin_hold_start = time.ticks_ms()
        elif not _admin_hold_triggered and time.ticks_diff(time.ticks_ms(), _admin_hold_start) > _ADMIN_HOLD_MS:
            _admin_hold_triggered = True
            _admin_unlocked = True
            print(_json.dumps({cmd: admin_unlock, unlocked: True}), flush=True)
    else:
        _admin_hold_start = 0
        _admin_hold_triggered = False

def cmd_estop():
    global _estop_active
    _estop_active = True
    cmd_relax_all()
    return {estop: activated}

def cmd_estop_clear():
    global _estop_active
    _estop_active = False
    return {estop: cleared}

def cmd_admin_unlock():
    global _admin_unlocked
    _admin_unlocked = True
    return {admin_unlock: unlocked}

def cmd_admin_lock():
    global _admin_unlocked
    _admin_unlocked = False
    return {admin_unlock: locked}

def cmd_admin_status():
    return {admin_unlocked: _admin_unlocked, estop_active: _estop_active}

# ---------------------------------------------------------------------------
# Bus re-resolution — the servo/sensor board can power up after the Pico
# ---------------------------------------------------------------------------
_BUS_CHECK_MS = 5000
_bus_checked_ms = 0

def _bus_has(bus, addr):
    try:
        return addr in bus.scan()
    except Exception:
        return False

def _ensure_buses():
    """Adopt the other I2C bus when a device shows up there later.

    _bus_for() runs once at import. If the PCA9685 / INA219 / VL53L0X board is
    still unpowered at that moment (or the Pico boots before its rail is up),
    the lookup falls back to i2c0 and every servo write afterwards fails
    silently: PCA registers stay at their power-on defaults, telemetry reports
    pca.present=false, and no PWM ever reaches the servos. Re-check the cached
    bus every few seconds and re-init the device once it answers.
    """
    global pca_bus, vl_bus, ina_bus, _bus_checked_ms
    now = time.ticks_ms()
    if _bus_checked_ms and time.ticks_diff(now, _bus_checked_ms) < _BUS_CHECK_MS:
        return
    _bus_checked_ms = now
    if not _bus_has(pca_bus, PCA_ADDR):
        b = _bus_for(PCA_ADDR)
        if _bus_has(b, PCA_ADDR):
            pca_bus = b
            pca_init()
            print(_json.dumps({"bus_moved": "pca", "bus": 1 if b is i2c1 else 0}))
    if not _bus_has(vl_bus, VL_ADDR):
        b = _bus_for(VL_ADDR)
        if _bus_has(b, VL_ADDR):
            vl_bus = b
            _vl53_init()
    if not _bus_has(ina_bus, INA_ADDR):
        b = _bus_for(INA_ADDR)
        if _bus_has(b, INA_ADDR):
            ina_bus = b
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

# --- cached I2C scans (a full scan is ~15 ms per bus; too slow for every tick) ---
_scan_cache = {"i2c0": [], "i2c1": [], "ts": 0}

def _refresh_scans(force=False):
    now = time.ticks_ms()
    if force or time.ticks_diff(now, _scan_cache["ts"]) > 5000:
        try:
            _scan_cache["i2c0"] = [hex(x) for x in i2c0.scan()]
            _scan_cache["i2c1"] = [hex(x) for x in i2c1.scan()]
            _scan_cache["ts"] = now
        except Exception:
            pass
    return _scan_cache

def _pca_present():
    scan = _scan_cache["i2c0"] if pca_bus is i2c0 else _scan_cache["i2c1"]
    return hex(PCA_ADDR) in scan

def pca_readback():
    """Read the PCA9685 ON/OFF registers back -> the pulse width actually being driven."""
    out = {"present": False, "pulse_us": [], "deg": []}
    if not _pca_present():
        return out
    try:
        raw = pca_bus.readfrom_mem(PCA_ADDR, 0x06, 64)   # ch0..ch15 (on_l,on_h,off_l,off_h)
        pulses = []
        for ch in range(16):
            b = ch * 4
            on = (raw[b] | (raw[b + 1] << 8)) & 0xFFF
            off = (raw[b + 2] | (raw[b + 3] << 8)) & 0xFFF
            ticks = (off - on) & 0xFFF
            pulses.append(int(round(ticks * 20000.0 / 4096)))
        out["present"] = True
        out["pulse_us"] = pulses
        # 0 us = channel not driven (no meaningful angle); do not show -45 deg.
        out["deg"] = [None if p == 0 else round((p - 500) / 2000.0 * 180.0, 1)
                      for p in pulses]
    except Exception as e:
        out["error"] = str(e)
    return out

_tick_last_ms = 0

def cmd_sensors():
    global _tick_last_ms
    _ensure_buses()
    now = time.ticks_ms()
    dt_ms = time.ticks_diff(now, _tick_last_ms) if _tick_last_ms else None
    _tick_last_ms = now
    _refresh_scans()
    update_yaw()
    mpu = read_mpu()
    vl = read_vl53()
    ina = read_ina()
    gps = read_gps()
    # Pico status: track if we're receiving valid sensor data
    pico_online = mpu is not None  # MPU data presence indicates Pico is alive
    pico_age_ms = dt_ms  # Time since last sensor tick
    return {
        "cmd": "dashboard_tick",
        "mpu": mpu,
        "mpu_temp_c": mpu_temp_c(),
        "yaw_deg": yaw_deg(),
        "vl53_mm": vl,
        "ina": ina,
        "gps": gps,
        "pca": pca_readback(),
        "uptime_s": time.ticks_ms() // 1000,
        "version": FW_VERSION,
        "dt_ms": dt_ms,
        "i2c0": _scan_cache["i2c0"],
        "i2c1": _scan_cache["i2c1"],
        "estop": _estop_active,
        "admin_unlocked": _admin_unlocked,
        "_meta": {
            "pico": pico_online,
            "pico_age_ms": pico_age_ms,
            "bridge": True,  # bridge is always up when this endpoint is called
        }
    }


def cmd_servo(ch, deg):
    if _estop_active:
        return {"servo": "estop_active"}
    if not isinstance(ch, int) or ch < 0 or ch > 15:
        return {"servo": "bad_ch"}
    if isinstance(deg, (int, float)) and deg > 500:
        pulse = int(deg)
    else:
        pulse = int(500 + (float(deg) / 180.0) * 2000)
    pca_set_channel(ch, pulse)
    return {"servo": {"ch": ch, "deg": deg, "pulse_us": pulse}}

def cmd_servos(positions):
    pca_set_servos(positions)
    return {"servos": "ok"}

def cmd_sweep(ch=0, lo=30, hi=150, step=10, delay_ms=150, hold_end=True):
    """Sweep one PCA channel back and forth so you can spot the servo."""
    try:
        ch = int(ch)
    except Exception:
        return {"sweep": "bad_ch"}
    if ch < 0 or ch > 15:
        return {"sweep": "bad_ch"}
    try:
        lo = int(lo); hi = int(hi); step = int(step); delay_ms = int(delay_ms)
    except Exception:
        return {"sweep": "bad_args"}
    if step <= 0:
        step = 10
    if lo > hi:
        lo, hi = hi, lo
    lo = max(0, min(180, lo)); hi = max(0, min(180, hi))
    angles = list(range(lo, hi + 1, step))
    if angles[-1] != hi:
        angles.append(hi)
    angles += list(reversed(angles[:-1]))
    for deg in angles:
        pca_set_channel(ch, int(500 + (deg / 180.0) * 2000))
        time.sleep_ms(delay_ms)
    if hold_end:
        pca_set_channel(ch, 1500)
    return {"sweep": "ok", "ch": ch, "lo": lo, "hi": hi, "step": step, "held_90": bool(hold_end)}

def cmd_sweep_ch0():
    return cmd_sweep(0, 30, 150, 10, 150, True)

USED_CHANNELS = [0, 1, 2, 3, 5, 7, 8, 10, 12, 13, 14, 15]

def _deg_to_pulse(deg):
    return int(500 + (max(0, min(180, deg)) / 180.0) * 2000)

def cmd_sweep_all():
    """One-shot test: move all 12 connected servos together 90->60->120->90."""
    for deg in (90, 60, 120, 90):
        pulse = _deg_to_pulse(deg)
        for ch in USED_CHANNELS:
            pca_set_channel(ch, pulse)
        time.sleep_ms(600)
    return {"sweep_all": "ok", "channels": USED_CHANNELS, "held_90": True}

def cmd_sweep_10_120_0():
    """Sweep channel 0 from 10° to 120° then back to 0°.
    One full cycle: 10° → 120° → 0°. PWM remains set at 0° (500µs) at the end."""
    # 10° → 120°
    for deg in range(10, 121, 10):  # 10,20,...,120
        pca_set_channel(0, int(500 + (deg / 180.0) * 2000))
        time.sleep_ms(15)
    # 120° → 0°
    for deg in range(120, -1, -10):  # 120,110,...,0
        pca_set_channel(0, int(500 + (deg / 180.0) * 2000))
        time.sleep_ms(15)
    return {"sweep_10_120_0": "ok", "cycled": "10→120→0"}

def cmd_sweep_ch0_continuous():
    """Continuously sweep channel 0 back-and-forth between 10° and 120°.
    Uses the same 500-2500µs mapping as the 4 digital 180° servos (1499µs at 90°).
    Fast step (8ms) makes it appear continuous; send any other command (e.g. stand90) to park at 1500."""
    try:
        while True:
            # 10° → 120°
            for deg in range(10, 121, 10):  # 10,20,...,120
                pca_set_channel(0, int(500 + (deg / 180.0) * 2000))
                time.sleep_ms(8)
            # 120° → 10°
            for deg in range(120, 9, -10):  # 120,110,...,10
                pca_set_channel(0, int(500 + (deg / 180.0) * 2000))
                time.sleep_ms(8)
    except Exception:
        pca_set_channel(0, 1500)
        return {"sweep_ch0_continuous": "stopped", "held_at": "90°"}

def cmd_stand90():
    scan = [hex(x) for x in pca_bus.scan()]
    present = hex(PCA_ADDR) in scan
    pca_set_servos([90] * 16)
    return {"stand90": "ok" if present else "no_pca", "deg": 90, "channels": 16,
            "bus": 1 if pca_bus is i2c1 else 0, "scan": scan}

def cmd_relax_all():
    """Cut PWM on all channels (0us = no signal). Servos go limp and silent."""
    for ch in range(16):
        pca_set_channel(ch, 0)
    return {"relax_all": "ok", "channels": 16, "pulse_us": 0}

def cmd_sweep_0_90_continuous():
    """Sweep channel 0 pulse from 0° (500us) to 90° (1500us) and back to 0°.
    One cycle = forward ramp to stop then reverse ramp from stop.
    Send the command again to repeat the cycle.
    Other commands (e.g. stand90) can interrupt by parking at 1500."""
    try:
        # Forward: 0° → 90° : pulse 500 → 1500
        for step in range(0, 1001, 10):  # 0 to 1000 in steps of 10
            pulse = 500 + (step / 1000.0) * 1000
            pca_set_channel(0, int(pulse))
            time.sleep_ms(5)
        # Reverse: 90° → 0° : pulse 1500 → 500
        for step in range(1000, -1, -10):  # 1000 down to 0 in steps of 10
            pulse = 500 + (step / 1000.0) * 1000
            pca_set_channel(0, int(pulse))
            time.sleep_ms(5)
        return {"sweep_0_90_continuous": "ok", "cycled": "0→90→0"}
    except Exception as e:
        pca_set_channel(0, 1500)
        return {"sweep_0_90_continuous": "stopped", "error": str(e)}

def _pca_rd(reg):
    return pca_bus.readfrom_mem(PCA_ADDR, reg, 1)[0]

def cmd_pca_read():
    _ensure_buses()
    out = {"bus": 1 if pca_bus is i2c1 else 0}
    try:
        scan = [hex(x) for x in pca_bus.scan()]
        out["scan"] = scan
        out["present"] = hex(PCA_ADDR) in scan
        if not out["present"]:
            return {"pca_read": out}
        for reg, name in ((0x00, "mode1"), (0x01, "mode2"), (0x02, "sub1"),
                          (0x06, "ch0_on_l"), (0x07, "ch0_on_h"),
                          (0x08, "ch0_off_l"), (0x09, "ch0_off_h"),
                          (0x42, "ch15_on_l"), (0x43, "ch15_on_h"),
                          (0x44, "ch15_off_l"), (0x45, "ch15_off_h"),
                          (0xFA, "all_on_l"), (0xFD, "all_off_h"),
                          (0xFE, "prescale")):
            out[name] = _pca_rd(reg)
        pca_set_channel(0, 1500)
        time.sleep_ms(5)
        out["ch0_off_l_wr"] = _pca_rd(0x08)
        out["ch0_off_h_wr"] = _pca_rd(0x09)
        if "0x70" in scan:
            out["x70_r00"] = pca_bus.readfrom_mem(0x70, 0x00, 1)[0]
    except Exception as e:
        out["error"] = str(e)
    return {"pca_read": out}

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
    _refresh_scans()
    return {
        "version": FW_VERSION,
        "uptime_s": time.ticks_ms() // 1000,
        "yaw_deg": yaw_deg(),
        "i2c0": _scan_cache["i2c0"],
        "i2c1": _scan_cache["i2c1"]
    }

def cmd_led(on):
    if led:
        led.value(1 if on else 0)
    return {"led": on}

def cmd_gyro_cal(samples=100):
    return gyro_calibrate(int(samples))

def cmd_yaw_reset():
    global _yaw_deg
    _yaw_deg = 0.0
    return {"yaw_deg": 0.0}

def cmd_servo_ch0_90():
    """Drive PCA channel 0 to 90 deg (1500us) and hold."""
    pca_set_channel(0, 1500)
    return {"ch0_90": "ok", "ch": 0, "deg": 90, "pulse_us": 1500}

CMD_MAP = {
    "scan": (lambda p: cmd_scan()),
    "sensors": (lambda p: cmd_sensors()),
    "servo": (lambda p: cmd_servo(p.get("ch", 0), p.get("deg", 90))),
    "servo_ch0_90": (lambda p: cmd_servo_ch0_90()),
    "sweep": (lambda p: cmd_sweep(p.get("ch", 0), p.get("lo", 30), p.get("hi", 150), p.get("step", 10), p.get("delay_ms", 150), p.get("hold_end", True))),
    "sweep_ch0": (lambda p: cmd_sweep_ch0()),
    "sweep_all": (lambda p: cmd_sweep_all()),
    "servos": (lambda p: cmd_servos(p.get("positions", []))),
    "stand90": (lambda p: cmd_stand90()),
    "relax_all": (lambda p: cmd_relax_all()),
    "sweep_0_90_continuous": (lambda p: cmd_sweep_0_90_continuous()),
    "sweep_10_120_0": (lambda p: cmd_sweep_10_120_0()),
    "sweep_ch0_continuous": (lambda p: cmd_sweep_ch0_continuous()),
    "pca_read": (lambda p: cmd_pca_read()),
    "gyro_cal": (lambda p: cmd_gyro_cal(p.get("samples", 100))),
    "yaw_reset": (lambda p: cmd_yaw_reset()),

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
    "estop": (lambda p: cmd_estop()),
    "estop_clear": (lambda p: cmd_estop_clear()),
    "admin_unlock": (lambda p: cmd_admin_unlock()),
    "admin_lock": (lambda p: cmd_admin_lock()),
    "admin_status": (lambda p: cmd_admin_status()),
    "heartbeat": (lambda p: cmd_heartbeat()),
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
    global _yaw_last_ms
    try:
        pca_set_channel(0, 1500)
    except Exception:
        pass
    _mpu_init()
    tft_ok = tft_init()
    if tft_ok:
        img = cmd_show_image()
        tft_ok = img.get("show_image") == "ok"
    _yaw_last_ms = time.ticks_ms()
    cal = gyro_calibrate(100, 5)      # ~0.5 s, robot should be still
    print(_json.dumps({"version": FW_VERSION, "tft": tft_ok, "gyro": cal, "ready": True}))
    buf = b""
    last_tick = time.ticks_ms()
    poller = None
    if uselect is not None:
        try:
            poller = uselect.poll()
            poller.register(sys.stdin, uselect.POLLIN)
        except Exception:
            poller = None
    while True:
        try:
            _admin_hold_check()
            if _dashboard_running and _dashboard_interval > 0:
                if time.ticks_diff(time.ticks_ms(), last_tick) >= _dashboard_interval:
                    last_tick = time.ticks_ms()
                    sensors = cmd_sensors()
                    sensors["cmd"] = "dashboard_tick"
                    print(_json.dumps(sensors))
            if poller is not None:
                if not poller.poll(20):
                    continue
                ch = sys.stdin.buffer.read(1)
            else:
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
