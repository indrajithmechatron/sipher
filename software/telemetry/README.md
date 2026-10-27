# Telemetry Layer

**Layer 6** of the Sipher architecture. See `docs/ARCHITECTURE.md` for full spec.

## Key Files

| File | Purpose |
|---|---|
| `pi_logger.py` | Subscribes to the Layer 2 bridge TCP stream (`:5000`) and appends JSON lines to `/home/sipher/sipher.log`. |

## Run

```bash
python3 pi_logger.py
# or, with an explicit bridge
SIPHER_BRIDGE_HOST=127.0.0.1 SIPHER_LOG_FILE=/home/sipher/sipher.log python3 pi_logger.py
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SIPHER_BRIDGE_HOST` | `127.0.0.1` | Bridge TCP host |
| `SIPHER_BRIDGE_PORT` | `5000` | Bridge TCP port |
| `SIPHER_LOG_FILE` | `/home/sipher/sipher.log` | Append-only JSON-lines log |

## Rules

- Never opens `/dev/ttyACM0` — Layer 2 (`software/robot/pico_bridge.py`) owns the serial port.
- Reconnects every 5 s if the bridge drops; never buffers unbounded data.

## Relationship to retrieval

`sipher.log` is part of the RAG corpus: the retrieval layer tails the last
512 KB of `SIPHER_LOG_FILE` (same variable) so questions like "what happened
before the stop" can be answered from real telemetry. See
`software/rag/README.md`.
