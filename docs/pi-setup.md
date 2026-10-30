# sipher — Raspberry Pi 4 (Quadruped Brain)

Hostname `sipher` (`192.168.1.37/24` **static**), Ubuntu 24.04.4 LTS `noble` on Pi 4, user `sipher`.

## Network — static (verified 2026-10-30)

- `MAC 2c:cf:67:8d:0f:57` → `wlan0 192.168.1.37/24`, default route via `192.168.1.1`
- Netplan `/etc/netplan/50-cloud-init.yaml`: `wlan0` `dhcp4: false` +
  `addresses [192.168.1.37/24]` + route `to: default via 192.168.1.1` +
  `nameservers [192.168.1.1, 8.8.8.8, 1.1.1.1]` → `proto static`
- `eth0` is link-local only (`169.254.191.88/16`)
- `192.168.1.35` — the address this page used to document — no longer answers;
  the Pi has been on `.37` since the Wi-Fi/netplan change, and both the dashboard
  (`SIPHER_API`) and `deploy/systemd/sipher-command-endpoint.service` (`PI_IP`) use it.
- `sipher.local` currently resolves over mDNS to the IPv6 link-local address only
  (`fe80::2ecf:67ff:fe8d:f57`), so prefer the IPv4 address in scripts.

## Audio — USB mic (ready)
- `08bb:2902 Texas Instruments PCM2902` / `C-Media USB PnP` → `card 3 [Device]` `pcmC3D0c` `controlC3`
- Installed `alsa-utils`, added `sipher` to `audio,plugdev,dialout`
- Test: `arecord -D plughw:CARD=Device,DEV=0 -f S16_LE -r 16000 -d 2 /tmp/mic_test.wav` → `63K WAV` OK

## Pico 2 W — USB `ttyACM0` (ready)
- `2e8a:0005 MicroPython Board in FS mode` → `/dev/ttyACM0` (`by-id ...0aabae125f27cba3-if00`)
- `MicroPython v1.28.0 on 2026-04-06, RP2350, Pico 2 W`
- Tool `~/.local/bin/mpremote 1.29.0` via `pip3 --break-system-packages`
- Use: `/home/sipher/.local/bin/mpremote a0 exec "import sys; print(sys.version)"`

## SSH access — key-only (done 2026-10-30)

Admin access uses an ed25519 key, installed from the Windows workstation:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\ssh-key-setup.ps1
powershell -ExecutionPolicy Bypass -File deploy\ssh-key-setup.ps1 -DisablePasswordAuth
```

- Key: `~/.ssh/id_ed25519_sipher` on the workstation; public half appended to
  `/home/sipher/.ssh/authorized_keys` on the Pi.
- The script pins `Host sipher` in `~/.ssh/config` (currently `192.168.1.37`,
  `IdentitiesOnly yes`), so `ssh sipher` uses this key and nothing else.
- Re-running is safe: the install step is skipped when the key already logs in,
  and it falls back to an existing working key when password login is already
  refused. `-DisablePasswordAuth` writes
  `/etc/ssh/sshd_config.d/99-sipher-keyonly.conf` only when it can read the
  effective sshd config (otherwise it prints what to check).
- On this Pi password auth is already off via
  `/etc/ssh/sshd_config.d/00-sipher.conf` (`PasswordAuthentication no`,
  `KbdInteractiveAuthentication no`), so a password login is refused even
  though the OS password still works on the physical console.
- The login password is deliberately **not** recorded in this repository.
- Firewall: `deploy/pi-firewall.sh` allows `22/tcp` from the LAN only and
  `8888/tcp` from the LAN + tailnet.

## Next
- Wire Dejavu/Shazam + Piper/Groq voice loop to `hw:3,0` for Shazam/Muse voice.
- Pico `main.py` for quadruped servos via `sipher` UART/I2C.

Last verified: 2026-10-30 — `ssh sipher` key-only, dashboard `:8888`, RAG `/api/rag/*`
