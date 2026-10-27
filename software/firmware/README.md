# Firmware Layer

**Layer 5** of the Sipher architecture — MicroPython on the Pico 2 W (RP2350).
See `docs/ARCHITECTURE.md` for full spec.

## Key Files

| File | Purpose |
|---|---|
| `main.py` | Boot coordinator; settles the board, then starts `pico_main`. |
| `pico_main.py` | Sensor polling loop, PCA9685 servo output, JSON serial telemetry. |
| `boot_logo.py` | Blits the `anime.rgb565` framebuffer to the ILI9341 at boot. |
| `ili9341.py` | ILI9341 240x320 TFT driver (SPI0). |
| `nrf24l01.py` | nRF24L01+ 2.4 GHz radio driver (SPI0, shared with the TFT). |
| `show_image_now.py` | Dev helper: draw `anime.rgb565` once via `mpremote`, bypassing the main loop. |

## Flash

```bash
mpremote connect /dev/ttyACM0 cp main.py pico_main.py boot_logo.py ili9341.py nrf24l01.py :
mpremote connect /dev/ttyACM0 cp anime.rgb565 :
mpremote connect /dev/ttyACM0 reset
```

`anime.rgb565` is a generated 320x240 framebuffer and is not tracked in git;
copy it to the Pico separately.
