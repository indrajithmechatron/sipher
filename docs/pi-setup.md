# sipher — Raspberry Pi 4 (Quadruped Brain)

Hostname `sipher` (`192.168.1.35/24` **static**), Ubuntu 24.04.4 LTS `noble` on Pi 4, `sipher/marin26`.

## Network — static (done 2026-09-04)
- `MAC 2c:cf:67:8d:0f:57` → `wlan0 192.168.1.35/24` `via 192.168.1.1`
- `mDNS sipher.local` also works
- Netplan `50-cloud-init.yaml` `dhcp4: false` + `addresses [192.168.1.35/24]` + `gateway4 192.168.1.1` + `nameservers [192.168.1.1,8.8.8.8,1.1.1.1]` → `proto static`
- `sipher.local` → `192.168.1.35` (A) + `fe80::2ecf:67ff:fe8d:f57` (AAAA)

## Audio — USB mic (ready)
- `08bb:2902 Texas Instruments PCM2902` / `C-Media USB PnP` → `card 3 [Device]` `pcmC3D0c` `controlC3`
- Installed `alsa-utils`, added `sipher` to `audio,plugdev,dialout`
- Test: `arecord -D plughw:CARD=Device,DEV=0 -f S16_LE -r 16000 -d 2 /tmp/mic_test.wav` → `63K WAV` OK

## Pico 2 W — USB `ttyACM0` (ready)
- `2e8a:0005 MicroPython Board in FS mode` → `/dev/ttyACM0` (`by-id ...0aabae125f27cba3-if00`)
- `MicroPython v1.28.0 on 2026-04-06, RP2350, Pico 2 W`
- Tool `~/.local/bin/mpremote 1.29.0` via `pip3 --break-system-packages`
- Use: `/home/sipher/.local/bin/mpremote a0 exec "import sys; print(sys.version)"`

## Next
- Wire Dejavu/Shazam + Piper/Groq voice loop to `hw:3,0` for Shazam/Muse voice.
- Pico `main.py` for quadruped servos via `sipher` UART/I2C.

Last verified: 2026-09-04 `ssh sipher@sipher.local`
