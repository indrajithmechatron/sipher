# Pico 2 W — Wiring for sipher (MPU6050 + GPS + PCA9685 + nRF24 + INA219 + VL53LOX + TFT 2.4" SPI)

> **Board:** Raspberry Pi Pico 2 W (RP2350) 40-pin. All logic 3.3V. Common GND star at Pico GND. VBUS 5V only for PCA9685 servo rail / TFT VCC if 5V-tolerant.

## I2C — two buses, firmware probes both

`pico_main.py` opens `I2C0` on GP8/GP9 and `I2C1` on GP2/GP3, then picks the bus
that actually answers for each address (`_bus_for()`). Either bus works for a
device; the bench wiring is split as follows.

| Bus | SDA | SCL | Devices |
|---|---|---|---|
| `I2C0` (100 kHz) | GP8 | GP9 | PCA9685 `0x40`, INA219 `0x41` (A0 → VCC), VL53L0X `0x29` |
| `I2C1` (100 kHz) | GP2 | GP3 | MPU6050 `0x68` (AD0 → GND) |

4.7k pull-ups are already fitted on the breakout boards.

- `VL53L0X` XSHUT is tied high: the firmware never drives it, so the sensor is
  always enabled. GP3 is I2C1 SCL, not XSHUT.
- MPU6050 `INT` is not wired. GP2 is I2C1 SDA; the firmware polls instead of
  using the interrupt.

## UART — GPS

| GY-GPS6MV2 (NEO-6M) | Pico 2 W |
|---------------------|----------|
| VCC 3.3-5V | VBUS 5V or 3V3 (module is 3.3V LDO) |
| GND | GND |
| TX → | **GP1** `UART0 RX` |
| RX ← | **GP0** `UART0 TX` (3.3V) |
| PPS (optional) | GP4 |

Baud 9600 `UART0`.

## SPI — Shared SPI0 Bus (TFT 2.4" + nRF24L01+ PA+LNA)

Both the 2.4" TFT display and nRF24L01+ share the `SPI0` bus lines (`SCK`, `MOSI`, `MISO`), with separate chip-select (`CS` / `CSN`) lines:

| Signal / Pin | TFT 2.4" SPI | nRF24L01+ PA+LNA | Pico 2 W Pin | Function |
|--------------|--------------|------------------|--------------|----------|
| **SCK** | SCK | SCK | **GP18** (Pin 24) | Shared SPI0 Clock |
| **MOSI** | MOSI/SDI | MOSI | **GP19** (Pin 25) | Shared SPI0 MOSI (TX) |
| **MISO** | MISO/SDO | MISO | **GP16** (Pin 21) | Shared SPI0 MISO (RX) |
| **CS / CSN** | CS (GP17, Pin 22) | CSN (GP20, Pin 26) | **GP17** / **GP20** | Independent Chip Selects |
| **Control** | DC: **GP4** (Pin 6)<br>RST: **GP5** (Pin 7) | CE: **GP21** (Pin 27)<br>IRQ: **GP22** (Pin 29) | — | Device control & IRQ |
| **Power** | VCC: 3V3 (Pin 36)<br>BL: 3V3 (Pin 36) | VCC: 3V3 (Pin 36, **3.3V only**) | **3V3** (Pin 36) | Logic & backlight |
| **GND** | GND | GND | **GND** | Common Star GND |

## Summary Pin Map

```
Pico 2W            sipher peripherals
------             -------------------
GP0  (UART0 TX) → GPS RX
GP1  (UART0 RX) ← GPS TX
GP2  (I2C1 SDA) → MPU6050 SDA
GP3  (I2C1 SCL) → MPU6050 SCL
GP4              → TFT DC/RS
GP5              → TFT RESET
GP8  (I2C0 SDA) ↔ PCA / INA / VL53 SDA
GP9  (I2C0 SCL) ↔ PCA / INA / VL53 SCL
GP16 (SPI0 MISO)↔ Shared SPI0 MISO (TFT SDO & nRF MISO)
GP17 (SPI0 CSn) → TFT CS
GP18 (SPI0 SCK) → Shared SPI0 SCK (TFT SCK & nRF SCK)
GP19 (SPI0 MOSI)→ Shared SPI0 MOSI (TFT SDI & nRF MOSI)
GP20             → nRF CSN (Chip Select)
GP21             → nRF CE (Enable)
GP22             → nRF IRQ (Optional Interrupt)
GND              → All GND common
3V3              → All 3.3V logic + TFT BL + nRF VCC
VBUS (5V)        → PCA V+ / servo rail / external UBEC
```

## Power notes

- PCA9685: `VCC` 3.3V logic, `V+` 5-6V 3A for 12 servos (separate UBEC). Common GND.
- INA219: inline on VBAT (0-26V) to monitor servo rail current; A0 soldered → 0x41.
- nRF PA+LNA: needs stable 3.3V 300 mA, add 10 µF + 100 nF at module.
- TFT: 2.4" draws ~120 mA BL on.

## Check

I2C is on the Pico, so scan it from the Pico — not with `i2cdetect` on the Pi:

```python
# mpremote connect /dev/ttyACM0 exec "import machine; print([hex(a) for a in machine.I2C(0, sda=machine.Pin(8), scl=machine.Pin(9)).scan()]); print([hex(a) for a in machine.I2C(1, sda=machine.Pin(2), scl=machine.Pin(3)).scan()])"
# I2C0: 0x29 VL53, 0x40 PCA, 0x41 INA
# I2C1: 0x68 MPU
```

```bash
ls -la /dev/ttyACM*             # Pico on the Pi
cat /dev/serial0                # GPS NMEA (Pi-side UART, if wired there)
curl -s localhost:5001/sensor   # parsed telemetry from the bridge
```

Wire star-GND, keep I2C <20 cm, SPI <10 cm, twist nRF power.
