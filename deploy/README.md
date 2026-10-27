# Sipher Auto-Deploy

Pulls new commits from `main` on the Pi and restarts the Sipher services.
Repo location on the Pi: `/home/sipher/sipher`.

## What's here

| Path | Purpose |
|---|---|
| `update.sh` | Fetch + pull `main`, restart active services |
| `pi-firewall.sh` | Idempotent UFW baseline (SSH from LAN, dashboard port 8888) |
| `systemd/` | Units installed on the Pi |
| `sudoers.d/sipher-deploy` | Passwordless restart for exactly the Sipher services |
| `udev/99-sipher-pico.rules` | `/dev/sipher-pico` symlink for the Pico |

### Systemd units

| Unit | Purpose |
|---|---|
| `sipher-command-endpoint.service` | Layer 4 HTTP API + dashboard (`software/control/`) |
| `sipher-instincts.service` | Layer 2 instincts loop (`software/robot/`) |
| `sipher-deploy.service` + `.timer` | Scheduled pull-and-restart |

`update.sh` also restarts `sipher-bridge`, `sipher-logger`, and `sipher-voice`
when they are active. Those units are installed directly on the Pi.

## Mode A: Cron (simple)

```bash
chmod +x update.sh
(crontab -l 2>/dev/null; echo "*/5 * * * * /home/sipher/deploy/update.sh") | crontab -
```

## Mode B: Systemd timer (reliable)

```bash
sudo cp systemd/sipher-deploy.service systemd/sipher-deploy.timer /etc/systemd/system/
sudo cp sudoers.d/sipher-deploy /etc/sudoers.d/sipher-deploy
sudo chmod 440 /etc/sudoers.d/sipher-deploy
sudo systemctl daemon-reload
sudo systemctl enable --now sipher-deploy.timer
```

## Mode C: Instant deploy (SSH alias)

After `git push` from your laptop, trigger the Pi instantly:

```powershell
ssh -i C:\Users\indra\.ssh\id_rsa sipher@192.168.1.35 "/home/sipher/deploy/update.sh"
```

Add to your PowerShell profile as `git-push-and-deploy`.

## Log

`/home/sipher/deploy/pull.log` — all fetch/pull/restart activity.
