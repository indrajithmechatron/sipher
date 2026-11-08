# Sipher — Status Indicator LEDs & Nav Buttons: Wiring / Pin Map

> Scope: physical status LEDs (red / green / yellow) on the robot, and the 7-button
> tactile navigation pad. Firmware owner: `software/firmware/pico_main.py`.

## 1. Status indicator LEDs

### 1.1 Behaviour spec (user-confirmed)

| # | LED | Colour | Condition | Behaviour | Firmware source |
|---|-----|--------|-----------|-----------|-----------------|
| 1 | E-stop | RED | E-stop asserted | Solid ON while active, OFF when cleared | `_estop_active` (hardware IRQ + software) |
| 2 | Battery | RED | Battery voltage < 5.5 V | **Solid ON** = fine (OK), **blink** = less than 5.5 V | INA219 `voltage_v` via `_last_sensors` (`_BATTERY_LOW_V = 5.5`) |
| 3 | Error / manual reset | RED | Manual reset needed | **Blink** = reset needed, OFF when OK | `_op_mode == "reset"` |
| 4 | Bridge | GREEN | Pi ↔ bridge ↔ dashboard link | **Solid ON** = connected, **blink** = trying to connect | Bridge heartbeat (`cmd_heartbeat` every 5 s from `pico_bridge`) |
| 5 | Sensors | GREEN | All used sensors live/working | **Solid ON** = all OK, **blink** = any sensor data missing | `_last_sensors` I2C scan + sensor reads |
| 6 | nRF radio | YELLOW | TX / RX activity | **Blink** = fetching/receiving, **solid ON** = waiting for signal / connected | `_nrf_activity` (nrf_send / nrf_recv / nrf_init) |

User-supplied (blank entries in the earlier list — recommended assignments):
- RED #7 (4th red): **servo rail overcurrent / brownout latch** — spare, wire to a spare GPIO if needed.
- GREEN #3 (3rd green): **system / heartbeat watchdog** — spare.
- YELLOW #2 (2nd yellow): **Wi-Fi / Ethernet link on Pi** — driven Pi-side, blink = no link.

### 1.2 Wiring (Pico → LED)

```
Pico GPIO ----[ 330 ohm ]----> LED anode (long leg) ----> LED cathode (short leg) ----> GND
```

- Active **HIGH** (Pico drives 3.3 V logic; Pico GPIO source ≈ 20 mA — fine for ≤ 5 mA LEDs).
- Resistor: **330 Ω** (or 220 Ω) series. Typical current ≈ (3.3 − 2.0) / 330 ≈ 4 mA.
- Common **star GND** with the rest of the robot (single ground point at Pico GND).
- No LED needed for e-stop if you later wire a MOSFET; current design is direct.

### 1.3 Firmware implementation

- Status LED pin/mode/state tables: `_STATUS_LED_PINS`, `_STATUS_LED_MODES`, `_STATUS_LED_STATE`, `_STATUS_LED_BLINK_MS`, `_STATUS_LED_PHASE(_MS)`, `_STATUS_LED_TICK_MS`.
- `_status_leds_tick()` runs every loop (~100 ms throttle) → `_status_led_write(name)` applies level/blink.
- `estop` / `battery` / `sensors` / `bridge` / `nrf` are **auto**; `error` is **blink**.
- E-stop hardware path: `ESTOP_PIN` (GP6, TTP223 touch) → `_estop_trigger()` → `_estop_active` → red LED solid.
- Battery path: INA219 (`INA_ADDR 0x41`) → `read_ina()` → `voltage_v` → `_BATTERY_LOW_V = 5.5` → red LED solid/blink.
- Bridge path: `pico_bridge.py` sends `{"cmd": "heartbeat"}` every 5 s → Pico `cmd_heartbeat()` → `_last_hb_ms` → green LED solid/blink (disconnect after 10 s).
- Error path: `_op_mode == "reset"` → red error LED blinks.

### 1.4 Note on battery thresholds

- Status LEDs use **`_BATTERY_LOW_V = 5.5`** (user spec: < 5.5 V → blink; ≥ 5.5 V → solid).
- The older op-mode low-battery constant `_LOW_BATT_V = 10.5` is untouched (TFT mode semantics).

## 2. Nav buttons (7× tactile, 4-pin style NO)

### 2.1 Behaviour

| Button | Action | Firmware input |
|--------|--------|----------------|
| up | north / mode-select-up | `up` |
| select | centre / apply | `select` |
| down | south / mode-select-down | `down` |
| right | east / view-cycle | `right` |
| left | west / channel-cycle | `left` |
| menu | south-west / menu | `menu` |
| options | south-east / options | `options` |

(Please confirm the compass labelling you want; firmware action mapping is in `_handle_button`.)

### 2.2 Wiring (tactile NO momentary, 2-conductor equivalent / 4-pin per switch)

```
GPIO ----[ switch ]---- GND
```

- **Normally Open** (NO) momentary.
- Pico internal **pull-up** (`machine.Pin(pin, Pin.IN, Pin.PULL_UP)`) → unpressed = HIGH, pressed = LOW (active-low).
- Debounce: `_BTN_DEBOUNCE_MS = 180`.

### 2.3 Firmware pin assignment (Pico 2 W)

| Button | GPIO | Notes |
|--------|------|-------|
| up | **GP23** | was GP6 (conflict — GP6 = E-stop) |
| down | **GP24** | was GP7 (conflict — GP7 = admin unlock) |
| left | GP10 | |
| right | GP11 | |
| select | GP12 | |
| menu | GP13 | |
| options | GP14 | |

- GP6 / GP7 are reserved for the E-stop (TTP223) and admin-unlock (TTP223) touch sensors.
- All 7 nav buttons are polled by `buttons_poll()` → `_handle_button()`.

## 3. Full Pico 2 W pin map (status + nav, this iteration)

| Signal | Pin | Function |
|--------|-----|----------|
| E-stop LED | GP15 | red, solid on = estop |
| Battery LED | GP26 | red, solid = OK / blink = <5.5 V |
| Error LED | GP27 | red, blink = reset needed |
| nRF LED | GP28 | yellow, solid = idle / blink = TX/RX |
| Bridge LED | GP25 | green, onboard, solid = connected / blink = trying |
| Sensors LED | GP29 | green, solid = all OK / blink = missing |
| Nav up | GP23 | NO, active-low, pull-up |
| Nav down | GP24 | NO, active-low, pull-up |
| Nav left | GP10 | NO, active-low, pull-up |
| Nav right | GP11 | NO, active-low, pull-up |
| Nav select | GP12 | NO, active-low, pull-up |
| Nav menu | GP13 | NO, active-low, pull-up |
| Nav options | GP14 | NO, active-low, pull-up |

Previously-used pins (do not reuse): GP0/GP1 UART0 (GPS), GP2/GP3 I2C1 (MPU), GP4/GP5 TFT, GP6 E-stop, GP7 admin, GP8/GP9 I2C0, GP16–GP22 SPI/nRF, GP25 onboard LED/bridge, GP26/27/28/29 status LEDs, GP23/24 nav.

## 4. Pi side

- Bridge link LED (green) is Pico-driven via heartbeat; Pi → `command_endpoint.py` (:8888) → `pico_bridge.py` (:5000) → Pico serial (`{"cmd":"heartbeat"}`).
- Pi dashboard HealthStrip mirrors Pico statuses (Pico live / sensors / battery / estop).
- Nav buttons drive the **Pico TFT UI** via firmware; the Pi dashboard nav stays keyboard/browser-driven for now.

## 5. Deploy

```bash
mpremote connect /dev/ttyACM0 cp firmware/pico_main.py pico_main.py
```
