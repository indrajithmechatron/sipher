# Control Layer

**Layer 4** of the Sipher architecture. See `docs/ARCHITECTURE.md` for full spec.

## Key Files

| File | Purpose |
|---|---|
| `command_endpoint.py` | HTTP server on `:8888`: dashboard bundle, sensor poller, restricted commands, `/api/rag/*` |
| `joint_limits.py` | (planned) min/max angles per servo |
| `inverse_kinematics.py` | (planned) foot trajectory from body velocity |
| `gait_generator.py` | (planned) tripod, wave, trot patterns |
| `emergency_stop.py` | (planned) software E-Stop |

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/`, `/dashboard` | GET | Built dashboard (`dashboard/dist/index.html`) |
| `/assets/*` | GET | Dashboard static assets |
| `/api/sensors` | GET | Latest snapshot polled from the bridge |
| `/api/pi` | GET | CPU, temperature, disk, uptime |
| `/api/info` | GET | Host/build info |
| `/api/map` | GET | ToF occupancy grid |
| `/api/rag/*` | GET/POST | Retrieval layer (`software/rag/`) |
| `/api/bridge_cmd` | POST | Forward a command to the bridge over TCP `:5000` |
| `/command` | POST | Run an allowlisted argv (no shell) |
| `/health` | GET | Liveness |

The RAG routes are mounted here rather than on a second port so the dashboard's
existing `/api` proxy reaches them unchanged. They are imported lazily on the
first request, so a broken index never stops the endpoint from booting.

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

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SIPHER_PORT` | `8888` | Listen port |
| `SIPHER_REPO_DIR` | `/home/sipher/sipher` | Repo root: dashboard bundle, RAG corpus, `git`/`cat` scope |
| `SIPHER_LOG_DIR` | `/home/sipher/logs` | Allowed directory for `cat` in `/command` |
| `SIPHER_COMMAND_TOKEN` | unset | Shared secret required in `X-Sipher-Token` |
| `SIPHER_PICO_SERIAL` | `/dev/ttyACM0` | Serial device used by `/command` helpers |
| `SIPHER_PICO_BAUD` | `115200` | Serial baud rate |
| `SIPHER_BRIDGE_SENSOR_URL` | `http://localhost:5001/sensor` | Bridge sensor poll |
| `SIPHER_BRIDGE_MAP_URL` | `http://localhost:5001/map` | Bridge occupancy map |

Operator commands (`/api/bridge_cmd`) are written straight to the bridge's TCP
stream on `127.0.0.1:5000` and answered on the same socket.

Sibling packages (`rag`, `robot`, ...) are added to `sys.path` automatically,
so the server also runs without `PYTHONPATH` when started from the repo.

## Boundaries

- ❌ No servo PWM or I2C/SPI access here — that is Layer 5 firmware.
- ❌ No gait decisions in the HTTP handlers; they belong to the control modules
  listed above once implemented.
- ✅ `/command` runs only the allowlisted programs above, as an argv, with
  `cwd` set to `SIPHER_REPO_DIR`.

## Tests

```bash
PYTHONPATH=software python -m unittest discover -s software/control/tests -t software
```
