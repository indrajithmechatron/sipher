# Sipher Pico 2 W — Complete Wiring / Pin Map (all components)

> Consolidated from `docs/hardware/pico-wiring.md`, `software/firmware/pico_main.py` and
> `docs/hardware/status-lights-and-nav.md`.
> **Pin numbers below are Pico GPIO numbers (GPx). Physical header positions should be
> verified against the Pico 2 W silkscreen before soldering.**

## 1. Power

| Rail | Connection |
|------|------------|
| **VBUS (5 V)** | Pico VBUS → UBEC (5 V / 3 A) → PCA9685 **V+** (servo rail) |
| **3V3** | Pico 3V3 → PCA9685 **VCC** (logic), INA219, nRF24L01 **VCC**, TFT **VCC/BL**, VL53L0X, MPU6050 |
| **GND** | Star ground at Pico GND (all modules share) |

## 2. Complete GPIO allocation — Pico 2 W (RP2350)

| Bus / Function | Signal | Pico GPIO | Destination | Notes |
|---|---|---|---|---|
| I2C0 (100 kHz) | SDA | **GP8** | PCA9685 (0x40), INA219 (0x41), VL53L0X (0x29) | 4.7 kΩ pull-ups |
| I2C0 (100 kHz) | SCL | **GP9** | PCA9685, INA219, VL53L0X | 4.7 kΩ pull-ups |
| I2C1 (100 kHz) | SDA | **GP2** | MPU6050 (0x68, AD0 → GND) | 4.7 kΩ pull-ups |
| I2C1 (100 kHz) | SCL | **GP3** | MPU6050 | 4.7 kΩ pull-ups |
| UART0 (9600) | TX | **GP0** | GPS RX | NEO-6M |
| UART0 (9600) | RX | **GP1** | GPS TX | NEO-6M |
| SPI0 | MISO | **GP16** | TFT SDO / nRF MISO | shared bus |
| SPI0 | MOSI | **GP19** | TFT SDI / nRF MOSI | shared bus |
| SPI0 | SCK | **GP18** | TFT SCK / nRF SCK | shared bus |
| SPI0 | CS (TFT) | **GP17** | ILI9341 | — |
| SPI0 | CSN (nRF) | **GP20** | nRF24L01+ | — |
| SPI0 | CE (nRF) | **GP21** | nRF24L01+ | — |
| SPI0 | IRQ (nRF) | **GP22** | nRF24L01+ | optional |
| GPIO | DC (TFT) | **GP4** | ILI9341 | — |
| GPIO | RST (TFT) | **GP5** | ILI9341 | — |
| GPIO | E-stop (TTP223) | **GP6** | E-stop touch | — |
| GPIO | Admin unlock (TTP223) | **GP7** | Admin unlock touch | — |
| GPIO | Nav up | **GP23** | nav button NO | active-low, pull-up |
| GPIO | Nav down | **GP24** | nav button NO | active-low, pull-up |
| GPIO | Nav left | **GP10** | nav button NO | active-low, pull-up |
| GPIO | Nav right | **GP11** | nav button NO | active-low, pull-up |
| GPIO | Nav select | **GP12** | nav button NO | active-low, pull-up |
| GPIO | Nav menu | **GP13** | nav button NO | active-low, pull-up |
| GPIO | Nav options | **GP14** | nav button NO | active-low, pull-up |
| GPIO | Status LED estop | **GP15** | red LED | active HIGH, 330 Ω |
| GPIO | Status LED battery | **GP26** | red LED | active HIGH, 330 Ω |
| GPIO | Status LED error | **GP27** | red LED | active HIGH, 330 Ω |
| GPIO | Status LED nRF | **GP28** | yellow LED | active HIGH, 330 Ω |
| GPIO | Status LED bridge / onboard | **GP25** | green LED | active HIGH, 330 Ω (onboard) |
| GPIO | Status LED sensors | **GP29** | green LED | active HIGH, 330 Ω |

## 3. Component-level connections

### 3.1 PCA9685 (servo driver) — I2C0 @ 0x40
```
Pico GP8 (SDA) → PCA SDA ; Pico GP9 (SCL) → PCA SCL
PCA VCC → 3V3 ; PCA V+ → VBUS/UBEC → servo rail
PCA GND → GND
Ch0–Ch15 → servo signal wires (PWM via I2C addr 0x40)
```

### 3.2 INA219 (battery current) — I2C0 @ 0x41
```
Pico GP8/GP9 → INA SDA/SCL
INA VCC → 3V3 ; INA Vbat → VBAT line (0–26 V)
INA A0 → VCC (sets address 0x41)
INA GND → GND
```

### 3.3 VL53L0X (time-of-flight) — I2C0 @ 0x29
```
Pico GP8/GP9 → VL53 SDA/SCL
VL53 VCC → 3V3 ; XSHUT → tied HIGH (firmware never drives it)
VL53 GND → GND
```

### 3.4 MPU6050 (IMU) — I2C1 @ 0x68
```
Pico GP2 (SDA) / GP3 (SCL) → MPU SDA/SCL
MPU VCC → 3V3 ; MPU GND → GND
MPU AD0 → GND (addr 0x68)
MPU INT → not wired (firmware polls)
```

### 3.5 GPS (NEO-6M) — UART0 @ 9600
```
Pico GP0 (TX) → GPS RX
Pico GP1 (RX) → GPS TX
GPS VCC → 3V3 / VBUS
GPS GND → GND
GPS PPS → not wired
```

### 3.6 ILI9341 TFT 2.4" — SPI0
```
Pico GP16 (MISO) / GP19 (MOSI) / GP18 (SCK) → TFT
Pico GP17 (CS) → TFT CS
Pico GP4 (DC) → TFT DC/RS
Pico GP5 (RST) → TFT RST
TFT VCC → 3V3 ; TFT BL → 3V3
TFT GND → GND
```

### 3.7 nRF24L01+ PA+LNA — SPI0
```
Pico GP16 (MISO) / GP19 (MOSI) / GP18 (SCK) → nRF
Pico GP20 (CSN) → nRF CSN
Pico GP21 (CE) → nRF CE
Pico GP22 (IRQ) → nRF IRQ
nRF VCC → 3V3 (+ 10 µF + 100 nF decoupling) ; nRF PA+LNA needs stable 3.3 V @ 300 mA
nRF GND → GND
```

### 3.8 Status LEDs
```
GP15 (red)   → E-stop        GP26 (red)  → battery <5.5 V
GP27 (red)   → error/reset   GP28 (yellow) → nRF TX/RX
GP25 (green) → bridge link   GP29 (green) → sensors all OK
All: GPIO → 330 Ω → LED → GND (active HIGH, 3.3 V)
```

### 3.9 Nav buttons (7× NO tactile)
```
GP23, GP24, GP10, GP11, GP12, GP13, GP14 → each NO switch: GPIO → switch → GND
Internal pull-up, active-low, 180 ms debounce
```

### 3.10 Pico ↔ Pi
```
Pico USB (built-in) → Pi /dev/ttyACM0 @ 115200
Pico -> Pi: JSON commands (CMD_MAP) ; Pi -> Pico: JSON commands
Bridge: Pi command_endpoint (:8888) -> pico_bridge (:5000) -> Pico serial
```

## 4. Full GPIO usage summary

| GPIO | Function |
|------|----------|
| GP0 | UART0 TX → GPS RX |
| GP1 | UART0 RX ← GPS TX |
| GP2 | I2C1 SDA → MPU6050 |
| GP3 | I2C1 SCL → MPU6050 |
| GP4 | TFT DC |
| GP5 | TFT RST |
| GP6 | E-stop touch (TTP223) |
| GP7 | Admin touch (TTP223) |
| GP8 | I2C0 SDA → PCA/INA/VL53 |
| GP9 | I2C0 SCL → PCA/INA/VL53 |
| GP10 | Nav left |
| GP11 | Nav right |
| GP12 | Nav select |
| GP13 | Nav menu |
| GP14 | Nav options |
| GP15 | Status LED estop (red) |
| GP16 | SPI0 MISO → TFT/nRF |
| GP17 | SPI0 CS → TFT |
| GP18 | SPI0 SCK → TFT/nRF |
| GP19 | SPI0 MOSI → TFT/nRF |
| GP20 | SPI0 CSN → nRF |
| GP21 | SPI0 CE → nRF |
| GP22 | SPI0 IRQ → nRF |
| GP23 | Nav up |
| GP24 | Nav down |
| GP25 | Status LED bridge/onboard (green) |
| GP26 | Status LED battery (red) |
| GP27 | Status LED error (red) |
| GP28 | Status LED nRF (yellow) |
| GP29 | Status LED sensors (green) |

## 5. Open / free pins

- None currently free on the Pico 2 W header after this iteration — all GP0–GP29 are assigned.
- If you add the suggested spare LEDs (overcurrent red, watchdog green, Pi-link yellow), you will need an I/O expander (e.g., PCF8574) or repurpose nav/status slots.

## 6. Deploy

```bash
mpremote connect /dev/ttyACM0 cp software/firmware/pico_main.py pico_main.py
```
