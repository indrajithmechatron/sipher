# Control Layer

**Layer 4** of the Sipher architecture. See `docs/ARCHITECTURE.md` for full spec.

## Key Files

- `command_endpoint.py` — HTTP server on port 8888: serves dashboard, `/api/sensors`, `/api/bridge_cmd`, `/command`, `/api/rag/*`
- `joint_limits.py` — (planned) min/max angles per servo
- `inverse_kinematics.py` — (planned) foot trajectory from body velocity
- `gait_generator.py` — (planned) tripod, wave, trot patterns
- `emergency_stop.py` — (planned) software E-Stop

## Running

```bash
PYTHONPATH=/home/sipher/sipher/software python3 -m control.command_endpoint
```

Systemd: `deploy/systemd/sipher-command-endpoint.service`

## Remote commands (`POST /command`)

The endpoint is reachable from the LAN, so it is **not a shell**: the request
body is `{"command": "..."}`, parsed with `shlex` and validated against a small
table, then executed as an argv (`shell=False`).

| Program | Allowed |
|---|---|
| `systemctl` | `status`, `is-active`, `is-enabled`, `show`, `list-units`, `list-timers` on `sipher-*` units only |
| `git` | read-only subcommands (`status`, `log`, `diff`, `show`, `rev-parse`, `remote`, `describe`, `ls-files`) plus `pull`/`fetch`, inside the repo only |
| `cat` | one file under `SIPHER_REPO_DIR` or `SIPHER_LOG_DIR` |
| `tailscale` | `status`, `ip`, `version` |

Everything else is rejected — notably `python3 …`, state-changing `systemctl`
verbs, `git push/reset`, flags that make git execute another program (`-c`,
`--exec-path`, `--upload-pack`, …), and any string containing shell
metacharacters (`; & | \` $ < >`) or newlines.

Access control:

- Set `SIPHER_COMMAND_TOKEN` (systemd `Environment=` or `/etc/sipher.env`) and
  clients must send `X-Sipher-Token`. Use this before exposing the port beyond
  the LAN.
- Without a token, only loopback/private/link-local clients are accepted (a
  port-forward or public address gets `403`), and a warning is logged at start.

Tests (stdlib unittest, no hardware needed):

```bash
python -m unittest discover -s software/control/tests -t software
```
