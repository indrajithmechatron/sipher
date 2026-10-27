# Voice Layer

**Layer 1** of the Sipher architecture. See `docs/ARCHITECTURE.md` for full spec.

## Key Files

| File | Purpose |
|---|---|
| `always_on.py` | Always-listening loop: `arecord` capture, faster-whisper (or Groq) transcription, espeak/piper replies, intent trigger for "rotate" / "stop". |

## Rules

- May only emit structured requests to the Robot Runtime (`software/robot/`).
- Must not open the serial port, write servo PWM, or bypass the control layer.
- `always_on.py` still actuates directly; fixing that is Phase 4 in
  `docs/reports/architecture-inspection-report.md`.

## Run

```bash
python3 always_on.py            # local mic + faster-whisper
GROQ_API_KEY=... python3 always_on.py   # Groq transcription
```
