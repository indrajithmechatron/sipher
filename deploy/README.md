# Sipher Auto-Deploy

Pulls new commits from `main` on the Pi and restarts the Sipher services.
Repo location on the Pi: `/home/sipher/sipher`.

## What's here

| Path | Purpose |
|---|---|
| `update.sh` | Fetch + pull `main`, restart active services (falls back to `reset --hard` if upstream history was rewritten) |
| `ssh-key-setup.ps1` | Install the workstation's ed25519 key on the Pi (key-only SSH) |
| `pi-firewall.sh` | Idempotent UFW baseline (SSH from LAN; dashboard port 8888 from LAN + tailnet) |
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
ssh sipher "/home/sipher/deploy/update.sh"
```

Add to your PowerShell profile as `git-push-and-deploy`.

The `sipher` alias comes from `ssh-key-setup.ps1` (see below).

## SSH keys (key-only admin access)

```powershell
# once, while the Pi is on the network (prompts for the login password once)
powershell -ExecutionPolicy Bypass -File deploy\ssh-key-setup.ps1

# then, to stop accepting passwords over SSH
powershell -ExecutionPolicy Bypass -File deploy\ssh-key-setup.ps1 -DisablePasswordAuth
```

The script generates `~/.ssh/id_ed25519_sipher`, appends it to
`~/.ssh/authorized_keys` on the Pi, verifies a prompt-free login, and pins a
`Host sipher` entry in `~/.ssh/config`. It probes `sipher.local`, then
`192.168.1.35`, then `192.168.1.37`, so it works whichever address the Pi
answers on.

`-DisablePasswordAuth` writes `/etc/ssh/sshd_config.d/99-sipher-keyonly.conf`
and reloads sshd. The OS login password is **not** disabled by this: it stays
valid on the physical console for recovery. Keep a working key (or a keyboard
and monitor) before running it.

## Log

`/home/sipher/deploy/pull.log` — all fetch/pull/restart activity.

## Behaviour notes

- **Fast-forward only.** `update.sh` pulls with `--ff-only` so a dirty Pi can
  never silently produce a merge commit.
- **Rewritten upstream.** If local `HEAD` is no longer an ancestor of
  `origin/main` (history was scrubbed, as when credentials are purged), the
  script logs `local history diverged` and resets to `origin/main` instead of
  failing and leaving the services on old code. The Pi is a deploy target, so
  local commits there are always discarded.
- **Services** are restarted only when they are active, using the narrow
  `sudoers.d/sipher-deploy` rule — no blanket passwordless sudo.
- **Firewall scope.** `pi-firewall.sh` opens `22/tcp` from the LAN only, and
  `8888/tcp` (dashboard, `/command`, `/api/rag/*`) from the LAN plus Tailscale
  (`100.64.0.0/10`, interface `tailscale0`). It deletes any older blanket
  `ufw allow 8888/tcp` rule and fails if one is still present, so remote access
  goes through the tailnet rather than the public internet.

