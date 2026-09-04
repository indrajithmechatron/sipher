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

## SPI — Two buses

### SPI1 → nRF24L01+PA+LNA (3.3V **only**)

| nRF24 | Pico |
|-------|------|
| VCC 3.3V | 3V3 (not 5V) |
| GND | GND |
| CE | **GP14** |
| CSN | **GP13** `SPI1 CSn` |
| SCK | **GP10** `SPI1 SCK` |
| MOSI | **GP11** `SPI1 TX` |
| MISO | **GP12** `SPI1 RX` |
| IRQ | **GP15** (optional, INT) |

`SPI1`.

### SPI0 → 2.4" TFT SPI (ILI9341, 240×320)

| TFT | Pico |
|-----|------|
| VCC 3.3V / 5V | 3V3 (if board has LDO) |
| GND | GND |
| SCK | **GP18** `SPI0 SCK` |
| MOSI/SDI | **GP19** `SPI0 TX` |
| MISO/SDO | **GP16** `SPI0 RX` (for touch/SD, else NC) |
| CS | **GP17** `SPI0 CSn` |
| DC | **GP20** |
| RST | **GP21** |
| BL (LED) | **GP22** (PWM) or 3V3 |
| T_CS / T_IRQ (if touch) | GP26 / GP27 (touch SPI shared) |

`SPI0`.

## Extra Pins

| Signal | Pico | Note |
|--------|------|------|
| MPU6050 INT | **GP2** | Data-ready interrupt |
| VL53LOX XSHUT | **GP3** | Hold low to reset, high to run |
| VL53LOX GPIO1 | GP4 | Optional threshold IRQ |

## Summary Pin Map

```
Pico 2W            sipher peripherals
------             -------------------
GP0  (UART0 TX) → GPS RX
GP1  (UART0 RX) ← GPS TX
GP2              → MPU INT
GP3              → VL53 XSHUT
GP8  (I2C0 SDA) ↔ MPU/PCA/INA/VL53 SDA
GP9  (I2C0 SCL) ↔ MPU/PCA/INA/VL53 SCL
GP10 (SPI1 SCK) → nRF SCK
GP11 (SPI1 MOSI)→ nRF MOSI
GP12 (SPI1 MISO)← nRF MISO
GP13 (SPI1 CSn) → nRF CSN
GP14             → nRF CE
GP15             ← nRF IRQ
GP16 (SPI0 MISO)← TFT SDO
GP17 (SPI0 CSn) → TFT CS
GP18 (SPI0 SCK) → TFT SCK
GP19 (SPI0 MOSI)→ TFT SDI
GP20             → TFT DC
GP21             → TFT RST
GP22             → TFT BL
GND              → All GND common
3V3              → All 3.3V logic
VBUS (5V)        → PCA V+ / servo rail / TFT VCC if needed
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
