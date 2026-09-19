# Pico 2 W — Wiring for sipher (MPU6050 + GPS + PCA9685 + nRF24 + INA219 + VL53LOX + TFT 2.4" SPI)

> **Board:** Raspberry Pi Pico 2 W (RP2350) 40-pin. All logic 3.3V. Common GND star at Pico GND. VBUS 5V only for PCA9685 servo rail / TFT VCC if 5V-tolerant.

## I2CBus Shared (I2C0) — 4 devices

| Device | VCC | GND | SDA | SCL | Addr | Note |
|--------|-----|-----|-----|-----|------|------|
| MPU6050 | 3V3 | GND | GP8 | GP9 | 0x68 (AD0 GND) | INT → GP2 |
| VL53LOX | 3V3 | GND | GP8 | GP9 | 0x29 | XSHUT → GP3 |
| PCA9685 | 3V3 (logic) | GND | GP8 | GP9 | 0x40 | OE → GND (always on), 5V servo rail separate |
| INA219 A0 soldered | 3V3 | GND | GP8 | GP9 | **0x41** (A0=VCC) | Avoids clash with PCA 0x40 |

**Bus:** `I2C0 SDA GP8` + `I2C0 SCL GP9`, 4.7k pull-ups already on boards. All share same bus.

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
GP2              → MPU INT / I2C1 SDA
GP3              → VL53 XSHUT / I2C1 SCL
GP4              → TFT DC/RS
GP5              → TFT RESET
GP8  (I2C0 SDA) ↔ PCA/INA/VL53 SDA (alt)
GP9  (I2C0 SCL) ↔ PCA/INA/VL53 SCL (alt)
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

```bash
i2cdetect -y 1  # expect 0x29 VL53, 0x40 PCA, 0x41 INA, 0x68 MPU
ls -la /dev/ttyACM*  # Pico
cat /dev/serial0  # GPS NMEA
```

Wire star-GND, keep I2C <20 cm, SPI <10 cm, twist nRF power.
